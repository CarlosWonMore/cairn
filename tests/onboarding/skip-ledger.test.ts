/**
 * 跳过事实（item_skipped）测试（tasks 1.x / 2.x）。
 *
 * 关键证据点：
 * - 跳过是持久事实，且 detail 不含正文；
 * - 幂等（同条目同依据不重复记）；
 * - blocked 条目拒绝写入；
 * - remaining 用 handled 谓词，跳过即出队；
 * - promoted 语义未被改变（跳过 != 晋升）。
 */

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import {
  batchProgress,
  listSkippedItems,
  markItemPromoted,
  markItemSkipped,
  nextBatchChunk,
  promotedPredicate,
} from '../../src/onboarding/batches.js';
import { isCairnError } from '../../src/core/errors.js';
import { openStore, type CairnStore } from '../../src/store/open.js';
import { makeTestHome, cleanupTestHome } from '../helpers.js';

let store: CairnStore;
let home: string;

function forCode(code: string) {
  return (e: unknown): boolean => isCairnError(e) && e.code === code;
}

/** 造一个含 n 条 clean 条目（可选 blocked）的档案与批次。 */
function seedBatch(n: number, blockedCount = 0): { batchId: string; itemIds: string[]; blockedIds: string[] } {
  const batchId = 'batch-' + Math.random().toString(36).slice(2, 10);
  const { archive } = store.archives.createArchive({
    sourceKind: 'markdown',
    sourceLocator: '/tmp/src-' + Math.random().toString(36).slice(2) + '.md',
    sourceLabel: 'test.md',
    byteSize: 100,
    contentHash: 'h-' + Math.random().toString(36).slice(2, 12),
    snapshotPath: '/tmp/snap.md',
    parser: 'markdown',
    batchId,
  } as never);
  const itemIds: string[] = [];
  const blockedIds: string[] = [];
  for (let i = 0; i < n; i++) {
    const r = store.archives.addItem({
      archiveId: archive.id,
      itemIndex: i,
      content: `内容 ${i}`,
      byteOffset: i * 10,
      scanState: 'clean',
      batchId,
    });
    itemIds.push(r.item.id);
  }
  for (let i = 0; i < blockedCount; i++) {
    const r = store.archives.addItem({
      archiveId: archive.id,
      itemIndex: n + i,
      content: `blocked ${i}`,
      byteOffset: 1000 + i * 10,
      scanState: 'blocked',
      batchId,
    });
    blockedIds.push(r.item.id);
  }
  return { batchId, itemIds, blockedIds };
}
before(() => {
  home = makeTestHome();
  store = openStore({ home, allowUninitialized: true } as never);
});

after(() => {
  try { store.close(); } catch { /* ignore */ }
  cleanupTestHome(home);
});

describe('谓词：三组各自独立', () => {
  it('exists/skippedExists/handledExists 是三个不同的 SQL 片段', () => {
    const p = promotedPredicate('i');
    assert.ok(p.exists.includes('item_promoted'));
    assert.ok(p.skippedExists.includes('item_skipped'));
    assert.ok(p.handledExists.includes('item_promoted') && p.handledExists.includes('item_skipped'));
    assert.notEqual(p.exists, p.skippedExists);
  });

  it('非法别名被拒绝', () => {
    assert.throws(() => promotedPredicate('bad alias;'), forCode('E_VALIDATION'));
  });
});

describe('markItemSkipped：写入、幂等、边界', () => {
  it('写入跳过事实，detail 含 itemId 与 basis，且不含正文', () => {
    const { itemIds } = seedBatch(1);
    markItemSkipped(store, itemIds[0]!, { basis: 'judgement', reasonCode: 'not_reusable' });
    const rows = store.db.all(
      "SELECT detail FROM audit_event WHERE action='item_skipped' AND json_extract(detail,'$.itemId')=?",
      itemIds[0],
    );
    assert.equal(rows.length, 1);
    const detail = String(rows[0]!['detail']);
    assert.ok(detail.includes('not_reusable'));
    assert.ok(!detail.includes('内容 0'), '审计不得包含条目正文');
  });

  it('同条目同依据重复标记是幂等的', () => {
    const { itemIds } = seedBatch(1);
    markItemSkipped(store, itemIds[0]!, { basis: 'rule' });
    markItemSkipped(store, itemIds[0]!, { basis: 'rule' });
    const n = store.db.scalar(
      "SELECT COUNT(*) FROM audit_event WHERE action='item_skipped' AND json_extract(detail,'$.itemId')=?",
      itemIds[0],
    );
    assert.equal(Number(n), 1);
  });

  it('blocked 条目拒绝写入', () => {
    const { blockedIds } = seedBatch(1, 1);
    assert.throws(() => markItemSkipped(store, blockedIds[0]!, { basis: 'rule' }), forCode('E_VALIDATION'));
  });

  it('非法 basis 被拒绝', () => {
    const { itemIds } = seedBatch(1);
    assert.throws(
      () => markItemSkipped(store, itemIds[0]!, { basis: 'whatever' as never }),
      forCode('E_VALIDATION'),
    );
  });
});

describe('remaining 口径：跳过即出队，但可查', () => {
  it('跳过一条后 remaining 减一、skipped 加一、promoted 不变', () => {
    const { batchId, itemIds } = seedBatch(3);
    const before = batchProgress(store, batchId);
    assert.equal(before.remaining, 3);
    markItemSkipped(store, itemIds[0]!, { basis: 'rule' });
    const after = batchProgress(store, batchId);
    assert.equal(after.remaining, 2, '跳过的条目必须退出待处理');
    assert.equal(after.skipped, 1);
    assert.equal(after.promoted, 0, '跳过不是晋升，promoted 不得变化');
  });

  it('nextBatchChunk 不再返回已跳过的条目', () => {
    const { batchId, itemIds } = seedBatch(2);
    markItemSkipped(store, itemIds[0]!, { basis: 'rule' });
    const chunk = nextBatchChunk(store, batchId, 10);
    assert.equal(chunk.length, 1);
    assert.equal(chunk[0]!.itemId, itemIds[1]);
  });

  it('已跳过的条目仍可通过 listSkippedItems 查询（不从视野消失）', () => {
    const { batchId, itemIds } = seedBatch(2);
    markItemSkipped(store, itemIds[0]!, { basis: 'judgement', reasonCode: 'low_value' });
    const listed = listSkippedItems(store, batchId);
    assert.equal(listed.length, 1);
    assert.equal(listed[0]!.itemId, itemIds[0]);
    assert.equal(listed[0]!.basis, 'judgement');
    assert.equal(listed[0]!.reasonCode, 'low_value');
  });

  it('总数平衡：total = promoted + skipped + remaining + blocked', () => {
    const { batchId, itemIds } = seedBatch(4, 2);
    const mem1 = store.memories.add(
      { content: '记忆内容', kind: 'fact', authority: 'user_explicit',
        scopeId: store.scopes.resolvePreset('personal-global').id, createdBy: 'cli' } as never,
      store.identity.deviceId,
    );
    markItemPromoted(store, itemIds[0]!, mem1.id);
    markItemSkipped(store, itemIds[1]!, { basis: 'rule' });
    const p = batchProgress(store, batchId);
    assert.equal(p.total, p.promoted + p.skipped + p.remaining + p.blocked, JSON.stringify(p));
  });
});

describe('跳过与晋升并存时的语义', () => {
  it('同条目既有跳过又晋升：remaining 为 0，且两条事实都保留', () => {
    const { batchId, itemIds } = seedBatch(1);
    markItemSkipped(store, itemIds[0]!, { basis: 'judgement' });
    const mem = store.memories.add(
      { content: '后来的记忆', kind: 'fact', authority: 'user_explicit',
        scopeId: store.scopes.resolvePreset('personal-global').id, createdBy: 'cli' } as never,
      store.identity.deviceId,
    );
    markItemPromoted(store, itemIds[0]!, mem.id);
    const p = batchProgress(store, batchId);
    assert.equal(p.remaining, 0);
    assert.equal(p.promoted, 1);
    const skippedRows = store.db.scalar(
      "SELECT COUNT(*) FROM audit_event WHERE action='item_skipped' AND json_extract(detail,'$.itemId')=?",
      itemIds[0],
    );
    assert.equal(Number(skippedRows), 1, '跳过历史不被晋升抹掉');
  });
});

describe('防回归：谓词不得退化为单一动作', () => {
  it('handled 谓词必须同时包含两种动作（否则跳过会永远出不了队）', () => {
    const p2 = promotedPredicate('i');
    assert.ok(p2.handledExists.includes('item_promoted'));
    assert.ok(p2.handledExists.includes('item_skipped'));
    assert.ok(p2.handledNotExists.startsWith('NOT '));
  });

  it('handled 谓词含两处别名占位符：调用方必须用 replaceAll', () => {
    const p2 = promotedPredicate('%ALIAS%');
    const occurrences = p2.handledNotExists.split('%ALIAS%').length - 1;
    assert.equal(occurrences, 2, '含两处别名；单次 replace 会残留 % 导致 SQL 语法错误');
  });
});
