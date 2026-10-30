import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openStore, CairnStore } from '../../src/store/open.js';
import { makeTestHome, cleanupTestHome } from '../helpers.js';
import { importSnapshot } from '../../src/onboarding/import.js';
import { assignBatch, markItemPromoted } from '../../src/onboarding/batches.js';
import { computeInbox, computeSuggestions, ENGINE_VERSION } from '../../src/interfaces/console/suggestions.js';

// 合成凭据：AWS 官方文档示例 ID，非真实凭据。
const FAKE_AWS_ID = 'AKIAIOSFODNN7EXAMPLE';

interface Ctx {
  home: string;
  store: CairnStore;
  cleanup(): void;
}

function setup(): Ctx {
  const home = makeTestHome('cairn-suggest-');
  const store = openStore({ home });
  return {
    home,
    store,
    cleanup() {
      try {
        store.close();
      } catch {
        /* 已关闭 */
      }
      cleanupTestHome(home);
    },
  };
}

/** 一个来源文件 = 一个批次；用 markdown 空行分隔成条目。 */
async function importItems(ctx: Ctx, name: string, items: string[]): Promise<{ batchId: string; archiveId: string }> {
  const dir = join(ctx.home, 'sources');
  mkdirSync(dir, { recursive: true });
  const p = join(dir, name);
  writeFileSync(p, items.join('\n\n'), 'utf8');
  const outcome = await importSnapshot(ctx.store, { agentKind: 'manual', sourcePath: p });
  const archiveId = (outcome.archiveId ?? outcome.reusedArchiveId)!;
  const batchId = outcome.batchId ?? assignBatch(ctx.store, archiveId);
  return { batchId, archiveId };
}

function addMemory(ctx: Ctx, text: string): string {
  const scope = ctx.store.scopes.resolvePreset('personal-global', {});
  const m = ctx.store.memories.add(
    { kind: 'fact', content: text, scopeId: scope.id, authority: 'user_explicit', createdBy: 'cli' },
    ctx.store.identity.deviceId,
  );
  return m.id;
}

function byRule(ctx: Ctx, batchId: string): Map<string, { action: string; targetMemoryId: string | null; basis: unknown[] }> {
  const set = computeSuggestions(ctx.store, { batchId });
  const out = new Map<string, { action: string; targetMemoryId: string | null; basis: unknown[] }>();
  for (const s of set.items) out.set(s.ruleId, { action: s.action, targetMemoryId: s.targetMemoryId, basis: s.basis });
  return out;
}

test('S-BLOCKED: 命中秘密的条目建议 skip，且不回显原文', async () => {
  const ctx = setup();
  try {
    const { batchId } = await importItems(ctx, 'secret.md', ['这是一条正常条目，长度足够不被当作碎片处理。', `数据库口令泄露记录：${FAKE_AWS_ID}`]);
    const rules = byRule(ctx, batchId);
    const blocked = rules.get('S-BLOCKED');
    assert.ok(blocked != null, '应命中 S-BLOCKED');
    assert.equal(blocked!.action, 'skip');
    assert.ok(blocked!.basis.length >= 2);
    assert.ok(!JSON.stringify(blocked).includes(FAKE_AWS_ID), 'basis 不得包含原文');
  } finally {
    ctx.cleanup();
  }
});

test('S-DUP-EXACT: 与既有记忆哈希相等时建议 merge 并指向目标', async () => {
  const ctx = setup();
  try {
    const text = '部署流程第一步是先跑全量测试，再打镜像标签。';
    const memId = addMemory(ctx, text);
    const { batchId } = await importItems(ctx, 'dup.md', [text, '另一条无关的条目，足够长以避开碎片规则判定。']);
    const rules = byRule(ctx, batchId);
    const dup = rules.get('S-DUP-EXACT');
    assert.ok(dup != null);
    assert.equal(dup!.action, 'merge');
    assert.equal(dup!.targetMemoryId, memId);
    const basis = dup!.basis as { key: string; value: string | number }[];
    assert.ok(basis.some((b) => b.key === 'content_hash'));
    assert.equal(String(basis.find((b) => b.key === 'content_hash')!.value), createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 12));
  } finally {
    ctx.cleanup();
  }
});

test('S-NUMERIC-CONFLICT: 高度相似但数值不相交时建议 needs_human（不合并）', async () => {
  const ctx = setup();
  try {
    addMemory(ctx, '生产环境数据库端口是 5432，连接超时 30 秒，最大连接数 200，重试次数 3 次。');
    const { batchId } = await importItems(ctx, 'conflict.md', [
      '生产环境数据库端口是 5433，连接超时 60 秒，最大连接数 100，重试次数 5 次。',
    ]);
    const rules = byRule(ctx, batchId);
    const c = rules.get('S-NUMERIC-CONFLICT');
    assert.ok(c != null, '应命中 S-NUMERIC-CONFLICT 而不是 S-DUP-NEAR');
    assert.equal(c!.action, 'needs_human', '数值冲突绝不能自动合并');
    assert.equal(rules.has('S-DUP-NEAR'), false, '冲突判定必须优先于近似重复');
    const basis = c!.basis as { key: string }[];
    assert.ok(basis.some((b) => b.key === 'item_numbers'));
    assert.ok(basis.some((b) => b.key === 'target_numbers'));
  } finally {
    ctx.cleanup();
  }
});

test('S-DUP-NEAR: 数值一致的高度相似文本建议 merge', async () => {
  const ctx = setup();
  try {
    const memId = addMemory(ctx, '构建命令是 pnpm build，产物目录 dist，Node 版本要求 22 以上。');
    const { batchId } = await importItems(ctx, 'near.md', ['构建命令是 pnpm build，产物目录是 dist，Node 版本要求 22 以上。']);
    const rules = byRule(ctx, batchId);
    const near = rules.get('S-DUP-NEAR');
    assert.ok(near != null, `应命中近似重复，实际规则: ${[...rules.keys()].join(',')}`);
    assert.equal(near!.action, 'merge');
    assert.equal(near!.targetMemoryId, memId);
  } finally {
    ctx.cleanup();
  }
});

test('S-FRAGMENT: 过短且非列表项建议 skip', async () => {
  const ctx = setup();
  try {
    const { batchId } = await importItems(ctx, 'frag.md', ['短句一条', '这是一条足够长的正常记忆条目，用于避开碎片规则的判定阈值。']);
    const rules = byRule(ctx, batchId);
    const frag = rules.get('S-FRAGMENT');
    assert.ok(frag != null);
    assert.equal(frag!.action, 'skip');
  } finally {
    ctx.cleanup();
  }
});

test('S-FRONTMATTER: 只有 frontmatter 与标题建议 skip，有正文时不命中', async () => {
  const ctx = setup();
  try {
    const onlyMeta = ['---', 'title: 说明', 'tags: [a, b]', '---', '# 标题'].join('\n');
    const withBody = [
      '---',
      'title: 说明',
      '---',
      '# 标题',
      '这是一段实质正文，长度足够且不触发碎片规则，用于验证 frontmatter 规则不会误伤。',
    ].join('\n');
    const { batchId } = await importItems(ctx, 'meta.md', [onlyMeta, withBody]);
    const set = computeSuggestions(ctx.store, { batchId });
    assert.equal(set.items.length, 2, `应解析为两条，实际 ${set.items.length}`);
    const skips = set.items.filter((i) => i.ruleId === 'S-FRONTMATTER');
    assert.equal(skips.length, 1, `只应有一条被 frontmatter 规则跳过，实际 ${skips.length}（规则：${set.items.map((i) => i.ruleId).join(',')}）`);
    const other = set.items.find((i) => i.ruleId !== 'S-FRONTMATTER');
    assert.ok(other != null);
    assert.notEqual(other!.action, 'skip', '带实质正文的条目不应被跳过');
  } finally {
    ctx.cleanup();
  }
});

test('S-CODE-HEAVY: 代码行为主建议 promote 并给出代码行比', async () => {
  const ctx = setup();
  try {
    const code = [
      '```ts',
      'const port = 5432;',
      'function connect() {',
      '  return pool.connect();',
      '}',
      'export default connect;',
      '```',
    ].join('\n');
    const { batchId } = await importItems(ctx, 'code.md', [code]);
    const rules = byRule(ctx, batchId);
    const heavy = rules.get('S-CODE-HEAVY');
    assert.ok(heavy != null, `应命中代码规则，实际: ${[...rules.keys()].join(',')}`);
    assert.equal(heavy!.action, 'promote');
    const basis = heavy!.basis as { key: string; value: string | number }[];
    assert.ok(Number(basis.find((b) => b.key === 'code_line_ratio')!.value) > 0.6);
  } finally {
    ctx.cleanup();
  }
});

test('S-CLEAN-DEFAULT: 普通段落建议 promote 且 basis 含相似度上界', async () => {
  const ctx = setup();
  try {
    const { batchId } = await importItems(ctx, 'clean.md', [
      '江南大学附属医院医保接口在每月一号批量对账，对账前需要先核对上月结算清单的总金额是否一致。',
    ]);
    const rules = byRule(ctx, batchId);
    const d = rules.get('S-CLEAN-DEFAULT');
    assert.ok(d != null);
    assert.equal(d!.action, 'promote');
    const basis = d!.basis as { key: string }[];
    assert.ok(basis.some((b) => b.key === 'best_jaccard'));
    assert.ok(basis.some((b) => b.key === 'scan_state'));
  } finally {
    ctx.cleanup();
  }
});

test('每条建议都必须带非空 basis（类型约束之外的运行时兜底）', async () => {
  const ctx = setup();
  try {
    await importItems(ctx, 'mix.md', [
      '短',
      '这是一条足够长的正常记忆条目，用于确保默认规则被触发而不是碎片规则。',
      `密钥：${FAKE_AWS_ID}`,
      '```js\nconst a = 1;\nconsole.log(a);\n```',
    ]);
    const set = computeSuggestions(ctx.store, {});
    assert.ok(set.items.length >= 4);
    for (const s of set.items) {
      assert.ok(Array.isArray(s.basis) && s.basis.length > 0, `${s.ruleId} 的 basis 为空`);
      assert.ok(s.reason.length > 0);
      assert.ok(['promote', 'merge', 'keep_both', 'skip', 'needs_human'].includes(s.action));
    }
  } finally {
    ctx.cleanup();
  }
});

test('排序：needs_human 在 merge 之前，merge 在 promote 之前，promote 在 skip 之前', async () => {
  const ctx = setup();
  try {
    addMemory(ctx, '生产环境数据库端口是 5432，连接超时 30 秒，最大连接数 200，重试次数 3 次。');
    await importItems(ctx, 'order.md', [
      '短',
      '生产环境数据库端口是 5433，连接超时 60 秒，最大连接数 100，重试次数 5 次。',
      '构建命令是 pnpm build，产物目录 dist，Node 版本要求 22 以上。',
      '构建命令是 pnpm build，产物目录是 dist，Node 版本要求 22 以上。',
      '这是一条与任何既有记忆都不相似的普通条目，用来触发默认晋升规则且长度足够。',
    ]);
    const set = computeSuggestions(ctx.store, {});
    const order = set.items.map((i) => i.action);
    const rank: Record<string, number> = { needs_human: 0, merge: 1, promote: 2, keep_both: 3, skip: 4 };
    for (let i = 1; i < order.length; i++) {
      assert.ok(
        rank[order[i]!]! >= rank[order[i - 1]!]!,
        `排序被破坏：位置 ${i - 1}=${order[i - 1]} 之后出现 ${order[i]}`,
      );
    }
    assert.equal(order[0], 'needs_human');
    assert.equal(order[order.length - 1], 'skip');
  } finally {
    ctx.cleanup();
  }
});

test('确定性：同一输入两次调用结果深度相等，engineVersion 稳定', async () => {
  const ctx = setup();
  try {
    await importItems(ctx, 'stable.md', [
      '第一条足够长的普通记忆条目，用于验证输出稳定性。',
      '第二条足够长的普通记忆条目，同样用于验证输出稳定性。',
    ]);
    const a = computeSuggestions(ctx.store, {});
    const b = computeSuggestions(ctx.store, {});
    assert.equal(a.engineVersion, ENGINE_VERSION);
    assert.deepEqual(
      a.items.map((i) => [i.itemId, i.action, i.ruleId, i.targetMemoryId]),
      b.items.map((i) => [i.itemId, i.action, i.ruleId, i.targetMemoryId]),
    );
  } finally {
    ctx.cleanup();
  }
});

test('不落盘：计算建议前后全表行数与内容哈希不变，且不创建 console 目录', async () => {
  const ctx = setup();
  try {
    await importItems(ctx, 'nofile.md', ['这是一条正常条目，用于验证建议引擎不写库也不写文件。']);
    const tables = ['memory', 'memory_revision', 'onboarding_plan', 'approval', 'import_item', 'import_archive', 'audit_event', 'outbox_job'];
    const snapshot = () => {
      const out: Record<string, string> = {};
      for (const t of tables) {
        const rows = ctx.store.db.all(`SELECT * FROM ${t} ORDER BY rowid`);
        out[t] = `${rows.length}:${createHash('sha256').update(JSON.stringify(rows)).digest('hex')}`;
      }
      return out;
    };
    const before = snapshot();
    computeSuggestions(ctx.store, {});
    computeInbox(ctx.store, {});
    const after = snapshot();
    assert.deepEqual(after, before, '建议计算不得修改任何表');
    const { existsSync } = await import('node:fs');
    assert.equal(existsSync(join(ctx.home, 'console')), false, '建议引擎不应创建任何落盘产物');
  } finally {
    ctx.cleanup();
  }
});

test('已晋升条目不再出现在建议里；blocked 条目始终出现但只能 skip', async () => {
  const ctx = setup();
  try {
    const { batchId } = await importItems(ctx, 'promoted.md', [
      '将被晋升的条目，长度足够避开碎片规则，内容与其他条目不重复。',
      '保持待处理的条目，长度足够且不与其他条目重复，用于验证过滤。',
      `秘密条目：${FAKE_AWS_ID}`,
    ]);
    const first = computeSuggestions(ctx.store, { batchId });
    const pending = first.items.find((i) => i.action === 'promote' && i.basis.some((b) => b.key === 'scan_state'));
    assert.ok(pending != null);
    markItemPromoted(ctx.store, pending!.itemId, 'mem-x');
    const second = computeSuggestions(ctx.store, { batchId });
    assert.equal(
      second.items.some((i) => i.itemId === pending!.itemId),
      false,
      '已晋升条目不应再出现在建议里',
    );
    const blocked = second.items.filter((i) => i.scanState === 'blocked');
    assert.ok(blocked.length > 0, 'blocked 条目仍应出现（它们是需要被看见的欠账）');
    assert.ok(blocked.every((b) => b.action === 'skip'));
  } finally {
    ctx.cleanup();
  }
});

test('inbox：区分"必须人判断"与"可批量确认"，计划与冲突优先级最高', async () => {
  const ctx = setup();
  try {
    await importItems(ctx, 'inbox.md', [
      '这是一条普通待晋升条目，长度足够，用于验证 inbox 分组。',
      '这是第二条普通待晋升条目，长度同样足够，内容互不重复。',
    ]);
    const inbox = computeInbox(ctx.store, {});
    assert.ok(inbox.total >= 2);
    assert.equal(inbox.counts.decisionRequired + inbox.counts.bulkConfirmable, inbox.total);
    assert.ok(inbox.entries.every((e) => typeof e.decisionRequired === 'boolean'));
    // 普通 promote 归入"可批量确认"，不该冒充"必须人判断"
    const promotes = inbox.entries.filter((e) => e.action === 'promote' && e.kind === 'item');
    assert.ok(promotes.length >= 2);
    assert.ok(promotes.every((e) => e.decisionRequired === false));
  } finally {
    ctx.cleanup();
  }
});
