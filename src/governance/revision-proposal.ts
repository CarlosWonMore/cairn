import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CairnStore } from '../store/open.js';
import { err } from '../core/errors.js';
import { nowIso } from '../core/time.js';
import { scanText } from '../core/secrets.js';

/**
 * 修订提案（方案卡，OpenSpec: add-agent-managed-revision）。
 *
 * 核心边界（design D1）：Agent 拿提案权，人拿写入权。本文件**从不写 memory / memory_revision /
 * outbox**——它只读写 `<home>/console/revision-proposals.json` 这份派生数据。
 * 应用（改记忆）只发生在 CLI 与本地控制台，走既有的 reviseMemory（不可变修订链 + 秘密复检 + 审计），
 * 不在这里新造写入路径（D2）。
 *
 * 新鲜度（D3）：卡片记提出时的 currentRevisionId，应用时对比，不一致拒绝并标 stale——
 * 与 reviseMemory 的 expectedCurrentRevisionId 是同一套乐观锁语义，不另造一份。
 *
 * 秘密在生成时就扫（D6）：卡片要落盘给人看，等应用才查等于已经泄露。
 */

export const REVISIONS_FILE = 'revision-proposals.json';
export const REVISIONS_VERSION = 1;

export const REVISION_STATUSES = ['pending', 'applied', 'rejected', 'stale'] as const;
export type RevisionStatus = (typeof REVISION_STATUSES)[number];

export interface RevisionProposalRecord {
  id: string;
  memoryId: string;
  /** 提出时的当前修订 id；应用前用它判陈旧（与 expectedCurrentRevisionId 同语义）。 */
  revisionIdAtPropose: string | null;
  /** 关联批注（软引用，可选；批注可能已被处置，不校验存在性）。 */
  annotationId: string | null;
  /** 改前摘要（首行截断；sensitive / tombstoned 记忆不给摘要）。改后永远是完整正文。 */
  beforeExcerpt: string | null;
  /** 拟改后的完整正文。 */
  afterContent: string;
  reason: string;
  proposedBy: string;
  proposedAt: string;
  status: RevisionStatus;
  resolvedAt: string | null;
  resolvedBy: string | null;
  rejectReason: string | null;
}

export interface RevisionProposalView extends RevisionProposalRecord {
  /** 展示时判定：记忆的当前修订已不是提出时的那一份。 */
  stale: boolean;
  memoryStatus: string | null;
  memoryExists: boolean;
}

export interface RevisionQuery {
  status?: string;
  memoryId?: string;
  limit?: number;
}

interface RevisionsFile {
  version: number;
  updatedAt: string;
  items: RevisionProposalRecord[];
}

export function revisionsPath(home: string): string {
  return join(home, 'console', REVISIONS_FILE);
}

function emptyFile(): RevisionsFile {
  return { version: REVISIONS_VERSION, updatedAt: nowIso(), items: [] };
}

function isStatus(v: unknown): v is RevisionStatus {
  return typeof v === 'string' && (REVISION_STATUSES as readonly string[]).includes(v);
}

function normalizeRecord(raw: unknown): RevisionProposalRecord | null {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' ? r.id : '';
  const memoryId = typeof r.memoryId === 'string' ? r.memoryId : '';
  const afterContent = typeof r.afterContent === 'string' ? r.afterContent : '';
  if (id.length === 0 || memoryId.length === 0 || afterContent.length === 0) return null;
  return {
    id,
    memoryId,
    revisionIdAtPropose: typeof r.revisionIdAtPropose === 'string' ? r.revisionIdAtPropose : null,
    annotationId: typeof r.annotationId === 'string' ? r.annotationId : null,
    beforeExcerpt: typeof r.beforeExcerpt === 'string' ? r.beforeExcerpt : null,
    afterContent,
    reason: typeof r.reason === 'string' ? r.reason : '',
    proposedBy: typeof r.proposedBy === 'string' ? r.proposedBy : 'unknown',
    proposedAt: typeof r.proposedAt === 'string' ? r.proposedAt : nowIso(),
    status: isStatus(r.status) ? r.status : 'pending',
    resolvedAt: typeof r.resolvedAt === 'string' ? r.resolvedAt : null,
    resolvedBy: typeof r.resolvedBy === 'string' ? r.resolvedBy : null,
    rejectReason: typeof r.rejectReason === 'string' ? r.rejectReason : null,
  };
}

/** 坏文件按空处理：提案是派生数据，读不出来不阻塞控制台。 */
export function loadRevisionsFile(home: string): RevisionsFile {
  const p = revisionsPath(home);
  if (!existsSync(p)) return emptyFile();
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8')) as Partial<RevisionsFile>;
    if (parsed == null || typeof parsed !== 'object' || !Array.isArray(parsed.items)) return emptyFile();
    const items: RevisionProposalRecord[] = [];
    for (const raw of parsed.items) {
      const rec = normalizeRecord(raw);
      if (rec != null) items.push(rec);
    }
    return {
      version: Number(parsed.version ?? REVISIONS_VERSION),
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : nowIso(),
      items,
    };
  } catch {
    return emptyFile();
  }
}

/** 原子写入：临时文件 + rename（与 annotations.ts 同姿势，避开 Windows 句柄抖动）。 */
function saveRevisionsFile(home: string, data: RevisionsFile): void {
  const p = revisionsPath(home);
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
  throw err('E_IO', `写入修订提案文件失败: ${(lastError as Error)?.message ?? '未知错误'}`);
}

function excerptOf(row: Record<string, unknown>): string | null {
  if (String(row['sensitivity']) === 'sensitive' || String(row['status']) === 'tombstoned') return null;
  const firstLine = String(row['content']).split('\n')[0]?.trim() ?? '';
  if (firstLine.length === 0) return null;
  return firstLine.length > 80 ? `${firstLine.slice(0, 80)}…` : firstLine;
}

function scanProposalError(scan: ReturnType<typeof scanText>): Error {
  if (scan.findings.length > 0) {
    return err('E_SECRET_DETECTED', '修订提案疑似包含秘密，已拒绝生成（不回显原文）', {
      findings: scan.findings.map((f) => ({ kind: f.kind, masked: f.masked })),
      injectionFindings: scan.injectionFindings.map((f) => ({ kind: f.kind, rule: f.rule })),
    });
  }
  return err('E_INJECTION_SUSPECTED', '修订提案疑似提示注入指令，已拒绝生成', {
    injectionFindings: scan.injectionFindings.map((f) => ({ kind: f.kind, rule: f.rule })),
  });
}

export interface ProposeInput {
  memoryId: string;
  afterContent: string;
  reason: string;
  annotationId?: string;
  proposedBy: string;
}

/**
 * 生成方案卡。只读记忆、只写提案文件：正文/状态/权威/修订数/作用域一个都不碰
 * （spec「生成提案不改记忆」）。afterContent 与 reason 都要过扫描，命中拒绝整条且不落盘。
 */
export function proposeRevision(store: CairnStore, input: ProposeInput): RevisionProposalRecord {
  store.assertWritable();
  const memoryId = input.memoryId.trim();
  if (memoryId.length === 0) throw err('E_VALIDATION', 'memoryId 不能为空');
  const afterContent = input.afterContent.trim();
  if (afterContent.length === 0) throw err('E_VALIDATION', '拟改后的正文不能为空');
  const reason = input.reason.trim();
  if (reason.length === 0) throw err('E_VALIDATION', '改动理由不能为空（人要看懂为什么改）');
  // D6：落盘即可能泄露，所以秘密与注入扫描在生成时就做。
  const scan = scanText(afterContent);
  if (!scan.clean) throw scanProposalError(scan);
  const reasonScan = scanText(reason);
  if (!reasonScan.clean) throw scanProposalError(reasonScan);

  const mem = store.memories.require(memoryId);
  const rec: RevisionProposalRecord = {
    id: `rev_${randomUUID()}`,
    memoryId,
    revisionIdAtPropose: mem.currentRevisionId,
    annotationId: input.annotationId?.trim() || null,
    beforeExcerpt: excerptOf(mem as unknown as Record<string, unknown>),
    afterContent,
    reason,
    proposedBy: input.proposedBy,
    proposedAt: nowIso(),
    status: 'pending',
    resolvedAt: null,
    resolvedBy: null,
    rejectReason: null,
  };
  const file = loadRevisionsFile(store.paths.home);
  file.items.push(rec);
  file.updatedAt = nowIso();
  saveRevisionsFile(store.paths.home, file);
  // 审计只记标识与动作：拟改正文不进审计（摘要纪律）。
  store.audit.record('revision', 'proposed', { type: 'memory', id: memoryId }, {
    proposalId: rec.id,
    annotationId: rec.annotationId,
    proposedBy: rec.proposedBy,
  });
  return rec;
}

/**
 * 读取提案并就地判定陈旧（对比当前修订；不删任何提案）。
 * 默认只返回待审（design 威胁模型：列表默认只给待审，避免 Agent 用长列表耗尽注意力）；
 * `status: 'all'` 返回全部。
 */
export function readRevisionProposals(store: CairnStore, query: RevisionQuery = {}): RevisionProposalView[] {
  const file = loadRevisionsFile(store.paths.home);
  const statusFilter = query.status == null || query.status === '' ? 'pending' : query.status;
  const out: RevisionProposalView[] = [];
  for (const rec of file.items) {
    if (rec.status !== statusFilter && statusFilter !== 'all') continue;
    if (query.memoryId != null && rec.memoryId !== query.memoryId) continue;
    const row = store.db.get('SELECT current_revision_id, status FROM memory WHERE id = ?', rec.memoryId);
    const currentRevisionId = row ? ((row['current_revision_id'] as string | null) ?? null) : null;
    const stale = rec.status === 'pending' && currentRevisionId !== rec.revisionIdAtPropose;
    out.push({
      ...rec,
      stale,
      memoryStatus: row ? String(row['status']) : null,
      memoryExists: row != null,
    });
  }
  out.sort((a, b) => (a.proposedAt < b.proposedAt ? 1 : -1));
  return query.limit != null && query.limit > 0 ? out.slice(0, query.limit) : out;
}

export function getRevisionProposal(store: CairnStore, id: string): RevisionProposalView | null {
  return readRevisionProposals(store, { status: 'all' }).find((r) => r.id === id) ?? null;
}

/** 终态转换：pending → applied / rejected / stale。返回更新后的记录。 */
export function resolveRevisionProposal(
  store: CairnStore,
  id: string,
  to: Exclude<RevisionStatus, 'pending'>,
  by: string,
  rejectReason?: string,
): RevisionProposalRecord {
  store.assertWritable();
  if (by.trim().length === 0) throw err('E_VALIDATION', '处置者不能为空');
  if (to === 'rejected' && (rejectReason ?? '').trim().length === 0) {
    throw err('E_VALIDATION', '拒绝理由不能为空');
  }
  const file = loadRevisionsFile(store.paths.home);
  const rec = file.items.find((x) => x.id === id);
  if (rec == null) throw err('E_NOT_FOUND', `提案不存在: ${id}`);
  // 应用只允许从待审发起（陈旧卡必须重新生成，不能硬应用）；
  // 拒绝允许从待审与陈旧发起——陈旧卡也是人要不要的东西，否则永远清不掉。
  if (to !== 'rejected' && rec.status !== 'pending') {
    throw err('E_CONFLICT_STATE', `提案已是终态（${rec.status}），不能重复处置`);
  }
  if (to === 'rejected' && (rec.status === 'applied' || rec.status === 'rejected')) {
    throw err('E_CONFLICT_STATE', `提案已是终态（${rec.status}），不能重复处置`);
  }
  rec.status = to;
  rec.resolvedAt = nowIso();
  rec.resolvedBy = by;
  if (to === 'rejected') rec.rejectReason = (rejectReason ?? '').trim();
  file.updatedAt = nowIso();
  saveRevisionsFile(store.paths.home, file);
  store.audit.record('revision', to, { type: 'memory', id: rec.memoryId }, {
    proposalId: rec.id,
    by,
  });
  return rec;
}

/** doctor 用计数：待审提案数（不进 problems）。 */
export function countPendingRevisions(home: string): number {
  return loadRevisionsFile(home).items.filter((x) => x.status === 'pending').length;
}
