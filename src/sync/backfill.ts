import { CairnStore } from '../store/index.js';
import { PERSONAL_SPACE_KEY, PROJECT_CHAIN_PREFIX, preserveModeEnabled } from './vault.js';
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
 * 多链（add-cloud-preserve-mode + add-cross-device-project-sync）：
 * - 个人链缺口：personal-global 活动、无任何 sync_upstream 任务（既有口径不变）；
 * - 项目链缺口：project-global（且有项目身份）活动、**无本链推送证据**
 *   （`sync_pushed:project/<projectId>:<memoryId>`）、且无在途（pending/running/retry）
 *   上行任务。MUST NOT 用「无任何 sync_upstream 任务」：曾经是 personal-global 的
 *   记忆迁入项目后，库里留着一条当年**不可路由完成**的 sync_upstream（项目链还不存在，
 *   push 记 sync_job_unroutable 后 markDone），它从未发布到项目链，旧口径却把它当成
 *   「已上行」——2026-11-16 真机 27 条 project-global 全被漏成 0 候选。判据与
 *   findScopeExitGap 的 `sync_pushed:personal-global:<id>` 是同一套证据口径。
 * - 保管链缺口（仅保管模式开启）：设备限定/project-device 活动、无任何 sync_preserve 任务；
 *   另含缺项目身份的孤儿 project-global（route 侧降级到保管链，判据仍是 sync_preserve）。
 *   不看 sync_upstream：旧版本给 project-global 排过永远发不出去的 sync_upstream
 *   （静默完成时代），开启保管模式后这些内容应首次入保管链。
 * - 迁出通知缺口：曾推送到个人链、现已不在个人链、但从未有过任何 sync_scope_exit
 *   任务的活动记忆——本变更之前迁移到 project-global（可上行目的地）不产生迁出通知
 *   （2026-11 双设备事故的 27 条就在这个形状里），对端残缺副本靠补发的通知收敛。
 *
 * 三条链的缺口判据都必须排除「本机不是发布者」的副本（2026-11-16 真机对端 upstreamGap=27）：
 * `sync_pushed` 元数据只在 push.ts 写入，接收方永远没有它——不排除的话，**每一台接收设备**
 * 上拉下来的每条记忆都恒被判缺口，且自身永不消解（发布方本机看不出来）。
 * 依据是 `memory.origin_device_id`（本机创建 = 本机 deviceId；同步到达 = 事件来源设备）。
 * `NULL` 视为「可能由本机创建」（历史记忆），仍算缺口，避免把真缺口一刀切漏掉。
 */

export interface UpstreamGap {
  memoryId: string;
  scopeId: string;
  /** 缺口所属链：personal = 个人链；project = 项目链；preserve = 本设备保管链。 */
  chain: 'personal' | 'project' | 'preserve';
  /** 项目链缺口的项目身份（project-global 才有）。 */
  projectId?: string;
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
  /** 按链分列（tasks 4.2 / add-cross-device-project-sync 5.2）。关闭保管模式时 preserve 段全为 0。 */
  chains: { personal: ChainBackfillCounts; project: ChainBackfillCounts; preserve: ChainBackfillCounts };
  /** 存量迁出通知补发（add-cloud-preserve-mode：0.6.x 迁移不产生通知的历史缺口）。 */
  scopeExits: { candidates: number; enqueued: number; memoryIds: string[] };
}

export const BACKFILL_DEFAULT_LIMIT = 500;

export function findUpstreamGap(store: CairnStore): UpstreamGap[] {
  const ownDeviceId = store.identity.deviceId;
  const personal = store.db
    .all(
      `SELECT m.id AS memoryId, m.scope_id AS scopeId
       FROM memory m JOIN scope s ON s.id = m.scope_id
       WHERE m.status = 'active' AND s.sync_policy = 'encrypted' AND s.device_id = 'all' AND s.preset = 'personal-global'
         AND (m.origin_device_id IS NULL OR m.origin_device_id = ?)
         AND NOT EXISTS (SELECT 1 FROM outbox_job j
                         WHERE j.job_type = 'sync_upstream' AND j.entity_id = m.id)
       ORDER BY m.created_at, m.id`,
      ownDeviceId,
    )
    .map((r) => ({ memoryId: String(r.memoryId), scopeId: String(r.scopeId), chain: 'personal' as const }));
  const project = store.db
    .all(
      `SELECT m.id AS memoryId, m.scope_id AS scopeId, s.project_id AS projectId
       FROM memory m JOIN scope s ON s.id = m.scope_id
       WHERE m.status = 'active' AND s.preset = 'project-global' AND s.project_id IS NOT NULL
         AND s.sync_policy = 'encrypted' AND s.device_id = 'all'
         AND (m.origin_device_id IS NULL OR m.origin_device_id = ?)
         AND NOT EXISTS (SELECT 1 FROM meta
                         WHERE meta.key = ? || s.project_id || ':' || m.id)
         AND NOT EXISTS (SELECT 1 FROM outbox_job j
                         WHERE j.job_type = 'sync_upstream' AND j.entity_id = m.id
                           AND j.status IN ('pending','running','retry'))
       ORDER BY m.created_at, m.id`,
      ownDeviceId,
      'sync_pushed:' + PROJECT_CHAIN_PREFIX,
    )
    .map((r) => ({
      memoryId: String(r.memoryId),
      scopeId: String(r.scopeId),
      chain: 'project' as const,
      projectId: String(r.projectId),
    }));
  const upstream = [...personal, ...project];
  if (!preserveModeEnabled(store.paths.dataDir)) return upstream;
  // 保管链缺口：设备限定与 project-device，无任何 sync_preserve 任务。
  // 缺项目身份的孤儿 project-global 也在这里（route 侧把它降级到保管链）。
  const preserve = store.db
    .all(
      `SELECT m.id AS memoryId, m.scope_id AS scopeId
       FROM memory m JOIN scope s ON s.id = m.scope_id
       WHERE m.status = 'active'
         AND (s.preset IN ('device-local','project-device')
              OR (s.preset = 'project-global' AND s.project_id IS NULL))
         AND (m.origin_device_id IS NULL OR m.origin_device_id = ?)
         AND NOT EXISTS (SELECT 1 FROM outbox_job j
                         WHERE j.job_type = 'sync_preserve' AND j.entity_id = m.id)
       ORDER BY m.created_at, m.id`,
      ownDeviceId,
    )
    .map((r) => ({ memoryId: String(r.memoryId), scopeId: String(r.scopeId), chain: 'preserve' as const }));
  return [...upstream, ...preserve];
}

/**
 * 存量迁出通知缺口（add-cloud-preserve-mode）：曾推个人链、已离开、从未通知过。
 * 曾推 = sync_pushed 元数据存在；从未通知 = 无任何 sync_scope_exit 任务（不论状态——
 * 0.6.x 对 device-local 目标的迁出已正确产生过任务，不重发）。
 * 接收方副本没有 `sync_pushed:personal-global:<id>`（该元数据只由 push 写），因此
 * 不会被误判为「曾推」——本函数不需要 origin_device_id 条件。
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

/** 按链统计缺口（doctor / status 用；同一判定口径，不在可观测层另写 SQL）。
 * 项目链按 projectId 分列（一条项目一条链）。 */
export function findUpstreamGapChains(store: CairnStore): { personal: number; project: Record<string, number>; preserve: number } {
  const gaps = findUpstreamGap(store);
  const project: Record<string, number> = {};
  for (const g of gaps) {
    if (g.chain === 'project' && g.projectId) project[g.projectId] = (project[g.projectId] ?? 0) + 1;
  }
  return {
    personal: gaps.filter((g) => g.chain === 'personal').length,
    project,
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
      project: { candidates: 0, enqueued: 0, existing: 0, excluded: 0 },
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
        // 项目链任务必须用本链独立键：`memory:<id>` 往往已被当年个人链的任务永久占用
        // （唯一约束，done 之后仍占），复用同键会被幂等去重挡成 existing，项目链永远补不上。
        idempotencyKey: g.chain === 'project' ? `memory:${g.memoryId}:project:${g.projectId}` : `memory:${g.memoryId}`,
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
