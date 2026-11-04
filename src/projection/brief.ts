import type { CairnStore } from '../store/open.js';
import type { MemoryRecord } from '../core/types.js';
import { err } from '../core/errors.js';

/**
 * 投影简报渲染（变更 add-memory-projection-brief）。
 *
 * 两个不变量，改实现前先读：
 *
 * 1. **敏感排除放在取数阶段**，不放在渲染阶段。先渲染再过滤，一旦某处漏过滤
 *    就会把 local_only / sensitive / blocked 的内容写进宿主文件——泄露面不可控。
 * 2. **同输入必然同字节**。排序键全序且不含"当前时间"：用 confidence、updated_at、
 *    id 三个稳定字段。任何把 now() 写进输出都会让每次渲染不同，破坏缓存、也让
 *    "内容未变化 → 不重写文件"的幂等判断失效。
 *
 * 摘要用确定性渲染而不是 LLM：引入模型会让上述第 2 条不成立，且多一层依赖与成本。
 */

/** 投影候选：已完成敏感排除的记忆。 */
export interface ProjectionCandidate {
  id: string;
  kind: string;
  content: string;
  confidence: number;
  updatedAt: string;
}

export interface ProjectionSelection {
  /** 入选记忆（已按预算排序）。 */
  selected: ProjectionCandidate[];
  /** 因敏感/状态被排除的条数（只计数，不暴露内容）。 */
  excludedCount: number;
  /** 因预算被裁掉的条数。 */
  truncatedCount: number;
  /** 渲染结果字节数。 */
  bytes: number;
}

/** 单条摘要的首行截断长度（含省略号）。 */
const SUMMARY_MAX = 120;

function firstLine(content: string): string {
  const line = content.split(/\r?\n/).find((l) => l.trim().length > 0) ?? '';
  return line.trim();
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
}

/**
 * 取数 + 敏感排除（第 1 条不变量）。
 *
 * 排除条件（任一命中即排除，且**先于**任何排序与预算判断）：
 * - scope.sync_policy = 'local_only'（设备限定内容不得离开本机语境）
 * - memory.sensitivity = 'sensitive'
 * - memory.status = 'blocked'
 */
/** 艾宾浩斯分桶（天数 → 权重）。照抄 dsh-meow-memory 的实测分桶，不自创。 */
export function recencyWeight(days: number): number {
  if (days < 1) return 1.0;
  if (days < 2) return 0.9;
  if (days < 4) return 0.8;
  if (days < 7) return 0.65;
  if (days < 15) return 0.5;
  if (days < 30) return 0.35;
  if (days < 60) return 0.25;
  if (days < 180) return 0.15;
  return 0.08;
}

/** 绝对地板：最差情况也保留一半基线分（prime-memory 的 max(0.5, ...)）。 */
export const DECAY_FLOOR = 0.5;
/** 高重要度豁免衰减的阈值。 */
export const NO_DECAY_IMPORTANCE = 4;
/** 「本轮高度相关」豁免衰减的比例（相对本轮最高分）。 */
export const SUPER_MATCH_RATIO = 0.85;

/**
 * 投影排序分值（add-memory-importance-and-usage-signal D8）。
 *
 * `score = 基线分 × 衰减系数`，衰减系数带三重地板：
 * ① importance >= 4 → 不衰减；
 * ② 本轮相关度 >= 0.85 × 最高分 → 不衰减；
 * ③ 绝对地板 0.5 → 任何记忆至少保留一半基线分。
 *
 * **地板不是可选装饰**：纯衰减会让「被注入过的更容易被注入」，一年后只剩几条
 * 明星记忆被反复注入，其余成为存在于库中但不可见的僵尸——那反而加剧库膨胀。
 *
 * @param nowMs 当前时间（ms）。传入以保持纯函数可测。
 */
export function scoreCandidate(input: {
  importance: number | null;
  lastUsedAt: string | null;
  createdAt: string;
  nowMs: number;
  /** 本轮相关度（0-1）。拿不到时传 undefined，跳过地板②。 */
  relevance?: number;
  maxRelevance?: number;
}): { score: number; decay: number; flooredBy: 'importance' | 'relevance' | 'floor' | null } {
  const base = input.importance ?? 3;
  const refIso = input.lastUsedAt ?? input.createdAt;
  const refMs = Date.parse(refIso);
  const days = Number.isFinite(refMs) ? Math.max(0, (input.nowMs - refMs) / 86_400_000) : 0;
  let decay = recencyWeight(days);

  let flooredBy: 'importance' | 'relevance' | 'floor' | null = null;
  if (base >= NO_DECAY_IMPORTANCE) {
    decay = 1;
    flooredBy = 'importance';
  } else if (
    input.relevance !== undefined &&
    input.maxRelevance !== undefined &&
    input.maxRelevance > 0 &&
    input.relevance >= SUPER_MATCH_RATIO * input.maxRelevance
  ) {
    decay = 1;
    flooredBy = 'relevance';
  } else if (decay < DECAY_FLOOR) {
    decay = DECAY_FLOOR;
    flooredBy = 'floor';
  }
  return { score: base * decay, decay, flooredBy };
}

export function selectProjectionCandidates(
  store: CairnStore,
  opts: { scopeIds: string[]; limit?: number; nowMs?: number } = { scopeIds: [] },
): { candidates: ProjectionCandidate[]; excludedCount: number } {
  const where: string[] = ["m.status = 'active'"];
  const params: unknown[] = [];

  if (opts.scopeIds.length > 0) {
    where.push(`m.scope_id IN (${opts.scopeIds.map(() => '?').join(',')})`);
    params.push(...opts.scopeIds);
  }

  // 取回后在 JS 里算分并排序（add-memory-importance-and-usage-signal D8）：
  // 衰减需要「当前时间」与可选的相关度，放进 SQL 会既难读又难调；投影每会话一次，
  // 而 FETCH_CAP 已有上限，数据量小，性能不敏感。
  const rows = store.db.all(
    `SELECT m.id, m.kind, m.content, m.confidence, m.updated_at, m.created_at,
            m.importance, m.last_used_at, m.sensitivity, s.sync_policy
       FROM memory m
       JOIN scope s ON s.id = m.scope_id
      WHERE ${where.join(' AND ')}`,
    ...params,
  );

  const nowMs = opts.nowMs ?? Date.now();
  const scored = rows.map((r) => ({
    row: r,
    ...scoreCandidate({
      importance: r['importance'] == null ? null : Number(r['importance']),
      lastUsedAt: (r['last_used_at'] as string | null) ?? null,
      createdAt: String(r['created_at'] ?? r['updated_at'] ?? ''),
      nowMs,
    }),
  }));
  scored.sort((a, b) => {
    // lesson 优先（既有语义：承担「曾经错了，别再犯」，会话开场最该看到）
    const la = a.row['kind'] === 'lesson' ? 0 : 1;
    const lb = b.row['kind'] === 'lesson' ? 0 : 1;
    if (la !== lb) return la - lb;
    if (b.score !== a.score) return b.score - a.score;
    const ua = String(a.row['updated_at'] ?? '');
    const ub = String(b.row['updated_at'] ?? '');
    if (ua !== ub) return ua < ub ? 1 : -1;
    return String(a.row['id']) < String(b.row['id']) ? -1 : 1;
  });

  const candidates: ProjectionCandidate[] = [];
  let excludedCount = 0;
  for (const { row: r } of scored) {
    const localOnly = String(r['sync_policy']) === 'local_only';
    const sensitive = String(r['sensitivity']) !== 'normal';
    const blocked = String(r['sensitivity']) === 'blocked';
    if (localOnly || sensitive || blocked) {
      excludedCount += 1;
      continue;
    }
    candidates.push({
      id: String(r['id']),
      kind: String(r['kind']),
      content: String(r['content']),
      confidence: Number(r['confidence'] ?? 0),
      updatedAt: String(r['updated_at']),
    });
  }
  return { candidates, excludedCount };
}

/** brief 模式单行渲染：`- [kind] 摘要 (id:xxxxxxxx)` */
export function renderBriefLine(m: ProjectionCandidate): string {
  const id8 = m.id.replace(/-/g, '').slice(0, 8);
  return `- [${m.kind}] ${truncate(firstLine(m.content), SUMMARY_MAX)} (id:${id8})`;
}

/** index 模式单行渲染（ZCode 约定）：`- [标题](id:xxxxxxxx) — 一句话` */
export function renderIndexLine(m: ProjectionCandidate): string {
  const id8 = m.id.replace(/-/g, '').slice(0, 8);
  const head = truncate(firstLine(m.content), 80);
  return `- [${head}](id:${id8}) — ${m.kind}`;
}

export interface RenderOptions {
  mode: 'brief' | 'index';
  budgetBytes: number;
  /** 单行字符上限（index 模式为 200）。 */
  maxLineChars?: number;
}

export interface RenderResult {
  text: string;
  selected: number;
  truncated: number;
  bytes: number;
  excludedCount: number;
}

/**
 * 渲染简报：按预算裁剪，超出时写明省略条数（第 2 条不变量：确定性）。
 *
 * 裁剪顺序即入参顺序（调用方已按 confidence/updated_at/id 排好），
 * 不做二次排序——否则"哪几条被裁掉"会随实现变化而漂移。
 */
export function renderProjection(
  candidates: ProjectionCandidate[],
  opts: RenderOptions,
): RenderResult {
  if (!Number.isInteger(opts.budgetBytes) || opts.budgetBytes < 0) {
    throw err('E_VALIDATION', 'budgetBytes 必须是非负整数');
  }
  const render = opts.mode === 'brief' ? renderBriefLine : renderIndexLine;
  const maxLine = opts.maxLineChars ?? (opts.mode === 'index' ? 200 : 0);

  const lines: string[] = [];
  let used = 0;
  let truncated = 0;

  for (let i = 0; i < candidates.length; i++) {
    let line = render(candidates[i]!);
    if (maxLine > 0 && line.length > maxLine) line = truncate(line, maxLine);
    // 预留省略提示的字节（约占 40 字节，足够 "…（另 N 条未显示）"）
    const reserve = 48;
    if (used + Buffer.byteLength(line, 'utf8') + reserve > opts.budgetBytes) {
      truncated = candidates.length - i;
      break;
    }
    lines.push(line);
    used += Buffer.byteLength(line, 'utf8') + 1; // +1 = 换行
  }

  if (truncated > 0) {
    lines.push(`…（另 ${truncated} 条未显示）`);
  }
  const text = lines.join('\n');
  return {
    text,
    selected: lines.length - (truncated > 0 ? 1 : 0),
    truncated,
    bytes: Buffer.byteLength(text, 'utf8'),
    excludedCount: 0,
  };
}

/** 便捷入口：取数 + 渲染一步到位（仍保证排除先于渲染）。 */
export function buildProjection(
  store: CairnStore,
  opts: { scopeIds: string[]; mode: 'brief' | 'index'; budgetBytes: number },
): RenderResult {
  const { candidates, excludedCount } = selectProjectionCandidates(store, { scopeIds: opts.scopeIds });
  const result = renderProjection(candidates, { mode: opts.mode, budgetBytes: opts.budgetBytes });
  return { ...result, excludedCount };
}
