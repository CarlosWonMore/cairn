import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { AppService } from '../../src/interfaces/app-service.js';
import { findUpstreamGap, backfillUpstream } from '../../src/sync/backfill.js';
import { makeTestHome, cleanupTestHome } from '../helpers.js';

/**
 * 冷启动对账（spec cloud-sync「冷启动对账」/ design D3）。
 * 钉住：默认只读、幂等、不限制既有 job 状态、设备限定零入队、不碰网络。
 */

function setup() {
  const home = makeTestHome('cairn-backfill-');
  const service = AppService.open(home);
  return {
    service,
    store: service.store,
    cleanup() {
      service.close();
      cleanupTestHome(home);
    },
  };
}

/** 直写存储层造一条"应上行但未入队"的活动记忆：历史遗留缺口的形状。 */
function gapMemory(s: ReturnType<typeof setup>, content: string, preset: 'personal-global' | 'device-local' = 'personal-global'): string {
  const scope = s.service.resolveScope({ preset });
  const m = s.store.memories.add(
    { kind: 'fact', content, scopeId: scope.id, authority: 'user_explicit', createdBy: 'cli' },
    s.service.caller.deviceId,
  );
  return m.id;
}

function outboxSnapshot(store: ReturnType<typeof setup>['store']): { rows: number; digest: string } {
  const rows = store.db.all('SELECT id, payload_hash, status, idempotency_key FROM outbox_job ORDER BY id');
  return { rows: rows.length, digest: createHash('sha256').update(JSON.stringify(rows)).digest('hex') };
}

function syncJobs(store: ReturnType<typeof setup>['store'], memoryId: string) {
  return store.db.all(
    "SELECT * FROM outbox_job WHERE job_type = 'sync_upstream' AND entity_id = ?",
    memoryId,
  );
}

test('dry-run：候选数正确，outbox 行数与内容逐字节不变', () => {
  const s = setup();
  try {
    const a = gapMemory(s, '历史遗漏的偏好一');
    const b = gapMemory(s, '历史遗漏的偏好二');
    const before = outboxSnapshot(s.store);

    const r = backfillUpstream(s.store, { apply: false });

    assert.equal(r.candidates, 2);
    assert.equal(r.enqueued, 0);
    assert.equal(r.existing, 0);
    assert.equal(r.excluded, 0);
    assert.deepEqual([...r.memoryIds].sort(), [a, b].sort());
    assert.deepEqual(outboxSnapshot(s.store), before, 'dry-run 不得写任何 outbox 行');
  } finally {
    s.cleanup();
  }
});

test('--apply 后缺口归零：再次 dry-run 候选为 0，任务形状与 addMemory 一致', () => {
  const s = setup();
  try {
    const id = gapMemory(s, '需要补入队的记忆');
    assert.equal(findUpstreamGap(s.store).length, 1, '前置：存在缺口');

    const r = backfillUpstream(s.store, { apply: true });

    assert.equal(r.candidates, 1);
    assert.equal(r.enqueued, 1);
    assert.deepEqual(r.memoryIds, [id]);
    const rows = syncJobs(s.store, id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.idempotency_key, `memory:${id}`);
    assert.equal(rows[0]!.status, 'pending');
    assert.deepEqual(JSON.parse(String(rows[0]!.payload)), { op: 'memory_upsert', memoryId: id });

    assert.equal(findUpstreamGap(s.store).length, 0, '补齐后缺口应为 0');
    assert.equal(backfillUpstream(s.store, { apply: false }).candidates, 0);
  } finally {
    s.cleanup();
  }
});

test('连续两次 --apply：第二次新增 0，不产生重复任务', () => {
  const s = setup();
  try {
    const id = gapMemory(s, '幂等性测试记忆');

    const first = backfillUpstream(s.store, { apply: true });
    const second = backfillUpstream(s.store, { apply: true });

    assert.equal(first.enqueued, 1);
    assert.equal(second.candidates, 0);
    assert.equal(second.enqueued, 0);
    assert.equal(second.memoryIds.length, 0);
    assert.equal(syncJobs(s.store, id).length, 1, '同一记忆只能有一条 memory:<id> 任务');
  } finally {
    s.cleanup();
  }
});

test('device-local 记忆不计入候选，也不产生任何 outbox 行', () => {
  const s = setup();
  try {
    const localId = gapMemory(s, '只属于本机的内容', 'device-local');
    const globalId = gapMemory(s, '可以上行的内容');

    const r = backfillUpstream(s.store, { apply: true });

    assert.equal(r.candidates, 1);
    assert.deepEqual(r.memoryIds, [globalId]);
    assert.equal(syncJobs(s.store, localId).length, 0, '设备限定内容零入队');
    assert.equal(syncJobs(s.store, globalId).length, 1);
  } finally {
    s.cleanup();
  }
});

test('已有任意状态 sync_upstream 的记忆不算缺口：done 与 dead 都算"管过"', () => {
  const s = setup();
  try {
    const doneId = gapMemory(s, '已成功推送过的记忆');
    const doneJob = s.store.outbox.enqueue({
      jobType: 'sync_upstream',
      scopeId: s.service.resolveScope({ preset: 'personal-global' }).id,
      entityType: 'memory',
      entityId: doneId,
      payload: { op: 'memory_upsert', memoryId: doneId },
      idempotencyKey: `memory:${doneId}`,
    });
    s.store.outbox.markDone(doneJob.job!.id);

    const deadId = gapMemory(s, '重试耗尽而终止的记忆');
    const deadJob = s.store.outbox.enqueue({
      jobType: 'sync_upstream',
      scopeId: s.service.resolveScope({ preset: 'personal-global' }).id,
      entityType: 'memory',
      entityId: deadId,
      payload: { op: 'memory_upsert', memoryId: deadId },
      idempotencyKey: `memory:${deadId}`,
      maxAttempts: 1,
    });
    s.store.outbox.markFailedRetry(deadJob.job!.id, '模拟不可达');
    assert.equal(s.store.outbox.requireById(deadJob.job!.id).status, 'dead', '前置：任务已终止');

    const aliveId = gapMemory(s, '从未入队的记忆');
    const r = backfillUpstream(s.store, { apply: true });

    assert.equal(r.candidates, 1);
    assert.deepEqual(r.memoryIds, [aliveId]);
    assert.equal(syncJobs(s.store, doneId).length, 1);
    assert.equal(syncJobs(s.store, deadId).length, 1);
  } finally {
    s.cleanup();
  }
});

test('--limit 限制单次写入量：候选数报全量，分两轮补齐', () => {
  const s = setup();
  try {
    for (const c of ['批次一', '批次二', '批次三']) gapMemory(s, c);

    const first = backfillUpstream(s.store, { apply: true, limit: 2 });
    assert.equal(first.candidates, 3, '候选数是库中缺口全量');
    assert.equal(first.enqueued, 2, '单次只写 limit 条');
    assert.equal(first.memoryIds.length, 2);

    const second = backfillUpstream(s.store, { apply: true, limit: 2 });
    assert.equal(second.candidates, 1);
    assert.equal(second.enqueued, 1);
    assert.equal(backfillUpstream(s.store, { apply: false }).candidates, 0);
  } finally {
    s.cleanup();
  }
});

test('远端已配置但不可达：--apply 仍成功，且全程零网络调用', () => {
  const s = setup();
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = ((..._args: Parameters<typeof fetch>) => {
    fetchCalls++;
    throw new Error('网络不可用（测试替身）');
  }) as typeof fetch;
  try {
    s.service.vaultInitRemote({ provider: 'syncd', syncd: { baseUrl: 'http://127.0.0.1:1' } });
    assert.equal(s.service.vaultStatus().configured, true, '前置：远端已配置');
    const id = gapMemory(s, '远端不可达时仍需补入队的记忆');

    const r = s.service.syncBackfillCmd({ apply: true });

    assert.equal(r.enqueued, 1);
    assert.equal(syncJobs(s.store, id).length, 1);
    assert.equal(fetchCalls, 0, 'backfill 不得发起任何网络请求');
  } finally {
    globalThis.fetch = originalFetch;
    s.cleanup();
  }
});
