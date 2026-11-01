import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openStore, CairnStore } from '../../src/store/open.js';
import { makeTestHome, cleanupTestHome } from '../helpers.js';
import { importSnapshot, ImportOutcome } from '../../src/onboarding/import.js';
import { assignBatch, batchProgress, nextBatchChunk, markItemPromoted } from '../../src/onboarding/batches.js';
import { CairnError } from '../../src/core/errors.js';

// 合成凭据：AWS 官方文档示例 ID，非真实凭据。
const FAKE_AWS_ID = 'AKIAIOSFODNN7EXAMPLE';

const MIXED_BLOCKS = [
  '记忆甲：偏好早上深度工作',
  `AWS 配置泄露：${FAKE_AWS_ID}`,
  '记忆乙：构建命令 pnpm build',
  '记忆丙：部署端口 9090',
];

interface TestCtx {
  home: string;
  store: CairnStore;
  sourcesDir: string;
  writeSource(name: string, content: string): string;
  cleanup(): void;
}

function setup(): TestCtx {
  const home = makeTestHome();
  const store = openStore({ home });
  const sourcesDir = join(home, 'sources');
  mkdirSync(sourcesDir, { recursive: true });
  return {
    home,
    store,
    sourcesDir,
    writeSource(name: string, content: string): string {
      const p = join(sourcesDir, name);
      writeFileSync(p, content, 'utf8');
      return p;
    },
    cleanup() {
      try {
        store.close();
      } catch {
        /* 用例内已显式关闭（如中断续跑），清理幂等 */
      }
      cleanupTestHome(home);
    },
  };
}

/** 导入 3 条 clean + 1 条 blocked 的混合批次。 */
async function importMixed(store: CairnStore, ctx: { sourcesDir: string }): Promise<ImportOutcome> {
  const p = join(ctx.sourcesDir, 'mixed.md');
  writeFileSync(p, MIXED_BLOCKS.join('\n\n'), 'utf8');
  return importSnapshot(store, { agentKind: 'claude-code', sourcePath: p });
}

test('assignBatch 幂等：两次调用返回同一 batchId，且与导入批次一致', async () => {
  const s = setup();
  try {
    const outcome = await importMixed(s.store, s);
    const b1 = assignBatch(s.store, outcome.archiveId!);
    const b2 = assignBatch(s.store, outcome.archiveId!);
    assert.equal(b1, outcome.batchId, '导入时已分批，assignBatch 收敛到原批次');
    assert.equal(b2, b1);
    assert.ok(s.store.archives.listItems(outcome.archiveId!).every((i) => i.batchId === b1));
  } finally {
    s.cleanup();
  }
});

test('assignBatch 补齐未分批条目：白盒置空后 refill 收敛回同一批次', async () => {
  const s = setup();
  try {
    const outcome = await importMixed(s.store, s);
    const archiveId = outcome.archiveId!;
    const b1 = assignBatch(s.store, archiveId);

    // 白盒：制造两条未分批条目（schema 冻结下合法的存量状态）
    s.store.db.run('UPDATE import_item SET batch_id = NULL WHERE archive_id = ? AND item_index IN (0, 2)', archiveId);
    assert.ok(s.store.archives.listItems(archiveId).some((i) => i.batchId === null));

    const b2 = assignBatch(s.store, archiveId);
    assert.equal(b2, b1, '补批必须收敛到档案既有批次，不得分裂');
    assert.ok(s.store.archives.listItems(archiveId).every((i) => i.batchId === b2));
  } finally {
    s.cleanup();
  }
});

test('assignBatch 未知档案 → E_NOT_FOUND', () => {
  const s = setup();
  try {
    assert.throws(
      () => assignBatch(s.store, 'no-such-archive'),
      (e: unknown) => e instanceof CairnError && e.code === 'E_NOT_FOUND',
    );
  } finally {
    s.cleanup();
  }
});

test('batchProgress：total/clean/blocked 按扫描状态统计正确', async () => {
  const s = setup();
  try {
    const outcome = await importMixed(s.store, s);
    const p = batchProgress(s.store, outcome.batchId);
    assert.deepEqual(p, {
      batchId: outcome.batchId,
      total: 4,
      clean: 3,
      blocked: 1,
      promoted: 0,
        skipped: 0,
      remaining: 3,
    });
  } finally {
    s.cleanup();
  }
});

test('nextBatchChunk 只返回 clean 未晋升条目；blocked 永不进入批次', async () => {
  const s = setup();
  try {
    const outcome = await importMixed(s.store, s);
    const chunk = nextBatchChunk(s.store, outcome.batchId, 100);
    assert.equal(chunk.length, 3);
    assert.deepEqual(
      chunk.map((c) => c.content),
      ['记忆甲：偏好早上深度工作', '记忆乙：构建命令 pnpm build', '记忆丙：部署端口 9090'],
    );
    assert.ok(chunk.every((c) => !c.content.includes(FAKE_AWS_ID)), '秘密条目不得出现在批次中');
    for (const c of chunk) {
      assert.equal(typeof c.itemId, 'string');
      assert.equal(c.archiveId, outcome.archiveId);
      assert.ok(c.sourceRef && c.sourceRef.startsWith('mixed.md#item-'));
      assert.equal(typeof c.contentHash, 'string');
      assert.ok(c.contentHash.length === 64);
    }
  } finally {
    s.cleanup();
  }
});

test('nextBatchChunk：limit 有界、晋升即游标、分页无重叠；非法 limit 拒绝', async () => {
  const s = setup();
  try {
    const outcome = await importMixed(s.store, s);
    const full = nextBatchChunk(s.store, outcome.batchId, 100).map((c) => c.itemId);

    // 游标是晋升而非读取位置：不晋升时重复读取返回同一窗口（只读语义）
    const window1 = nextBatchChunk(s.store, outcome.batchId, 2);
    const window1again = nextBatchChunk(s.store, outcome.batchId, 2);
    assert.deepEqual(window1.map((c) => c.itemId), full.slice(0, 2));
    assert.deepEqual(window1again.map((c) => c.itemId), window1.map((c) => c.itemId));

    // 晋升窗口内条目后，下一窗口无重叠且顺序延续
    for (const c of window1) markItemPromoted(s.store, c.itemId, `mem-for-${c.itemId.slice(0, 8)}`);
    const window2 = nextBatchChunk(s.store, outcome.batchId, 2);
    assert.equal(window2.length, 1);
    assert.deepEqual(
      [...window1.map((c) => c.itemId), ...window2.map((c) => c.itemId)],
      full,
      '按晋升游标分页必须覆盖全量且不重叠',
    );

    assert.throws(
      () => nextBatchChunk(s.store, outcome.batchId, 0),
      (e: unknown) => e instanceof CairnError && e.code === 'E_VALIDATION',
    );
    assert.throws(
      () => nextBatchChunk(s.store, outcome.batchId, 1.5),
      (e: unknown) => e instanceof CairnError && e.code === 'E_VALIDATION',
    );
  } finally {
    s.cleanup();
  }
});

test('markItemPromoted 后该条不再返回；全部晋升后 remaining=0、chunk 为空', async () => {
  const s = setup();
  try {
    const outcome = await importMixed(s.store, s);
    const chunk = nextBatchChunk(s.store, outcome.batchId, 100);
    markItemPromoted(s.store, chunk[0]!.itemId, 'mem-001');

    let p = batchProgress(s.store, outcome.batchId);
    assert.equal(p.promoted, 1);
    assert.equal(p.remaining, 2);

    const after = nextBatchChunk(s.store, outcome.batchId, 100);
    assert.equal(after.length, 2);
    assert.ok(!after.some((c) => c.itemId === chunk[0]!.itemId), '已晋升条目不得再次出现');

    for (const [n, c] of after.entries()) markItemPromoted(s.store, c.itemId, `mem-00${n + 2}`);
    p = batchProgress(s.store, outcome.batchId);
    assert.equal(p.promoted, 3);
    assert.equal(p.remaining, 0);
    assert.deepEqual(nextBatchChunk(s.store, outcome.batchId, 100), []);
  } finally {
    s.cleanup();
  }
});

test('markItemPromoted：未知条目 → E_NOT_FOUND；空 memoryId → E_VALIDATION', async () => {
  const s = setup();
  try {
    const outcome = await importMixed(s.store, s);
    assert.throws(
      () => markItemPromoted(s.store, 'no-such-item', 'mem-x'),
      (e: unknown) => e instanceof CairnError && e.code === 'E_NOT_FOUND',
    );
    const chunk = nextBatchChunk(s.store, outcome.batchId, 1);
    assert.throws(
      () => markItemPromoted(s.store, chunk[0]!.itemId, ''),
      (e: unknown) => e instanceof CairnError && e.code === 'E_VALIDATION',
    );
  } finally {
    s.cleanup();
  }
});

test('markItemPromoted 幂等：同条目同记忆重复标记不产生重复审计', async () => {
  const s = setup();
  try {
    const outcome = await importMixed(s.store, s);
    const chunk = nextBatchChunk(s.store, outcome.batchId, 1);
    markItemPromoted(s.store, chunk[0]!.itemId, 'mem-001');
    markItemPromoted(s.store, chunk[0]!.itemId, 'mem-001');
    const rows = s.store.db.all(
      "SELECT * FROM audit_event WHERE category = 'onboarding' AND action = 'item_promoted'",
    );
    assert.equal(rows.length, 1, '同一 (itemId, memoryId) 只记一条审计');
    const p = batchProgress(s.store, outcome.batchId);
    assert.equal(p.promoted, 1);
  } finally {
    s.cleanup();
  }
});

test('markItemPromoted 换 memoryId → E_CONFLICT_STATE，原审计保留', async () => {
  const s = setup();
  try {
    const outcome = await importMixed(s.store, s);
    const chunk = nextBatchChunk(s.store, outcome.batchId, 1);
    markItemPromoted(s.store, chunk[0]!.itemId, 'mem-001');
    assert.throws(
      () => markItemPromoted(s.store, chunk[0]!.itemId, 'mem-002'),
      (e: unknown) => e instanceof CairnError && e.code === 'E_CONFLICT_STATE',
    );
    const rows = s.store.db.all(
      "SELECT * FROM audit_event WHERE category = 'onboarding' AND action = 'item_promoted'",
    );
    assert.equal(rows.length, 1, '冲突标记不得追加审计行');
    assert.equal(batchProgress(s.store, outcome.batchId).promoted, 1);
  } finally {
    s.cleanup();
  }
});

test('中断续跑：晋升 1 条后关闭并重开同一 home，进度与游标持久化', async () => {
  const s = setup();
  try {
    const outcome = await importMixed(s.store, s);
    const batchId = outcome.batchId;
    const first = nextBatchChunk(s.store, batchId, 100);
    markItemPromoted(s.store, first[0]!.itemId, 'mem-001');
    s.store.close();

    // 新会话：重开同一 home（模拟会话中断后继续）
    const store2 = openStore({ home: s.home });
    try {
      const p = batchProgress(store2, batchId);
      assert.deepEqual(
        { total: p.total, clean: p.clean, blocked: p.blocked, promoted: p.promoted, remaining: p.remaining },
        { total: 4, clean: 3, blocked: 1, promoted: 1, remaining: 2 },
      );
      const resumed = nextBatchChunk(store2, batchId, 100);
      assert.equal(resumed.length, 2);
      assert.ok(!resumed.some((c) => c.itemId === first[0]!.itemId), '续跑游标不得包含已晋升条目');
      assert.deepEqual(
        resumed.map((c) => c.itemId),
        [first[1]!.itemId, first[2]!.itemId],
        '续跑从中断点继续，顺序不变',
      );
    } finally {
      store2.close();
    }
  } finally {
    s.cleanup();
  }
});

test('审计即状态：audit_event 有 item_promoted 记录，json_extract 可查', async () => {
  const s = setup();
  try {
    const outcome = await importMixed(s.store, s);
    const chunk = nextBatchChunk(s.store, outcome.batchId, 1);
    const itemId = chunk[0]!.itemId;
    markItemPromoted(s.store, itemId, 'mem-009');

    const rows = s.store.db.all(
      "SELECT * FROM audit_event WHERE category = 'onboarding' AND action = 'item_promoted'",
    );
    assert.equal(rows.length, 1);
    const row = rows[0]!;
    assert.equal(row['subject_type'], 'import_item');
    assert.equal(row['subject_id'], itemId);
    const detail = JSON.parse(String(row['detail'])) as { itemId: string; memoryId: string };
    assert.equal(detail.itemId, itemId);
    assert.equal(detail.memoryId, 'mem-009');

    // 与 batchProgress/nextBatchChunk 相同的查询路径：json_extract 精确命中
    const n = s.store.db.scalar(
      "SELECT COUNT(*) FROM audit_event WHERE category = 'onboarding' AND action = 'item_promoted' AND json_extract(detail, '$.itemId') = ?",
      itemId,
    );
    assert.equal(Number(n), 1);
    assert.equal(batchProgress(s.store, outcome.batchId).promoted, 1);
  } finally {
    s.cleanup();
  }
});

test('未知 batchId：进度全零、chunk 为空，不抛错', async () => {
  const s = setup();
  try {
    assert.deepEqual(batchProgress(s.store, 'batch-nonexistent'), {
      batchId: 'batch-nonexistent',
      total: 0,
      clean: 0,
      blocked: 0,
      promoted: 0,
        skipped: 0,
      remaining: 0,
    });
    assert.deepEqual(nextBatchChunk(s.store, 'batch-nonexistent', 5), []);
  } finally {
    s.cleanup();
  }
});

test('blocked 条目不进批次但计入进度；档案级 redaction_state 与批次过滤独立生效', async () => {
  const s = setup();
  try {
    const outcome = await importMixed(s.store, s);
    const archive = s.store.archives.requireById(outcome.archiveId!);
    assert.equal(archive.redactionState, 'scanned_blocked');
    const items = s.store.archives.listItems(archive.id);
    assert.equal(items.filter((i) => i.scanState === 'blocked').length, 1);
    // 批次层（治理入口）对 blocked 的过滤与档案级 redaction_state 独立生效
    const chunk = nextBatchChunk(s.store, outcome.batchId, 100);
    assert.equal(chunk.length, 3);
    assert.equal(batchProgress(s.store, outcome.batchId).blocked, 1);
    assert.equal(batchProgress(s.store, outcome.batchId).remaining, 3);
  } finally {
    s.cleanup();
  }
});
