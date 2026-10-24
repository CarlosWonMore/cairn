import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openStore, CairnStore } from '../../src/store/open.js';
import { makeTestHome, cleanupTestHome } from '../helpers.js';
import { err } from '../../src/core/errors.js';

function withStore(fn: (store: CairnStore) => void): void {
  const home = makeTestHome();
  const store = openStore({ home });
  try {
    fn(store);
  } finally {
    store.close();
    cleanupTestHome(home);
  }
}

test('outbox：local_only 作用域上行任务被物理排除并留审计', () => {
  withStore((store) => {
    const local = store.scopes.resolvePreset('device-local', { deviceId: store.identity.deviceId });
    const r = store.outbox.enqueue({
      jobType: 'sync_upstream',
      scopeId: local.id,
      entityType: 'memory',
      entityId: 'm1',
      idempotencyKey: 'k1',
    });
    assert.equal(r.enqueued, false);
    assert.equal(r.reason, 'scope_local_only');
    assert.equal(store.outbox.counts().pending, 0);
    // 审计有排除记录
    const audits = store.audit.recent(10).filter((a) => a.category === 'scope_exclusion');
    assert.equal(audits.length, 1);
    assert.equal(audits[0]!.action, 'outbox_upstream_excluded');

    // DB 触发器兜底：绕过应用层直接插入同样失败
    assert.throws(
      () =>
        store.db.run(
          `INSERT INTO outbox_job (id, job_type, scope_id, entity_type, entity_id, payload, payload_hash, idempotency_key, status, attempts, max_attempts, next_attempt_at, created_at, updated_at)
           VALUES ('x1','sync_upstream',?,'memory','m1','{}','h','kx','pending',0,5,NULL,'2026-01-01','2026-01-01')`,
          local.id,
        ),
      /scope_not_upstreamable/,
    );
  });
});

test('outbox：encrypted 作用域可入队，设备限定被排除', () => {
  withStore((store) => {
    const enc = store.scopes.resolvePreset('personal-global');
    const r1 = store.outbox.enqueue({
      jobType: 'sync_upstream', scopeId: enc.id, entityType: 'memory', entityId: 'm1', idempotencyKey: 'k-enc',
    });
    assert.equal(r1.enqueued, true);

    // 设备限定作用域（custom 构造 device 绑定）
    const devBound = store.scopes.resolvePreset('device-local', { deviceId: store.identity.deviceId });
    const r2 = store.outbox.enqueue({
      jobType: 'sync_upstream', scopeId: devBound.id, entityType: 'memory', entityId: 'm2', idempotencyKey: 'k-dev',
    });
    assert.equal(r2.enqueued, false);
    assert.equal(r2.reason, 'scope_local_only');

    // 非 sync 任务不受限
    const r3 = store.outbox.enqueue({
      jobType: 'maintain', scopeId: devBound.id, entityType: 'system', entityId: 'sys', idempotencyKey: 'k-maint',
    });
    assert.equal(r3.enqueued, true);
  });
});

test('outbox：幂等键防重复入队，claim/重试/死亡上限', () => {
  withStore((store) => {
    const enc = store.scopes.resolvePreset('personal-global');
    const first = store.outbox.enqueue({
      jobType: 'sync_upstream', scopeId: enc.id, entityType: 'memory', entityId: 'm1', idempotencyKey: 'dup-key',
    });
    assert.equal(first.enqueued, true);
    const second = store.outbox.enqueue({
      jobType: 'sync_upstream', scopeId: enc.id, entityType: 'memory', entityId: 'm1', idempotencyKey: 'dup-key',
    });
    assert.equal(second.enqueued, false);
    assert.equal(second.job!.id, first.job!.id);

    // 领取 → 失败 → retry；达到上限 → dead
    const claimed = store.outbox.claimReady(10);
    assert.equal(claimed.length, 1);
    let j = store.outbox.markFailedRetry(claimed[0]!.id, 'boom-1');
    assert.equal(j.status, 'retry');
    assert.equal(j.attempts, 1);
    // retry 的任务 next_attempt_at 在未来，不可立即再领取
    assert.equal(store.outbox.claimReady(10).length, 0);
    for (let i = 0; i < 10; i++) {
      j = store.outbox.markFailedRetry(j.id, `boom-${i + 2}`);
    }
    assert.equal(j.status, 'dead', '超过上限转 dead');
    assert.equal(j.attempts, j.maxAttempts);
    assert.equal(j.lastError, 'boom-5', '死亡时记录当次错误；终态后不再累加');

    // done 状态
    const c2 = store.outbox.claimReady(10);
    assert.equal(c2.length, 0, 'dead 不再领取');
  });
});

test('outbox：worker 崩溃后 running 复位', () => {
  withStore((store) => {
    const enc = store.scopes.resolvePreset('personal-global');
    store.outbox.enqueue({ jobType: 'maintain', scopeId: enc.id, entityType: 'system', entityId: 's', idempotencyKey: 'k1' });
    const claimed = store.outbox.claimReady(1);
    assert.equal(claimed[0]!.status, 'running');
    const reset = store.outbox.resetRunningToPending();
    assert.equal(reset, 1);
    assert.equal(store.outbox.claimReady(1).length, 1);
  });
});

test('outbox：scope_id 不存在时入队报错', () => {
  withStore((store) => {
    assert.throws(
      () =>
        store.outbox.enqueue({ jobType: 'sync_upstream', scopeId: 'missing', entityType: 'memory', entityId: 'm', idempotencyKey: 'k' }),
      (e: unknown) => (e as { code?: string }).code === 'E_NOT_FOUND',
    );
  });
});
