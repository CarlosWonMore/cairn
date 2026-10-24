import { CairnDb } from './db.js';
import { err } from '../core/errors.js';
import { uuidv7 } from '../core/ids.js';
import { nowIso } from '../core/time.js';
import { sha256Canonical } from '../core/hash.js';
import { AuditLog } from './audit.js';
import { WriteGuardMixin } from './write-guard.js';

/**
 * 本地 outbox（任务 5.3）：后台任务的本地可靠边界。
 * job_type=sync_upstream 受作用域物理排除（触发器 + 应用层双重检查）；
 * 默认不安装同步 hook，任务由独立 worker 或显式 CLI 处理。
 */

export type JobType = 'sync_upstream' | 'extract' | 'embed' | 'maintain' | 'projection_rebuild';
export type JobStatus = 'pending' | 'running' | 'done' | 'retry' | 'failed' | 'dead' | 'conflict';

export interface JobRow {
  id: string;
  jobType: JobType;
  scopeId: string | null;
  entityType: 'memory' | 'revision' | 'plan' | 'archive' | 'system';
  entityId: string;
  payload: Record<string, unknown>;
  payloadHash: string;
  idempotencyKey: string;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EnqueueJobInput {
  jobType: JobType;
  scopeId: string | null;
  entityType: JobRow['entityType'];
  entityId: string;
  payload?: Record<string, unknown>;
  idempotencyKey: string;
  maxAttempts?: number;
}

/** 上行退避基数（毫秒）；本变更无真实云端，仅用于故障注入与可重试状态验证。 */
export const RETRY_BACKOFF_MS = [1_000, 5_000, 30_000, 5 * 60_000, 30 * 60_000] as const;

export class OutboxRepository extends WriteGuardMixin {
  constructor(
    private readonly db: CairnDb,
    private readonly audit: AuditLog,
  ) {
    super();
  }

  /**
   * 入队。local_only/设备限定内容对 sync_upstream 物理排除：
   * 返回 { enqueued: false, reason: 'scope_local_only' } 并记录审计。
   */
  enqueue(input: EnqueueJobInput): { job: JobRow | null; enqueued: boolean; reason?: string } {
    this.checkWritable();
    if (input.jobType === 'sync_upstream' && input.scopeId) {
      const scope = this.db.get('SELECT sync_policy, device_id FROM scope WHERE id = ?', input.scopeId);
      if (!scope) throw err('E_NOT_FOUND', `作用域不存在: ${input.scopeId}`);
      const upstreamable = scope.sync_policy === 'encrypted' && scope.device_id === 'all';
      if (!upstreamable) {
        this.audit.record('scope_exclusion', 'outbox_upstream_excluded', { type: 'scope', id: input.scopeId }, {
          jobId: input.idempotencyKey,
          reason: scope.sync_policy !== 'encrypted' ? 'local_only' : 'device_bound',
        });
        return { job: null, enqueued: false, reason: scope.sync_policy !== 'encrypted' ? 'scope_local_only' : 'scope_device_bound' };
      }
    }
    const payload = input.payload ?? {};
    const payloadHash = sha256Canonical(payload);
    const existing = this.db.get('SELECT * FROM outbox_job WHERE idempotency_key = ?', input.idempotencyKey);
    if (existing) return { job: mapJob(existing), enqueued: false, reason: 'duplicate' };
    const id = uuidv7();
    const at = nowIso();
    this.db.run(
      `INSERT INTO outbox_job (id, job_type, scope_id, entity_type, entity_id, payload, payload_hash,
         idempotency_key, status, attempts, max_attempts, next_attempt_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?, ?)`,
      id,
      input.jobType,
      input.scopeId,
      input.entityType,
      input.entityId,
      JSON.stringify(payload),
      payloadHash,
      input.idempotencyKey,
      input.maxAttempts ?? 5,
      at,
      at,
      at,
    );
    return { job: this.requireById(id), enqueued: true };
  }

  requireById(id: string): JobRow {
    const row = this.db.get('SELECT * FROM outbox_job WHERE id = ?', id);
    if (!row) throw err('E_NOT_FOUND', `任务不存在: ${id}`);
    return mapJob(row);
  }

  /** 领取到期任务：pending/retry 且 next_attempt_at <= now；置 running。 */
  claimReady(limit: number, now: string = nowIso()): JobRow[] {
    return this.db.transaction(() => {
      const rows = this.db.all(
        `SELECT * FROM outbox_job WHERE status IN ('pending','retry') AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
         ORDER BY next_attempt_at, created_at LIMIT ?`,
        now,
        limit,
      );
      for (const r of rows) {
        this.db.run("UPDATE outbox_job SET status = 'running', updated_at = ? WHERE id = ?", now, r.id);
      }
      return rows.map((r) => ({ ...mapJob(r), status: 'running' as JobStatus }));
    });
  }

  markDone(id: string): void {
    this.db.run("UPDATE outbox_job SET status = 'done', updated_at = ? WHERE id = ?", nowIso(), id);
  }

  /** 失败重试：超上限转 dead 并保留原因；绝不无限循环；终态任务不再变化。 */
  markFailedRetry(id: string, error: string, now: string = nowIso()): JobRow {
    const job = this.requireById(id);
    if (job.status === 'dead' || job.status === 'done') return job;
    const attempts = job.attempts + 1;
    if (attempts >= job.maxAttempts) {
      this.db.run(
        "UPDATE outbox_job SET status = 'dead', attempts = ?, last_error = ?, updated_at = ? WHERE id = ?",
        attempts,
        error,
        now,
        id,
      );
    } else {
      const backoff = RETRY_BACKOFF_MS[Math.min(attempts - 1, RETRY_BACKOFF_MS.length - 1)] ?? 60_000;
      this.db.run(
        "UPDATE outbox_job SET status = 'retry', attempts = ?, last_error = ?, next_attempt_at = ?, updated_at = ? WHERE id = ?",
        attempts,
        error,
        new Date(new Date(now).getTime() + backoff).toISOString(),
        now,
        id,
      );
    }
    return this.requireById(id);
  }

  resetRunningToPending(now: string = nowIso()): number {
    // worker 崩溃后遗留的 running 任务复位（幂等续跑）
    const r = this.db.run("UPDATE outbox_job SET status = 'pending', updated_at = ? WHERE status = 'running'", now);
    return Number(r.changes);
  }

  counts(): Record<JobStatus, number> {
    const out = Object.fromEntries(
      ['pending', 'running', 'done', 'retry', 'failed', 'dead', 'conflict'].map((s) => [s, 0]),
    ) as Record<JobStatus, number>;
    for (const r of this.db.all('SELECT status, COUNT(*) AS n FROM outbox_job GROUP BY status')) {
      out[r.status as JobStatus] = Number(r.n);
    }
    return out;
  }

  list(filter: { status?: JobStatus; jobType?: JobType; limit?: number } = {}): JobRow[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.status) {
      where.push('status = ?');
      params.push(filter.status);
    }
    if (filter.jobType) {
      where.push('job_type = ?');
      params.push(filter.jobType);
    }
    params.push(filter.limit ?? 100);
    return this.db
      .all(`SELECT * FROM outbox_job ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT ?`, ...params)
      .map(mapJob);
  }
}

function mapJob(r: Record<string, unknown>): JobRow {
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse((r.payload as string) ?? '{}') as Record<string, unknown>;
  } catch {
    payload = {};
  }
  return {
    id: r.id as string,
    jobType: r.job_type as JobType,
    scopeId: (r.scope_id as string | null) ?? null,
    entityType: r.entity_type as JobRow['entityType'],
    entityId: r.entity_id as string,
    payload,
    payloadHash: r.payload_hash as string,
    idempotencyKey: r.idempotency_key as string,
    status: r.status as JobStatus,
    attempts: Number(r.attempts),
    maxAttempts: Number(r.max_attempts),
    nextAttemptAt: (r.next_attempt_at as string | null) ?? null,
    lastError: (r.last_error as string | null) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}
