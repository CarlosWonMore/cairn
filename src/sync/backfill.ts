import { CairnStore } from '../store/index.js';
import { PERSONAL_SPACE_KEY, preserveModeEnabled } from './vault.js';
import { enqueueMemorySync, enqueueScopeExit } from './route.js';

/**
 * 冷启动对账（spec cloud-sync「冷启动对账」/ design D3 + add-cloud-preserve-mode tasks 4）。
 *
 * 只写本地 outbox：本模块不 import 任何远端实现，也没有网络入口，
 * 因此 `backfill --apply` 不可能与云端交互。
 *
 * 缺口判定**不限制 job 状态**：只要历史上存在过任意一条对应链的上行任务
 * （pending / running / done / dead…），就认为这条记忆在**该链**的上行已经有人管过。
 * 只看 pending 会把已 markDone 的记忆算成缺口，每次 backfill 重报同一批。
 *
 * 多链（add-cloud-preserve-mode）：
 * - 个人链缺口：personal-global 活动、无任何 sync_upstream 任务（既有口径不变）；
 * - 保管链缺口（仅保管模式开启）：设备限定/项目内容活动、无任何 sync_preserve 任务。
 *   不看 sync_upstream：旧版本给 project-global 排过永远发不出去的 sync_upstream
 *   （静默完成时代），开启保管模式后这些内容应首次入保管链。
 * - 迁出通知缺口：曾推送到个人链、现已不在个人链、但从未有过任何 sync_scope_exit
 *   任务的活动记忆——本变更之前迁移到 project-global（可上行目的地）不产生迁出通知
 *   （2026-11 双设备事故的 27 条就在这个形状里），对端残缺副本靠补发的通知收敛。
 */

export interface UpstreamGap {
  memoryId: string;
  scopeId: string;
  /** 缺口所属链：personal = 个人链；preserve = 本设备保管链。 */
  chain: 'personal' | 'preserve';
}

export interface ScopeExitGap {
  memoryId: string;
  scopeId: string;
}

export interface ChainBackfillCounts {
  candidates: number;
  enqueued: number;
  existing: number;
  excluded: number;
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
  /** 按链分列（tasks 4.2）。关闭保管模式时 preserve 段全为 0。 */
  chains: { personal: ChainBackfillCounts; preserve: ChainBackfillCounts };
  /** 存量迁出通知补发（add-cloud-preserve-mode：0.6.x 迁移不产生通知的历史缺口）。 */
  scopeExits: { candidates: number; enqueued: number; memoryIds: string[] };
}

export const BACKFILL_DEFAULT_LIMIT = 500;

export function findUpstreamGap(store: CairnStore): UpstreamGap[] {
  const personal = store.db
    .all(
      `SELECT m.id AS memoryId, m.scope_id AS scopeId
       FROM memory m JOIN scope s ON s.id = m.scope_id
       WHERE m.status = 'active' AND s.sync_policy = 'encrypted' AND s.device_id = 'all' AND s.preset = 'personal-global'
         AND NOT EXISTS (SELECT 1 FROM outbox_job j
                         WHERE j.job_type = 'sync_upstream' AND j.entity_id = m.id)
       ORDER BY m.created_at, m.id`,
    )
    .map((r) => ({ memoryId: String(r.memoryId), scopeId: String(r.scopeId), chain: 'personal' as const }));
  if (!preserveModeEnabled(store.paths.dataDir)) return personal;
  // 保管链缺口：设备限定与项目内容，无任何 sync_preserve 任务
  const preserve = store.db
    .all(
      `SELECT m.id AS memoryId, m.scope_id AS scopeId
       FROM memory m JOIN scope s ON s.id = m.scope_id
       WHERE m.status = 'active' AND s.preset IN ('device-local','project-global','project-device')
         AND NOT EXISTS (SELECT 1 FROM outbox_job j
                         WHERE j.job_type = 'sync_preserve' AND j.entity_id = m.id)
       ORDER BY m.created_at, m.id`,
    )
    .map((r) => ({ memoryId: String(r.memoryId), scopeId: String(r.scopeId), chain: 'preserve' as const }));
  return [...personal, ...preserve];
}

/**
 * 存量迁出通知缺口（add-cloud-preserve-mode）：曾推个人链、已离开、从未通知过。
 * 曾推 = sync_pushed 元数据存在；从未通知 = 无任何 sync_scope_exit 任务（不论状态——
 * 0.6.x 对 device-local 目标的迁出已正确产生过任务，不重发）。
 */
export function findScopeExitGap(store: CairnStore): ScopeExitGap[] {
  return store.db
    .all(
      `SELECT m.id AS memoryId, m.scope_id AS scopeId
       FROM memory m JOIN scope s ON s.id = m.scope_id
       JOIN meta ON meta.key = '${'sync_pushed:' + PERSONAL_SPACE_KEY + ':'}' || m.id
       WHERE m.status = 'active' AND s.preset <> 'personal-global'
         AND NOT EXISTS (SELECT 1 FROM outbox_job j
                         WHERE j.job_type = 'sync_scope_exit' AND j.entity_id = m.id)
       ORDER BY m.created_at, m.id`,
    )
    .map((r) => ({ memoryId: String(r.memoryId), scopeId: String(r.scopeId) }));
}

/** 按链统计缺口（doctor / status 用；同一判定口径，不在可观测层另写 SQL）。 */
export function findUpstreamGapChains(store: CairnStore): { personal: number; preserve: number } {
  const gaps = findUpstreamGap(store);
  return {
    personal: gaps.filter((g) => g.chain === 'personal').length,
    preserve: gaps.filter((g) => g.chain === 'preserve').length,
  };
}

/**
 * `apply=false` 只统计不写（默认只读）。写入全部经 `enqueueMemorySync` /
 * `enqueueScopeExit`：路由与物理排除的判定只有 route.ts 一处（不在对账层另写一份）。
 */
export function backfillUpstream(store: CairnStore, opts: { apply: boolean; limit?: number }): BackfillReport {
  const gap = findUpstreamGap(store);
  const batch = gap.slice(0, opts.limit ?? BACKFILL_DEFAULT_LIMIT);
  const exitGaps = findScopeExitGap(store);
  const report: BackfillReport = {
    candidates: gap.length,
    enqueued: 0,
    existing: 0,
    excluded: 0,
    memoryIds: [],
    chains: {
      personal: { candidates: 0, enqueued: 0, existing: 0, excluded: 0 },
      preserve: { candidates: 0, enqueued: 0, existing: 0, excluded: 0 },
    },
    scopeExits: { candidates: exitGaps.length, enqueued: 0, memoryIds: [] },
  };
  for (const g of gap) report.chains[g.chain].candidates++;
  if (!opts.apply) {
    report.memoryIds = batch.map((g) => g.memoryId);
    return report;
  }
  store.db.transaction(() => {
    for (const g of batch) {
      const r = enqueueMemorySync(store, {
        memoryId: g.memoryId,
        scopeId: g.scopeId,
        op: 'memory_upsert',
        idempotencyKey: `memory:${g.memoryId}`,
      });
      if (r.enqueued) {
        report.enqueued++;
        report.memoryIds.push(g.memoryId);
        report.chains[g.chain].enqueued++;
      } else if (r.reason === 'duplicate') {
        report.existing++;
        report.chains[g.chain].existing++;
      } else {
        report.excluded++;
        report.chains[g.chain].excluded++;
      }
    }
    for (const g of exitGaps) {
      const r = enqueueScopeExit(store, g.memoryId);
      if (r.enqueued) {
        report.scopeExits.enqueued++;
        report.scopeExits.memoryIds.push(g.memoryId);
      }
    }
  });
  return report;
}
