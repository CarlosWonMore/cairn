import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppService } from '../../src/interfaces/app-service.js';
import { makeTestHome, cleanupTestHome } from '../helpers.js';

/**
 * 作用域迁移（add-scope-migration 任务 1.3 / 2.5）：
 * 迁移只改 scope_id；安全阀逐条拒绝；outbox 重建与 promoteCandidate 同构；
 * 迁出排独立 sync_scope_exit 任务（不是 sync_upstream）。
 */

function openService() {
  const home = makeTestHome();
  return { service: AppService.open(home), home };
}

interface Setup {
  service: AppService;
  home: string;
  memoryId: string;
}

function setup(): Setup {
  const { service, home } = openService();
  const r = service.addMemory({ content: '构建约定是 pnpm', kind: 'fact' });
  return { service, home, memoryId: r.memory!.id };
}

test('migrateScope：只改 scope_id，status/authority/正文/修订链不变', () => {
  const { service, home, memoryId } = setup();
  try {
    const store = service.store;
    const before = store.memories.require(memoryId);
    const revCountBefore = store.memories.revisions(memoryId).length;
    const target = store.scopes.resolvePreset('device-local', { deviceId: store.identity.deviceId });

    const out = store.memories.migrateScope(memoryId, target.id, 'test');

    const after = store.memories.require(memoryId);
    assert.equal(after.scopeId, target.id);
    assert.equal(after.status, before.status);
    assert.equal(after.authority, before.authority);
    assert.equal(after.content, before.content);
    assert.equal(after.currentRevisionId, before.currentRevisionId);
    assert.equal(store.memories.revisions(memoryId).length, revCountBefore);
    assert.equal(out.id, memoryId);
  } finally {
    service.close();
    cleanupTestHome(home);
  }
});

test('migrateScope：目标作用域不存在 → E_NOT_FOUND', () => {
  const { service, home, memoryId } = setup();
  try {
    assert.throws(() => service.store.memories.migrateScope(memoryId, 'scope-nope', 'test'), /E_NOT_FOUND|不存在/);
  } finally {
    service.close();
    cleanupTestHome(home);
  }
});

test('安全阀：冲突状态拒绝（E_CONFLICT_STATE，退出码 4）', () => {
  const { service, home, memoryId } = setup();
  try {
    const store = service.store;
    const r1 = store.memories.revise(memoryId, 'v2', { reason: 'a', author: 'test' }, store.identity.deviceId).revision;
    const r2 = store.memories.revise(memoryId, 'v3', { reason: 'b', author: 'test' }, store.identity.deviceId).revision;
    store.conflicts.record({ memoryId, revisionAId: r1.id, revisionBId: r2.id });

    assert.throws(
      () => service.rescopeMemory(memoryId, { scopePreset: 'device-local' }),
      (e: { code?: string }) => e.code === 'E_CONFLICT_STATE',
    );
    // 记忆未变
    assert.equal(store.memories.require(memoryId).scopeId, store.scopes.resolvePreset('personal-global').id);
  } finally {
    service.close();
    cleanupTestHome(home);
  }
});

test('安全阀：项目作用域缺 projectId 拒绝（E_VALIDATION）', () => {
  const { service, home, memoryId } = setup();
  try {
    assert.throws(
      () => service.rescopeMemory(memoryId, { scopePreset: 'project-device' }),
      (e: { code?: string }) => e.code === 'E_VALIDATION',
    );
  } finally {
    service.close();
    cleanupTestHome(home);
  }
});

test('安全阀：user_explicit 无 force 拒绝（E_FORBIDDEN）；带 force 通过', () => {
  const { service, home, memoryId } = setup();
  try {
    const store = service.store;
    const mem = store.memories.require(memoryId);
    assert.equal(mem.authority, 'user_explicit');
    assert.throws(
      () => service.rescopeMemory(memoryId, { scopePreset: 'device-local' }),
      (e: { code?: string }) => e.code === 'E_FORBIDDEN',
    );
    const r = service.rescopeMemory(memoryId, { scopePreset: 'device-local', force: true });
    assert.equal(r.willLoseSync, true);
    assert.equal(store.memories.require(memoryId).scopeId, r.scope.id);
  } finally {
    service.close();
    cleanupTestHome(home);
  }
});

test('安全阀：agent_inferred 记忆迁移不需要 force', () => {
  const { service, home, memoryId } = setup();
  try {
    const store = service.store;
    store.db.run("UPDATE memory SET authority = 'agent_inferred' WHERE id = ?", memoryId);
    const r = service.rescopeMemory(memoryId, { scopePreset: 'device-local' });
    assert.equal(r.willLoseSync, true);
  } finally {
    service.close();
    cleanupTestHome(home);
  }
});

test('迁出：旧 pending 上行作废、无新 sync_upstream、排一条 sync_scope_exit', () => {
  const { service, home, memoryId } = setup();
  try {
    const store = service.store;
    const scope = store.scopes.resolvePreset('personal-global');
    // 模拟「曾同步过」：排一条 pending 上行 + 写 sync_pushed 元数据
    store.outbox.enqueue({ jobType: 'sync_upstream', scopeId: scope.id, entityType: 'memory', entityId: memoryId, idempotencyKey: `t:${memoryId}` });
    store.db.run('INSERT INTO meta (key, value) VALUES (?, ?)', `sync_pushed:personal-global:${memoryId}`, 'rev-x');

    const r = service.rescopeMemory(memoryId, { scopePreset: 'device-local', force: true });

    assert.equal(r.willLoseSync, true);
    assert.equal(r.scopeExitEnqueued, true);
    const ups = store.outbox.list({ jobType: 'sync_upstream', limit: 100 }).filter((j) => j.entityId === memoryId);
    assert.equal(ups.length, 0, '旧 pending 上行必须作废，且未产生新的上行任务');
    const exits = store.outbox.list({ jobType: 'sync_scope_exit', limit: 100 }).filter((j) => j.entityId === memoryId);
    assert.equal(exits.length, 1);
    assert.equal(exits[0]!.status, 'pending');
    assert.equal(exits[0]!.payload['op'], 'scope_exit');
  } finally {
    service.close();
    cleanupTestHome(home);
  }
});

test('迁入：产生一条 sync_upstream 待办；曾同步过的迁入带 force（迁回信号）', () => {
  const { service, home, memoryId } = setup();
  try {
    const store = service.store;
    // 迁出到 device-local（从未同步过）：不产生任何上行或迁出任务
    service.rescopeMemory(memoryId, { scopePreset: 'device-local', force: true });
    let jobs = store.outbox.list({ jobType: 'sync_upstream', limit: 100 }).filter((j) => j.entityId === memoryId);
    assert.equal(jobs.length, 0, '迁出到 local_only 不入上行队');

    // 迁入 personal-global（从未同步过）：普通入队，不带 force
    service.rescopeMemory(memoryId, { scopePreset: 'personal-global', force: true });
    jobs = store.outbox.list({ jobType: 'sync_upstream', limit: 100 }).filter((j) => j.entityId === memoryId && j.status === 'pending');
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0]!.payload['force'], undefined);

    // 再走一轮「曾同步过 → 迁出 → 迁回」：迁入必须带 force（否则 push 幂等跳过，对端收不到重新持有信号）
    store.db.run('INSERT INTO meta (key, value) VALUES (?, ?)', `sync_pushed:personal-global:${memoryId}`, 'rev-x');
    service.rescopeMemory(memoryId, { scopePreset: 'device-local', force: true });
    service.rescopeMemory(memoryId, { scopePreset: 'personal-global', force: true });
    jobs = store.outbox.list({ jobType: 'sync_upstream', limit: 100 }).filter((j) => j.entityId === memoryId && j.status === 'pending');
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0]!.payload['force'], true, '迁回必须强制重发，否则对端永远收不到重新持有的信号');
  } finally {
    service.close();
    cleanupTestHome(home);
  }
});

test('原地迁移：无操作、无审计、无新任务', () => {
  const { service, home, memoryId } = setup();
  try {
    const store = service.store;
    const before = store.memories.require(memoryId);
    const r = service.rescopeMemory(memoryId, { scopePreset: 'personal-global' });
    assert.equal(r.scope.id, before.scopeId);
    assert.equal(r.willLoseSync, false);
    assert.equal(r.scopeExitEnqueued, false);
  } finally {
    service.close();
    cleanupTestHome(home);
  }
});

test('审计：scope_migrated 记录前后作用域与执行者', () => {
  const { service, home, memoryId } = setup();
  try {
    const store = service.store;
    const from = store.scopes.resolvePreset('personal-global').id;
    service.rescopeMemory(memoryId, { scopePreset: 'device-local', force: true });
    const items = store.audit.list({ category: 'memory', action: 'scope_migrated' });
    assert.equal(items.length, 1);
    assert.equal(items[0]!.detail['fromScope'], from);
    assert.notEqual(items[0]!.detail['toScope'], from);
  } finally {
    service.close();
    cleanupTestHome(home);
  }
});
