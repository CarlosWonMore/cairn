import type { CairnStore } from '../store/open.js';
import type { JobRow, JobType } from '../store/outbox.js';
import { err } from '../core/errors.js';
import { isoPlusMs, nowIso } from '../core/time.js';
import { getRemoteStore, type RemoteStore } from './remote.js';

/**
 * 后台 worker（design D9）：outbox 任务的唯一消费者入口。
 *
 * 隔离合同（agent-interfaces spec「后台任务退出会话关键路径」）：
 * - handler 异常、超时、不可用能力一律转化为 outbox 的有界重试/dead 状态，绝不逃出 runOnce；
 * - worker 只被显式调用（runOnce / runWorkerLoop），绝不自启，也不安装任何 hook；
 * - runOnce 自身只在外部契约错误（claimReady/markDone/markFailedRetry 的存储层故障，如
 *   E_DB_LOCKED）时抛出——那是环境不可用，不是某个任务的失败。
 *
 * 安全边界：记录到 last_error 的文本经过 sanitize（截断 200 字符），
 * worker 自己构造的错误绝不拼接 payload 或记忆正文。
 */

export const DEFAULT_JOB_TIMEOUT_MS = 30_000;
/** maintain 把 running 任务判定为"属主 worker 已死"的阈值。 */
export const RUNNING_STALE_MS = 15 * 60 * 1000;

export interface JobContext {
  store: CairnStore;
  remote: RemoteStore;
  /** 超时后由 worker 置 true 的协作式停止信号；handler 应周期性检查并尽快返回。 */
  signal: { get aborted(): boolean };
  /** 本任务 wall-clock 截止时刻（Date.now() 基准）。 */
  deadlineAt: number;
}

export type JobHandler = (job: JobRow, ctx: JobContext) => Promise<void> | void;

export interface RunOnceSummary {
  processed: number;
  done: number;
  retry: number;
  dead: number;
  failures: { id: string; error: string }[];
}

export interface RunOnceOptions {
  max?: number;
  remote?: RemoteStore;
  timeoutMs?: number;
  now?: string;
}

export interface RunWorkerLoopOptions {
  intervalMs: number;
  maxCycles?: number;
  remote?: RemoteStore;
  timeoutMs?: number;
  stop?: { stopped: boolean };
}

// ---------------------------------------------------------------------------
// handler 注册表：模块级，启动时为空——未注册类型诚实失败（no_handler_*），
// 而不是静默套用默认行为。默认 handler 通过 registerDefaultHandlers() 显式注册，
// 业务模块（如投影）可随时用 registerHandler 覆盖。
// ---------------------------------------------------------------------------

const registry = new Map<JobType, JobHandler>();

export function registerHandler(type: JobType, handler: JobHandler): void {
  registry.set(type, handler);
}

/** 注册内置默认 handler（幂等；用于测试后恢复或 worker 入口初始化）。 */
export function registerDefaultHandlers(): void {
  registry.set('maintain', defaultMaintainHandler);
  registry.set('sync_upstream', defaultSyncUpstreamHandler);
  registry.set('extract', modelRequiredHandler);
  registry.set('embed', modelRequiredHandler);
  registry.set('projection_rebuild', projectionNotRegisteredHandler);
}

// ---------------------------------------------------------------------------
// 默认 handler
// ---------------------------------------------------------------------------

/** maintain：过期计划清扫 + 崩溃遗留 running 复位（带 15 分钟新鲜度阈值，不误伤存活 worker）。 */
async function defaultMaintainHandler(_job: JobRow, ctx: JobContext): Promise<void> {
  ctx.store.plans.expireStale();
  const at = nowIso();
  const cutoff = isoPlusMs(at, -RUNNING_STALE_MS);
  // 语义化 resetRunningToPending：只复位 updated_at 早于阈值的 running 任务。
  // 本轮 claimReady 刚领取的任务 updated_at 是新鲜的，不会被误伤。
  ctx.store.db.run(
    "UPDATE outbox_job SET status = 'pending', updated_at = ? WHERE status = 'running' AND updated_at <= ?",
    at,
    cutoff,
  );
}

/** sync_upstream：未配置远端必须诚实失败；配置了远端也只做最小推送（MVP 无真实云端）。 */
async function defaultSyncUpstreamHandler(job: JobRow, ctx: JobContext): Promise<void> {
  if (!ctx.remote.configured) {
    throw err('E_FORBIDDEN', 'remote_not_configured');
  }
  // 最小实现：把任务载荷作为不可变对象推到 jobs/<job.id>.bin。
  // chunk 级同步协议（manifest、代次、加密）属于后续变更。
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      id: job.id,
      entity_type: job.entityType,
      entity_id: job.entityId,
      payload_hash: job.payloadHash,
      payload: job.payload,
    }),
  );
  await ctx.remote.putImmutable(`jobs/${job.id}.bin`, bytes, job.payloadHash);
}

/** extract/embed：本变更无本地模型、无云端模型授权——诚实进入 retry/dead，不假装完成。 */
async function modelRequiredHandler(_job: JobRow, _ctx: JobContext): Promise<void> {
  throw err('E_FORBIDDEN', 'extract_requires_model_config');
}

/** projection_rebuild：投影模块将来 registerHandler 覆盖本占位。 */
async function projectionNotRegisteredHandler(_job: JobRow, _ctx: JobContext): Promise<void> {
  throw err('E_FORBIDDEN', 'projection_rebuild_handler_not_registered');
}

// ---------------------------------------------------------------------------
// 执行
// ---------------------------------------------------------------------------

/** sanitize：只取 message 并截断 200 字符；绝不拼接 payload/正文。 */
function sanitizeError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  const s = raw.length > 200 ? raw.slice(0, 200) : raw;
  return s.length > 0 ? s : 'empty_error';
}

type JobOutcome = 'done' | 'retry' | 'dead';

/**
 * 执行单个已领取任务。返回终态与已 sanitize 的错误文本。
 * handler 的同步抛出、rejection、超时都被收敛为 markFailedRetry；
 * 只有 outbox 存储层自身故障才会向上抛（外部契约错误）。
 */
async function executeJob(
  store: CairnStore,
  job: JobRow,
  remote: RemoteStore,
  timeoutMs: number,
): Promise<{ outcome: JobOutcome; error: string }> {
  const abortFlag = { aborted: false };
  const ctx: JobContext = {
    store,
    remote,
    signal: abortFlag,
    deadlineAt: Date.now() + timeoutMs,
  };
  const handler = registry.get(job.jobType);
  // 包一层 then：handler 的同步 throw 也变成 rejection，绝不直接逃出。
  const work: Promise<void> = Promise.resolve().then(() => {
    if (!handler) throw err('E_FORBIDDEN', `no_handler_for_${job.jobType}`);
    return handler(job, ctx);
  });
  let timer: NodeJS.Timeout | undefined;
  const timeoutP = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      abortFlag.aborted = true; // 协作式停止信号；超时不能杀死仍在运行的 handler
      reject(new Error('job_timeout'));
    }, timeoutMs);
  });
  let failure: unknown;
  try {
    await Promise.race([work, timeoutP]);
  } catch (e) {
    failure = e;
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (failure === undefined) {
    store.outbox.markDone(job.id);
    return { outcome: 'done', error: '' };
  }
  const sanitized = sanitizeError(failure);
  const row = store.outbox.markFailedRetry(job.id, sanitized);
  return { outcome: row.status === 'dead' ? 'dead' : 'retry', error: sanitized };
}

/**
 * 领取并处理一批到期任务。handler 层的任何失败都留在 outbox 状态里；
 * 只有外部契约错误（如 E_DB_LOCKED）才会抛出。
 */
export async function runOnce(store: CairnStore, opts: RunOnceOptions = {}): Promise<RunOnceSummary> {
  const max = opts.max ?? 10;
  const now = opts.now ?? nowIso();
  const remote = opts.remote ?? getRemoteStore();
  const timeoutMs = Math.max(1, opts.timeoutMs ?? DEFAULT_JOB_TIMEOUT_MS);
  const summary: RunOnceSummary = { processed: 0, done: 0, retry: 0, dead: 0, failures: [] };
  const jobs = store.outbox.claimReady(max, now);
  for (const job of jobs) {
    summary.processed += 1;
    const { outcome, error } = await executeJob(store, job, remote, timeoutMs);
    summary[outcome] += 1;
    if (outcome !== 'done') {
      summary.failures.push({ id: job.id, error });
    }
  }
  return summary;
}

/**
 * 轮询 worker：显式调用才运行，绝不自启。返回累计处理的任务数。
 * stop.stopped 在每轮前后检查，供调用方从任意上下文请求停止。
 */
export async function runWorkerLoop(store: CairnStore, opts: RunWorkerLoopOptions): Promise<number> {
  const intervalMs = Math.max(0, opts.intervalMs);
  const maxCycles = opts.maxCycles ?? Number.POSITIVE_INFINITY;
  let total = 0;
  for (let cycle = 0; cycle < maxCycles; cycle += 1) {
    if (opts.stop?.stopped) break;
    const summary = await runOnce(store, { remote: opts.remote, timeoutMs: opts.timeoutMs });
    total += summary.processed;
    if (opts.stop?.stopped) break;
    if (cycle + 1 < maxCycles && intervalMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
    }
  }
  return total;
}
