/**
 * 插件召回逻辑的单测。
 *
 * CI 只能覆盖这些纯逻辑；插件与 DSH 的集成（事件是否触发、注入是否真进上下文）
 * 无法自动断言，只能手工冒烟并如实标注（design D6）。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createDedupeState,
  filterInjectable,
  renderInjection,
  shouldInject,
  toRecallHit,
  type RecallHit,
} from '../src/recall.js';

function hit(id: string, content: string, extra: Partial<RecallHit> = {}): RecallHit {
  return { id, kind: 'fact', content, ...extra };
}

import { isStopTerm, rankHits, scoreHit, containsTerm } from '../src/recall.js';

describe('相关性：虚词不算证据（2026-11-02 实测：视频会话里冒出别的项目的记忆）', () => {
  it('虚词二元组进黑名单，有实义的二字词不进', () => {
    for (const w of ['一个', '这个', '可以', '我们', '什么', '时候']) assert.ok(isStopTerm(w), w);
    // 误伤检查：这些是中文检索里最有效的单元，必须留住
    for (const w of ['记忆', '投影', '视频', '剪辑', '同步', '授权']) assert.ok(!isStopTerm(w), w);
  });

  it('计分只认正文里真的出现、且不是虚词的词', () => {
    const hit = '跨设备共享记忆统一走 Cairn';
    assert.equal(scoreHit(hit, ['记忆']).score, 1, '实义二字词 1 分');
    assert.equal(scoreHit(hit, ['共享记忆']).score, 2, '三字短语 2 分');
    assert.equal(scoreHit(hit, ['一个']).score, 0, '虚词不计分');
    assert.equal(scoreHit(hit, ['视频']).score, 0, '正文里没有的词不计分');
    assert.ok(containsTerm('Cairn', 'cairn'), '大小写无关');
  });

  it('排序：强词命中排在被虚词捞回来的前面', () => {
    const noise: { id: string; kind: string; content: string } = { id: 'n', kind: 'fact', content: '这个项目里有一个东西' };
    const good: { id: string; kind: string; content: string } = { id: 'g', kind: 'fact', content: '视频剪辑要注意音量' };
    const out = rankHits([
      { hit: noise, terms: ['这个'] },
      { hit: good, terms: ['视频'] },
    ], 2);
    assert.deepEqual(out.map((h) => h.id), ['g', 'n'], '有实义的命中必须在前');
  });

  it('截断按分数而不是按查询顺序', () => {
    const a = { id: 'a', kind: 'fact', content: '这个' };
    const b = { id: 'b', kind: 'fact', content: '视频剪辑' };
    const out = rankHits([{ hit: a, terms: ['这个'] }, { hit: b, terms: ['视频剪辑'] }], 1);
    assert.deepEqual(out.map((h) => h.id), ['b'], '预算只够一条时给最相关的那条');
  });
});

describe('shouldInject：开关与语义门槛', () => {
  it('关闭时绝不注入', () => {
    const d = shouldInject({ enabled: false, alreadyInjected: new Set(), message: '这是一条足够长的查询' });
    assert.equal(d.inject, false);
    assert.equal(d.reason, 'disabled');
  });

  it('极短消息不触发召回（没有可检索语义）', () => {
    const d = shouldInject({ enabled: true, alreadyInjected: new Set(), message: '继续' });
    assert.equal(d.inject, false);
    assert.equal(d.reason, 'empty_message');
  });

  it('正常长短消息在开启时注入', () => {
    const d = shouldInject({ enabled: true, alreadyInjected: new Set(), message: '请帮我查一下投影预算怎么算' });
    assert.equal(d.inject, true);
  });
});

describe('filterInjectable：注入前的最后一道闸', () => {
  it('剔除 sensitive 与 local_only，保留普通记忆（闸要求标签齐全：fail-closed）', () => {
    const hits = [
      hit('a', '普通内容', { sensitivity: 'normal', syncPolicy: 'encrypted' }),
      hit('b', '敏感内容', { sensitivity: 'sensitive', syncPolicy: 'encrypted' }),
      hit('c', '本机内容', { sensitivity: 'normal', syncPolicy: 'local_only' }),
      hit('d', 'blocked 内容', { sensitivity: 'blocked', syncPolicy: 'encrypted' }),
    ];
    const out = filterInjectable(hits);
    assert.deepEqual(out.map((h) => h.id), ['a']);
  });
});

describe('renderInjection：预算与去重', () => {
  it('空命中返回空文本', () => {
    const r = renderInjection([], { budgetBytes: 1024 });
    assert.equal(r.text, '');
    assert.equal(r.selected, 0);
  });

  it('已注入过的条目不再出现', () => {
    const r = renderInjection([hit('a', '内容甲'), hit('b', '内容乙')], {
      budgetBytes: 4096,
      alreadyInjected: new Set(['a']),
    });
    assert.ok(r.text.includes('内容乙'));
    assert.ok(!r.text.includes('内容甲'));
  });

  it('全部已注入时返回空文本（不产生空注入）', () => {
    const r = renderInjection([hit('a', '内容甲')], { budgetBytes: 4096, alreadyInjected: new Set(['a']) });
    assert.equal(r.text, '');
  });

  it('任意预算下输出字节不超预算', () => {
    const hits = Array.from({ length: 30 }, (_, i) => hit('id' + i, '撑爆预算的内容编号 ' + i + '，需要足够长才会触发裁剪逻辑。'));
    for (const budget of [60, 120, 300, 600, 1536, 4096]) {
      const r = renderInjection(hits, { budgetBytes: budget });
      const actual = Buffer.byteLength(r.text, 'utf8');
      assert.ok(actual <= budget, `预算 ${budget} 下实际 ${actual} 超限`);
    }
  });

  it('超预算时写明省略条数', () => {
    const hits = Array.from({ length: 20 }, (_, i) => hit('id' + i, '内容 ' + i + ' '.repeat(50) + '填充让每行变长'));
    const r = renderInjection(hits, { budgetBytes: 200 });
    assert.ok(r.truncated > 0);
    assert.ok(/另 \d+ 条未显示/.test(r.text));
  });

  it('同输入同字节（不含时间戳）', () => {
    const hits = [hit('a', '稳定内容'), hit('b', '另一条')];
    const r1 = renderInjection(hits, { budgetBytes: 2048 });
    const r2 = renderInjection(hits, { budgetBytes: 2048 });
    assert.equal(r1.text, r2.text);
    assert.ok(!/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(r1.text), '不得含 ISO 时间戳');
  });
});

describe('去重状态', () => {
  it('记录与查询', () => {
    const s = createDedupeState();
    s.add(['a', 'b']);
    assert.ok(s.has('a'));
    assert.ok(!s.has('c'));
    assert.equal(s.size(), 2);
  });

  it('会话压缩后重置，同一 id 可再次注入', () => {
    const s = createDedupeState();
    s.add(['a']);
    assert.ok(s.has('a'));
    s.reset();
    assert.ok(!s.has('a'), '压缩后必须允许重新注入');
    assert.equal(s.size(), 0);
  });
});
describe('注入与面板摘要必须同源（2026-11-02 缺陷）', () => {
  it('frontmatter 记忆在注入文本里显示 name，不是 ---', () => {
    const r = renderInjection(
      [{ id: 'a', kind: 'procedure', content: '---\nname: 交付先归档\ndescription: 说明\n---\n正文' }],
      { budgetBytes: 2048 },
    );
    assert.ok(r.text.includes('交付先归档'), '必须用 name 作摘要');
    assert.ok(!/^- \[procedure\] ---$/m.test(r.text), '不能只显示横线');
  });
});
describe('includedIds：不靠文本反推（2026-11-02 两次踩坑）', () => {
  it('长内容（渲染行截断 160）也必须返回在 includedIds 里', () => {
    const long = '[标签] 正文' + 'x'.repeat(2400);
    const r = renderInjection([{ id: 'w', kind: 'fact', content: long }], { budgetBytes: 1536 });
    assert.deepEqual(r.includedIds, ['w'], '长内容曾被 toSummary(60) 与渲染行(160) 的长度差搞挂');
    assert.equal(r.selected, 1);
  });

  it('被预算裁掉的条目不出现在 includedIds', () => {
    const hits = Array.from({ length: 20 }, (_, i) => ({ id: 'id' + i, kind: 'fact', content: '内容 ' + i + ' ' + 'y'.repeat(80) }));
    const r = renderInjection(hits, { budgetBytes: 400 });
    assert.ok(r.includedIds.length < hits.length, '必须有被裁掉的');
    assert.equal(r.includedIds.length, r.selected, 'includedIds 长度必须等于 selected');
  });

  it('空命中时 includedIds 为空数组', () => {
    assert.deepEqual(renderInjection([], { budgetBytes: 1024 }).includedIds, []);
  });
});

describe('注入闸：基于真实元数据过滤 + fail-closed（add-memory-scope-visibility）', () => {
  const full = (extra: Partial<RecallHit> = {}): RecallHit => ({
    id: 'm1', kind: 'fact', content: '内容', sensitivity: 'normal', syncPolicy: 'encrypted', ...extra,
  });

  it('normal + encrypted 放行', () => {
    assert.equal(filterInjectable([full()]).length, 1);
  });

  it('敏感（sensitive/blocked）拦截', () => {
    assert.equal(filterInjectable([full({ sensitivity: 'sensitive' })]).length, 0);
    assert.equal(filterInjectable([full({ sensitivity: 'blocked' })]).length, 0);
  });

  it('local_only 拦截', () => {
    assert.equal(filterInjectable([full({ syncPolicy: 'local_only' })]).length, 0);
  });

  it('字段缺失宁可漏注不错注（fail-closed）：缺 sensitivity 拦截', () => {
    assert.equal(filterInjectable([full({ sensitivity: undefined })]).length, 0);
  });

  it('字段缺失宁可漏注不错注（fail-closed）：缺 syncPolicy 拦截', () => {
    assert.equal(filterInjectable([full({ syncPolicy: undefined })]).length, 0);
  });
});

describe('toRecallHit：线协议 → RecallHit 显式映射（add-memory-scope-visibility）', () => {
  it('snake_case 字段映射到 camelCase（sync_policy/scope_preset）', () => {
    const h = toRecallHit({
      id: 'm1', kind: 'fact', content: '内容', scopeId: 'uuid-1',
      scope_preset: 'personal-global', sensitivity: 'normal', sync_policy: 'encrypted',
      importance: 3, usage_count: 2,
    });
    assert.ok(h);
    assert.equal(h!.scopePreset, 'personal-global');
    assert.equal(h!.syncPolicy, 'encrypted');
    assert.equal(h!.sensitivity, 'normal');
    assert.equal(h!.scopeId, 'uuid-1');
    assert.equal(h!.importance, 3);
    assert.equal(h!.usageCount, 2);
  });

  it('字段缺失按缺省（undefined/0/null），闸随后 fail-closed', () => {
    const h = toRecallHit({ id: 'm2', kind: 'fact', content: '旧内核返回' });
    assert.ok(h);
    assert.equal(h!.syncPolicy, undefined);
    assert.equal(h!.scopePreset, undefined);
    assert.equal(h!.usageCount, 0);
    assert.equal(h!.importance, null);
    assert.equal(filterInjectable([h!]).length, 0, '缺标签 → 不可注入');
  });

  it('无 id 或非对象返回 null', () => {
    assert.equal(toRecallHit({ kind: 'fact' }), null);
    assert.equal(toRecallHit(null), null);
    assert.equal(toRecallHit('字符串'), null);
  });
});

describe('注入行携带记忆标识（add-two-stage-memory-recall）', () => {
  it('注入行以 [id16|kind] 开头，includedIds 仍是完整 id', () => {
    const fullId = '018f1a2b-3c4d-7e8f-9a0b-1c2d3e4f5a6b';
    const rendered = renderInjection(
      [hit(fullId, '投影预算是 2KB', { sensitivity: 'normal', syncPolicy: 'encrypted' })],
      { budgetBytes: 1536 },
    );
    // 16 字符：uuidv7 同毫秒写入共享前 ≥13 字符，8 字符前缀在新建库上必然歧义
    assert.match(rendered.text, /\[018f1a2b-3c4d-7e\|fact\]/, `注入行应含 16 字符标识，实际：${rendered.text}`);
    assert.equal(rendered.includedIds[0], fullId, '去重键仍是完整 id');
  });

  it('预算裁剪把标识开销算进去', () => {
    const fullId = '018f1a2b-3c4d-7e8f-9a0b-1c2d3e4f5a6b';
    // 内容很长：行 = 表头 + [id8|fact] + 160 字内容，总字节 > 预算时裁剪
    const rendered = renderInjection(
      [hit(fullId, '长'.repeat(400), { sensitivity: 'normal', syncPolicy: 'encrypted' })],
      { budgetBytes: 100 },
    );
    assert.equal(rendered.includedIds.length, 0, '预算装不下一行就不注入');
  });
});

describe('toRecallHit：预览线协议（add-two-stage-memory-recall）', () => {
  it('preview 映射为 content，content_length/truncated 不进命中形状', () => {
    const h = toRecallHit({
      id: 'm1', kind: 'fact', preview: '这是预览文本', truncated: true, content_length: 1234,
      scope_preset: 'personal-global', sensitivity: 'normal', sync_policy: 'encrypted',
    });
    assert.ok(h);
    assert.equal(h!.content, '这是预览文本');
    assert.equal(h!.syncPolicy, 'encrypted');
    assert.equal(h!.scopePreset, 'personal-global');
    assert.ok(!('truncated' in h) && !('content_length' in h), '命中形状不携带截断元数据');
  });

  it('preview 缺失时 content 为空串（不炸）', () => {
    const h = toRecallHit({ id: 'm2', kind: 'fact', sensitivity: 'normal', sync_policy: 'encrypted' });
    assert.ok(h);
    assert.equal(h!.content, '');
  });
});
