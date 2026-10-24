import { CairnStore } from '../store/open.js';
import { ScopeQuery, ScopeRow, scopeAllowsRead } from '../core/scope.js';
import {
  EvidenceRecord,
  MEMORY_STATUSES,
  MemoryRecord,
  MemoryStatus,
  RevisionRecord,
} from '../core/types.js';
import { err } from '../core/errors.js';
import { nowIso } from '../core/time.js';
import { mapMemory } from '../store/memories.js';

/**
 * 导出（spec scoped-retrieval：与检索同一边界）。
 *
 * - 所有行逐行过 scopeAllowsRead；scopeIds 白名单同样生效且必须存在。
 * - 【硬性】tombstoned 正文绝不进入 memories[]，只以 hash+审计字段进入 tombstones[]；
 *   superseded 记忆同理完全不进导出。
 * - 每条 memory 携带库字段 contentHash（基于规范化正文），重复导入可幂等。
 * - 只读：本函数不写库。
 */

export interface ExportInput {
  query: ScopeQuery;
  /** 可选作用域白名单；为空数组时不过滤 scope。 */
  scopeIds?: string[];
  /** 默认 ['active']；tombstoned/superseded 仍然禁止。 */
  statuses?: MemoryStatus[];
  format: 'json' | 'markdown';
  /** true 时附带 import_item（仅 scan_state='clean'）。 */
  includeArchives?: boolean;
}

export interface ExportCounts {
  memories: number;
  revisions: number;
  evidence: number;
  archives?: number;
}

export interface ExportOutput {
  payload: string;
  counts: ExportCounts;
}

export interface ExportScopeInfo {
  id: string;
  preset: string;
  syncPolicy: string;
  projectId: string | null;
  deviceId: string;
  agentId: string;
}

export interface ExportRelationInfo {
  id: string;
  fromMemoryId: string;
  toMemoryId: string;
  relationType: string;
}

export interface ExportMemoryEntry extends MemoryRecord {
  revisions: RevisionRecord[];
  evidence: EvidenceRecord[];
  relations: ExportRelationInfo[];
}

export interface ExportTombstone {
  memoryId: string;
  contentHash: string;
  forgottenAt: string;
  reason: string | null;
  forgottenBy: string;
}

export interface ExportArchiveItem {
  itemIndex: number;
  content: string;
  contentHash: string;
  sourceRef: string | null;
}

export interface ExportArchive {
  id: string;
  batchId: string;
  parser: string;
  items: ExportArchiveItem[];
}

export interface ExportDoc {
  format: 'cairn-export';
  version: 1;
  exportedAt: string;
  scopes: ExportScopeInfo[];
  memories: ExportMemoryEntry[];
  tombstones: ExportTombstone[];
  archives?: ExportArchive[];
}

// ---------------------------------------------------------------------------
// 校验（与检索同规则）
// ---------------------------------------------------------------------------

function validateQueryIdentity(query: ScopeQuery): void {
  if (
    query == null ||
    typeof query.deviceId !== 'string' ||
    typeof query.agentId !== 'string' ||
    query.deviceId === '' ||
    query.agentId === ''
  ) {
    throw err('E_VALIDATION', '检索/导出必须提供调用方身份（deviceId 与 agentId 均非空）');
  }
}

function validateStatuses(statuses: MemoryStatus[]): MemoryStatus[] {
  for (const s of statuses) {
    if (!(MEMORY_STATUSES as readonly string[]).includes(s)) {
      throw err('E_VALIDATION', `未知记忆状态: ${String(s)}`);
    }
    if (s === 'tombstoned' || s === 'superseded') {
      throw err('E_VALIDATION', `状态 ${s} 永远不可检索或导出`);
    }
  }
  return [...new Set(statuses)];
}

function validateScopeIds(store: CairnStore, scopeIds: string[] | undefined): void {
  if (scopeIds == null) return;
  if (!Array.isArray(scopeIds)) throw err('E_VALIDATION', 'scopeIds 必须是字符串数组');
  for (const id of scopeIds) {
    if (typeof id !== 'string' || id === '') throw err('E_VALIDATION', 'scopeIds 必须是非空字符串数组');
  }
  for (const id of scopeIds) store.scopes.requireById(id);
}

// ---------------------------------------------------------------------------
// 共用读取判定（与检索/详情/投影同一边界）
// ---------------------------------------------------------------------------

function makeScopeChecker(store: CairnStore, query: ScopeQuery): (scopeId: string) => boolean {
  const cache = new Map<string, ScopeRow | null>();
  return (scopeId: string): boolean => {
    if (!cache.has(scopeId)) cache.set(scopeId, store.scopes.getById(scopeId));
    const row = cache.get(scopeId);
    return row != null && scopeAllowsRead(row, query);
  };
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

export function exportData(store: CairnStore, input: ExportInput): ExportOutput {
  if (input.format !== 'json' && input.format !== 'markdown') {
    throw err('E_VALIDATION', `format 必须是 'json' 或 'markdown'，收到 ${String(input.format)}`);
  }
  validateQueryIdentity(input.query);
  const statuses = validateStatuses(input.statuses ?? ['active']);
  validateScopeIds(store, input.scopeIds);

  const now = nowIso();
  const isReadable = makeScopeChecker(store, input.query);
  const scopeFilter = input.scopeIds != null && input.scopeIds.length > 0 ? input.scopeIds : null;

  // 1. 记忆集合：statuses + scopeIds 前置过滤，再逐行 scopeAllowsRead
  const statusPh = statuses.map(() => '?').join(',');
  const scopeConds: string[] = [`status IN (${statusPh})`];
  const baseParams: unknown[] = [...statuses];
  if (scopeFilter != null) {
    scopeConds.push(`scope_id IN (${scopeFilter.map(() => '?').join(',')})`);
    baseParams.push(...scopeFilter);
  }
  const where = scopeConds.join(' AND ');

  const scopeIdsUsed = new Set<string>();
  const memoryEntries: ExportMemoryEntry[] = [];
  let revisionsTotal = 0;
  let evidenceTotal = 0;
  for (const row of store.db.all(`SELECT * FROM memory WHERE ${where} ORDER BY created_at, id`, ...baseParams)) {
    const memory = mapMemory(row);
    // 硬性边界兜底：这两类状态即使被写入也不得进入导出正文
    if (memory.status === 'tombstoned' || memory.status === 'superseded') continue;
    if (!isReadable(memory.scopeId)) continue;
    scopeIdsUsed.add(memory.scopeId);
    const revisions = store.memories.revisions(memory.id);
    const evidence = store.memories.evidence(memory.id);
    const relations = store.memories.relationsOf(memory.id);
    revisionsTotal += revisions.length;
    evidenceTotal += evidence.length;
    memoryEntries.push({ ...memory, revisions, evidence, relations });
  }

  // 2. 遗忘清单：只有 hash + 审计字段，绝无正文
  const tombstones: ExportTombstone[] = [];
  for (const row of store.db.all(`SELECT * FROM memory WHERE status = 'tombstoned' ${scopeFilter != null ? `AND scope_id IN (${scopeFilter.map(() => '?').join(',')})` : ''} ORDER BY created_at, id`, ...(scopeFilter != null ? scopeFilter : []))) {
    const memory = mapMemory(row);
    if (!isReadable(memory.scopeId)) continue;
    scopeIdsUsed.add(memory.scopeId);
    const t = store.memories.getTombstone(memory.id);
    if (t == null) continue;
    tombstones.push({
      memoryId: memory.id,
      contentHash: t.contentHash,
      forgottenAt: t.forgottenAt,
      reason: t.reason,
      forgottenBy: t.forgottenBy,
    });
  }

  // 3. 作用域清单：仅导出实际贡献内容的 scopes（不枚举无关作用域）
  const scopes: ExportScopeInfo[] = [...scopeIdsUsed].map((id) => {
    const s = store.scopes.requireById(id);
    return { id: s.id, preset: s.preset, syncPolicy: s.syncPolicy, projectId: s.projectId, deviceId: s.deviceId, agentId: s.agentId };
  });

  // 4. 导入档案：仅 scan_state='clean' 条目
  let archives: ExportArchive[] | undefined;
  if (input.includeArchives === true) {
    archives = store.archives.list().map((a) => ({
      id: a.id,
      batchId: a.batchId,
      parser: a.parser,
      items: store.archives.listItems(a.id, { scanState: 'clean' }).map((it) => ({
        itemIndex: it.itemIndex,
        content: it.content,
        contentHash: it.contentHash,
        sourceRef: it.sourceRef,
      })),
    }));
  }

  const counts: ExportCounts = {
    memories: memoryEntries.length,
    revisions: revisionsTotal,
    evidence: evidenceTotal,
    ...(archives != null ? { archives: archives.length } : {}),
  };

  const payload =
    input.format === 'json'
      ? renderJson({ format: 'cairn-export', version: 1, exportedAt: now, scopes, memories: memoryEntries, tombstones, ...(archives != null ? { archives } : {}) })
      : renderMarkdown(now, scopes, memoryEntries, tombstones, archives, counts);
  return { payload, counts };
}

function renderJson(doc: ExportDoc): string {
  return JSON.stringify(doc, null, 2);
}

// ---------------------------------------------------------------------------
// Markdown 投影：按作用域分组的人类可读导出，正文保留
// ---------------------------------------------------------------------------

function renderMarkdown(
  exportedAt: string,
  scopes: ExportScopeInfo[],
  memories: ExportMemoryEntry[],
  tombstones: ExportTombstone[],
  archives: ExportArchive[] | undefined,
  counts: ExportCounts,
): string {
  const lines: string[] = [];
  lines.push('# cairn managed export', '');
  lines.push(`- exportedAt: ${exportedAt}`);
  lines.push('- format: cairn-export v1');
  lines.push(`- memories: ${counts.memories}, revisions: ${counts.revisions}, evidence: ${counts.evidence}${counts.archives != null ? `, archives: ${counts.archives}` : ''}`);
  lines.push('');

  for (const s of scopes) {
    lines.push(`## Scope ${s.preset} (${s.id})`, '');
    lines.push(`- project: ${s.projectId ?? '-'} / device: ${s.deviceId} / agent: ${s.agentId} / syncPolicy: ${s.syncPolicy}`, '');
    for (const m of memories.filter((x) => x.scopeId === s.id)) {
      lines.push(`### [${m.status}] ${m.kind} ${m.id}`);
      lines.push(`- authority: ${m.authority} / confidence: ${m.confidence} / sensitivity: ${m.sensitivity}`);
      lines.push(`- observedAt: ${m.observedAt} / contentHash: ${m.contentHash}`);
      lines.push('- content:');
      for (const line of m.content.split(/\r?\n/)) lines.push(line);
      lines.push('');
      if (m.revisions.length > 0) {
        lines.push('#### revisions');
        for (const r of m.revisions) {
          lines.push(`- seq ${r.seq} by ${r.author} at ${r.createdAt}${r.reason != null ? ` reason: ${r.reason}` : ''}`);
          for (const line of r.content.split(/\r?\n/)) lines.push(`  ${line}`);
        }
        lines.push('');
      }
      if (m.evidence.length > 0) {
        lines.push('#### evidence');
        for (const e of m.evidence) {
          lines.push(`- ${e.evidenceKind} trust=${e.trustLevel}${e.locator != null ? ` locator=${e.locator}` : ''}${e.importArchiveId != null ? ` archive=${e.importArchiveId}` : ''}`);
        }
        lines.push('');
      }
      if (m.relations.length > 0) {
        lines.push('#### relations');
        for (const rel of m.relations) {
          lines.push(`- ${rel.relationType} ${rel.fromMemoryId} <-> ${rel.toMemoryId}`);
        }
        lines.push('');
      }
    }
  }

  lines.push('## Forgotten memories (tombstones)', '');
  if (tombstones.length === 0) lines.push('(none)', '');
  for (const t of tombstones) {
    lines.push(`- ${t.memoryId} contentHash=${t.contentHash} forgottenAt=${t.forgottenAt} forgottenBy=${t.forgottenBy} reason=${t.reason ?? '-'}`);
  }
  lines.push('');

  if (archives != null) {
    lines.push('## Import archives (clean items only)', '');
    if (archives.length === 0) lines.push('(none)', '');
    for (const a of archives) {
      lines.push(`### archive ${a.id} batch=${a.batchId} parser=${a.parser}`);
      for (const it of a.items) {
        lines.push(`- item ${it.itemIndex} contentHash=${it.contentHash} sourceRef=${it.sourceRef ?? '-'}`);
        for (const line of it.content.split(/\r?\n/)) lines.push(`  ${line}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}
