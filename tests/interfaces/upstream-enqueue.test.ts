import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppService } from '../../src/interfaces/app-service.js';
import { makeTestHome, cleanupTestHome } from '../helpers.js';

/**
 * 编排层上行落点（spec cloud-sync「上行入队完备性」）。
 * 钉住三件事：合并到既有记忆、晋升候选、拒绝候选——三条路径都要和
 * addMemory / reviseMemory / forgetMemory 产生同形、同幂等键的上行任务。
 */

function setup() {
  const home = makeTestHome('cairn-upstream-');
  const service = AppService.open(home);
  const jobs = (entityId: string) =>
    service.store.db.all(
      "SELECT * FROM outbox_job WHERE job_type = 'sync_upstream' AND entity_id = ?",
      entityId,
    );
  return {
    service,
    store: service.store,
    jobs,
    cleanup() {
      service.close();
      cleanupTestHome(home);
    },
  };
}

/** 在指定作用域直写一条记忆（不入队），用来制造"既有目标"这一前置。 */
function directMemory(s: ReturnType<typeof setup>, content: string, preset: 'personal-global' | 'device-local' = 'personal-global'): string {
  const scope = s.service.resolveScope({ preset });
  const m = s.store.memories.add(
    { kind: 'fact', content, scopeId: scope.id, authority: 'user_explicit', createdBy: 'cli' },
    s.service.caller.deviceId,
  );
  return m.id;
}

test('addMemory merge 分支：目标原本没有待办时补一条 memory:<id>', () => {
  const s = setup();
  try {
    const targetId = directMemory(s, '合并落点测试原文');
    assert.equal(s.jobs(targetId).length, 0, '前置：直写存储层不入队');

    const r = s.service.addMemory({ content: '合并落点测试原文', scope: { preset: 'personal-global' } });

    assert.equal(r.action, 'merge');
    assert.equal(r.memory!.id, targetId);
    const rows = s.jobs(targetId);
    assert.equal(rows.length, 1, '合并目标应有且只有一条上行任务');
    assert.equal(rows[0]!.idempotency_key, `memory:${targetId}`);
    assert.deepEqual(JSON.parse(String(rows[0]!.payload)), { op: 'memory_upsert', memoryId: targetId });
    assert.equal(rows[0]!.status, 'pending');
  } finally {
    s.cleanup();
  }
});

test('addMemory promote_candidate 分支：晋升后补一条 memory:<id>:rev:<revisionId>', () => {
  const s = setup();
  try {
    const candId = directMemory(s, '待晋升候选原文');
    s.store.db.run("UPDATE memory SET status = 'candidate' WHERE id = ?", candId);
    assert.equal(s.jobs(candId).length, 0, '前置：候选直写不入队');

    const r = s.service.addMemory({
      content: '待晋升候选原文',
      authority: 'user_explicit',
      scope: { preset: 'personal-global' },
    });

    assert.equal(r.action, 'promote_candidate');
    assert.equal(r.memory!.status, 'active');
    const rows = s.jobs(candId);
    assert.equal(rows.length, 1, '晋升的记忆应有一条上行任务');
    assert.equal(rows[0]!.idempotency_key, `memory:${candId}:rev:${r.memory!.currentRevisionId}`);
  } finally {
    s.cleanup();
  }
});

test('rejectCandidate：墓碑上行一条，重复拒绝不产生第二条', () => {
  const s = setup();
  try {
    const candId = directMemory(s, '将被拒绝的候选原文');
    s.store.db.run("UPDATE memory SET status = 'candidate' WHERE id = ?", candId);

    const out = s.service.rejectCandidate(candId, { reason: '用户判断这条没有价值' });

    assert.equal(out.memory.status, 'tombstoned');
    const rows = s.jobs(candId);
    assert.equal(rows.length, 1, '拒绝候选应有且只有一条墓碑上行任务');
    assert.equal(rows[0]!.idempotency_key, `memory:${candId}:tombstone`);
    assert.deepEqual(JSON.parse(String(rows[0]!.payload)), { op: 'memory_tombstone', memoryId: candId });

    assert.throws(() => s.service.rejectCandidate(candId, { reason: '再拒一次' }), /只有候选/);
    assert.equal(s.jobs(candId).length, 1, '重复拒绝不得产生第二条任务');
  } finally {
    s.cleanup();
  }
});

test('rejectCandidate：设备限定候选转墓碑但不入队', () => {
  const s = setup();
  try {
    const candId = directMemory(s, '设备限定的候选原文', 'device-local');
    s.store.db.run("UPDATE memory SET status = 'candidate' WHERE id = ?", candId);

    const out = s.service.rejectCandidate(candId, { reason: '本机内容不上行' });

    assert.equal(out.memory.status, 'tombstoned');
    assert.equal(s.jobs(candId).length, 0, '设备限定内容不得产生上行任务');
  } finally {
    s.cleanup();
  }
});

test('doctor：上行缺口计数准确，进 notes 而不进 problems，ok 仍为 true', () => {
  const s = setup();
  try {
    directMemory(s, '历史遗漏的缺口甲');
    directMemory(s, '历史遗漏的缺口乙');

    const before = s.service.doctor();
    assert.equal(before.counts.upstreamGap, 2, '缺口计数应等于实际未入队的活动记忆数');
    assert.equal(before.ok, true, '缺口是可自愈状态，不得影响 ok');
    assert.deepEqual(before.problems, [], '缺口不得进 problems');
    assert.ok(
      before.notes.some((n) => n.includes('上行缺口 2 条') && n.includes('cairn sync backfill --apply')),
      `notes 应给出可执行提示，实际 ${JSON.stringify(before.notes)}`,
    );

    s.service.syncBackfillCmd({ apply: true });

    const after = s.service.doctor();
    assert.equal(after.counts.upstreamGap, 0, '补齐后缺口归零');
    assert.equal(after.ok, true);
    assert.ok(!after.notes.some((n) => n.includes('上行缺口')), '缺口消失后不再提示');
  } finally {
    s.cleanup();
  }
});
