import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CairnStore } from '../../store/open.js';
import { err } from '../../core/errors.js';
import { nowIso } from '../../core/time.js';
import { scanText } from '../../core/secrets.js';

/**
 * 记忆批注（OpenSpec: add-memory-annotations，design D1/D2/D5）。
 *
 * 批注是**人对记忆的旁注**，不是记忆本体：
 * - 落在 `<home>/console/annotations.json`，与 ai-reviews.json 同一模式，不建表；
 * - 从不写 `memory` / `memory_revision` / outbox，因此既不参与同步，也不会改变检索；
 * - 写入前必须过 `scanText`，命中即拒绝（不脱敏保存——那会让人误以为系统记住了全文）。
 *
 * 陈旧判定（D2）：批注记下写入时的 `revisionIdAtWrite` 作为快照证据，
 * 读取时与当前 `current_revision_id` 对比；不一致只标 stale，**不删批注**
 * （意见本身仍是人的判断，只是可能已过时）。
 */

export const ANNOTATIONS_FILE = 'annotations.json';
export const ANNOTATIONS_VERSION = 1;

/**
 * 处置类别。`pending_forget` 与 `needs_rescope`（add-scope-migration D5）带后续动作，
 * 且动作永远不在 WebUI 执行——批注只表达意图，执行留在终端。
 */
export const DISPOSITIONS = ['needs_edit', 'needs_merge', 'can_delete', 'uncertain', 'no_action', 'pending_forget', 'needs_rescope'] as const;
export type Disposition = (typeof DISPOSITIONS)[number];

export const ANNOTATION_STATUSES = ['open', 'resolved', 'ignored'] as const;
export type AnnotationStatus = (typeof ANNOTATION_STATUSES)[number];

/** 回写只允许这两种终态：已处置 / 忽略。 */
export const RESOLVE_STATUSES = ['resolved', 'ignored'] as const;
export type ResolveStatus = (typeof RESOLVE_STATUSES)[number];

export interface AnnotationRecord {
  id: string;
  memoryId: string;
  /** 写入当时的当前修订；仅作快照证据，用来判陈旧，不是绑定关系。 */
  revisionIdAtWrite: string | null;
  disposition: Disposition;
  note: string;
  status: AnnotationStatus;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
}

export interface AnnotationView extends AnnotationRecord {
  /** 记忆已变更（或已不存在）：意见可能已过时。批注本身保留。 */
  stale: boolean;
  staleReason: string | null;
  memoryStatus: string | null;
  memoryKind: string | null;
  /** 定位用摘要（首行、截断）；sensitive / tombstoned 记忆不给摘要。 */
  memoryExcerpt: string | null;
}

export interface AnnotationQuery {
  memoryId?: string;
  disposition?: string;
  status?: string;
  limit?: number;
}

interface AnnotationsFile {
  version: number;
  updatedAt: string;
  items: AnnotationRecord[];
}

export const DISPOSITION_LABELS: Record<Disposition, string> = {
  needs_edit: '需要修改',
  needs_merge: '需要合并',
  can_delete: '可以删除',
  uncertain: '存疑待查',
  no_action: '无需处理',
  pending_forget: '标记待删',
  needs_rescope: '需要迁移作用域',
};

export function annotationsPath(home: string): string {
  return join(home, 'console', ANNOTATIONS_FILE);
}

function emptyFile(): AnnotationsFile {
  return { version: ANNOTATIONS_VERSION, updatedAt: nowIso(), items: [] };
}

function isDisposition(v: unknown): v is Disposition {
  return typeof v === 'string' && (DISPOSITIONS as readonly string[]).includes(v);
}

function isStatus(v: unknown): v is AnnotationStatus {
  return typeof v === 'string' && (ANNOTATION_STATUSES as readonly string[]).includes(v);
}

function normalizeRecord(raw: unknown): AnnotationRecord | null {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' ? r.id : '';
  const memoryId = typeof r.memoryId === 'string' ? r.memoryId : '';
  if (id.length === 0 || memoryId.length === 0 || !isDisposition(r.disposition)) return null;
  return {
    id,
    memoryId,
    revisionIdAtWrite: typeof r.revisionIdAtWrite === 'string' ? r.revisionIdAtWrite : null,
    disposition: r.disposition,
    note: typeof r.note === 'string' ? r.note : '',
    status: isStatus(r.status) ? r.status : 'open',
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : nowIso(),
    resolvedAt: typeof r.resolvedAt === 'string' ? r.resolvedAt : null,
    resolvedBy: typeof r.resolvedBy === 'string' ? r.resolvedBy : null,
  };
}

/** 坏文件按空处理：批注是派生数据，读不出来不阻塞控制台。 */
export function loadAnnotationsFile(home: string): AnnotationsFile {
  const p = annotationsPath(home);
  if (!existsSync(p)) return emptyFile();
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8')) as Partial<AnnotationsFile>;
    if (parsed == null || typeof parsed !== 'object' || !Array.isArray(parsed.items)) return emptyFile();
    const items: AnnotationRecord[] = [];
    for (const raw of parsed.items) {
      const rec = normalizeRecord(raw);
      if (rec != null) items.push(rec);
    }
    return {
      version: Number(parsed.version ?? ANNOTATIONS_VERSION),
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : nowIso(),
      items,
    };
  } catch {
    return emptyFile();
  }
}

/** 原子写入：临时文件 + rename（与 review-store 同姿势，避开 Windows 句柄抖动）。 */
function saveAnnotationsFile(home: string, data: AnnotationsFile): void {
  const p = annotationsPath(home);
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
  throw err('E_IO', `写入批注文件失败: ${(lastError as Error)?.message ?? '未知错误'}`);
}

function excerptOf(row: Record<string, unknown>): string | null {
  if (String(row['sensitivity']) === 'sensitive' || String(row['status']) === 'tombstoned') return null;
  const firstLine = String(row['content']).split('\n')[0]?.trim() ?? '';
  if (firstLine.length === 0) return null;
  return firstLine.length > 80 ? `${firstLine.slice(0, 80)}…` : firstLine;
}

/** 读取批注并就地判定陈旧（对比当前修订，不删除任何批注）。 */
export function readAnnotations(store: CairnStore, query: AnnotationQuery = {}): AnnotationView[] {
  const file = loadAnnotationsFile(store.paths.home);
  const out: AnnotationView[] = [];
  for (const rec of file.items) {
    if (query.memoryId != null && rec.memoryId !== query.memoryId) continue;
    if (query.disposition != null && rec.disposition !== query.disposition) continue;
    if (query.status != null && rec.status !== query.status) continue;
    const row = store.db.get(
      'SELECT current_revision_id, status, kind, content, sensitivity FROM memory WHERE id = ?',
      rec.memoryId,
    );
    if (row == null) {
      out.push({ ...rec, stale: true, staleReason: '记忆已不存在', memoryStatus: null, memoryKind: null, memoryExcerpt: null });
      continue;
    }
    const currentRevisionId = (row['current_revision_id'] as string | null) ?? null;
    const memoryStatus = String(row['status']);
    const staleReason =
      memoryStatus === 'tombstoned'
        ? '记忆已遗忘，意见不再适用'
        : currentRevisionId !== rec.revisionIdAtWrite
          ? '记忆已变更（修订已更新），意见可能已过时'
          : null;
    out.push({
      ...rec,
      stale: staleReason != null,
      staleReason,
      memoryStatus,
      memoryKind: String(row['kind']),
      memoryExcerpt: excerptOf(row),
    });
  }
  out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return query.limit != null && query.limit > 0 ? out.slice(0, query.limit) : out;
}

function scanAnnotationError(scan: ReturnType<typeof scanText>): Error {
  if (scan.findings.length > 0) {
    return err('E_SECRET_DETECTED', '批注疑似包含秘密，已拒绝写入（不回显原文）', {
      findings: scan.findings.map((f) => ({ kind: f.kind, masked: f.masked })),
      injectionFindings: scan.injectionFindings.map((f) => ({ kind: f.kind, rule: f.rule })),
    });
  }
  return err('E_INJECTION_SUSPECTED', '批注疑似提示注入指令，已拒绝写入', {
    injectionFindings: scan.injectionFindings.map((f) => ({ kind: f.kind, rule: f.rule })),
  });
}

export interface AnnotateInput {
  memoryId: string;
  disposition: string;
  note?: string;
}

/** 单条批注。只写 JSON 旁注：不碰记忆正文、状态、修订链与 outbox。 */
export function addAnnotation(store: CairnStore, input: AnnotateInput): AnnotationRecord {
  store.assertWritable();
  if (!isDisposition(input.disposition)) {
    throw err('E_VALIDATION', `disposition 非法: ${String(input.disposition)}（允许 ${DISPOSITIONS.join('|')}）`);
  }
  const memoryId = input.memoryId.trim();
  if (memoryId.length === 0) throw err('E_VALIDATION', 'memoryId 不能为空');
  const mem = store.memories.require(memoryId);
  const note = (input.note ?? '').trim();
  if (note.length > 0) {
    const scan = scanText(note);
    if (!scan.clean) throw scanAnnotationError(scan);
  }
  const rec: AnnotationRecord = {
    id: `ann_${randomUUID()}`,
    memoryId,
    revisionIdAtWrite: mem.currentRevisionId,
    disposition: input.disposition,
    note,
    status: 'open',
    createdAt: nowIso(),
    resolvedAt: null,
    resolvedBy: null,
  };
  const file = loadAnnotationsFile(store.paths.home);
  file.items.push(rec);
  file.updatedAt = nowIso();
  saveAnnotationsFile(store.paths.home, file);
  // 审计只记标识与类别：意见原文不进审计（摘要纪律）。
  store.audit.record('annotation', 'created', { type: 'memory', id: memoryId }, {
    annotationId: rec.id,
    disposition: rec.disposition,
  });
  return rec;
}

export interface BatchAnnotateResult {
  succeeded: number;
  failed: { memoryId: string; code: string; message: string }[];
  annotations: AnnotationRecord[];
}

/** 批量标记：逐条校验、分别计数，单条失败不中断（spec「批量标记」）。 */
export function addAnnotationsBatch(
  store: CairnStore,
  input: { memoryIds: string[]; disposition: string; note?: string },
): BatchAnnotateResult {
  store.assertWritable();
  if (!isDisposition(input.disposition)) {
    throw err('E_VALIDATION', `disposition 非法: ${String(input.disposition)}（允许 ${DISPOSITIONS.join('|')}）`);
  }
  const ids = Array.isArray(input.memoryIds) ? input.memoryIds.map((s) => String(s).trim()).filter((s) => s.length > 0) : [];
  if (ids.length === 0) throw err('E_VALIDATION', 'memoryIds 不能为空');
  // 共享 note 先扫一次：命中即整批拒绝（不是某一条的问题）。
  const note = (input.note ?? '').trim();
  if (note.length > 0) {
    const scan = scanText(note);
    if (!scan.clean) throw scanAnnotationError(scan);
  }
  const result: BatchAnnotateResult = { succeeded: 0, failed: [], annotations: [] };
  for (const memoryId of ids) {
    try {
      const rec = addAnnotation(store, { memoryId, disposition: input.disposition, note });
      result.succeeded += 1;
      result.annotations.push(rec);
    } catch (e) {
      const code = (e as { code?: string }).code ?? 'E_INTERNAL';
      const message = (e as Error).message ?? '未知错误';
      result.failed.push({ memoryId, code, message });
    }
  }
  return result;
}

export interface ResolveInput {
  id: string;
  status: string;
  by: string;
}

/** 回写批注状态。只接受 resolved / ignored；不碰记忆。 */
export function resolveAnnotation(store: CairnStore, input: ResolveInput): AnnotationRecord {
  store.assertWritable();
  if (!(RESOLVE_STATUSES as readonly string[]).includes(input.status)) {
    throw err('E_VALIDATION', `status 非法: ${String(input.status)}（允许 ${RESOLVE_STATUSES.join('|')}）`);
  }
  const by = (input.by ?? '').trim();
  if (by.length === 0) throw err('E_VALIDATION', '处置者不能为空');
  const id = (input.id ?? '').trim();
  if (id.length === 0) throw err('E_VALIDATION', 'id 不能为空');
  const file = loadAnnotationsFile(store.paths.home);
  const rec = file.items.find((x) => x.id === id);
  if (rec == null) throw err('E_NOT_FOUND', `批注不存在: ${id}`);
  rec.status = input.status as ResolveStatus;
  rec.resolvedAt = nowIso();
  rec.resolvedBy = by;
  file.updatedAt = nowIso();
  saveAnnotationsFile(store.paths.home, file);
  store.audit.record('annotation', 'resolved', { type: 'memory', id: rec.memoryId }, {
    annotationId: rec.id,
    status: rec.status,
  });
  return rec;
}

/** doctor 用计数：待办 = 未处理且非「无需处理」。不进 problems。 */
export function countOpenAnnotations(home: string): number {
  return loadAnnotationsFile(home).items.filter((x) => x.status === 'open' && x.disposition !== 'no_action').length;
}
