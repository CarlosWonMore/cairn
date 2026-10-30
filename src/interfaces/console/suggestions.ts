import { CairnStore } from '../../store/open.js';
import { nowIso } from '../../core/time.js';
import { promotedPredicate } from '../../onboarding/batches.js';

/**
 * 规则层建议引擎（design D4 第一层）。
 *
 * 三条设计约束，都在实现里体现：
 * 1. **纯函数**：不写库、不联网、不调模型。同样的输入永远得到同样的输出。
 * 2. **强制 basis**：每条建议必须带可复算的证据值（哈希前缀、相似度、字符数、
 *    扫描状态）。没有 basis 的建议在类型上就构造不出来。
 * 3. **承认边界**：判不了的给 `needs_human`，不猜。猜错的成本由用户承担，
 *    而"我不知道"的成本只是一次阅读。
 *
 * 刻意不做的事：不自动执行、不预选、不问模型。
 */

export type SuggestedAction = 'promote' | 'merge' | 'keep_both' | 'skip' | 'needs_human';

export interface BasisEntry {
  key: string;
  value: string | number;
  note?: string;
}

export interface Suggestion {
  itemId: string;
  batchId: string | null;
  archiveId: string;
  itemIndex: number;
  action: SuggestedAction;
  ruleId: string;
  /** 人可读的一句话，不含敏感正文。 */
  reason: string;
  targetMemoryId: string | null;
  basis: BasisEntry[];
  confidence: 'high' | 'medium' | 'low';
  scanState: string;
}

export interface SuggestionSet {
  generatedAt: string;
  batchId: string | null;
  itemId: string | null;
  /** 规则集版本：规则变了但引擎没改版本号，复用旧建议就是错的。 */
  engineVersion: string;
  counts: Record<SuggestedAction, number>;
  items: Suggestion[];
}

export const ENGINE_VERSION = 'rule-v1';

/** 排序权重：需要人判断的排最前，可直接批量确认的排后面。 */
const ACTION_ORDER: Record<SuggestedAction, number> = {
  needs_human: 0,
  merge: 1,
  promote: 2,
  keep_both: 3,
  skip: 4,
};

const NEAR_DUP_THRESHOLD = 0.8;
/**
 * 冲突判定的相似度下界。低于这个值说明两段文本本来就不相干，
 * "共享 3 个 token"在中文里太容易凑到（"配置/文件/路径"就够），
 * 不设下界会把大量无关条目误报成"需要人判断"，反而淹没真正的冲突。
 */
const CONFLICT_MIN_JACCARD = 0.35;
/**
 * 碎片阈值。中文的信息密度远高于英文：40 个汉字已经能装四个关键数值，
 * 按"字符数 40"砍会把真实条目误判成碎片。所以这里同时要求"不含数字"——
 * 带数值的短句往往是端口、超时、版本号这类不可再短的事实。
 */
const FRAGMENT_LIMIT = 20;
const CODE_HEAVY_RATIO = 0.6;
const MAX_COMPARE_CHARS = 1200;

export interface ComputeSuggestionsInput {
  batchId?: string;
  itemId?: string;
  redact?: boolean;
  /**
   * 连已晋升的条目一起判。默认 false —— 已晋升的再审一遍只会制造噪音。
   * 只有"明确要求重做"的场景（`onboarding auto --redo`）才该打开：
   * 否则条目被选中了、规则层却因为看不到它而一律给 needs_human，
   * 重做就会安静地变成"全部跳过"。
   */
  includePromoted?: boolean;
}

export function computeSuggestions(store: CairnStore, input: ComputeSuggestionsInput = {}): SuggestionSet {
  const rows = loadCandidateItems(store, input);
  const memories = loadMemoryCorpus(store);
  const items = rows.map((row) => suggestForItem(row, memories));
  items.sort((a, b) => {
    const byAction = ACTION_ORDER[a.action] - ACTION_ORDER[b.action];
    if (byAction !== 0) return byAction;
    if (a.batchId !== b.batchId) return String(a.batchId).localeCompare(String(b.batchId));
    return a.itemIndex - b.itemIndex;
  });
  const counts: Record<SuggestedAction, number> = { promote: 0, merge: 0, keep_both: 0, skip: 0, needs_human: 0 };
  for (const it of items) counts[it.action]++;
  return {
    generatedAt: nowIso(),
    batchId: input.batchId ?? null,
    itemId: input.itemId ?? null,
    engineVersion: ENGINE_VERSION,
    counts,
    items,
  };
}

interface CandidateItem {
  id: string;
  archiveId: string;
  batchId: string | null;
  itemIndex: number;
  content: string;
  contentHash: string;
  scanState: string;
  scanFindings: string | null;
}

interface MemoryCorpusEntry {
  id: string;
  content: string;
  contentHash: string;
  status: string;
  scopeId: string;
  trigrams: Set<string>;
  tokens: Set<string>;
  numbers: Set<string>;
  kind: string;
}

function loadCandidateItems(store: CairnStore, input: ComputeSuggestionsInput): CandidateItem[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (input.itemId != null) {
    where.push('i.id = ?');
    params.push(input.itemId);
  } else if (input.includePromoted === true) {
    // 显式重做：不按晋升状态过滤，批次内全部重新判一遍。
    if (input.batchId != null) {
      where.push('i.batch_id = ?');
      params.push(input.batchId);
    }
  } else {
    // 默认只看还没晋升的条目：已晋升的再审一遍没有意义，只会制造噪音。
    // 谓词与批次/进度共用同一处（promotedPredicate），不要在这里另写一份。
    where.push(`(
      (i.scan_state = 'blocked')
      OR (i.scan_state = 'clean' AND ${promotedPredicate('i').notExists}))`);
    if (input.batchId != null) {
      where.push('i.batch_id = ?');
      params.push(input.batchId);
    }
  }
  return store.db
    .all(
      `SELECT i.id, i.archive_id, i.batch_id, i.item_index, i.content, i.content_hash, i.scan_state, i.scan_findings
         FROM import_item i WHERE ${where.length > 0 ? where.join(' AND ') : '1 = 1'}
        ORDER BY i.archive_id, i.item_index`,
      ...params,
    )
    .map((r) => ({
      id: String(r['id']),
      archiveId: String(r['archive_id']),
      batchId: (r['batch_id'] as string | null) ?? null,
      itemIndex: Number(r['item_index']),
      content: String(r['content']),
      contentHash: String(r['content_hash']),
      scanState: String(r['scan_state']),
      scanFindings: (r['scan_findings'] as string | null) ?? null,
    }));
}

function loadMemoryCorpus(store: CairnStore): MemoryCorpusEntry[] {
  return store.db
    .all("SELECT id, content, content_hash, status, scope_id, kind FROM memory WHERE status IN ('active','candidate','conflicted')")
    .map((r) => {
      const content = String(r['content']);
      return {
        id: String(r['id']),
        content,
        contentHash: String(r['content_hash']),
        status: String(r['status']),
        scopeId: String(r['scope_id']),
        kind: String(r['kind']),
        trigrams: trigramsOf(content),
        tokens: tokensOf(content),
        numbers: numbersOf(content),
      };
    });
}

function suggestForItem(item: CandidateItem, memories: MemoryCorpusEntry[]): Suggestion {
  const base = {
    itemId: item.id,
    batchId: item.batchId,
    archiveId: item.archiveId,
    itemIndex: item.itemIndex,
    targetMemoryId: null as string | null,
    scanState: item.scanState,
  };

  // S-BLOCKED：扫描已判定，不给"再想想"的余地。
  if (item.scanState === 'blocked') {
    return {
      ...base,
      action: 'skip',
      ruleId: 'S-BLOCKED',
      reason: '导入扫描判定为含秘密或注入文本，正文已在导入时丢弃，不可晋升',
      basis: [
        { key: 'scan_state', value: item.scanState },
        { key: 'findings', value: summarizeFindings(item.scanFindings) },
        { key: 'content_length', value: item.content.length, note: '库中仅存占位符' },
      ],
      confidence: 'high',
    };
  }

  const compact = item.content.replace(/\s+/g, '');
  if (compact.length === 0) {
    return {
      ...base,
      action: 'skip',
      ruleId: 'S-FRAGMENT',
      reason: '空白条目，没有可提取的信息',
      basis: [{ key: 'stripped_length', value: 0 }],
      confidence: 'high',
    };
  }

  // S-DUP-EXACT：哈希相等，无需相似度。
  const exact = memories.find((m) => m.contentHash === item.contentHash);
  if (exact) {
    return {
      ...base,
      action: 'merge',
      ruleId: 'S-DUP-EXACT',
      reason: '与既有记忆内容完全一致（哈希相等）',
      targetMemoryId: exact.id,
      basis: [
        { key: 'content_hash', value: item.contentHash.slice(0, 12) },
        { key: 'target_status', value: exact.status },
        { key: 'target_kind', value: exact.kind },
      ],
      confidence: 'high',
    };
  }

  // S-FRONTMATTER：只剩 YAML frontmatter 或标题行，没有正文价值。
  const bodyAfterFrontmatter = stripFrontmatter(item.content).trim();
  const meaningfulLines = bodyAfterFrontmatter
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !/^#{1,6}\s/.test(l) && !/^[-*_]{3,}$/.test(l) && !/^[a-zA-Z0-9_-]+:\s*$/.test(l));
  if (meaningfulLines.length === 0) {
    return {
      ...base,
      action: 'skip',
      ruleId: 'S-FRONTMATTER',
      reason: '内容只有 frontmatter 与标题，没有实质正文',
      basis: [
        { key: 'raw_length', value: item.content.length },
        { key: 'meaningful_lines', value: meaningfulLines.length },
        { key: 'after_frontmatter_length', value: bodyAfterFrontmatter.length },
      ],
      confidence: 'medium',
    };
  }

  // S-FRAGMENT：过短、不含数字、且不是列表项，通常是文件名或半句话。
  const isListItem = /^\s*(?:[-*+]|\d+[.)])\s+/.test(item.content.trim());
  const hasDigit = /\d/.test(item.content);
  if (compact.length < FRAGMENT_LIMIT && !isListItem && !hasDigit) {
    return {
      ...base,
      action: 'skip',
      ruleId: 'S-FRAGMENT',
      reason: `去空白后仅 ${compact.length} 字符、不含数字，且不是列表项`,
      basis: [
        { key: 'stripped_length', value: compact.length },
        { key: 'threshold', value: FRAGMENT_LIMIT },
        { key: 'has_digit', value: 0 },
        { key: 'is_list_item', value: isListItem ? 1 : 0 },
      ],
      confidence: 'medium',
    };
  }

  // 先算近邻：冲突判定与近似重复判定共用同一次 trigram 计算。
  const itemTrigrams = trigramsOf(item.content);
  const itemTokens = tokensOf(item.content);
  const itemNumbers = numbersOf(item.content);
  let best: { mem: MemoryCorpusEntry; score: number } | null = null;
  for (const m of memories) {
    const score = jaccard(itemTrigrams, m.trigrams);
    if (best == null || score > best.score) best = { mem: m, score };
  }

  // S-NUMERIC-CONFLICT 必须排在 S-DUP-NEAR 之前：
  // 两段文本几乎相同但数值不同时，那是"改了口径"或"记错了"，不是"重复"。
  // 若先判重复去合并，就会把错误的那组数值静默覆盖掉——这正是最不该自动化的事。
  const sharedTok = best != null ? intersect(itemTokens, best.mem.tokens) : [];
  if (best != null && best.score >= CONFLICT_MIN_JACCARD && sharedTok.length >= 3) {
    const numbersDisjoint = disjoint(itemNumbers, best.mem.numbers);
    if (numbersDisjoint && itemNumbers.size > 0 && best.mem.numbers.size > 0) {
      return {
        ...base,
        action: 'needs_human',
        ruleId: 'S-NUMERIC-CONFLICT',
        reason: '与既有记忆共享多个关键词，但数值集合完全不相交，可能是口径变更或记录错误',
        targetMemoryId: best.mem.id,
        basis: [
          { key: 'shared_tokens', value: sharedTok.slice(0, 5).join('|') },
          { key: 'shared_token_count', value: sharedTok.length },
          { key: 'item_numbers', value: [...itemNumbers].slice(0, 8).join(',') },
          { key: 'target_numbers', value: [...best.mem.numbers].slice(0, 8).join(',') },
          { key: 'jaccard', value: Number(best.score.toFixed(3)) },
          { key: 'min_jaccard', value: CONFLICT_MIN_JACCARD },
        ],
        confidence: 'low',
      };
    }
  }

  // S-DUP-NEAR：trigram Jaccard 相似度。
  if (best != null && best.score >= NEAR_DUP_THRESHOLD) {
    return {
      ...base,
      action: 'merge',
      ruleId: 'S-DUP-NEAR',
      reason: `与既有记忆高度相似（trigram Jaccard ${best.score.toFixed(2)}）`,
      targetMemoryId: best.mem.id,
      basis: [
        { key: 'jaccard', value: Number(best.score.toFixed(3)) },
        { key: 'threshold', value: NEAR_DUP_THRESHOLD },
        { key: 'shared_trigrams', value: intersectSize(itemTrigrams, best.mem.trigrams) },
        { key: 'item_trigrams', value: itemTrigrams.size },
        { key: 'target_trigrams', value: best.mem.trigrams.size },
      ],
      confidence: best.score >= 0.92 ? 'high' : 'medium',
    };
  }

  // S-CODE-HEAVY：代码片段本身有保留价值，且比自然语言记忆更少歧义。
  const ratio = codeLineRatio(item.content);
  if (ratio > CODE_HEAVY_RATIO) {
    return {
      ...base,
      action: 'promote',
      ruleId: 'S-CODE-HEAVY',
      reason: '以代码行为主，可直接晋升为 procedure/fact 记忆',
      basis: [
        { key: 'code_line_ratio', value: Number(ratio.toFixed(3)) },
        { key: 'threshold', value: CODE_HEAVY_RATIO },
        { key: 'stripped_length', value: compact.length },
      ],
      confidence: 'medium',
    };
  }

  return {
    ...base,
    action: 'promote',
    ruleId: 'S-CLEAN-DEFAULT',
    reason: '扫描干净、无重复、无冲突、非碎片，默认建议晋升',
    basis: [
      { key: 'stripped_length', value: compact.length },
      { key: 'best_jaccard', value: best == null ? 0 : Number(best.score.toFixed(3)) },
      { key: 'near_dup_threshold', value: NEAR_DUP_THRESHOLD },
      { key: 'scan_state', value: item.scanState },
    ],
    confidence: 'medium',
  };
}

// ---------------------------------------------------------------------------
// 待处理队列（跨批次聚合）
// ---------------------------------------------------------------------------

export type InboxKind = 'item' | 'plan' | 'conflict' | 'outbox';

export interface InboxEntry {
  kind: InboxKind;
  id: string;
  /** 数值越小越靠前。 */
  priority: number;
  title: string;
  detail: string;
  batchId: string | null;
  itemId: string | null;
  planId: string | null;
  action: SuggestedAction | null;
  /** true = 必须人做判断；false = 规则已能定，只需批量确认。 */
  decisionRequired: boolean;
  actions: string[];
  suggestion?: Suggestion;
  ruleLayer?: { action: SuggestedAction; ruleId: string; reason: string };
  aiLayer?: { action: SuggestedAction; reason: string; producer: string; stale: boolean; model: string | null } | null;
  conflict: boolean;
}

export interface Inbox {
  generatedAt: string;
  counts: { byKind: Record<string, number>; byAction: Record<string, number>; decisionRequired: number; bulkConfirmable: number };
  total: number;
  shown: number;
  entries: InboxEntry[];
}

export function computeInbox(
  store: CairnStore,
  opts: { redact?: boolean; limit?: number; aiReviews?: Map<string, { action: SuggestedAction; reason: string; producer: string; stale: boolean; model: string | null }> } = {},
): Inbox {
  const limit = opts.limit ?? 100;
  const suggestions = computeSuggestions(store, {});
  const aiIndex = opts.aiReviews ?? new Map();
  const entries: InboxEntry[] = [];

  for (const s of suggestions.items) {
    const ai = aiIndex.get(s.itemId) ?? null;
    entries.push({
      kind: 'item',
      id: s.itemId,
      priority: ACTION_ORDER[s.action],
      title: itemTitle(store, s),
      detail: s.reason,
      batchId: s.batchId,
      itemId: s.itemId,
      planId: null,
      action: s.action,
      decisionRequired: s.action === 'needs_human' || s.action === 'merge' || (ai != null && ai.action !== s.action),
      actions: s.action === 'skip' ? ['skip'] : ['promote', 'merge', 'keep_both', 'skip'],
      suggestion: s,
      ruleLayer: { action: s.action, ruleId: s.ruleId, reason: s.reason },
      aiLayer: ai,
      conflict: ai != null && ai.action !== s.action,
    });
  }

  const planRows = store.db.all(
    "SELECT id, status, plan_hash, item_count, created_at, expires_at FROM onboarding_plan WHERE status IN ('awaiting_approval','approved','draft') ORDER BY created_at DESC",
  );
  for (const p of planRows) {
    const status = String(p['status']);
    entries.push({
      kind: 'plan',
      id: String(p['id']),
      // 待批准的计划比单条条目更值得先处理：它挡着一整批。
      priority: status === 'approved' ? 1 : 0,
      title: `计划 ${String(p['plan_hash']).slice(0, 8)} · ${Number(p['item_count'])} 项`,
      detail:
        status === 'approved'
          ? '已签发审批，等待应用'
          : status === 'draft'
            ? '草稿状态，需要完善后才能批准'
            : `等待签发审批（${String(p['expires_at'])} 前有效）`,
      batchId: null,
      itemId: null,
      planId: String(p['id']),
      action: 'needs_human',
      decisionRequired: true,
      actions: status === 'approved' ? ['apply'] : status === 'awaiting_approval' ? ['approve'] : [],
      conflict: false,
    });
  }

  for (const c of store.db.all("SELECT id, memory_id, detected_at FROM conflict WHERE status = 'open' ORDER BY detected_at DESC")) {
    entries.push({
      kind: 'conflict',
      id: String(c['id']),
      priority: 0,
      title: `未解决冲突 · 记忆 ${String(c['memory_id']).slice(0, 8)}`,
      detail: `检测于 ${String(c['detected_at'])}；两版证据都保留，需要人裁定保留哪一版`,
      batchId: null,
      itemId: null,
      planId: null,
      action: 'needs_human',
      decisionRequired: true,
      actions: ['open'],
      conflict: false,
    });
  }

  for (const o of store.db.all(
    "SELECT id, job_type, entity_id, status, attempts FROM outbox_job WHERE status IN ('pending','retry','dead') ORDER BY created_at LIMIT 50",
  )) {
    const status = String(o['status']);
    entries.push({
      kind: 'outbox',
      id: String(o['id']),
      priority: status === 'dead' ? 0 : 2,
      title: `待上行 ${String(o['job_type'])} · ${String(o['entity_id']).slice(0, 8)}`,
      detail: status === 'dead' ? `已放弃（尝试 ${Number(o['attempts'])} 次），需要人工决定重试或丢弃` : `状态 ${status}，等待一次 cairn worker 或 sync push`,
      batchId: null,
      itemId: null,
      planId: null,
      action: status === 'dead' ? 'needs_human' : 'promote',
      decisionRequired: status === 'dead',
      actions: ['sync'],
      conflict: false,
    });
  }

  entries.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
    return a.id.localeCompare(b.id);
  });

  const byKind: Record<string, number> = {};
  const byAction: Record<string, number> = {};
  let decisionRequired = 0;
  for (const e of entries) {
    byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
    if (e.action != null) byAction[e.action] = (byAction[e.action] ?? 0) + 1;
    if (e.decisionRequired) decisionRequired++;
  }
  return {
    generatedAt: nowIso(),
    counts: { byKind, byAction, decisionRequired, bulkConfirmable: entries.length - decisionRequired },
    total: entries.length,
    shown: Math.min(limit, entries.length),
    entries: entries.slice(0, limit),
  };
}

function itemTitle(store: CairnStore, s: Suggestion): string {
  const label = store.db.get(
    `SELECT a.source_label AS lab FROM import_archive a JOIN import_item i ON i.archive_id = a.id WHERE i.id = ?`,
    s.itemId,
  );
  const raw = label == null ? null : (label['lab'] as string | null);
  const name = raw == null ? '未知来源' : raw.split(/[\\/]/).pop() ?? raw;
  return `${name} · 第 ${s.itemIndex + 1} 条`;
}

// ---------------------------------------------------------------------------
// 文本工具（纯函数，无外部依赖）
// ---------------------------------------------------------------------------

function stripFrontmatter(text: string): string {
  if (!text.startsWith('---')) return text;
  const end = text.indexOf('\n---', 3);
  if (end < 0) return text;
  const after = text.indexOf('\n', end + 4);
  return after < 0 ? '' : text.slice(after + 1);
}

function trigramsOf(text: string): Set<string> {
  const s = normalizeForCompare(text).slice(0, MAX_COMPARE_CHARS);
  const out = new Set<string>();
  if (s.length <= 3) {
    if (s.length > 0) out.add(s);
    return out;
  }
  for (let i = 0; i + 3 <= s.length; i++) out.add(s.slice(i, i + 3));
  return out;
}

function normalizeForCompare(text: string): string {
  return text
    .toLowerCase()
    .replace(/^---[\s\S]*?\n---\n?/, '')
    .replace(/[#>*_`~\-|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokensOf(text: string): Set<string> {
  const s = normalizeForCompare(text).slice(0, MAX_COMPARE_CHARS);
  const out = new Set<string>();
  for (const w of s.match(/[a-z][a-z0-9_.-]{2,}/g) ?? []) out.add(w);
  const cjk = s.replace(/[^\u4e00-\u9fff]/g, '');
  for (let i = 0; i + 2 <= cjk.length; i += 2) out.add(cjk.slice(i, i + 2));
  return out;
}

function numbersOf(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.match(/-?\d+(?:\.\d+)?/g) ?? []) out.add(m);
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const x of small) if (large.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function intersectSize(a: Set<string>, b: Set<string>): number {
  let n = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const x of small) if (large.has(x)) n++;
  return n;
}

function intersect(a: Set<string>, b: Set<string>): string[] {
  const out: string[] = [];
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const x of small) if (large.has(x)) out.push(x);
  return out.sort();
}

function disjoint(a: Set<string>, b: Set<string>): boolean {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const x of small) if (large.has(x)) return false;
  return true;
}

function codeLineRatio(text: string): number {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) return 0;
  let code = 0;
  for (const l of lines) {
    if (/^(?:const|let|var|function|class|import|export|def|fn|pub|if|for|while|return|try|catch)\b/.test(l)) code++;
    else if (/[{};]$/.test(l)) code++;
    else if (/^\s*[$>#]\s+\w/.test(l)) code++;
    else if (/=>|::|&&|\|\||\w+\([^)]*\);/.test(l)) code++;
  }
  return code / lines.length;
}

function summarizeFindings(raw: string | null): string {
  if (raw == null || raw.length === 0) return 'unknown';
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      const kinds = parsed.map((p) => (typeof p === 'object' && p != null ? String((p as Record<string, unknown>)['kind'] ?? (p as Record<string, unknown>)['rule'] ?? '?') : String(p)));
      return [...new Set(kinds)].join(',') || 'unknown';
    }
    return 'recorded';
  } catch {
    return 'recorded';
  }
}

export { ACTION_ORDER };
