import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openStore, type CairnStore } from '../../src/store/open.js';
import { makeTestHome, cleanupTestHome } from '../helpers.js';
import { isoPlusMs, nowIso } from '../../src/core/time.js';
import { err } from '../../src/core/errors.js';
import type { JobRow } from '../../src/store/outbox.js';
import type { RemoteStore } from '../../src/jobs/remote.js';
import {
  DEFAULT_JOB_TIMEOUT_MS,
  registerDefaultHandlers,
  registerHandler,
  runOnce,
  runWorkerLoop,
  type JobContext,
  type RunOnceSummary,
} from '../../src/jobs/worker.js';

/**
 * 注意：本文件第一个测试依赖「handler 注册表初始为空」（模块级状态，测试按声明顺序执行），
 * 因此 no_handler 测试必须先于任何 registerDefaultHandlers() 调用。
 * node:sqlite 的 DatabaseSync 在 Node 24 会有 ExperimentalWarning（stderr），不影响断言。
 */

async function withStore(fn: (store: CairnStore) => Promise<void>): Promise<void> {
  const home = makeTestHome();
  const store = openStore({ home });
  try {
    await fn(store);
  } finally {
    store.close();
    cleanupTestHome(home);
  }
}

function enqueue(store: CairnStore, input: {
  jobType: JobRow['jobType'];
  scopeId: string | null;
  entityId: string;
  idempotencyKey: string;
  payload?: Record<string, unknown>;
  maxAttempts?: number;
  entityType?: JobRow['entityType'];
}): JobRow {
  const r = store.outbox.enqueue({
    jobType: input.jobType,
    scopeId: input.scopeId,
    entityType: input.entityType ?? 'system',
    entityId: input.entityId,
    payload: input.payload,
    idempotencyKey: input.idempotencyKey,
    maxAttempts: input.maxAttempts,
  });
  assert.equal(r.enqueued, true, `任务应入队成功: ${input.idempotencyKey}`);
  return r.job!;
}

function personalScope(store: CairnStore): string {
  return store.scopes.resolvePreset('personal-global').id;
}

/** 把 retry 任务变回可领取（绕过退避等待：直接用未来 now 或回拨 next_attempt_at）。 */
function futureNow(ms = 60_000): string {
  return isoPlusMs(nowIso(), ms);
}

// ---------------------------------------------------------------------------
// 1. 未注册 handler（必须最先运行：此时注册表仍为空）
// ---------------------------------------------------------------------------

test('worker：未注册 handler 的类型诚实进 retry，错误含 no_handler', async () => {
  await withStore(async (store) => {
    const job = enqueue(store, {
      jobType: 'maintain', scopeId: personalScope(store), entityId: 'sys', idempotencyKey: 'no-handler-1',
    });
    const summary = await runOnce(store);
    assert.equal(summary.processed, 1);
    assert.equal(summary.done, 0);
    assert.equal(summary.retry, 1);
    assert.equal(summary.failures.length, 1);
    assert.equal(summary.failures[0]!.id, job.id);
    assert.equal(summary.failures[0]!.error, 'no_handler_for_maintain');
    const stored = store.outbox.requireById(job.id);
    assert.equal(stored.status, 'retry');
    assert.equal(stored.lastError, 'no_handler_for_maintain');
  });
});

// ---------------------------------------------------------------------------
// 2. maintain 默认 handler
// ---------------------------------------------------------------------------

test('worker maintain：过期的 awaiting_approval 计划被 expireStale 清理', async () => {
  registerDefaultHandlers();
  await withStore(async (store) => {
    const { plan } = store.plans.createPlan({
      scopeId: personalScope(store),
      ops: [{ opType: 'add', content: '构建命令是 pnpm build', kind: 'fact' }],
      proposedBy: 'test',
      ttlMs: -1, // 创建即过期
    });
    assert.equal(plan.status, 'awaiting_approval');
    enqueue(store, { jobType: 'maintain', scopeId: plan.scopeId, entityId: 'sys', idempotencyKey: 'm-plan-1' });
    const summary = await runOnce(store);
    assert.equal(summary.done, 1, 'maintain 任务本身成功');
    assert.equal(store.plans.requireById(plan.id).status, 'expired');
  });
});

test('worker maintain：updated_at 早于 15 分钟的 running 任务被复位为 pending', async () => {
  registerDefaultHandlers();
  await withStore(async (store) => {
    const scopeId = personalScope(store);
    // 任务 A：被领取后 worker 死亡，人为把 updated_at 拨到 16 分钟前
    const a = enqueue(store, { jobType: 'maintain', scopeId, entityId: 'a', idempotencyKey: 'm-stale-a' });
    const [claimed] = store.outbox.claimReady(1);
    assert.equal(claimed!.id, a.id);
    assert.equal(claimed!.status, 'running');
    store.db.run('UPDATE outbox_job SET updated_at = ? WHERE id = ?', isoPlusMs(nowIso(), -16 * 60_000), a.id);

    // 任务 B：提供本轮 maintain 触发（A 是 running，claimReady 不会重复领取它）
    enqueue(store, { jobType: 'maintain', scopeId, entityId: 'b', idempotencyKey: 'm-stale-b' });
    const summary = await runOnce(store);
    assert.equal(summary.processed, 1, '只有 B 可领取');
    assert.equal(store.outbox.requireById(a.id).status, 'pending', '陈旧 running 被复位，可由下一轮续跑');
  });
});

test('worker maintain：updated_at 新鲜的 running 任务不被误伤', async () => {
  registerDefaultHandlers();
  await withStore(async (store) => {
    const scopeId = personalScope(store);
    const a = enqueue(store, { jobType: 'maintain', scopeId, entityId: 'a', idempotencyKey: 'm-fresh-a' });
    store.outbox.claimReady(1);
    // updated_at 保持新鲜（刚被 claimReady 更新为 now）
    enqueue(store, { jobType: 'maintain', scopeId, entityId: 'b', idempotencyKey: 'm-fresh-b' });
    await runOnce(store);
    assert.equal(store.outbox.requireById(a.id).status, 'running', '存活 worker 正在跑的任务不被复位');
  });
});

// ---------------------------------------------------------------------------
// 3. sync_upstream 与远端能力
// ---------------------------------------------------------------------------

test('worker sync_upstream：远端未配置时诚实 retry，lastError 含 remote_not_configured', async () => {
  registerDefaultHandlers();
  await withStore(async (store) => {
    const id = enqueue(store, {
      jobType: 'sync_upstream', scopeId: personalScope(store), entityId: 'm1', entityType: 'memory',
      payload: { content: 'synthetic' }, idempotencyKey: 'sync-nc-1',
    }).id;
    const summary = await runOnce(store);
    assert.equal(summary.retry, 1);
    assert.equal(summary.failures[0]!.error, 'remote_not_configured');
    const job = store.outbox.requireById(id);
    assert.equal(job.status, 'retry');
    assert.ok((job.lastError ?? '').includes('remote_not_configured'));
    assert.equal(store.outbox.counts().retry, 1);
  });
});

test('worker sync_upstream：连续失败到 max_attempts 转 dead，counts 如实反映', async () => {
  registerDefaultHandlers();
  await withStore(async (store) => {
    const id = enqueue(store, {
      jobType: 'sync_upstream', scopeId: personalScope(store), entityId: 'm2', entityType: 'memory',
      idempotencyKey: 'sync-dead-1', maxAttempts: 2,
    }).id;
    const s1 = await runOnce(store);
    assert.equal(s1.retry, 1, '第一次失败进 retry');
    const s2 = await runOnce(store, { now: futureNow() });
    assert.equal(s2.dead, 1, '第二次失败达到上限转 dead');
    const job = store.outbox.requireById(id);
    assert.equal(job.status, 'dead');
    assert.equal(job.attempts, job.maxAttempts);
    const counts = store.outbox.counts();
    assert.equal(counts.dead, 1);
    assert.equal(counts.retry, 0);
    assert.equal(counts.done, 0);
  });
});

class FakeConfiguredRemote implements RemoteStore {
  readonly configured = true;
  readonly puts: { key: string; bytes: Uint8Array; hash: string }[] = [];
  readonly objects = new Map<string, Uint8Array>();

  async getObject(key: string): Promise<Uint8Array | null> {
    return this.objects.get(key) ?? null;
  }
  async putImmutable(key: string, bytes: Uint8Array, hash: string): Promise<void> {
    this.puts.push({ key, bytes, hash });
    this.objects.set(key, bytes);
  }
  async list(prefix: string): Promise<{ keys: string[]; nextCursor?: string }> {
    return { keys: [...this.objects.keys()].filter((k) => k.startsWith(prefix)) };
  }
  async getManifest(): Promise<unknown | null> {
    return null;
  }
  async putManifest(): Promise<void> {}
}

test('worker sync_upstream：配置了远端则最小推送 jobs/<id>.bin 并 done', async () => {
  registerDefaultHandlers();
  await withStore(async (store) => {
    const remote = new FakeConfiguredRemote();
    const job = enqueue(store, {
      jobType: 'sync_upstream', scopeId: personalScope(store), entityId: 'm3', entityType: 'memory',
      payload: { content: 'synthetic-upstream' }, idempotencyKey: 'sync-ok-1',
    });
    const summary = await runOnce(store, { remote });
    assert.equal(summary.done, 1);
    assert.equal(summary.failures.length, 0);
    assert.equal(remote.puts.length, 1);
    assert.equal(remote.puts[0]!.key, `jobs/${job.id}.bin`);
    assert.equal(remote.puts[0]!.hash, job.payloadHash);
    assert.equal(store.outbox.requireById(job.id).status, 'done');
  });
});

// ---------------------------------------------------------------------------
// 4. extract / embed：无模型配置的诚实路径
// ---------------------------------------------------------------------------

test('worker extract/embed：无模型配置诚实 retry（不假装成功）', async () => {
  registerDefaultHandlers();
  await withStore(async (store) => {
    const scopeId = personalScope(store);
    const ex = enqueue(store, { jobType: 'extract', scopeId, entityId: 'm4', idempotencyKey: 'ex-1' });
    const em = enqueue(store, { jobType: 'embed', scopeId, entityId: 'm5', idempotencyKey: 'em-1' });
    const summary = await runOnce(store);
    assert.equal(summary.retry, 2);
    assert.equal(summary.failures.map((f) => f.error).every((e) => e === 'extract_requires_model_config'), true);
    assert.equal(store.outbox.requireById(ex.id).status, 'retry');
    assert.equal(store.outbox.requireById(em.id).status, 'retry');
  });
});

test('worker extract/embed：retry 到上限转 dead，终态不再变化', async () => {
  registerDefaultHandlers();
  await withStore(async (store) => {
    const scopeId = personalScope(store);
    const ex = enqueue(store, { jobType: 'extract', scopeId, entityId: 'm6', idempotencyKey: 'ex-2', maxAttempts: 2 });
    const em = enqueue(store, { jobType: 'embed', scopeId, entityId: 'm7', idempotencyKey: 'em-2', maxAttempts: 2 });
    await runOnce(store);
    const s2 = await runOnce(store, { now: futureNow() });
    assert.equal(s2.dead, 2);
    assert.equal(store.outbox.requireById(ex.id).status, 'dead');
    assert.equal(store.outbox.requireById(em.id).status, 'dead');
    // dead 终态：继续 runOnce 也不再领取
    const s3 = await runOnce(store, { now: futureNow() });
    assert.equal(s3.processed, 0);
  });
});

// ---------------------------------------------------------------------------
// 5. handler 异常的隔离
// ---------------------------------------------------------------------------

test('worker：handler 抛异常不逃出 runOnce，错误被截断且不含 payload 内容', async () => {
  registerDefaultHandlers();
  await withStore(async (store) => {
    const PAYLOAD_SECRET = 'TOPSECRET-BODY-should-never-reach-last_error';
    const job = enqueue(store, {
      jobType: 'maintain', scopeId: personalScope(store), entityId: 'sys',
      payload: { content: PAYLOAD_SECRET }, idempotencyKey: 'throw-1',
    });
    registerHandler('maintain', async () => {
      throw new Error('x'.repeat(300));
    });
    let summary!: RunOnceSummary; // runOnce 不抛出；finally 只做恢复
    try {
      summary = await runOnce(store);
    } finally {
      registerDefaultHandlers(); // 恢复默认，避免污染后续测试
    }
    assert.equal(summary.processed, 1);
    assert.equal(summary.retry, 1);
    assert.equal(summary.failures.length, 1);
    assert.equal(summary.failures[0]!.id, job.id);
    assert.ok(summary.failures[0]!.error.length <= 200, '错误文本必须被截断到 200 字符');
    const stored = store.outbox.requireById(job.id);
    assert.equal(stored.status, 'retry');
    assert.equal(stored.lastError!.length, 200);
    assert.ok(!stored.lastError!.includes(PAYLOAD_SECRET), 'last_error 不含 payload 内容');
    assert.ok(!JSON.stringify(summary).includes(PAYLOAD_SECRET), 'summary 不含 payload 内容');
  });
});

test('worker：CairnError 截断与非 Error 抛出物都被安全记录', async () => {
  registerDefaultHandlers();
  await withStore(async (store) => {
    const scopeId = personalScope(store);
    const j1 = enqueue(store, { jobType: 'maintain', scopeId, entityId: 'a', idempotencyKey: 'throw-cairn' });
    const j2 = enqueue(store, { jobType: 'maintain', scopeId, entityId: 'b', idempotencyKey: 'throw-plain' });
    registerHandler('maintain', (job) => {
      if (job.id === j1.id) throw err('E_FORBIDDEN', 'z'.repeat(250));
      throw 'plain-string-failure'; // 非 Error 抛出物
    });
    let summary!: RunOnceSummary;
    try {
      summary = await runOnce(store);
    } finally {
      registerDefaultHandlers();
    }
    assert.equal(summary.retry, 2);
    const e1 = summary.failures.find((f) => f.id === j1.id)!.error;
    const e2 = summary.failures.find((f) => f.id === j2.id)!.error;
    assert.equal(e1.length, 200, 'CairnError message 截断到 200');
    assert.ok(!e1.startsWith('E_FORBIDDEN'), '只记录 message，不拼接其他内容');
    assert.equal(e2, 'plain-string-failure');
  });
});

// ---------------------------------------------------------------------------
// 6. 超时
// ---------------------------------------------------------------------------

test('worker：handler 挂起超过 timeoutMs 时 runOnce 快速返回并标记 job_timeout', async () => {
  registerDefaultHandlers();
  await withStore(async (store) => {
    let capturedCtx: JobContext | null = null;
    let hangTimer: NodeJS.Timeout | undefined;
    registerHandler('maintain', (_job, ctx) => {
      capturedCtx = ctx; // 同步捕获：证明超时后 signal.aborted 已被置位
      return new Promise<void>((resolve) => {
        hangTimer = setTimeout(resolve, 5000); // 同步 handler 无法被杀死，只能靠协作式检查
      });
    });
    const job = enqueue(store, { jobType: 'maintain', scopeId: personalScope(store), entityId: 'sys', idempotencyKey: 'timeout-1' });
    let summary!: RunOnceSummary;
    let elapsed!: number;
    try {
      const t0 = Date.now();
      summary = await runOnce(store, { timeoutMs: 50 });
      elapsed = Date.now() - t0;
    } finally {
      if (hangTimer) clearTimeout(hangTimer);
      registerDefaultHandlers();
    }
    assert.ok(elapsed! < 3000, `runOnce 应在超时后快速返回而不是等满 handler（${elapsed!}ms）`);
    assert.equal(summary.processed, 1);
    assert.equal(summary.retry, 1);
    assert.equal(summary.failures[0]!.error, 'job_timeout');
    const stored = store.outbox.requireById(job.id);
    assert.equal(stored.status, 'retry');
    assert.equal(stored.lastError, 'job_timeout');
    assert.equal(capturedCtx!.signal.aborted, true, '超时后协作式停止信号已置位');
    assert.ok(capturedCtx!.deadlineAt <= Date.now());
  });
});

// ---------------------------------------------------------------------------
// 7. 崩溃恢复
// ---------------------------------------------------------------------------

test('worker：claim 后进程死亡的任务对 runOnce 不可见，复位后可续跑', async () => {
  registerDefaultHandlers();
  await withStore(async (store) => {
    const job = enqueue(store, { jobType: 'maintain', scopeId: personalScope(store), entityId: 'sys', idempotencyKey: 'crash-1' });
    const [claimed] = store.outbox.claimReady(1); // 模拟：领取后进程立即死亡，未 markDone
    assert.equal(claimed!.id, job.id);

    const s1 = await runOnce(store);
    assert.equal(s1.processed, 0, 'running 状态的任务不会被重复领取');

    const reset = store.outbox.resetRunningToPending();
    assert.equal(reset, 1);
    const s2 = await runOnce(store);
    assert.equal(s2.processed, 1);
    assert.equal(s2.done, 1);
    assert.equal(store.outbox.requireById(job.id).status, 'done');
  });
});

test('worker：claim 后死亡且 updated_at 变陈旧的任务由下一轮 maintain 复位续跑', async () => {
  registerDefaultHandlers();
  await withStore(async (store) => {
    const scopeId = personalScope(store);
    const stale = enqueue(store, { jobType: 'maintain', scopeId, entityId: 'a', idempotencyKey: 'crash-2' });
    store.outbox.claimReady(1);
    store.db.run('UPDATE outbox_job SET updated_at = ? WHERE id = ?', isoPlusMs(nowIso(), -16 * 60_000), stale.id);

    enqueue(store, { jobType: 'maintain', scopeId, entityId: 'b', idempotencyKey: 'crash-2-trigger' });
    const s1 = await runOnce(store); // 触发 maintain：把陈旧 running 复位为 pending
    assert.equal(s1.processed, 1);
    assert.equal(store.outbox.requireById(stale.id).status, 'pending');

    const s2 = await runOnce(store); // 下一轮：续跑被复位的任务
    assert.equal(s2.processed, 1);
    assert.equal(s2.done, 1);
    assert.equal(store.outbox.requireById(stale.id).status, 'done');
  });
});

// ---------------------------------------------------------------------------
// 8. local_only 上行排除（worker 层）
// ---------------------------------------------------------------------------

test('worker：local_only 作用域的 sync_upstream 从入队层被物理排除', async () => {
  registerDefaultHandlers();
  await withStore(async (store) => {
    const local = store.scopes.resolvePreset('device-local', { deviceId: store.identity.deviceId });
    const r = store.outbox.enqueue({
      jobType: 'sync_upstream', scopeId: local.id, entityType: 'memory', entityId: 'm-local',
      payload: { content: 'device-private' }, idempotencyKey: 'local-only-1',
    });
    assert.equal(r.enqueued, false);
    assert.equal(r.reason, 'scope_local_only');
    assert.equal(store.outbox.claimReady(10).length, 0, 'claimReady 永远看不到该任务');
    const summary = await runOnce(store);
    assert.equal(summary.processed, 0);
    assert.equal(store.outbox.counts().pending, 0);
    const audits = store.audit.recent(10).filter((a) => a.category === 'scope_exclusion');
    assert.equal(audits.length, 1, '排除事件留审计');
  });
});

// ---------------------------------------------------------------------------
// 9. runWorkerLoop
// ---------------------------------------------------------------------------

test('worker loop：maxCycles=2 跑两轮并返回处理总数', async () => {
  registerDefaultHandlers();
  await withStore(async (store) => {
    const scopeId = personalScope(store);
    enqueue(store, { jobType: 'extract', scopeId, entityId: 'm8', idempotencyKey: 'loop-1', maxAttempts: 1 });
    enqueue(store, { jobType: 'extract', scopeId, entityId: 'm9', idempotencyKey: 'loop-2', maxAttempts: 1 });
    const total = await runWorkerLoop(store, { intervalMs: 10, maxCycles: 2 });
    assert.equal(total, 2, '两轮共处理 2 个任务（第一轮全部领取）');
    assert.equal(store.outbox.counts().dead, 2);
    const empty = await runWorkerLoop(store, { intervalMs: 10, maxCycles: 2 });
    assert.equal(empty, 0, '无任务时循环空转返回 0');
  });
});

test('worker loop：启动前已停止则不处理任何任务', async () => {
  registerDefaultHandlers();
  await withStore(async (store) => {
    enqueue(store, { jobType: 'extract', scopeId: personalScope(store), entityId: 'm10', idempotencyKey: 'stop-pre' });
    const total = await runWorkerLoop(store, { intervalMs: 5, maxCycles: 100, stop: { stopped: true } });
    assert.equal(total, 0);
    assert.equal(store.outbox.counts().pending, 1, '任务保持 pending，未被领取');
  });
});

test('worker loop：运行中置 stop 可提前结束循环', async () => {
  registerDefaultHandlers();
  await withStore(async (store) => {
    const stop = { stopped: false };
    registerHandler('maintain', () => {
      stop.stopped = true; // 第一轮处理完后请求停止
    });
    let total!: number;
    try {
      enqueue(store, { jobType: 'maintain', scopeId: personalScope(store), entityId: 'sys', idempotencyKey: 'stop-mid' });
      total = await runWorkerLoop(store, { intervalMs: 5, maxCycles: 50, stop });
    } finally {
      registerDefaultHandlers();
    }
    assert.equal(total, 1, '停止后不再进入后续循环');
    assert.equal(store.outbox.counts().done, 1);
  });
});

// ---------------------------------------------------------------------------
// 10. 契约常数
// ---------------------------------------------------------------------------

test('worker：默认超时为 30 秒（会话关键路径的有界等待）', () => {
  assert.equal(DEFAULT_JOB_TIMEOUT_MS, 30_000);
});
