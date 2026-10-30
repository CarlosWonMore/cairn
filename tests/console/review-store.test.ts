import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openStore, CairnStore } from '../../src/store/open.js';
import { makeTestHome, cleanupTestHome } from '../helpers.js';
import { importSnapshot } from '../../src/onboarding/import.js';
import { assignBatch } from '../../src/onboarding/batches.js';
import {
  buildReviewPack,
  loadReviewsFile,
  readReviews,
  reviewPackForBatch,
  reviewSubmit,
  reviewsPath,
  DEFAULT_PACK_CHARS,
} from '../../src/interfaces/console/review-store.js';

const FAKE_AWS_ID = 'AKIAIOSFODNN7EXAMPLE';

interface Ctx {
  home: string;
  store: CairnStore;
  cleanup(): void;
}

function setup(): Ctx {
  const home = makeTestHome('cairn-review-');
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

async function seed(ctx: Ctx, items: string[], name = 'src.md'): Promise<{ batchId: string; archiveId: string }> {
  const dir = join(ctx.home, 'sources');
  mkdirSync(dir, { recursive: true });
  const p = join(dir, name);
  writeFileSync(p, items.join('\n\n'), 'utf8');
  const o = await importSnapshot(ctx.store, { agentKind: 'manual', sourcePath: p });
  const archiveId = (o.archiveId ?? o.reusedArchiveId)!;
  return { batchId: o.batchId ?? assignBatch(ctx.store, archiveId), archiveId };
}

function itemIds(ctx: Ctx, batchId: string, state: 'clean' | 'blocked' = 'clean'): string[] {
  return ctx.store.db
    .all('SELECT id FROM import_item WHERE batch_id = ? AND scan_state = ? ORDER BY item_index', batchId, state)
    .map((r) => String(r['id']));
}

test('pack: 每条带规则层结论，条目数与批次一致，跳过 skip 项', async () => {
  const ctx = setup();
  try {
    const { batchId } = await seed(ctx, [
      '这是一条足够长的普通条目，用于验证复核包生成，内容不与其他条目重复。',
      '第二条足够长的普通条目，同样用于验证复核包，长度超过碎片阈值。',
      '短句',
    ]);
    const pack = buildReviewPack(ctx.store, { batchId });
    assert.equal(pack.batchId, batchId);
    assert.equal(pack.engineVersion, 'rule-v1');
    assert.ok(pack.items.length > 0);
    for (const it of pack.items) {
      assert.ok(it.rule.ruleId.startsWith('S-'), '每条必须带规则标识');
      assert.ok(it.rule.reason.length > 0);
      assert.ok(Array.isArray(it.rule.basis) && it.rule.basis.length > 0, '规则结论必须带依据');
      assert.ok(it.expected.actions.includes('promote'));
      assert.ok(it.content.length <= pack.maxCharsPerItem);
    }
    // skip 项不进复核包（规则已判定，不需要 AI 再判一次）
    assert.equal(pack.items.length, 2, `应有 2 条进包，实际 ${pack.items.length}`);
    assert.ok(pack.totalChars > 0);
  } finally {
    ctx.cleanup();
  }
});

test('pack: 超长条目按 maxCharsPerItem 截断并标记 truncated', async () => {
  const ctx = setup();
  try {
    const long = 'L'.repeat(3000);
    const { batchId } = await seed(ctx, [long]);
    const pack = buildReviewPack(ctx.store, { batchId, maxCharsPerItem: 500 });
    assert.equal(pack.items.length, 1);
    assert.equal(pack.items[0]!.content.length, 500);
    assert.equal(pack.items[0]!.truncated, true);

    const full = buildReviewPack(ctx.store, { batchId, maxCharsPerItem: 5000 });
    assert.equal(full.items[0]!.truncated, false);
    assert.equal(full.items[0]!.content.length, 3000);
    assert.equal(DEFAULT_PACK_CHARS, 1200);
  } finally {
    ctx.cleanup();
  }
});

test('pack: 落盘到 console 目录，返回路径与规模并写审计', async () => {
  const ctx = setup();
  try {
    const { batchId } = await seed(ctx, ['一条足够长的普通条目，用于验证复核包落盘与审计记录。']);
    const before = Number(ctx.store.db.scalar("SELECT COUNT(*) FROM audit_event WHERE category = 'review'") ?? 0);
    const r = reviewPackForBatch(ctx.store, { batchId });
    assert.ok(existsSync(r.outFile), '复核包文件应存在');
    assert.ok(r.outFile.includes(join('console')));
    const parsed = JSON.parse(readFileSync(r.outFile, 'utf8')) as { runId: string; itemCount: number };
    assert.equal(parsed.runId, r.runId);
    assert.equal(parsed.itemCount, r.itemCount);
    const after = Number(ctx.store.db.scalar("SELECT COUNT(*) FROM audit_event WHERE category = 'review'") ?? 0);
    assert.equal(after, before + 1, '应写入一条 review 审计');
  } finally {
    ctx.cleanup();
  }
});

test('submit: 合法输入写入并可按 itemId 读回（含 runId 与生成时间）', async () => {
  const ctx = setup();
  try {
    const { batchId } = await seed(ctx, ['一条足够长的普通条目，用于验证 AI 建议写回与读回。']);
    const [id] = itemIds(ctx, batchId);
    const r = reviewSubmit(ctx.store, {
      items: [{ itemId: id, action: 'promote', reason: '内容独立，与既有记忆无重复' }],
      producer: 'test-agent',
      model: 'test-model',
    });
    assert.equal(r.accepted, 1);
    assert.equal(r.overwritten, 0);
    assert.ok(r.runId.length > 0);

    const list = readReviews(ctx.store, { batchId });
    assert.equal(list.length, 1);
    assert.equal(list[0]!.itemId, id);
    assert.equal(list[0]!.action, 'promote');
    assert.equal(list[0]!.producer, 'test-agent');
    assert.equal(list[0]!.model, 'test-model');
    assert.equal(list[0]!.stale, false);
    assert.match(list[0]!.createdAt, /^\d{4}-\d{2}-\d{2}T/);
  } finally {
    ctx.cleanup();
  }
});

test('submit: 五个负例各自整批拒绝，且库与文件均无变化', async () => {
  const ctx = setup();
  try {
    const { batchId } = await seed(ctx, [
      '第一条足够长的普通条目，用于验证整批拒绝，内容不重复。',
      '第二条足够长的普通条目，同样用于验证整批拒绝行为。',
    ]);
    const [a, b] = itemIds(ctx, batchId);
    const auditBefore = Number(ctx.store.db.scalar("SELECT COUNT(*) FROM audit_event WHERE category = 'review'") ?? 0);
    const fileBefore = existsSync(reviewsPath(ctx.home)) ? readFileSync(reviewsPath(ctx.home), 'utf8') : null;

    const cases: { name: string; items: unknown[] }[] = [
      { name: '缺 itemId', items: [{ action: 'promote', reason: '理由' }] },
      { name: 'action 非法', items: [{ itemId: a, action: 'delete', reason: '理由' }] },
      { name: '理由为空', items: [{ itemId: a, action: 'promote', reason: '   ' }] },
      { name: '目标记忆不存在（合法条目 + 非法目标混在一起）', items: [{ itemId: a, action: 'promote', reason: '好的' }, { itemId: b, action: 'merge', reason: '合并', targetMemoryId: 'mem_nope' }] },
      { name: '理由含秘密', items: [{ itemId: a, action: 'promote', reason: `把密钥 ${FAKE_AWS_ID} 记下来` }] },
    ];

    for (const c of cases) {
      assert.throws(
        () => reviewSubmit(ctx.store, { items: c.items, producer: 'test' }),
        (e: unknown) => {
          const err = e as { code?: string; message?: string };
          assert.ok(err.code === 'E_VALIDATION' || err.code === 'E_SECRET_DETECTED', `${c.name}: 错误码 ${err.code}`);
          assert.match(String(err.message), /整批拒绝/, `${c.name}: 应说明整批拒绝`);
          return true;
        },
        c.name,
      );
    }

    assert.equal(
      Number(ctx.store.db.scalar("SELECT COUNT(*) FROM audit_event WHERE category = 'review'") ?? 0),
      auditBefore,
      '拒绝时不应写审计',
    );
    const fileAfter = existsSync(reviewsPath(ctx.home)) ? readFileSync(reviewsPath(ctx.home), 'utf8') : null;
    assert.equal(fileAfter, fileBefore, '拒绝时不应改动建议文件');
    assert.equal(readReviews(ctx.store, {}).length, 0);
  } finally {
    ctx.cleanup();
  }
});

test('submit: 错误详情含条目索引，且不回显正文', async () => {
  const ctx = setup();
  try {
    const { batchId } = await seed(ctx, ['一条足够长的普通条目，用于验证错误详情不含正文。']);
    const [id] = itemIds(ctx, batchId);
    assert.throws(
      () => reviewSubmit(ctx.store, { items: [{ itemId: id, action: 'bad', reason: '理由' }], producer: 't' }),
      (e: unknown) => {
        const err = e as { details?: { problems?: { index: number; message: string }[] } };
        const problems = err.details?.problems;
        assert.ok(Array.isArray(problems) && problems.length > 0);
        assert.equal(problems![0]!.index, 0);
        assert.ok(!JSON.stringify(problems).includes('一条足够长的普通条目'), '错误详情不得回显正文');
        return true;
      },
    );
  } finally {
    ctx.cleanup();
  }
});

test('submit: 同 itemId 二次提交覆盖旧值，审计读到 overwritten', async () => {
  const ctx = setup();
  try {
    const { batchId } = await seed(ctx, ['一条足够长的普通条目，用于验证覆盖语义。']);
    const [id] = itemIds(ctx, batchId);
    reviewSubmit(ctx.store, { items: [{ itemId: id, action: 'promote', reason: '第一次判断' }], producer: 'a' });
    const second = reviewSubmit(ctx.store, { items: [{ itemId: id, action: 'skip', reason: '第二次判断' }], producer: 'b' });
    assert.equal(second.overwritten, 1);
    assert.equal(second.items[0]!.overwrote, true);
    const list = readReviews(ctx.store, { batchId });
    assert.equal(list.length, 1, '同 itemId 只保留最新一条');
    assert.equal(list[0]!.action, 'skip');
    assert.equal(list[0]!.producer, 'b');
  } finally {
    ctx.cleanup();
  }
});

test('submit: 连续多次写入后文件始终可解析（原子写）', async () => {
  const ctx = setup();
  try {
    const { batchId } = await seed(ctx, [
      '第一条足够长的普通条目，用于验证原子写。',
      '第二条足够长的普通条目，用于验证原子写。',
      '第三条足够长的普通条目，用于验证原子写。',
    ]);
    const ids = itemIds(ctx, batchId);
    // 说明：本实现是同步写（临时文件 + rename），同进程内不存在交错；
    // 这里验证的是"多次写入后文件仍可解析、条目数正确"，跨进程并发由 rename 的原子性保证。
    for (const id of ids) {
      reviewSubmit(ctx.store, { items: [{ itemId: id, action: 'promote', reason: `处理 ${id.slice(0, 6)}` }], producer: 'loop' });
    }
    const file = loadReviewsFile(ctx.home);
    assert.equal(Object.keys(file.items).length, 3);
    assert.ok(file.updatedAt.length > 0);
    assert.equal(readReviews(ctx.store, {}).length, 3);
  } finally {
    ctx.cleanup();
  }
});

test('陈旧标记：条目内容变化后旧建议标 stale 且不参与索引', async () => {
  const ctx = setup();
  try {
    const { batchId, archiveId } = await seed(ctx, ['一条足够长的普通条目，用于验证陈旧判定逻辑。']);
    const [id] = itemIds(ctx, batchId);
    reviewSubmit(ctx.store, { items: [{ itemId: id, action: 'promote', reason: '初始判断' }], producer: 'a' });
    assert.equal(readReviews(ctx.store, {})[0]!.stale, false);

    // 直接改条目内容（模拟重新解析或条目被替换）
    ctx.store.db.run('UPDATE import_item SET content = ?, content_hash = ? WHERE id = ?', '改过的内容，长度依然足够。', 'deadbeef'.repeat(8), id);
    const after = readReviews(ctx.store, {});
    assert.equal(after.length, 1);
    assert.equal(after[0]!.stale, true);
    assert.match(String(after[0]!.staleReason), /内容已变化/);

    const idx = (await import('../../src/interfaces/console/review-store.js')).readReviewsIndex(ctx.store);
    assert.equal(idx.size, 0, '陈旧建议不进入默认索引');
    void archiveId;
  } finally {
    ctx.cleanup();
  }
});

test('陈旧标记：扫描状态变化同样标 stale', async () => {
  const ctx = setup();
  try {
    const { batchId } = await seed(ctx, ['一条足够长的普通条目，用于验证扫描状态变化的陈旧判定。']);
    const [id] = itemIds(ctx, batchId);
    reviewSubmit(ctx.store, { items: [{ itemId: id, action: 'promote', reason: '初始判断' }], producer: 'a' });
    ctx.store.db.run("UPDATE import_item SET scan_state = 'blocked' WHERE id = ?", id);
    const after = readReviews(ctx.store, {});
    assert.equal(after[0]!.stale, true);
    assert.match(String(after[0]!.staleReason), /扫描状态/);
  } finally {
    ctx.cleanup();
  }
});

test('submit: blocked 条目拒绝接受 AI 建议', async () => {
  const ctx = setup();
  try {
    const { batchId } = await seed(ctx, ['一条足够长的普通条目。', `密钥：${FAKE_AWS_ID}`]);
    const blockedIds = itemIds(ctx, batchId, 'blocked');
    assert.equal(blockedIds.length, 1);
    assert.throws(
      () => reviewSubmit(ctx.store, { items: [{ itemId: blockedIds[0], action: 'promote', reason: '看起来没问题' }], producer: 't' }),
      (e: unknown) => (e as { code?: string }).code === 'E_VALIDATION',
    );
  } finally {
    ctx.cleanup();
  }
});
