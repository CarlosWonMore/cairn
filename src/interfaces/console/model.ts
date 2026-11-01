import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { err } from '../../core/errors.js';
import { CairnStore } from '../../store/open.js';
import { schemaVersion } from '../../store/migrate.js';
import { nowIso } from '../../core/time.js';
import { loadVaultConfig } from '../../sync/vault.js';
import { ContentView, contentView, sanitizeLabel } from './security.js';
import { promotedPredicate } from '../../onboarding/batches.js';

/**
 * 只读装配层（design D1/D9）。
 *
 * 设计约束：这里只发 SELECT。传进来的是只读 store 时，仓储的写守卫会把任何
 * 误写直接拒为 E_READONLY；这比"代码里小心一点"更可靠。
 *
 * 两个模式：
 * - `brief`：正文按 briefChars 裁切，用于列表与工作台首屏；
 * - `full`：正文完整，用于详情与静态导出。
 *
 * 掩码由调用方决定（`redact`）：工作台默认 true，静态导出默认 false。
 * 该默认值属于"传输面"策略，不属于装配层策略，所以放在参数里而不是写死。
 */

export type ViewMode = 'brief' | 'full';

export interface ModelOptions {
  mode?: ViewMode;
  /** true 时敏感记忆与 blocked 条目的正文一律不出装配层。 */
  redact?: boolean;
  /** brief 模式裁切字符数，默认 240。 */
  briefChars?: number;
  /** 只取这些作用域（空/未给表示全部）。 */
  scopeIds?: string[];
  /** 记忆状态过滤。 */
  statuses?: string[];
  /** 记忆 kind 过滤。 */
  kinds?: string[];
  /** 关键词过滤（记忆正文 + 快照条目正文，走有界 LIKE，不走 FTS 以免污染只读快照语义）。 */
  q?: string;
  /** 是否把 import_item 明细一并装配（导出需要；工作台首屏不需要）。 */
  includeItems?: boolean;
  /** 明细条数上限（undefined = 不限，仅供导出使用）。 */
  itemsLimit?: number;
}

export interface ScopeLayerView {
  id: string;
  preset: string;
  scopeKind: string;
  spaceId: string;
  spaceName: string | null;
  spaceKind: string | null;
  projectId: string | null;
  deviceId: string;
  agentId: string;
  syncPolicy: string;
  readPolicy: string;
  sensitivity: string;
  ttlDays: number | null;
  builtin: boolean;
  counts: { total: number; byStatus: Record<string, number> };
}

export interface MemoryView {
  id: string;
  kind: string;
  status: string;
  authority: string;
  confidence: number;
  sensitivity: string;
  scopeId: string;
  content: ContentView;
  contentHash: string;
  sourceAgent: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  revisionCount: number;
  evidenceCount: number;
  openConflicts: number;
  tombstoned: boolean;
}

export interface ArchiveView {
  id: string;
  batchId: string;
  sourceKind: string;
  /** 已折叠 ~ 的来源标识（不泄漏用户名）。 */
  sourceLabel: string | null;
  byteSize: number;
  parser: string;
  status: string;
  redactionState: string;
  discoveredAt: string;
  importedAt: string | null;
  items: { total: number; clean: number; blocked: number; promoted: number; skipped: number; remaining: number };
}

export interface BatchView {
  batchId: string;
  label: string | null;
  archiveCount: number;
  total: number;
  clean: number;
  blocked: number;
  promoted: number;
  remaining: number;
  lastImportedAt: string | null;
}

export interface ItemView {
  id: string;
  archiveId: string;
  batchId: string | null;
  itemIndex: number;
  scanState: string;
  scanFindings: string | null;
  sourceRef: string | null;
  content: ContentView;
  /** false 表示原文在导入阶段已被物理丢弃（blocked 条目），库里只有占位符。 */
  contentAvailable: boolean;
  contentHash: string;
  /** 已处理状态：已晋升 / 已跳过 / 仍待处理。跳过的条目可查但不计 remaining。 */
  handled: 'promoted' | 'skipped' | 'pending';
}

/** 一次自动整理的摘要（来自 `policy/auto_applied` 审计，任务 4.6）。 */
export interface AutoRunView {
  policyId: string;
  policyHashPrefix: string | null;
  at: string;
  applied: number;
  skipped: number;
  failed: number;
  planId: string | null;
  approvalId: string | null;
  /** 本次写入的记忆里还有几条没被遗忘。0 = 已被撤销（或全被遗忘）。 */
  liveMemories: number;
  /** 撤销事件的时间；null 表示没撤过。 */
  revokedAt: string | null;
  revokedCount: number | null;
}

/**
 * 导入工作台的一行：**一条来源的一次导入**（任务 4.1）。
 *
 * 刻意以 archive 为行单位而不是 batch 或来源：同一份笔记重复导入会产生多个
 * archive，它们各自有独立的条目计数——合成一行会把"这次又导进来 40 条"抹掉。
 * 折叠展示交给 groups（任务 4.4），那只是呈现层，不能反过来改数据结构。
 */
export interface ImportRowView {
  id: string;
  archiveId: string;
  batchId: string | null;
  sourceLabel: string | null;
  sourceKind: string;
  parser: string;
  status: string;
  redactionState: string;
  byteSize: number;
  discoveredAt: string;
  importedAt: string | null;
  /** 同一来源一共导入过几次（含本行）。 */
  importCount: number;
  /** 同一来源最近一次导入时间。 */
  lastImportedAt: string | null;
  /** 本行是不是该来源最近一次导入——UI 默认只展开它，其余收进 details。 */
  isLatestOfSource: boolean;
  items: { total: number; clean: number; blocked: number; promoted: number; skipped: number; remaining: number };
  /** 该 archive 所属批次的最近一次自动整理摘要；没跑过为 null。 */
  autoRun: AutoRunView | null;
}

/** 同一个来源的多次导入（任务 4.4 折叠用）。 */
export interface ImportGroupView {
  key: string;
  sourceLabel: string | null;
  importCount: number;
  lastImportedAt: string | null;
  /** 行 id，按导入时间倒序，[0] 是最新一次。 */
  rowIds: string[];
  items: { total: number; clean: number; blocked: number; promoted: number; skipped: number; remaining: number };
}

export interface ImportRowsView {
  rows: ImportRowView[];
  groups: ImportGroupView[];
}

export interface ApprovalView {
  id: string;
  planId: string;
  channel: string;
  approvedBy: string;
  approvedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  maxUses: number;
  uses: number;
  live: boolean;
}

export interface PlanView {
  id: string;
  status: string;
  planHash: string;
  planHashPrefix: string;
  scopeId: string;
  sourceArchiveIds: string[];
  itemCount: number;
  proposedBy: string;
  createdAt: string;
  expiresAt: string;
  appliedAt: string | null;
  ops: { total: number; add: number; merge: number; keepBoth: number; skip: number; pending: number; applied: number };
  approvals: ApprovalView[];
}

export interface OutboxView {
  byStatus: Record<string, number>;
  pending: { id: string; jobType: string; entityType: string; entityId: string; status: string; attempts: number; nextAttemptAt: string | null }[];
}

export interface SyncView {
  configured: boolean;
  provider: string | null;
  vaultId: string | null;
  keysPresent: boolean;
  lastOkAt: string | null;
  /** 缺什么导致不能同步（供 UI 直接展示原因，而不是只把按钮变灰）。 */
  blockers: string[];
}

export interface ConsoleCounts {
  memoriesByStatus: Record<string, number>;
  memoriesTotal: number;
  archives: number;
  items: { total: number; clean: number; blocked: number; promoted: number; skipped: number; remaining: number };
  batches: number;
  plansByStatus: Record<string, number>;
  approvalsLive: number;
  outboxByStatus: Record<string, number>;
  openConflicts: number;
  scopeLayers: number;
}

export interface ConsoleModel {
  generatedAt: string;
  home: string;
  schemaVersion: number;
  mode: ViewMode;
  redacted: boolean;
  filter: { q: string | null; scopeIds: string[]; statuses: string[]; kinds: string[] };
  counts: ConsoleCounts;
  scopes: ScopeLayerView[];
  memories: MemoryView[];
  archives: ArchiveView[];
  batches: BatchView[];
  plans: PlanView[];
  approvals: ApprovalView[];
  outbox: OutboxView;
  sync: SyncView;
  /** 导入工作台的单表数据（任务 4.1）：一条来源一次导入一行。 */
  imports: ImportRowsView;
  /** 仅在 includeItems 时存在。 */
  items?: ItemView[];
  /** 装配期发现的可读性告警（不影响数据）。 */
  notes: string[];
}

const PROMOTED_SQL = promotedPredicate('%ALIAS%').exists;
const NOT_PROMOTED_SQL = promotedPredicate('%ALIAS%').notExists;
/** 已跳过（判定不采用）。与 promoted 分开统计，但同样退出待处理。 */
const SKIPPED_SQL = promotedPredicate('%ALIAS%').skippedExists;
/** 已处理完毕 = 已晋升 OR 已跳过。「还要不要处理」用它，不用 NOT_PROMOTED。 */
const HANDLED_SQL = promotedPredicate('%ALIAS%').handledExists;
const NOT_HANDLED_SQL = promotedPredicate('%ALIAS%').handledNotExists;

export function buildModel(store: CairnStore, opts: ModelOptions = {}): ConsoleModel {
  const mode: ViewMode = opts.mode ?? 'brief';
  const redact = opts.redact ?? true;
  const briefChars = opts.briefChars ?? 240;
  const notes: string[] = [];
  const q = (opts.q ?? '').trim();
  const scopeIds = opts.scopeIds ?? [];
  const statuses = opts.statuses ?? [];
  const kinds = opts.kinds ?? [];

  const scopes = loadScopes(store);
  const archives = loadArchives(store);
  const batches = loadBatches(store);
  const memories = loadMemories(store, {
    mode,
    redact,
    briefChars,
    q,
    scopeIds,
    statuses,
    kinds,
  });
  const plans = loadPlans(store);
  const approvals = plans.flatMap((p) => p.approvals);
  const outbox = loadOutbox(store);
  const sync = loadSync(store);
  const imports = buildImportRows(store);
  const itemAgg = aggregateItems(store);
  const memoriesByStatus: Record<string, number> = {};
  for (const m of memories) memoriesByStatus[m.status] = (memoriesByStatus[m.status] ?? 0) + 1;

  if (scopes.length === 0) notes.push('库中没有任何作用域层；记忆视图将全部为空');
  if (memories.length === 0) notes.push('没有匹配的记忆（过滤条件可能过窄）');

  const model: ConsoleModel = {
    generatedAt: nowIso(),
    home: sanitizeLabel(store.paths.home) ?? store.paths.home,
    schemaVersion: schemaVersion(store.db),
    mode,
    redacted: redact,
    filter: { q: q.length > 0 ? q : null, scopeIds, statuses, kinds },
    counts: {
      memoriesByStatus,
      memoriesTotal: memories.length,
      archives: archives.length,
      items: {
        total: itemAgg.total,
        clean: itemAgg.clean,
        blocked: itemAgg.blocked,
        promoted: itemAgg.promoted,
        skipped: itemAgg.skipped,
        remaining: itemAgg.remaining,
      },
      batches: batches.length,
      plansByStatus: countBy(store, 'SELECT status AS k, COUNT(*) AS n FROM onboarding_plan GROUP BY status'),
      approvalsLive: Number(
        store.db.scalar('SELECT COUNT(*) AS n FROM approval WHERE revoked_at IS NULL AND uses < max_uses AND expires_at > ?', nowIso()) ?? 0,
      ),
      outboxByStatus: outbox.byStatus,
      openConflicts: Number(store.db.scalar("SELECT COUNT(*) AS n FROM conflict WHERE status = 'open'") ?? 0),
      scopeLayers: scopes.length,
    },
    scopes,
    memories,
    archives,
    batches,
    plans,
    approvals,
    outbox,
    sync,
    imports,
    notes,
  };

  if (opts.includeItems === true) {
    model.items = loadItems(store, { mode, redact, briefChars, q, limit: opts.itemsLimit, scopeIds: [] });
  }
  return model;
}

// ---------------------------------------------------------------------------
// 各段装配
// ---------------------------------------------------------------------------

function loadScopes(store: CairnStore): ScopeLayerView[] {
  const rows = store.db.all(
    `SELECT s.*, sp.name AS space_name, sp.space_kind AS space_kind
       FROM scope s LEFT JOIN space sp ON sp.id = s.space_id
      ORDER BY s.builtin DESC, s.preset, s.created_at`,
  );
  const counts = new Map<string, { total: number; byStatus: Record<string, number> }>();
  for (const r of store.db.all(
    "SELECT scope_id AS sid, status AS st, COUNT(*) AS n FROM memory WHERE status <> 'superseded' GROUP BY scope_id, status",
  )) {
    const sid = String(r['sid']);
    const entry = counts.get(sid) ?? { total: 0, byStatus: {} };
    const n = Number(r['n']);
    entry.total += n;
    entry.byStatus[String(r['st'])] = (entry.byStatus[String(r['st'])] ?? 0) + n;
    counts.set(sid, entry);
  }
  return rows.map((r) => {
    const id = String(r['id']);
    const c = counts.get(id) ?? { total: 0, byStatus: {} };
    return {
      id,
      preset: String(r['preset']),
      scopeKind: String(r['scope_kind']),
      spaceId: String(r['space_id']),
      spaceName: (r['space_name'] as string | null) ?? null,
      spaceKind: (r['space_kind'] as string | null) ?? null,
      projectId: (r['project_id'] as string | null) ?? null,
      deviceId: String(r['device_id']),
      agentId: String(r['agent_id']),
      syncPolicy: String(r['sync_policy']),
      readPolicy: String(r['read_policy']),
      sensitivity: String(r['sensitivity']),
      ttlDays: r['ttl_days'] == null ? null : Number(r['ttl_days']),
      builtin: Number(r['builtin']) === 1,
      counts: c,
    };
  });
}

function loadMemories(
  store: CairnStore,
  o: { mode: ViewMode; redact: boolean; briefChars: number; q: string; scopeIds: string[]; statuses: string[]; kinds: string[] },
): MemoryView[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (o.scopeIds.length > 0) {
    where.push(`m.scope_id IN (${o.scopeIds.map(() => '?').join(',')})`);
    params.push(...o.scopeIds);
  }
  if (o.statuses.length > 0) {
    where.push(`m.status IN (${o.statuses.map(() => '?').join(',')})`);
    params.push(...o.statuses);
  }
  if (o.kinds.length > 0) {
    where.push(`m.kind IN (${o.kinds.map(() => '?').join(',')})`);
    params.push(...o.kinds);
  }
  if (o.q.length > 0) {
    where.push('m.content LIKE ?');
    params.push(`%${escapeLike(o.q)}%`);
  }
  const sql = `SELECT m.*,
      (SELECT COUNT(*) FROM memory_revision r WHERE r.memory_id = m.id) AS revision_count,
      (SELECT COUNT(*) FROM evidence e WHERE e.memory_id = m.id) AS evidence_count,
      (SELECT COUNT(*) FROM conflict c WHERE c.memory_id = m.id AND c.status = 'open') AS open_conflicts,
      (SELECT COUNT(*) FROM tombstone t WHERE t.memory_id = m.id) AS tombstone_count
    FROM memory m
    ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY m.updated_at DESC, m.id`;
  return store.db.all(sql, ...params).map((r) => {
    const text = String(r['content']);
    const masked = o.redact && (String(r['sensitivity']) === 'sensitive' || String(r['status']) === 'tombstoned');
    return {
      id: String(r['id']),
      kind: String(r['kind']),
      status: String(r['status']),
      authority: String(r['authority']),
      confidence: Number(r['confidence']),
      sensitivity: String(r['sensitivity']),
      scopeId: String(r['scope_id']),
      content: contentView(text, {
        masked,
        maxChars: o.mode === 'brief' ? o.briefChars : 0,
        hash: String(r['content_hash']),
      }),
      contentHash: String(r['content_hash']),
      sourceAgent: (r['source_agent'] as string | null) ?? null,
      createdBy: String(r['created_by']),
      createdAt: String(r['created_at']),
      updatedAt: String(r['updated_at']),
      expiresAt: (r['expires_at'] as string | null) ?? null,
      revisionCount: Number(r['revision_count']),
      evidenceCount: Number(r['evidence_count']),
      openConflicts: Number(r['open_conflicts']),
      tombstoned: Number(r['tombstone_count']) > 0 || String(r['status']) === 'tombstoned',
    };
  });
}

function loadArchives(store: CairnStore): ArchiveView[] {
  const rows = store.db.all(
    `SELECT a.*,
       (SELECT COUNT(*) FROM import_item i WHERE i.archive_id = a.id) AS n_total,
       (SELECT COUNT(*) FROM import_item i WHERE i.archive_id = a.id AND i.scan_state = 'clean') AS n_clean,
       (SELECT COUNT(*) FROM import_item i WHERE i.archive_id = a.id AND i.scan_state = 'blocked') AS n_blocked,
       (SELECT COUNT(*) FROM import_item i WHERE i.archive_id = a.id AND ${PROMOTED_SQL.replaceAll('%ALIAS%', 'i')}) AS n_promoted,
       (SELECT COUNT(*) FROM import_item i WHERE i.archive_id = a.id AND ${SKIPPED_SQL.replaceAll('%ALIAS%', 'i')}) AS n_skipped,
       (SELECT COUNT(*) FROM import_item i WHERE i.archive_id = a.id AND i.scan_state = 'clean' AND ${NOT_HANDLED_SQL.replaceAll('%ALIAS%', 'i')}) AS n_remaining
     FROM import_archive a
     ORDER BY a.imported_at DESC, a.id`,
  );
  return rows.map((r) => ({
    id: String(r['id']),
    batchId: String(r['batch_id']),
    sourceKind: String(r['source_kind']),
    sourceLabel: sanitizeLabel((r['source_label'] as string | null) ?? null),
    byteSize: Number(r['byte_size']),
    parser: String(r['parser']),
    status: String(r['status']),
    redactionState: String(r['redaction_state']),
    discoveredAt: String(r['discovered_at']),
    importedAt: (r['imported_at'] as string | null) ?? null,
    items: {
      total: Number(r['n_total']),
      clean: Number(r['n_clean']),
      blocked: Number(r['n_blocked']),
      promoted: Number(r['n_promoted']),
      skipped: Number(r['n_skipped']),
      remaining: Number(r['n_remaining']),
    },
  }));
}

function loadBatches(store: CairnStore): BatchView[] {
  const rows = store.db.all(
    `SELECT i.batch_id AS batch_id,
       COUNT(*) AS total,
       SUM(CASE WHEN i.scan_state = 'clean' THEN 1 ELSE 0 END) AS clean,
       SUM(CASE WHEN i.scan_state = 'blocked' THEN 1 ELSE 0 END) AS blocked,
       SUM(CASE WHEN ${PROMOTED_SQL.replaceAll('%ALIAS%', 'i')} THEN 1 ELSE 0 END) AS promoted,
       SUM(CASE WHEN ${SKIPPED_SQL.replaceAll('%ALIAS%', 'i')} THEN 1 ELSE 0 END) AS skipped,
       SUM(CASE WHEN i.scan_state = 'clean' AND ${NOT_HANDLED_SQL.replaceAll('%ALIAS%', 'i')} THEN 1 ELSE 0 END) AS remaining,
       MIN(i.created_at) AS first_at,
       MAX(i.created_at) AS last_at
     FROM import_item i
     WHERE i.batch_id IS NOT NULL
     GROUP BY i.batch_id
     ORDER BY remaining DESC, last_at DESC`,
  );
  return rows.map((r) => {
    const batchId = String(r['batch_id']);
    const labels = store.db.all(
      'SELECT source_label FROM import_archive WHERE batch_id = ? ORDER BY imported_at DESC, id LIMIT 2',
      batchId,
    );
    const label = labels.length > 0 ? sanitizeLabel((labels[0]!['source_label'] as string | null) ?? null) : null;
    const archiveCount = Number(store.db.scalar('SELECT COUNT(*) AS n FROM import_archive WHERE batch_id = ?', batchId) ?? 0);
    return {
      batchId,
      label,
      archiveCount,
      total: Number(r['total']),
      clean: Number(r['clean'] ?? 0),
      blocked: Number(r['blocked'] ?? 0),
      promoted: Number(r['promoted'] ?? 0),
      skipped: Number(r['skipped'] ?? 0),
      remaining: Number(r['remaining'] ?? 0),
      lastImportedAt: (r['last_at'] as string | null) ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// 导入工作台单表（任务 4.1/4.4/4.6）
// ---------------------------------------------------------------------------

/**
 * 把 archive（一次导入一条记录）、batch（一批条目）与自动整理审计合成一张表。
 *
 * 为什么要服务端算：`importCount` / `lastImportedAt` / `isLatestOfSource` 都是
 * 跨行聚合，前端自己算就得把全部行都拉一遍再排序，且"哪次是最新"的判定会跟
 * 后端各写一份。这里算完，前端只负责画。
 */
export function buildImportRows(store: CairnStore): ImportRowsView {
  const rows = store.db.all(
    `SELECT a.id AS id, a.batch_id AS batch_id, a.source_kind AS source_kind,
            a.source_label AS source_label, a.byte_size AS byte_size, a.parser AS parser,
            a.status AS status, a.redaction_state AS redaction_state,
            a.discovered_at AS discovered_at, a.imported_at AS imported_at,
            (SELECT COUNT(*) FROM import_item i WHERE i.archive_id = a.id) AS n_total,
            (SELECT COUNT(*) FROM import_item i WHERE i.archive_id = a.id AND i.scan_state = 'clean') AS n_clean,
            (SELECT COUNT(*) FROM import_item i WHERE i.archive_id = a.id AND i.scan_state = 'blocked') AS n_blocked,
            (SELECT COUNT(*) FROM import_item i WHERE i.archive_id = a.id AND ${PROMOTED_SQL.replaceAll('%ALIAS%', 'i')}) AS n_promoted,
            (SELECT COUNT(*) FROM import_item i WHERE i.archive_id = a.id AND ${SKIPPED_SQL.replaceAll('%ALIAS%', 'i')}) AS n_skipped,
            (SELECT COUNT(*) FROM import_item i WHERE i.archive_id = a.id AND i.scan_state = 'clean' AND ${NOT_HANDLED_SQL.replaceAll('%ALIAS%', 'i')}) AS n_remaining
       FROM import_archive a
      ORDER BY a.imported_at DESC, a.id DESC`,
  );

  const autoRuns = loadAutoRuns(store);

  const out: ImportRowView[] = rows.map((r) => {
    const batchId = (r['batch_id'] as string | null) ?? null;
    return {
      id: String(r['id']),
      archiveId: String(r['id']),
      batchId,
      sourceLabel: sanitizeLabel((r['source_label'] as string | null) ?? null),
      sourceKind: String(r['source_kind']),
      parser: String(r['parser']),
      status: String(r['status']),
      redactionState: String(r['redaction_state']),
      byteSize: Number(r['byte_size']),
      discoveredAt: String(r['discovered_at']),
      importedAt: (r['imported_at'] as string | null) ?? null,
      importCount: 0, // 下面按来源补齐
      lastImportedAt: null,
      isLatestOfSource: false,
      items: {
        total: Number(r['n_total']),
        clean: Number(r['n_clean']),
        blocked: Number(r['n_blocked']),
        promoted: Number(r['n_promoted']),
        skipped: Number(r['n_skipped']),
      remaining: Number(r['n_remaining']),
      },
      autoRun: batchId != null ? (autoRuns.get(batchId) ?? null) : null,
    };
  });

  // 按来源聚合。rows 已按 importedAt 倒序，所以每组第一条就是最新一次。
  const groups: ImportGroupView[] = [];
  const byKey = new Map<string, ImportGroupView>();
  for (const row of out) {
    // 来源标识可能为空（早期数据），退化用 sourceKind 归组，保证每行都进得了组。
    const key = row.sourceLabel != null ? `label:${row.sourceLabel}` : `kind:${row.sourceKind}`;
    let g = byKey.get(key);
    if (g == null) {
      g = {
        key,
        sourceLabel: row.sourceLabel,
        importCount: 0,
        lastImportedAt: row.importedAt,
        rowIds: [],
        items: { total: 0, clean: 0, blocked: 0, promoted: 0, skipped: 0, remaining: 0 },
      };
      byKey.set(key, g);
      groups.push(g);
    }
    g.rowIds.push(row.id);
    g.items.total += row.items.total;
    g.items.clean += row.items.clean;
    g.items.blocked += row.items.blocked;
    g.items.promoted += row.items.promoted;
    g.items.remaining += row.items.remaining;
  }
  for (const g of groups) {
    g.importCount = g.rowIds.length;
    for (let i = 0; i < g.rowIds.length; i++) {
      const row = out.find((x) => x.id === g.rowIds[i])!;
      row.importCount = g.importCount;
      row.lastImportedAt = g.lastImportedAt;
      row.isLatestOfSource = i === 0;
    }
  }

  return { rows: out, groups };
}

/**
 * 每个批次最近一次自动整理的结果（任务 4.6）。从审计读，不新增表：
 * 撤销是另一条 `policy/revoked` 事件，按 (policyId, batchId) 匹配。
 */
function loadAutoRuns(store: CairnStore): Map<string, AutoRunView> {
  const latest = new Map<string, AutoRunView>();
  const applied = store.db.all(
    "SELECT detail, at FROM audit_event WHERE category = 'policy' AND action = 'auto_applied' ORDER BY at",
  );
  for (const row of applied) {
    const d = parseDetail(row['detail']);
    const batchId = typeof d['batchId'] === 'string' ? d['batchId'] : null;
    if (batchId == null) continue;
    const memoryIds = Array.isArray(d['memoryIds']) ? d['memoryIds'].filter((x): x is string => typeof x === 'string') : [];
    latest.set(batchId, {
      policyId: typeof d['policyId'] === 'string' ? d['policyId'] : '',
      policyHashPrefix: typeof d['policyHashPrefix'] === 'string' ? d['policyHashPrefix'] : null,
      at: String(row['at']),
      applied: Number(d['applied'] ?? 0),
      skipped: Number(d['skipped'] ?? 0),
      failed: Number(d['failed'] ?? 0),
      planId: typeof d['planId'] === 'string' ? d['planId'] : null,
      approvalId: typeof d['approvalId'] === 'string' ? d['approvalId'] : null,
      liveMemories: countLiveMemories(store, memoryIds),
      revokedAt: null,
      revokedCount: null,
    });
  }

  const revoked = store.db.all(
    "SELECT detail, at FROM audit_event WHERE category = 'policy' AND action = 'revoked' ORDER BY at",
  );
  for (const row of revoked) {
    const d = parseDetail(row['detail']);
    const policyId = typeof d['policyId'] === 'string' ? d['policyId'] : null;
    if (policyId == null) continue;
    // 整策略撤销没有 batchId，靠 batchIds 回填；否则界面看不出"撤过"。
    const touched: string[] = [];
    if (typeof d['batchId'] === 'string') touched.push(d['batchId']);
    if (Array.isArray(d['batchIds'])) {
      for (const b of d['batchIds']) if (typeof b === 'string' && touched.indexOf(b) < 0) touched.push(b);
    }
    for (const batchId of touched) {
      const hit = latest.get(batchId);
      if (hit == null || hit.policyId !== policyId) continue;
      hit.revokedAt = String(row['at']);
      hit.revokedCount = Number(d['tombstoned'] ?? 0);
    }
  }
  return latest;
}

function countLiveMemories(store: CairnStore, ids: string[]): number {
  let n = 0;
  for (const id of ids) {
    const row = store.db.get('SELECT status FROM memory WHERE id = ?', id);
    if (row != null && String(row['status']) !== 'tombstoned') n += 1;
  }
  return n;
}

function parseDetail(raw: unknown): Record<string, unknown> {
  try {
    const v = JSON.parse(String(raw));
    return v != null && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function loadItems(
  store: CairnStore,
  o: { mode: ViewMode; redact: boolean; briefChars: number; q: string; limit?: number; scopeIds: string[] },
): ItemView[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (o.q.length > 0) {
    where.push('i.content LIKE ?');
    params.push(`%${escapeLike(o.q)}%`);
  }
  const limitSql = o.limit != null && o.limit > 0 ? 'LIMIT ?' : '';
  if (limitSql) params.push(o.limit);
  const sql = `SELECT i.*,
      (${PROMOTED_SQL.replaceAll('%ALIAS%', 'i')}) AS is_promoted,
      (${SKIPPED_SQL.replaceAll('%ALIAS%', 'i')}) AS is_skipped
    FROM import_item i
    ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY i.archive_id, i.item_index ${limitSql}`;
  return store.db.all(sql, ...params).map((r) => {
    const text = String(r['content']);
    const scanState = String(r['scan_state']);
    return {
      id: String(r['id']),
      archiveId: String(r['archive_id']),
      batchId: (r['batch_id'] as string | null) ?? null,
      itemIndex: Number(r['item_index']),
      scanState,
      scanFindings: (r['scan_findings'] as string | null) ?? null,
      sourceRef: sanitizeLabel((r['source_ref'] as string | null) ?? null),
      content: contentView(text, {
        maxChars: o.mode === 'brief' ? o.briefChars : 0,
        hash: String(r['content_hash']),
      }),
      // blocked 条目在导入时就被替换成 [blocked:kind] 占位符（import.ts:blockedPlaceholder），
      // 原文从未入库。所以这里不是"要不要给"的问题，而是"库里没有"。
      contentAvailable: scanState !== 'blocked',
      contentHash: String(r['content_hash']),
      handled: Number(r['is_promoted']) === 1 ? 'promoted' : Number(r['is_skipped']) === 1 ? 'skipped' : 'pending',
    };
  });
}

/** 对外暴露：单档案条目（工作台按需展开，不一次性把 533 条正文推给浏览器）。 */
export function listArchiveItems(
  store: CairnStore,
  archiveId: string,
  opts: { mode?: ViewMode; redact?: boolean; briefChars?: number; scanState?: 'clean' | 'blocked' | 'pending'; offset?: number; limit?: number } = {},
): { total: number; offset: number; limit: number; items: ItemView[] } {
  const mode = opts.mode ?? 'brief';
  const redact = opts.redact ?? true;
  const briefChars = opts.briefChars ?? 240;
  const offset = Math.max(0, opts.offset ?? 0);
  const limit = Math.min(500, Math.max(1, opts.limit ?? 100));
  const where = ['i.archive_id = ?'];
  const params: unknown[] = [archiveId];
  if (opts.scanState) {
    where.push('i.scan_state = ?');
    params.push(opts.scanState);
  }
  const total = Number(store.db.scalar(`SELECT COUNT(*) AS n FROM import_item i WHERE ${where.join(' AND ')}`, ...params) ?? 0);
  const rows = store.db.all(
    `SELECT i.*,
            (${PROMOTED_SQL.replaceAll('%ALIAS%', 'i')}) AS is_promoted,
            (${SKIPPED_SQL.replaceAll('%ALIAS%', 'i')}) AS is_skipped
       FROM import_item i WHERE ${where.join(' AND ')} ORDER BY i.item_index LIMIT ? OFFSET ?`,
    ...params,
    limit,
    offset,
  );
  return {
    total,
    offset,
    limit,
    items: rows.map((r) => {
      const text = String(r['content']);
      const scanState = String(r['scan_state']);
      return {
        id: String(r['id']),
        archiveId: String(r['archive_id']),
        batchId: (r['batch_id'] as string | null) ?? null,
        itemIndex: Number(r['item_index']),
        scanState,
        scanFindings: (r['scan_findings'] as string | null) ?? null,
        sourceRef: sanitizeLabel((r['source_ref'] as string | null) ?? null),
        content: contentView(text, {
          maxChars: mode === 'brief' ? briefChars : 0,
          hash: String(r['content_hash']),
        }),
        contentAvailable: scanState !== 'blocked',
        contentHash: String(r['content_hash']),
        // 已处理状态：抽屉里要能看出这条是被晋升了还是被判跳过了。
        handled: Number(r['is_promoted']) === 1 ? 'promoted' : Number(r['is_skipped']) === 1 ? 'skipped' : 'pending',
      };
    }),
  };
}

function loadPlans(store: CairnStore): PlanView[] {
  const plans = store.db.all('SELECT * FROM onboarding_plan ORDER BY created_at DESC');
  return plans.map((p) => {
    const id = String(p['id']);
    const ops = store.db.all('SELECT op_type AS t, status AS s FROM plan_operation WHERE plan_id = ?', id);
    const opCount = { total: ops.length, add: 0, merge: 0, keepBoth: 0, skip: 0, pending: 0, applied: 0 };
    for (const o of ops) {
      const t = String(o['t']);
      if (t === 'add') opCount.add++;
      else if (t === 'merge') opCount.merge++;
      else if (t === 'keep_both') opCount.keepBoth++;
      else if (t === 'skip') opCount.skip++;
      const s = String(o['s']);
      if (s === 'pending') opCount.pending++;
      else if (s === 'applied') opCount.applied++;
    }
    let archiveIds: string[] = [];
    try {
      const v = JSON.parse(String(p['source_archive_ids'] ?? '[]')) as unknown;
      if (Array.isArray(v)) archiveIds = v.map(String);
    } catch {
      archiveIds = [];
    }
    const planHash = String(p['plan_hash']);
    return {
      id,
      status: String(p['status']),
      planHash,
      planHashPrefix: planHash.slice(0, 8),
      scopeId: String(p['scope_id']),
      sourceArchiveIds: archiveIds,
      itemCount: Number(p['item_count']),
      proposedBy: String(p['proposed_by']),
      createdAt: String(p['created_at']),
      expiresAt: String(p['expires_at']),
      appliedAt: (p['applied_at'] as string | null) ?? null,
      ops: opCount,
      approvals: store.db
        .all('SELECT * FROM approval WHERE plan_id = ? ORDER BY approved_at DESC', id)
        .map((a) => {
          const revokedAt = (a['revoked_at'] as string | null) ?? null;
          const uses = Number(a['uses']);
          const maxUses = Number(a['max_uses']);
          const expiresAt = String(a['expires_at']);
          return {
            id: String(a['id']),
            planId: String(a['plan_id']),
            channel: String(a['channel']),
            approvedBy: String(a['approved_by']),
            approvedAt: String(a['approved_at']),
            expiresAt,
            revokedAt,
            maxUses,
            uses,
            live: revokedAt == null && uses < maxUses && expiresAt > nowIso(),
          };
        }),
    };
  });
}

function loadOutbox(store: CairnStore): OutboxView {
  const byStatus = countBy(store, 'SELECT status AS k, COUNT(*) AS n FROM outbox_job GROUP BY status');
  const pending = store.db
    .all(
      `SELECT id, job_type, entity_type, entity_id, status, attempts, next_attempt_at
         FROM outbox_job WHERE status IN ('pending','retry','running')
         ORDER BY created_at LIMIT 50`,
    )
    .map((r) => ({
      id: String(r['id']),
      jobType: String(r['job_type']),
      entityType: String(r['entity_type']),
      entityId: String(r['entity_id']),
      status: String(r['status']),
      attempts: Number(r['attempts']),
      nextAttemptAt: (r['next_attempt_at'] as string | null) ?? null,
    }));
  return { byStatus, pending };
}

function loadSync(store: CairnStore): SyncView {
  const vault = loadVaultConfig(store.paths.dataDir);
  const lastOk = store.db.get("SELECT value FROM meta WHERE key = 'sync_last_ok'");
  const blockers: string[] = [];
  if (!vault) blockers.push('未配置云端（cairn vault init-remote）');
  else {
    const env = vault.provider === 'obs' ? ['OBS_ENDPOINT', 'OBS_BUCKET', 'OBS_ACCESS_KEY_ID', 'OBS_SECRET_ACCESS_KEY'] : ['CAIRN_SYNCD_TOKEN'];
    const missing = env.filter((k) => !process.env[k]);
    if (missing.length > 0) blockers.push(`缺少环境变量: ${missing.join(', ')}`);
  }
  return {
    configured: vault != null,
    provider: vault?.provider ?? null,
    vaultId: vault?.vaultId ?? null,
    keysPresent: vault != null && hasKeys(store),
    lastOkAt: lastOk == null ? null : String(lastOk['value']),
    blockers,
  };
}

function hasKeys(store: CairnStore): boolean {
  // 只判断密钥文件是否存在，不读取内容（装配层不碰密钥材料）。
  return existsSync(join(store.paths.dataDir, 'keys.json'));
}

export interface MemoryDetailView {
  memory: MemoryView;
  scope: { id: string; preset: string; syncPolicy: string; deviceId: string; agentId: string } | null;
  revisions: { id: string; seq: number; content: ContentView; author: string; reason: string | null; createdAt: string; deviceId: string }[];
  evidence: { id: string; evidenceKind: string; trustLevel: string; sourceAgent: string | null; locator: string | null; createdAt: string }[];
  relations: { id: string; fromMemoryId: string; toMemoryId: string; relationType: string }[];
  conflicts: { id: string; revisionAId: string; revisionBId: string; status: string; detectedAt: string }[];
  tombstone: { reason: string | null; forgottenBy: string; forgottenAt: string } | null;
}

/** 单条记忆详情（含修订史与证据）。只读；掩码策略与列表一致。 */
export function memoryDetail(
  store: CairnStore,
  id: string,
  opts: { mode?: ViewMode; redact?: boolean; briefChars?: number } = {},
): MemoryDetailView {
  const mode = opts.mode ?? 'full';
  const redact = opts.redact ?? true;
  const briefChars = opts.briefChars ?? 240;
  const row = store.db.get('SELECT * FROM memory WHERE id = ?', id);
  if (row == null) throw err('E_NOT_FOUND', `记忆不存在: ${id}`);
  const sensitivity = String(row['sensitivity']);
  const status = String(row['status']);
  const masked = redact && (sensitivity === 'sensitive' || status === 'tombstoned');
  const memory: MemoryView = {
    id: String(row['id']),
    kind: String(row['kind']),
    status,
    authority: String(row['authority']),
    confidence: Number(row['confidence']),
    sensitivity,
    scopeId: String(row['scope_id']),
    content: contentView(String(row['content']), {
      masked,
      maxChars: mode === 'brief' ? briefChars : 0,
      hash: String(row['content_hash']),
    }),
    contentHash: String(row['content_hash']),
    sourceAgent: (row['source_agent'] as string | null) ?? null,
    createdBy: String(row['created_by']),
    createdAt: String(row['created_at']),
    updatedAt: String(row['updated_at']),
    expiresAt: (row['expires_at'] as string | null) ?? null,
    revisionCount: Number(store.db.scalar('SELECT COUNT(*) AS n FROM memory_revision WHERE memory_id = ?', id) ?? 0),
    evidenceCount: Number(store.db.scalar('SELECT COUNT(*) AS n FROM evidence WHERE memory_id = ?', id) ?? 0),
    openConflicts: Number(store.db.scalar("SELECT COUNT(*) AS n FROM conflict WHERE memory_id = ? AND status = 'open'", id) ?? 0),
    tombstoned: status === 'tombstoned',
  };
  const scopeRow = store.db.get('SELECT id, preset, sync_policy, device_id, agent_id FROM scope WHERE id = ?', memory.scopeId);
  return {
    memory,
    scope: scopeRow
      ? {
          id: String(scopeRow['id']),
          preset: String(scopeRow['preset']),
          syncPolicy: String(scopeRow['sync_policy']),
          deviceId: String(scopeRow['device_id']),
          agentId: String(scopeRow['agent_id']),
        }
      : null,
    revisions: store.db
      .all('SELECT * FROM memory_revision WHERE memory_id = ? ORDER BY seq', id)
      .map((r) => ({
        id: String(r['id']),
        seq: Number(r['seq']),
        content: contentView(String(r['content']), {
          masked,
          maxChars: mode === 'brief' ? briefChars : 0,
          hash: String(r['content_hash']),
        }),
        author: String(r['author']),
        reason: (r['reason'] as string | null) ?? null,
        createdAt: String(r['created_at']),
        deviceId: String(r['device_id']),
      })),
    evidence: store.db
      .all('SELECT * FROM evidence WHERE memory_id = ? ORDER BY created_at', id)
      .map((e) => ({
        id: String(e['id']),
        evidenceKind: String(e['evidence_kind']),
        trustLevel: String(e['trust_level']),
        sourceAgent: (e['source_agent'] as string | null) ?? null,
        locator: sanitizeLabel((e['locator'] as string | null) ?? null),
        createdAt: String(e['created_at']),
      })),
    relations: store.db
      .all('SELECT * FROM relation WHERE from_memory_id = ? OR to_memory_id = ? ORDER BY created_at', id, id)
      .map((r) => ({
        id: String(r['id']),
        fromMemoryId: String(r['from_memory_id']),
        toMemoryId: String(r['to_memory_id']),
        relationType: String(r['relation_type']),
      })),
    conflicts: store.db
      .all('SELECT * FROM conflict WHERE memory_id = ? ORDER BY detected_at DESC', id)
      .map((c) => ({
        id: String(c['id']),
        revisionAId: String(c['revision_a_id']),
        revisionBId: String(c['revision_b_id']),
        status: String(c['status']),
        detectedAt: String(c['detected_at']),
      })),
    tombstone: (() => {
      const t = store.db.get('SELECT reason, forgotten_by, forgotten_at FROM tombstone WHERE memory_id = ?', id);
      return t
        ? {
            reason: (t['reason'] as string | null) ?? null,
            forgottenBy: String(t['forgotten_by']),
            forgottenAt: String(t['forgotten_at']),
          }
        : null;
    })(),
  };
}

function aggregateItems(store: CairnStore): {
  total: number;
  clean: number;
  blocked: number;
  promoted: number;
  skipped: number;
  remaining: number;
} {
  const row = store.db.get(
    `SELECT COUNT(*) AS total,
       SUM(CASE WHEN i.scan_state = 'clean' THEN 1 ELSE 0 END) AS clean,
       SUM(CASE WHEN i.scan_state = 'blocked' THEN 1 ELSE 0 END) AS blocked,
       SUM(CASE WHEN ${PROMOTED_SQL.replaceAll('%ALIAS%', 'i')} THEN 1 ELSE 0 END) AS promoted,
       SUM(CASE WHEN ${SKIPPED_SQL.replaceAll('%ALIAS%', 'i')} THEN 1 ELSE 0 END) AS skipped,
       SUM(CASE WHEN i.scan_state = 'clean' AND ${NOT_HANDLED_SQL.replaceAll('%ALIAS%', 'i')} THEN 1 ELSE 0 END) AS remaining
     FROM import_item i`,
  );
  return {
    total: Number(row?.['total'] ?? 0),
    clean: Number(row?.['clean'] ?? 0),
    blocked: Number(row?.['blocked'] ?? 0),
    promoted: Number(row?.['promoted'] ?? 0),
    skipped: Number(row?.['skipped'] ?? 0),
    remaining: Number(row?.['remaining'] ?? 0),
  };
}

function countBy(store: CairnStore, sql: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of store.db.all(sql)) out[String(r['k'])] = Number(r['n']);
  return out;
}

/** LIKE 通配符转义：用户输入里的 % 与 _ 按字面处理。 */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}
