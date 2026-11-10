import { CairnStore } from '../store/index.js';

/**
 * 冷启动对账（spec cloud-sync「冷启动对账」/ design D3）。
 *
 * 只写本地 outbox：本模块不 import 任何远端实现，也没有网络入口，
 * 因此 `backfill --apply` 不可能与云端交互。
 *
 * 缺口判定**不限制 job 状态**：只要历史上存在过任意一条 `sync_upstream`
 * （pending / running / done / dead…），就认为这条记忆的上行已经有人管过。
 * 只看 pending 会把已 markDone 的记忆算成缺口，每次 backfill 重报同一批。
 */

export interface UpstreamGap {
  memoryId: string;
  scopeId: string;
}

export interface BackfillReport {
  /** 库中缺口总数（未按 limit 截断）。 */
  candidates: number;
  enqueued: number;
  /** 入队时已存在同幂等键任务（并发下的正常竞态，不算缺口）。 */
  existing: number;
  /** 被作用域物理排除：SQL 已过滤，这里是 enqueue 防线的兜底计数。 */
  excluded: number;
  /** 本次实际（dry-run 时为将会）入队的记忆标识，按创建顺序。 */
  memoryIds: string[];
}

export const BACKFILL_DEFAULT_LIMIT = 500;

export function findUpstreamGap(store: CairnStore): UpstreamGap[] {
  return store.db
    .all(
      `SELECT m.id AS memoryId, m.scope_id AS scopeId
       FROM memory m JOIN scope s ON s.id = m.scope_id
       WHERE m.status = 'active' AND s.sync_policy = 'encrypted' AND s.device_id = 'all'
         AND NOT EXISTS (SELECT 1 FROM outbox_job j
                         WHERE j.job_type = 'sync_upstream' AND j.entity_id = m.id)
       ORDER BY m.created_at, m.id`,
    )
    .map((r) => ({ memoryId: String(r.memoryId), scopeId: String(r.scopeId) }));
}

/**
 * `apply=false` 只统计不写（默认只读）。写入全部经 `store.outbox.enqueue`：
 * 作用域物理排除与 `scope_exclusion` 审计仍由它执行，这里不新增第二处判定。
 */
export function backfillUpstream(store: CairnStore, opts: { apply: boolean; limit?: number }): BackfillReport {
  const gap = findUpstreamGap(store);
  const batch = gap.slice(0, opts.limit ?? BACKFILL_DEFAULT_LIMIT);
  const report: BackfillReport = { candidates: gap.length, enqueued: 0, existing: 0, excluded: 0, memoryIds: [] };
  if (!opts.apply) {
    report.memoryIds = batch.map((g) => g.memoryId);
    return report;
  }
  store.db.transaction(() => {
    for (const g of batch) {
      const r = store.outbox.enqueue({
        jobType: 'sync_upstream',
        scopeId: g.scopeId,
        entityType: 'memory',
        entityId: g.memoryId,
        payload: { op: 'memory_upsert', memoryId: g.memoryId },
        idempotencyKey: `memory:${g.memoryId}`,
      });
      if (r.enqueued) {
        report.enqueued++;
        report.memoryIds.push(g.memoryId);
      } else if (r.reason === 'duplicate') {
        report.existing++;
      } else {
        report.excluded++;
      }
    }
  });
  return report;
}
