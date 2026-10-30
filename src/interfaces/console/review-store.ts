import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CairnStore } from '../../store/open.js';
import { err } from '../../core/errors.js';
import { nowIso } from '../../core/time.js';
import { scanText } from '../../core/secrets.js';
import { computeSuggestions, ENGINE_VERSION, SuggestedAction } from './suggestions.js';
import { promotedPredicate } from '../../onboarding/batches.js';

/**
 * AI 层建议的落盘与回填（design D4 第二层、任务 3.x）。
 *
 * 为什么不是数据库表：
 * 加表要把 user_version 推到 3，而 migrate 的保护会让**旧版 cairn 直接拒绝打开
 * 高版本库**——回滚就从"删一个目录"退化成"恢复备份"。建议是派生数据，
 * 丢了可以重算，不值得为它付这个代价。所以落在 `<home>/console/ai-reviews.json`。
 *
 * 为什么控制台自己不调模型：
 * 一旦控制台调模型，就得在本机存模型凭据、把记忆正文发出去，而用户再也说不清
 * "谁读过我的记忆"。走 `pack → Agent 会话 → submit` 三段，天然继承既有的
 * 授权边界：正文只在用户主动发起的会话里流动。
 */

export const REVIEWS_FILE = 'ai-reviews.json';
export const REVIEWS_VERSION = 1;
export const DEFAULT_PACK_CHARS = 1200;

const ACTIONS: SuggestedAction[] = ['promote', 'merge', 'keep_both', 'skip', 'needs_human'];

export interface AiReviewRecord {
  itemId: string;
  batchId: string | null;
  archiveId: string;
  action: SuggestedAction;
  reason: string;
  targetMemoryId: string | null;
  /**
   * AI 自评置信度。缺失（旧文件）按 low 处理——"没声明"不等于"有把握"，
   * 否则策略的 minConfidence 门槛会被历史数据无声放宽。
   */
  confidence: 'high' | 'medium' | 'low';
  producer: string;
  model: string | null;
  runId: string;
  createdAt: string;
  /** 写入当时的条目内容哈希与扫描状态，用于判定陈旧。 */
  itemContentHash: string;
  scanStateAtSubmit: string;
  supersededAt: string | null;
}

export interface AiReviewView extends AiReviewRecord {
  /** 条目内容或扫描状态已变，此建议不再适用于当前内容。 */
  stale: boolean;
  staleReason: string | null;
}

interface ReviewsFile {
  version: number;
  updatedAt: string;
  engineVersion: string;
  items: Record<string, AiReviewRecord>;
}

export function reviewsPath(home: string): string {
  return join(home, 'console', REVIEWS_FILE);
}

function emptyFile(): ReviewsFile {
  return { version: REVIEWS_VERSION, updatedAt: nowIso(), engineVersion: ENGINE_VERSION, items: {} };
}

export function loadReviewsFile(home: string): ReviewsFile {
  const p = reviewsPath(home);
  if (!existsSync(p)) return emptyFile();
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8')) as Partial<ReviewsFile>;
    if (parsed == null || typeof parsed !== 'object' || typeof parsed.items !== 'object' || parsed.items == null) {
      return emptyFile();
    }
    return {
      version: Number(parsed.version ?? REVIEWS_VERSION),
      updatedAt: String(parsed.updatedAt ?? nowIso()),
      engineVersion: String(parsed.engineVersion ?? ENGINE_VERSION),
      items: parsed.items as Record<string, AiReviewRecord>,
    };
  } catch {
    // 文件损坏不阻塞控制台：建议是派生数据，读不出来就当作没有，用户可重跑。
    return emptyFile();
  }
}

/** 原子写入：临时文件 + rename（同目录保证同一卷）。失败重试一次以避开 Windows 句柄抖动。 */
function saveReviewsFile(home: string, data: ReviewsFile): void {
  const p = reviewsPath(home);
  mkdirSync(join(home, 'console'), { recursive: true });
  const tmp = `${p}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      renameSync(tmp, p);
      return;
    } catch (e) {
      lastError = e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30);
    }
  }
  try {
    rmSync(tmp, { force: true });
  } catch {
    /* ignore */
  }
  throw err('E_IO', `写入 AI 建议文件失败: ${(lastError as Error)?.message ?? '未知错误'}`);
}

export interface ReviewsQuery {
  batchId?: string;
  itemId?: string;
}

/** 读取 AI 建议并就地判定陈旧（对比当前条目的 content_hash 与 scan_state）。 */
export function readReviews(store: CairnStore, query: ReviewsQuery = {}): AiReviewView[] {
  const file = loadReviewsFile(store.paths.home);
  const out: AiReviewView[] = [];
  for (const raw of Object.values(file.items)) {
    const rec: AiReviewRecord = {
      ...raw,
      confidence: (REVIEW_CONFIDENCES as readonly string[]).includes(String(raw.confidence))
        ? (raw.confidence as 'high' | 'medium' | 'low')
        : 'low',
    };
    if (query.itemId != null && rec.itemId !== query.itemId) continue;
    if (query.batchId != null && rec.batchId !== query.batchId) continue;
    if (rec.supersededAt != null) continue;
    const current = store.db.get('SELECT content_hash, scan_state, batch_id FROM import_item WHERE id = ?', rec.itemId);
    if (current == null) {
      out.push({ ...rec, stale: true, staleReason: '条目已不存在' });
      continue;
    }
    const hashNow = String(current['content_hash']);
    const scanNow = String(current['scan_state']);
    let staleReason: string | null = null;
    if (hashNow !== rec.itemContentHash) staleReason = '条目内容已变化';
    else if (scanNow !== rec.scanStateAtSubmit) staleReason = `扫描状态由 ${rec.scanStateAtSubmit} 变为 ${scanNow}`;
    out.push({ ...rec, stale: staleReason != null, staleReason });
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/** 供 inbox/队列使用的索引：只取未陈旧的一条，同 itemId 取最新。 */
export function readReviewsIndex(store: CairnStore): Map<string, AiReviewView> {
  const map = new Map<string, AiReviewView>();
  for (const r of readReviews(store)) {
    if (r.stale) continue;
    if (!map.has(r.itemId)) map.set(r.itemId, r);
  }
  return map;
}

// ---------------------------------------------------------------------------
// 3.1 复核包
// ---------------------------------------------------------------------------

export interface ReviewPackItem {
  itemId: string;
  archiveId: string;
  batchId: string | null;
  itemIndex: number;
  content: string;
  truncated: boolean;
  rule: { action: SuggestedAction; ruleId: string; reason: string; targetMemoryId: string | null; basis: { key: string; value: string | number }[] };
  expected: { actions: SuggestedAction[]; mustReturn: string[] };
}

export interface ReviewPack {
  runId: string;
  createdAt: string;
  engineVersion: string;
  batchId: string;
  scope: string;
  itemCount: number;
  totalChars: number;
  maxCharsPerItem: number;
  schema: Record<string, unknown>;
  items: ReviewPackItem[];
}

export interface ReviewPackResult {
  runId: string;
  outFile: string;
  itemCount: number;
  totalChars: number;
  maxCharsPerItem: number;
  truncatedItems: number;
  /** 每个条目都带了规则层结论——调用方无需再去查库。 */
  note: string;
}

export function buildReviewPack(
  store: CairnStore,
  input: { batchId?: string; maxCharsPerItem?: number } = {},
): ReviewPack {
  const maxChars = Math.max(200, input.maxCharsPerItem ?? DEFAULT_PACK_CHARS);
  const batchId = input.batchId ?? pickBatch(store);
  const suggestions = computeSuggestions(store, { batchId });
  const items: ReviewPackItem[] = [];
  let totalChars = 0;
  for (const s of suggestions.items) {
    if (s.action === 'skip') continue; // 规则层已判定跳过的条目不需要 AI 再判一次
    const row = store.db.get('SELECT content, item_index, archive_id FROM import_item WHERE id = ?', s.itemId);
    if (row == null) continue;
    const full = String(row['content']);
    const content = full.length > maxChars ? full.slice(0, maxChars) : full;
    totalChars += content.length;
    items.push({
      itemId: s.itemId,
      archiveId: s.archiveId,
      batchId: s.batchId,
      itemIndex: Number(row['item_index']),
      content,
      truncated: full.length > maxChars,
      rule: {
        action: s.action,
        ruleId: s.ruleId,
        reason: s.reason,
        targetMemoryId: s.targetMemoryId,
        basis: s.basis.map((b) => ({ key: b.key, value: b.value })),
      },
      expected: { actions: ACTIONS, mustReturn: ['itemId', 'action', 'reason'] },
    });
  }
  return {
    runId: `pack_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    createdAt: nowIso(),
    engineVersion: ENGINE_VERSION,
    batchId,
    scope: '个人全局（personal-global）',
    itemCount: items.length,
    totalChars,
    maxCharsPerItem: maxChars,
    schema: {
      type: 'object',
      required: ['runId', 'items'],
      properties: {
        runId: { type: 'string' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            required: ['itemId', 'action', 'reason'],
            properties: {
              itemId: { type: 'string' },
              action: { enum: ACTIONS },
              reason: { type: 'string', minLength: 1, maxLength: 500 },
              targetMemoryId: { type: ['string', 'null'] },
            },
          },
        },
      },
    },
    items,
  };
}

/** 写复核包到 <home>/console/，返回路径与规模（用于 stdout 告知用户发了多少内容）。 */
export function reviewPackForBatch(
  store: CairnStore,
  input: { batchId?: string; outFile?: string; maxCharsPerItem?: number } = {},
): ReviewPackResult {
  const pack = buildReviewPack(store, { batchId: input.batchId, maxCharsPerItem: input.maxCharsPerItem });
  const outFile =
    input.outFile ??
    join(store.paths.home, 'console', `review-pack-${pack.batchId.slice(0, 8)}-${Date.now()}.json`);
  mkdirSync(join(store.paths.home, 'console'), { recursive: true });
  writeFileSync(outFile, JSON.stringify(pack, null, 2), 'utf8');
  store.audit.record('review', 'pack_generated', { type: 'system', id: pack.runId }, {
    batchId: pack.batchId,
    itemCount: pack.itemCount,
    totalChars: pack.totalChars,
  });
  return {
    runId: pack.runId,
    outFile,
    itemCount: pack.itemCount,
    totalChars: pack.totalChars,
    maxCharsPerItem: pack.maxCharsPerItem,
    truncatedItems: pack.items.filter((i) => i.truncated).length,
    note: `复核包含 ${pack.itemCount} 条待判断内容、共 ${pack.totalChars} 字符；把它交给 Agent 会话逐条判断，再用 cairn review submit 写回。`,
  };
}

function pickBatch(store: CairnStore): string {
  const row = store.db.get(
    `SELECT i.batch_id AS bid, COUNT(*) AS n FROM import_item i
      WHERE i.scan_state = 'clean' AND i.batch_id IS NOT NULL
        AND ${promotedPredicate('i').notExists}
      GROUP BY i.batch_id ORDER BY n DESC LIMIT 1`,
  );
  if (row == null) throw err('E_VALIDATION', '没有待整理的批次：请先 cairn import');
  return String(row['bid']);
}

// ---------------------------------------------------------------------------
// 3.3/3.4 写回与整批校验
// ---------------------------------------------------------------------------

export interface SubmitItemInput {
  itemId?: unknown;
  action?: unknown;
  reason?: unknown;
  targetMemoryId?: unknown;
  confidence?: unknown;
}

const REVIEW_CONFIDENCES = ['high', 'medium', 'low'] as const;

export interface SubmitResult {
  runId: string;
  accepted: number;
  overwritten: number;
  items: { itemId: string; action: SuggestedAction; overwrote: boolean }[];
}

/**
 * 回填 AI 层建议。**任一条不合法即整批拒绝**——部分写入会让"这批到底判了哪些"
 * 变得说不清，而这正是复核环节最需要说清的事。
 */
export function reviewSubmit(
  store: CairnStore,
  input: { items: unknown[]; producer: string; model?: string | null; runId?: string },
): SubmitResult {
  store.assertWritable();
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw err('E_VALIDATION', 'items 必须是非空数组');
  }
  const runId = input.runId ?? `sub_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  const problems: { index: number; code: string; message: string }[] = [];
  const prepared: AiReviewRecord[] = [];
  const seen = new Set<string>();

  input.items.forEach((raw, index) => {
    const item = (raw ?? {}) as SubmitItemInput;
    const itemId = typeof item.itemId === 'string' ? item.itemId.trim() : '';
    if (itemId.length === 0) {
      problems.push({ index, code: 'E_VALIDATION', message: 'itemId 不能为空' });
      return;
    }
    if (seen.has(itemId)) {
      problems.push({ index, code: 'E_VALIDATION', message: `itemId 重复: ${itemId}` });
      return;
    }
    seen.add(itemId);

    const row = store.db.get(
      'SELECT i.id, i.batch_id, i.archive_id, i.content_hash, i.scan_state FROM import_item i WHERE i.id = ?',
      itemId,
    );
    if (row == null) {
      problems.push({ index, code: 'E_NOT_FOUND', message: `条目不存在: ${itemId}` });
      return;
    }
    if (String(row['scan_state']) === 'blocked') {
      problems.push({ index, code: 'E_FORBIDDEN', message: `条目 ${itemId} 已被扫描阻断，不接受 AI 建议` });
      return;
    }
    const action = typeof item.action === 'string' ? item.action : '';
    if (!ACTIONS.includes(action as SuggestedAction)) {
      problems.push({ index, code: 'E_VALIDATION', message: `action 非法: ${action || '(空)'}（允许 ${ACTIONS.join('|')}）` });
      return;
    }
    const reason = typeof item.reason === 'string' ? item.reason.trim() : '';
    if (reason.length === 0) {
      problems.push({ index, code: 'E_VALIDATION', message: `理由不能为空（itemId ${itemId}）` });
      return;
    }
    if (reason.length > 500) {
      problems.push({ index, code: 'E_VALIDATION', message: `理由过长（${reason.length} > 500 字符）` });
      return;
    }
    // 秘密/注入复检：建议文本会进 UI 与审计，不能成为把秘密搬出新位置的通道。
    const scan = scanText(reason);
    if (!scan.clean) {
      problems.push({
        index,
        code: 'E_SECRET_DETECTED',
        message: '理由文本包含疑似秘密或注入内容，已拒绝（不回显原文）',
      });
      return;
    }
    let confidence: 'high' | 'medium' | 'low' = 'low';
    if (item.confidence != null) {
      if (typeof item.confidence !== 'string' || !(REVIEW_CONFIDENCES as readonly string[]).includes(item.confidence)) {
        problems.push({
          index,
          code: 'E_VALIDATION',
          message: `confidence 非法: ${String(item.confidence)}（允许 ${REVIEW_CONFIDENCES.join('|')}）`,
        });
        return;
      }
      confidence = item.confidence as 'high' | 'medium' | 'low';
    }
    const targetMemoryId = typeof item.targetMemoryId === 'string' && item.targetMemoryId.length > 0 ? item.targetMemoryId : null;
    if (action === 'merge' || action === 'keep_both') {
      if (targetMemoryId == null) {
        problems.push({ index, code: 'E_VALIDATION', message: `${action} 需要 targetMemoryId` });
        return;
      }
      const target = store.db.get('SELECT id FROM memory WHERE id = ?', targetMemoryId);
      if (target == null) {
        problems.push({ index, code: 'E_NOT_FOUND', message: `目标记忆不存在: ${targetMemoryId}` });
        return;
      }
    }
    prepared.push({
      itemId,
      batchId: (row['batch_id'] as string | null) ?? null,
      archiveId: String(row['archive_id']),
      action: action as SuggestedAction,
      reason,
      targetMemoryId,
      confidence,
      producer: input.producer,
      model: input.model ?? null,
      runId,
      createdAt: nowIso(),
      itemContentHash: String(row['content_hash']),
      scanStateAtSubmit: String(row['scan_state']),
      supersededAt: null,
    });
  });

  if (problems.length > 0) {
    throw err('E_VALIDATION', `整批拒绝：${problems.length} 条不合法，未写入任何建议`, { problems });
  }

  const file = loadReviewsFile(store.paths.home);
  const overwrittenIds = new Set<string>();
  for (const rec of prepared) {
    if (file.items[rec.itemId] != null) overwrittenIds.add(rec.itemId);
    file.items[rec.itemId] = rec;
  }
  file.updatedAt = nowIso();
  file.engineVersion = ENGINE_VERSION;
  saveReviewsFile(store.paths.home, file);
  store.audit.record('review', 'ai_reviews_submitted', { type: 'system', id: runId }, {
    accepted: prepared.length,
    overwritten: overwrittenIds.size,
    producer: input.producer,
    model: input.model ?? null,
  });
  return {
    runId,
    accepted: prepared.length,
    overwritten: overwrittenIds.size,
    items: prepared.map((p) => ({ itemId: p.itemId, action: p.action, overwrote: overwrittenIds.has(p.itemId) })),
  };
}
