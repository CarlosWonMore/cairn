/**
 * 重要度与使用信号（add-memory-importance-and-usage-signal）。
 *
 * 锁死四件事：
 * 1. 迁移 005 只加列、不动子表、幂等；
 * 2. importance 与 confidence 正交，推断来源上限 3、越界被拒（不静默截断）；
 * 3. markUsed 双增量语义：注入只写时间，检索才计次数；
 * 4. 投影评分带三重地板（高重要度/高相关/绝对 0.5）。
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { openStore } from '../../src/store/open.js';
import type { CairnStore } from '../../src/store/open.js';
import { normalizeImportance, effectiveImportance } from '../../src/store/memories.js';
import { scoreCandidate, DECAY_FLOOR, recencyWeight } from '../../src/projection/brief.js';

let home: string;
let store: CairnStore;

before(() => {
  home = mkdtempSync(join(tmpdir(), 'cairn-importance-'));
  store = openStore({ home });
});

after(() => {
  try {
    store.close();
  } catch {
    /* 已关 */
  }
  rmSync(home, { recursive: true, force: true });
});

function addOne(content: string, extra: Record<string, unknown> = {}) {
  const scope = store.scopes.resolvePreset('personal-global', {});
  return store.memories.add(
    {
      kind: 'fact',
      content,
      scopeId: scope.id,
      authority: 'user_explicit',
      createdBy: 'cli',
      ...extra,
    } as never,
    'test-device',
  );
}

describe('迁移 005', () => {
  it('两列存在，旧数据 usage_count 默认 0', () => {
    const cols = (store.db.all('PRAGMA table_info(memory)') as Record<string, unknown>[]).map((r) => r['name']);
    assert.ok(cols.includes('importance'));
    assert.ok(cols.includes('usage_count'));

    const m = addOne('迁移后新写入的记忆');
    assert.equal(m.importance, null, '未指定则为 NULL（读取侧按 3）');
    assert.equal(m.usageCount, 0);
  });

  it('索引存在且外键干净', () => {
    const idx = (store.db.all("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='memory'") as Record<string, unknown>[]).map(
      (r) => r['name'],
    );
    assert.ok(idx.includes('memory_importance_used'));
    assert.equal((store.db.all('PRAGMA foreign_key_check') as unknown[]).length, 0);
  });
});

describe('重要度：与可信度正交、推断受限', () => {
  it('用户明确可给 5 星，confidence 不受影响', () => {
    const m = addOne('用户说这条很重要', { importance: 5 });
    assert.equal(m.importance, 5);
    assert.equal(m.confidence, 1, 'confidence 仍是可信度，未被重要度改写');
  });

  it('推断来源上限 3：传 5 落库为 3', () => {
    assert.equal(normalizeImportance(5, 'agent_inferred'), 3);
    assert.equal(normalizeImportance(2, 'agent_inferred'), 2);
    assert.equal(normalizeImportance(5, 'user_explicit'), 5);
  });

  it('越界抛错，不静默截断', () => {
    assert.throws(() => normalizeImportance(0, 'user_explicit'), /1-5/);
    assert.throws(() => normalizeImportance(6, 'user_explicit'), /1-5/);
    assert.throws(() => normalizeImportance(3.5, 'user_explicit'), /1-5/);
  });

  it('effectiveImportance：NULL 视为 3', () => {
    assert.equal(effectiveImportance({ importance: null }), 3);
    assert.equal(effectiveImportance({ importance: 4 }), 4);
  });
});

describe('使用信号：两种增量语义', () => {
  it('自动注入只写 last_used_at，不计次数', () => {
    const m = addOne('注入一次的记忆');
    store.memories.markUsed(m.id, '2026-11-04T00:00:00.000Z', false);
    const after1 = store.memories.require(m.id);
    assert.equal(after1.usageCount, 0, '注入不得计 usage_count');
    assert.equal(after1.lastUsedAt, '2026-11-04T00:00:00.000Z');
  });

  it('显式检索两者都写，且累加', () => {
    const m = addOne('被检索两次的记忆');
    store.memories.markUsed(m.id, '2026-11-04T00:00:00.000Z', true);
    store.memories.markUsed(m.id, '2026-11-04T01:00:00.000Z', true);
    const after2 = store.memories.require(m.id);
    assert.equal(after2.usageCount, 2);
    assert.equal(after2.lastUsedAt, '2026-11-04T01:00:00.000Z');
  });
});

describe('投影评分与地板', () => {
  const NOW = Date.parse('2026-11-04T00:00:00.000Z');

  it('艾宾浩斯分桶单调不增', () => {
    const days = [0, 1.5, 3, 5, 10, 20, 40, 100, 200];
    const weights = days.map((d) => recencyWeight(d));
    for (let i = 1; i < weights.length; i++) assert.ok(weights[i]! <= weights[i - 1]!, `第 ${i} 档不应上升`);
  });

  it('高重要度豁免衰减', () => {
    const r = scoreCandidate({
      importance: 4,
      lastUsedAt: null,
      createdAt: '2020-01-01T00:00:00.000Z', // 极老
      nowMs: NOW,
    });
    assert.equal(r.decay, 1);
    assert.equal(r.flooredBy, 'importance');
  });

  it('绝对地板 0.5：中间档老记忆不沉底', () => {
    const r = scoreCandidate({
      importance: 3,
      lastUsedAt: null,
      createdAt: '2020-01-01T00:00:00.000Z',
      nowMs: NOW,
    });
    assert.equal(r.decay, DECAY_FLOOR);
    assert.equal(r.score, 3 * DECAY_FLOOR);
  });

  it('本轮高度相关豁免衰减', () => {
    const r = scoreCandidate({
      importance: 3,
      lastUsedAt: null,
      createdAt: '2020-01-01T00:00:00.000Z',
      nowMs: NOW,
      relevance: 0.9,
      maxRelevance: 1,
    });
    assert.equal(r.decay, 1);
    assert.equal(r.flooredBy, 'relevance');
  });

  it('相关度不足时不触发豁免', () => {
    const r = scoreCandidate({
      importance: 3,
      lastUsedAt: null,
      createdAt: '2020-01-01T00:00:00.000Z',
      nowMs: NOW,
      relevance: 0.5,
      maxRelevance: 1,
    });
    assert.equal(r.flooredBy, 'floor');
  });

  it('5 星老记忆仍高于 3 星新记忆（地板 0.5 的实际效果）', () => {
    const old5 = scoreCandidate({
      importance: 5,
      lastUsedAt: null,
      createdAt: '2020-01-01T00:00:00.000Z',
      nowMs: NOW,
    });
    const fresh3 = scoreCandidate({
      importance: 3,
      lastUsedAt: '2026-11-03T00:00:00.000Z',
      createdAt: '2026-11-03T00:00:00.000Z',
      nowMs: NOW,
    });
    assert.ok(old5.score >= fresh3.score, `${old5.score} 应 >= ${fresh3.score}`);
  });
});

describe('归档：只归档最低档且长期未用', () => {
  const NOW = Date.parse('2026-11-04T00:00:00.000Z');

  function seed(importance: number | null, createdAt: string) {
    const m = addOne(`归档测试 ${importance} ${createdAt}`, { importance });
    store.db.run('UPDATE memory SET created_at = ?, last_used_at = NULL WHERE id = ?', createdAt, m.id);
    return m.id;
  }

  it('演练不写库', async () => {
    const { archiveStaleMemories } = await import('../../src/governance/archive.js');
    const id = seed(1, '2020-01-01T00:00:00.000Z');
    const r = archiveStaleMemories(store, { dryRun: true, nowMs: NOW });
    assert.equal(r.archived, 0);
    assert.ok(r.ids.includes(id));
    assert.equal(store.memories.require(id).status, 'active', '演练不得改状态');
  });

  it('到期归档并留审计', async () => {
    const { archiveStaleMemories } = await import('../../src/governance/archive.js');
    const id = seed(1, '2020-01-01T00:00:00.000Z');
    const r = archiveStaleMemories(store, { nowMs: NOW });
    assert.ok(r.archived >= 1);
    assert.equal(store.memories.require(id).status, 'archived');
    const audits = store.db.all(
      "SELECT action, detail FROM audit_event WHERE category='memory' AND action='archived_stale'",
    ) as Record<string, unknown>[];
    assert.ok(audits.length >= 1, '必须留审计');
    assert.ok(String(audits[audits.length - 1]!['detail']).includes('stale_low_importance'));
  });

  it('importance=2 不归档；NULL 也不归档', async () => {
    const { archiveStaleMemories } = await import('../../src/governance/archive.js');
    const keep2 = seed(2, '2020-01-01T00:00:00.000Z');
    const keepNull = seed(null, '2020-01-01T00:00:00.000Z');
    const r = archiveStaleMemories(store, { nowMs: NOW });
    assert.ok(!r.ids.includes(keep2), 'importance=2 保留');
    assert.ok(!r.ids.includes(keepNull), 'NULL（未判断）不视为最低档');
  });

  it('未到期不归档', async () => {
    const { archiveStaleMemories } = await import('../../src/governance/archive.js');
    const recent = seed(1, '2026-10-01T00:00:00.000Z'); // 34 天前
    const r = archiveStaleMemories(store, { nowMs: NOW });
    assert.ok(!r.ids.includes(recent));
  });

  it('幂等：重复执行不重复记审计', async () => {
    const { archiveStaleMemories } = await import('../../src/governance/archive.js');
    archiveStaleMemories(store, { nowMs: NOW });
    const before = (store.db.all("SELECT COUNT(*) n FROM audit_event WHERE action='archived_stale'") as Record<string, unknown>[])[0]!['n'];
    archiveStaleMemories(store, { nowMs: NOW });
    const after2 = (store.db.all("SELECT COUNT(*) n FROM audit_event WHERE action='archived_stale'") as Record<string, unknown>[])[0]!['n'];
    assert.equal(Number(after2), Number(before), '已归档的不会被重复处理');
  });
});
