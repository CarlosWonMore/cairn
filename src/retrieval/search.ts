import { CairnStore } from '../store/open.js';
import { ScopeQuery, ScopeRow, scopeAllowsRead } from '../core/scope.js';
import {
  MEMORY_STATUSES,
  MemoryRecord,
  MemoryStatus,
  SearchResultRecord,
} from '../core/types.js';
import { err } from '../core/errors.js';
import { nowIso } from '../core/time.js';
import { mapMemory } from '../store/memories.js';

/**
 * 检索（design D5 / spec scoped-retrieval）。
 *
 * - 主通道：FTS5 trigram 虚表（memory_fts），服务 ≥3 字中文子串与拉丁/数字词。
 * - 回退通道：两字中文短查询走【有界 LIKE】——作用域前置过滤 + 结果上限 + 超时预算。
 * - 降级：FTS 抛 SQLite 异常（索引损坏/虚表缺失）时捕获并整体改走 LIKE（degraded=true）；
 *   绝不以“返回全部记忆”作为降级方式（spec：无效查询安全失败）。
 * - 隔离：所有结果逐行过 scopeAllowsRead，与详情/导出/投影共用同一判定入口。
 * - 只读：本函数不写库；last_used 更新由调用方负责。
 */

export interface SearchInput {
  text: string;
  /** 调用方身份；所有结果必须逐行过 scopeAllowsRead。 */
  query: ScopeQuery;
  /** 可选作用域白名单（SQL 前置过滤）；为空数组时不过滤 scope。 */
  scopeIds?: string[];
  /** 默认 ['active']。tombstoned / superseded 永远不可检索。 */
  statuses?: MemoryStatus[];
  /** 默认 20，上限 100。 */
  limit?: number;
  /** 默认 false：过期（expires_at <= now）行被排除。 */
  includeExpired?: boolean;
  /** LIKE 回退通道的累计超时预算，默认 1000ms。 */
  timeoutMs?: number;
}

export interface SearchOutput {
  results: SearchResultRecord[];
  /** 实际产生结果的通道：fts / like / mixed（两通道都有命中）。 */
  matchedBy: 'fts' | 'like' | 'mixed';
  /** 索引不可用、改走有界 LIKE 回退时为 true（按设计走 LIKE 的两字短查询不算降级）。 */
  degraded: boolean;
  elapsedMs: number;
}

const MAX_TEXT_LENGTH = 512;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const DEFAULT_TIMEOUT_MS = 1000;
/** SQL 候选行上限：先按 scope/status/expiry 前置过滤，再逐行 scopeAllowsRead 后截断到 limit。 */
const FETCH_CAP = 400;
const LIKE_ESCAPE = '\\';

// ---------------------------------------------------------------------------
// 分词：连续 CJK 段按长度切（≥3 字整段进 FTS；2 字段进 LIKE 词表），
// 拉丁/数字词（≥2 字符）进 FTS。单字 CJK 丢弃（任何通道都会近似全表匹配）。
// ---------------------------------------------------------------------------

const CJK_CHAR_RE = /^[\u2E80-\u2EFF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u{20000}-\u{2FA1F}]$/u;
const WORD_CHAR_RE = /[\p{L}\p{N}_]/u;

interface TokenizedQuery {
  ftsTerms: string[];
  likeTerms: string[];
}

function isCjkChar(ch: string): boolean {
  return CJK_CHAR_RE.test(ch);
}

function dedupe<T>(terms: T[]): T[] {
  return [...new Set(terms)];
}

function tokenizeQuery(text: string): TokenizedQuery {
  const ftsTerms: string[] = [];
  const likeTerms: string[] = [];
  let cjkRun = '';
  let wordRun = '';
  const flushCjk = (): void => {
    if (cjkRun === '') return;
    const len = Array.from(cjkRun).length;
    if (len >= 3) ftsTerms.push(cjkRun);
    else if (len === 2) likeTerms.push(cjkRun);
    cjkRun = '';
  };
  const flushWord = (): void => {
    if (wordRun.length >= 2) ftsTerms.push(wordRun);
    wordRun = '';
  };
  for (const ch of text) {
    if (isCjkChar(ch)) {
      flushWord();
      cjkRun += ch;
    } else if (WORD_CHAR_RE.test(ch)) {
      flushCjk();
      wordRun += ch;
    } else {
      flushCjk();
      flushWord();
    }
  }
  flushCjk();
  flushWord();
  return { ftsTerms: dedupe(ftsTerms), likeTerms: dedupe(likeTerms) };
}

// ---------------------------------------------------------------------------
// 查询构造与转义
// ---------------------------------------------------------------------------

/** FTS MATCH：双引号短语包裹 + OR 连接；词内双引号按 FTS5 规则加倍转义。 */
function buildFtsMatch(terms: string[]): string | null {
  if (terms.length === 0) return null;
  return terms.map((t) => `"${t.replace(/"/g, '""')}"`).join(' OR ');
}

/** LIKE 词转义：词内 %/_/\ 前置反斜杠，配合 ESCAPE '\'。 */
function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (ch) => LIKE_ESCAPE + ch);
}

/** LIKE 命中分：位置越靠前分越高；恒 >0。 */
function likeScore(content: string, term: string): number {
  const idx = content.toLowerCase().indexOf(term.toLowerCase());
  return 1 / (1 + Math.max(idx, 0));
}

/** FTS 分：-bm25 归一化到 (0,1]，保持 bm25 排序（越小越优 → 分越高）。 */
function ftsScore(bm25: unknown): number {
  const v = Math.abs(Number(bm25 ?? 0));
  return 1 / (1 + (Number.isFinite(v) ? v : 0));
}

// ---------------------------------------------------------------------------
// 校验
// ---------------------------------------------------------------------------

function validateStatuses(statuses: MemoryStatus[]): MemoryStatus[] {
  for (const s of statuses) {
    if (!(MEMORY_STATUSES as readonly string[]).includes(s)) {
      throw err('E_VALIDATION', `未知记忆状态: ${String(s)}`);
    }
    if (s === 'tombstoned' || s === 'superseded') {
      throw err('E_VALIDATION', `状态 ${s} 永远不可检索或导出`);
    }
  }
  return dedupe(statuses);
}

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

function validateScopeIds(store: CairnStore, scopeIds: string[] | undefined): void {
  if (scopeIds == null) return;
  if (!Array.isArray(scopeIds)) throw err('E_VALIDATION', 'scopeIds 必须是字符串数组');
  for (const id of scopeIds) {
    if (typeof id !== 'string' || id === '') throw err('E_VALIDATION', 'scopeIds 必须是非空字符串数组');
  }
  // 白名单里的作用域必须真实存在；不存在直接 E_NOT_FOUND，而不是静默返回空集。
  for (const id of scopeIds) store.scopes.requireById(id);
}

// ---------------------------------------------------------------------------
// 共用读取判定（与导出/详情/投影同一边界）
// ---------------------------------------------------------------------------

function makeScopeChecker(store: CairnStore, query: ScopeQuery): (scopeId: string) => boolean {
  const cache = new Map<string, ScopeRow | null>();
  return (scopeId: string): boolean => {
    if (!cache.has(scopeId)) cache.set(scopeId, store.scopes.getById(scopeId));
    const row = cache.get(scopeId);
    return row != null && scopeAllowsRead(row, query);
  };
}

interface CommonFilter {
  where: string;
  params: unknown[];
}

function commonFilter(statuses: MemoryStatus[], scopeIds: string[] | null, includeExpired: boolean, now: string): CommonFilter {
  const conds = [`m.status IN (${statuses.map(() => '?').join(',')})`];
  const params: unknown[] = [...statuses];
  if (!includeExpired) {
    conds.push('(m.expires_at IS NULL OR m.expires_at > ?)');
    params.push(now);
  }
  if (scopeIds != null && scopeIds.length > 0) {
    conds.push(`m.scope_id IN (${scopeIds.map(() => '?').join(',')})`);
    params.push(...scopeIds);
  }
  return { where: conds.join(' AND '), params };
}

// ---------------------------------------------------------------------------
// 结果装配
// ---------------------------------------------------------------------------

function assembleResult(store: CairnStore, memory: MemoryRecord, matchedBy: 'fts' | 'like', score: number, now: string): SearchResultRecord {
  const expired = memory.expiresAt != null && memory.expiresAt <= now;
  const unverifiableImport = memory.authority === 'imported_unverified';
  let conflictId: string | undefined;
  if (memory.status === 'conflicted') {
    conflictId = store.conflicts.listOpen(memory.id)[0]?.id;
  }
  return { memory, matchedBy, score, conflictId, unverifiableImport, expired };
}

function mergedByChannelSort(a: SearchResultRecord, b: SearchResultRecord): number {
  if (b.score !== a.score) return b.score - a.score;
  if (a.matchedBy !== b.matchedBy) return a.matchedBy === 'fts' ? -1 : 1;
  return a.memory.id < b.memory.id ? -1 : a.memory.id > b.memory.id ? 1 : 0;
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

export function searchMemories(store: CairnStore, input: SearchInput): SearchOutput {
  const startedAt = performance.now();
  const elapsed = (): number => performance.now() - startedAt;

  // 1. 校验：非法输入安全失败，绝不降级为全量
  if (typeof input.text !== 'string' || input.text.trim().length === 0) {
    throw err('E_VALIDATION', '检索文本不能为空');
  }
  if (input.text.length > MAX_TEXT_LENGTH) {
    throw err('E_VALIDATION', `检索文本超过 ${MAX_TEXT_LENGTH} 字符上限`);
  }
  validateQueryIdentity(input.query);
  const statuses = validateStatuses(input.statuses ?? ['active']);
  const rawLimit = input.limit ?? DEFAULT_LIMIT;
  if (!Number.isInteger(rawLimit) || rawLimit < 1) {
    throw err('E_VALIDATION', 'limit 必须是正整数');
  }
  const limit = Math.min(rawLimit, MAX_LIMIT);
  const includeExpired = input.includeExpired ?? false;
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw err('E_VALIDATION', 'timeoutMs 必须是正数');
  }
  validateScopeIds(store, input.scopeIds);

  const query = input.query;
  const now = nowIso();
  const fetchLimit = Math.min(limit * 4 + 20, FETCH_CAP);
  const isReadable = makeScopeChecker(store, query);
  const scopeFilter = input.scopeIds != null && input.scopeIds.length > 0 ? input.scopeIds : null;

  // 2. 分词
  const tokens = tokenizeQuery(input.text);
  let ftsTerms = tokens.ftsTerms;
  let likeTerms = tokens.likeTerms;

  // 3. FTS MATCH 构造：失败时全部词改走 LIKE（非索引故障，不算 degraded）
  let ftsMatch: string | null = null;
  try {
    ftsMatch = buildFtsMatch(ftsTerms);
  } catch {
    likeTerms = dedupe([...ftsTerms, ...likeTerms]);
    ftsTerms = [];
    ftsMatch = null;
  }

  const merged = new Map<string, SearchResultRecord>();
  let degraded = false;
  let ftsRan = false;
  let ftsHits = 0;
  let likeHits = 0;

  // 4. FTS 主通道（只读查询；异常时降级到 LIKE）
  if (ftsMatch != null) {
    ftsRan = true;
    const { where, params } = commonFilter(statuses, scopeFilter, includeExpired, now);
    const sql = `SELECT m.*, bm25(memory_fts) AS bm25_score
FROM memory_fts
JOIN memory m ON m.rowid = memory_fts.rowid
WHERE memory_fts MATCH ? AND ${where}
ORDER BY bm25(memory_fts), m.id
LIMIT ?`;
    let rows: Record<string, unknown>[];
    try {
      rows = store.db.all(sql, ftsMatch, ...params, fetchLimit);
    } catch {
      // 索引不可用（损坏/虚表缺失）：degraded=true，全部改走 LIKE；绝不返回全部记忆。
      degraded = true;
      likeTerms = dedupe([...ftsTerms, ...likeTerms]);
      ftsMatch = null;
      merged.clear();
      ftsHits = 0;
      rows = [];
    }
    for (const row of rows) {
      if (merged.size >= limit) break;
      const memory = mapMemory(row);
      if (!isReadable(memory.scopeId)) continue;
      if (merged.has(memory.id)) continue;
      merged.set(memory.id, assembleResult(store, memory, 'fts', ftsScore(row['bm25_score']), now));
      ftsHits++;
    }
  }

  // 5. LIKE 回退通道：2 字 CJK 词（或降级后的全部词）；有界：前置过滤 + 上限 + 超时
  for (const term of likeTerms) {
    if (merged.size >= limit) break;
    if (elapsed() >= timeoutMs) break;
    const pattern = `%${escapeLike(term)}%`;
    const { where, params } = commonFilter(statuses, scopeFilter, includeExpired, now);
    const sql = `SELECT m.* FROM memory m
WHERE ${where} AND m.content LIKE ? ESCAPE '${LIKE_ESCAPE}'
ORDER BY m.updated_at DESC, m.id
LIMIT ?`;
    const rows = store.db.all(sql, ...params, pattern, fetchLimit);
    for (const row of rows) {
      if (merged.size >= limit) break;
      const memory = mapMemory(row);
      if (!isReadable(memory.scopeId)) continue;
      if (merged.has(memory.id)) continue;
      merged.set(memory.id, assembleResult(store, memory, 'like', likeScore(memory.content, term), now));
      likeHits++;
    }
  }

  // 6. matchedBy 按实际产生结果的通道
  const likeRan = likeTerms.length > 0;
  let matchedBy: SearchOutput['matchedBy'];
  if (degraded) {
    matchedBy = 'like';
  } else if (ftsRan && likeRan) {
    matchedBy = ftsHits > 0 && likeHits > 0 ? 'mixed' : ftsHits > 0 ? 'fts' : 'like';
  } else if (ftsRan) {
    matchedBy = 'fts';
  } else {
    matchedBy = 'like';
  }

  const results = [...merged.values()].sort(mergedByChannelSort).slice(0, limit);
  return { results, matchedBy, degraded, elapsedMs: Math.round(elapsed() * 100) / 100 };
}
