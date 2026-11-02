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
  type RecallHit,
} from '../src/recall.js';

function hit(id: string, content: string, extra: Partial<RecallHit> = {}): RecallHit {
  return { id, kind: 'fact', content, ...extra };
}

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
  it('剔除 sensitive 与 local_only，保留普通记忆', () => {
    const hits = [
      hit('a', '普通内容'),
      hit('b', '敏感内容', { sensitivity: 'sensitive' }),
      hit('c', '本机内容', { syncPolicy: 'local_only' }),
      hit('d', 'blocked 内容', { sensitivity: 'blocked' }),
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
