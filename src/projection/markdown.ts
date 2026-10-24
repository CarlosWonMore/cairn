import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { CairnStore } from '../store/open.js';
import { err } from '../core/errors.js';
import { sha256Hex } from '../core/hash.js';

/**
 * 受管 Markdown 投影（tasks 7.x）。
 *
 * 标记约定：
 *   起始 `<!-- cairn:begin block="<blockId>" revision="<n>" -->`
 *   结束 `<!-- cairn:end block="<blockId>" -->`
 *
 * 不变量：
 * - 只改动受管区块内部字节；区块外内容逐字节保留（含未知换行风格）。
 * - upsert 幂等：内容未变 → changed=false 且文件字节不动。
 * - remove 同时清理安装时加入的分隔空行，其余部分逐字节保留。
 * - 首次写入前把原始字节备份到 targetPath + '.cairn-backup'（已存在则不覆盖）。
 * - 写入先落同目录临时文件再 rename（原子替换）。
 */

/** 默认受管区块 ID（router 入口统一使用，保证 plan/apply/disable 一致）。 */
export const DEFAULT_BLOCK_ID = 'cairn-memory';

export const BACKUP_SUFFIX = '.cairn-backup';

const BEGIN_PREFIX = '<!-- cairn:begin block="';
const END_MARKER_PREFIX = '<!-- cairn:end block="';

/** blockId 进入标记文本与正则，只允许安全字符。 */
const BLOCK_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function assertBlockId(blockId: string): void {
  if (typeof blockId !== 'string' || !BLOCK_ID_RE.test(blockId)) {
    throw err('E_VALIDATION', `非法 blockId: ${JSON.stringify(blockId)}（仅允许字母数字与 . _ -，长度 1-64）`);
  }
}

function assertBlockContent(content: string): void {
  if (typeof content !== 'string') {
    throw err('E_VALIDATION', '区块内容必须是字符串');
  }
  if (/cairn:(begin|end)/i.test(content)) {
    throw err('E_VALIDATION', '区块内容不得包含 cairn:begin / cairn:end 标记（防嵌套与解析歧义）');
  }
}

export function beginMarker(blockId: string, revision: number): string {
  return `${BEGIN_PREFIX}${blockId}" revision="${revision}" -->`;
}

export function endMarker(blockId: string): string {
  return `${END_MARKER_PREFIX}${blockId}" -->`;
}

/** 渲染一个受管区块（含起止标记与内部正文）。 */
export function renderBlock(content: string, revision: number, blockId: string): string {
  assertBlockId(blockId);
  assertBlockContent(content);
  if (!Number.isInteger(revision) || revision < 0) {
    throw err('E_VALIDATION', `非法 revision: ${revision}`);
  }
  return `${beginMarker(blockId, revision)}\n${content}\n${endMarker(blockId)}`;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface BeginMatch {
  /** 起始标记所在行的行首（含行首缩进之前的换行之后位置）。 */
  lineStart: number;
  /** 起始标记文本结束位置（不含行尾换行）。 */
  markerEnd: number;
  revision: number;
}

interface BlockSpan {
  /** 区块整体（起始标记行首 → 结束标记行尾，不含结束行换行）。 */
  start: number;
  end: number;
  revision: number;
}

function findBeginMatches(text: string, blockId: string): BeginMatch[] {
  // revision 允许缺省（外来/手写标记按 0 处理，下一次写入从 1 开始）
  const re = new RegExp(
    `^<!-- cairn:begin block="${escapeRe(blockId)}"(?: revision="(\\d+)")? -->[ \\t]*\\r?$`,
    'gm',
  );
  const out: BeginMatch[] = [];
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    const markerStart = m.index;
    const lineStart = text.lastIndexOf('\n', markerStart) + 1;
    out.push({
      lineStart,
      markerEnd: markerStart + m[0].length,
      revision: m[1] ? Number.parseInt(m[1], 10) : 0,
    });
  }
  return out;
}

function findEndMatch(text: string, blockId: string, from: number): { start: number; end: number } | null {
  const re = new RegExp(`^<!-- cairn:end block="${escapeRe(blockId)}" -->[ \\t]*\\r?$`, 'gm');
  re.lastIndex = from;
  const m = re.exec(text);
  if (m === null) return null;
  return { start: m.index, end: m.index + m[0].length };
}

function countEndMarkers(text: string, blockId: string): number {
  const re = new RegExp(`^<!-- cairn:end block="${escapeRe(blockId)}" -->[ \\t]*\\r?$`, 'gm');
  let n = 0;
  while (re.exec(text) !== null) n += 1;
  return n;
}

/**
 * 定位区块跨度；重复或不平衡标记按 M0 矩阵约定拒绝（E_VALIDATION）。
 * 未找到时返回 null。
 */
function findBlockSpan(text: string, blockId: string): BlockSpan | null {
  const begins = findBeginMatches(text, blockId);
  const endCount = countEndMarkers(text, blockId);
  if (begins.length > 1) {
    throw err('E_VALIDATION', `目标文件中存在 ${begins.length} 个重复的受管区块标记（block=${blockId}），拒绝处理`);
  }
  if (begins.length === 0) {
    if (endCount > 0) {
      throw err('E_VALIDATION', `目标文件存在孤立的 cairn:end 标记（block=${blockId}），标记不平衡，拒绝处理`);
    }
    return null;
  }
  const begin = begins[0]!;
  if (endCount !== 1) {
    throw err('E_VALIDATION', `受管区块标记不平衡（block=${blockId}）：起始 1 个、结束 ${endCount} 个，拒绝处理`);
  }
  const end = findEndMatch(text, blockId, begin.markerEnd);
  if (end === null) {
    throw err('E_VALIDATION', `受管区块缺少结束标记（block=${blockId}），拒绝处理`);
  }
  return { start: begin.lineStart, end: end.end, revision: begin.revision };
}

/** 防回环探测：导入/发现层据此跳过受管文件，不做任何解析。 */
export function hasCairnMarker(text: string): boolean {
  return /<!--\s*cairn:(begin|end)\b/.test(text);
}

/**
 * 把区块写入文本：无块 → 追加（保证前面恰好一个空行分隔）；
 * 有块 → 整体替换并 revision+1；内容未变 → changed=false 且 revision 不变。
 *
 * options.revisionSeed：文件中无块但库里有历史记录时的 revision 续号
 * （新 revision = seed + 1；不传则从 1 开始）。
 */
export function upsertBlockInText(
  text: string,
  blockId: string,
  newContent: string,
  options: { revisionSeed?: number } = {},
): { output: string; changed: boolean; hadBlock: boolean; revision: number } {
  assertBlockId(blockId);
  assertBlockContent(newContent);
  const span = findBlockSpan(text, blockId);
  if (span === null) {
    const revision = (options.revisionSeed ?? 0) + 1;
    const block = renderBlock(newContent, revision, blockId);
    const base = text.replace(/(?:\r?\n)+$/, '');
    const output = base === '' ? `${block}\n` : `${base}\n\n${block}\n`;
    return { output, changed: true, hadBlock: false, revision };
  }
  const spanText = text.slice(span.start, span.end);
  const current = renderBlock(newContent, span.revision, blockId);
  if (spanText === current) {
    return { output: text, changed: false, hadBlock: true, revision: span.revision };
  }
  const nextRevision = span.revision + 1;
  const output =
    text.slice(0, span.start) + renderBlock(newContent, nextRevision, blockId) + text.slice(span.end);
  return { output, changed: true, hadBlock: true, revision: nextRevision };
}

/**
 * 从文本移除区块：删除区块本体，并回收安装时加入的前置分隔空行
 * （只回收紧邻区块的那一个空行，用户自己加的空行/内容全部保留）。
 * 区块外其余字节逐字节保留。
 */
export function removeBlockFromText(
  text: string,
  blockId: string,
): { output: string; changed: boolean; hadBlock: boolean } {
  assertBlockId(blockId);
  const span = findBlockSpan(text, blockId);
  if (span === null) {
    return { output: text, changed: false, hadBlock: false };
  }
  // 回收安装时加入的分隔空行：起始标记的上一行若为空行则一并移除
  let start = span.start;
  const before = text.slice(0, span.start);
  const sepMatch = /(?:^|\r?\n)([ \t]*\r?\n)$/.exec(before);
  if (sepMatch !== null && sepMatch[1] !== undefined) {
    start -= sepMatch[1].length;
  }
  const end = span.end;
  // 结束标记行自身的换行随区块一起移除
  const suffixStart = skipNewline(text, end);
  const head = text.slice(0, start);
  let tail = text.slice(suffixStart);
  if (head === '') {
    // 区块原本位于文件最前：清理残留的前导空行
    tail = tail.replace(/^(?:\r?\n)+/, '');
  }
  const output = head + tail;
  return { output, changed: true, hadBlock: true };
}

function skipNewline(text: string, at: number): number {
  if (text[at] === '\r' && text[at + 1] === '\n') return at + 2;
  if (text[at] === '\n') return at + 1;
  return at;
}

/** 从已存的 startMarker 里解析 revision（库记录续号用）。 */
function parseRevisionFromMarker(marker: string | null | undefined): number {
  if (!marker) return 0;
  const m = /revision="(\d+)"/.exec(marker);
  return m && m[1] ? Number.parseInt(m[1], 10) : 0;
}

async function readFileOrNull(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path);
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === 'ENOENT') return null;
    throw err('E_CONFIG_IO', `读取文件失败: ${path}（${code ?? '未知错误'}）`);
  }
}

async function writeFileAtomic(path: string, data: Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.cairn-tmp-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
  try {
    await writeFile(tmp, data);
    await rename(tmp, path);
  } catch (e) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw err('E_CONFIG_IO', `原子写入失败: ${path}（${(e as Error).message}）`);
  }
}

export interface GenerateProjectionResult {
  changed: boolean;
  revision: number;
  /** 本次实际使用的备份文件路径（未新建备份时为既有记录或 null）。 */
  backupPath: string | null;
}

/**
 * 生成受管投影：读文件（不存在 → ''）→ upsert → 有变化才写。
 * 首次写入前把原始字节备份到 targetPath + '.cairn-backup'（仅首次，不覆盖）。
 * 库记录 revision 取现有块标记 / 库记录 + 1。
 */
export async function generateProjection(
  store: CairnStore,
  input: { targetPath: string; content: string; blockId?: string; agentId: string },
): Promise<GenerateProjectionResult> {
  const blockId = input.blockId ?? DEFAULT_BLOCK_ID;
  assertBlockId(blockId);
  assertBlockContent(input.content);
  if (typeof input.targetPath !== 'string' || input.targetPath.length === 0) {
    throw err('E_VALIDATION', 'targetPath 不能为空');
  }
  if (typeof input.agentId !== 'string' || input.agentId.length === 0) {
    throw err('E_VALIDATION', 'agentId 不能为空');
  }

  const original = await readFileOrNull(input.targetPath);
  const text = original !== null ? original.toString('utf8') : '';

  const existingRow = store.blocks.get(input.targetPath, blockId);
  const seedRevision = existingRow ? parseRevisionFromMarker(existingRow.startMarker) : 0;
  const result = upsertBlockInText(text, blockId, input.content, { revisionSeed: seedRevision });

  // 幂等：内容未变且库里有记录 → 不写文件、不动库
  if (!result.changed && existingRow) {
    return { changed: false, revision: result.revision, backupPath: existingRow.backupPath };
  }

  const backupPath = input.targetPath + BACKUP_SUFFIX;
  let backupToRecord: string | null = existingRow?.backupPath ?? null;
  if (result.changed) {
    if (original !== null) {
      // 仅首次写入前备份原始字节；备份已存在则不覆盖
      if (!(await backupExists(backupPath))) {
        await writeFileAtomic(backupPath, original);
      }
      backupToRecord = backupPath;
    }
    await writeFileAtomic(input.targetPath, Buffer.from(result.output, 'utf8'));
  }

  const row = store.blocks.upsert({
    targetPath: input.targetPath,
    blockId,
    agentId: input.agentId,
    content: input.content,
    startMarker: beginMarker(blockId, result.revision),
    endMarker: endMarker(blockId),
    ...(backupToRecord ? { backupPath: backupToRecord } : {}),
  });

  return { changed: result.changed, revision: result.revision, backupPath: row.backupPath };
}

/** 备份是否已存在（仅区分 ENOENT，其他 IO 错误如实抛出）。 */
async function backupExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (e) {
    if ((e as { code?: string }).code === 'ENOENT') return false;
    throw err('E_CONFIG_IO', `检查备份文件失败: ${path}（${(e as { code?: string }).code ?? '未知错误'}）`);
  }
}

export interface DisableProjectionResult {
  removed: boolean;
  restoredOriginal: boolean;
}

/**
 * 停用受管投影：
 * - 当前文件移除区块后与备份原始文件一致 → 直接整文件恢复备份字节（restoredOriginal=true）；
 * - 否则（用户有其他修改）只移除受管区块，其余修改保留；
 * - 任何情况下都 markRemoved + 审计（不写正文）。
 */
export async function disableProjection(
  store: CairnStore,
  input: { targetPath: string; blockId?: string },
): Promise<DisableProjectionResult> {
  const blockId = input.blockId ?? DEFAULT_BLOCK_ID;
  assertBlockId(blockId);
  if (typeof input.targetPath !== 'string' || input.targetPath.length === 0) {
    throw err('E_VALIDATION', 'targetPath 不能为空');
  }

  const row = store.blocks.get(input.targetPath, blockId);
  const current = await readFileOrNull(input.targetPath);

  let removed = false;
  let restoredOriginal = false;

  if (current !== null) {
    const currentText = current.toString('utf8');
    const removal = removeBlockFromText(currentText, blockId);
    removed = removal.changed;

    const backupPath = row?.backupPath ?? input.targetPath + BACKUP_SUFFIX;
    const backup = await readFileOrNull(backupPath);

    if (backup !== null && removal.output === backup.toString('utf8')) {
      // 用户未做其他修改：整文件恢复原始字节
      await writeFileAtomic(input.targetPath, backup);
      restoredOriginal = true;
    } else if (removal.changed && removal.output !== currentText) {
      await writeFileAtomic(input.targetPath, Buffer.from(removal.output, 'utf8'));
    }
  }

  if (row) {
    store.blocks.markRemoved(row.id);
  }
  store.audit.record(
    'config',
    'projection_removed',
    { type: 'managed_block', id: blockId },
    { targetPath: input.targetPath, removed, restoredOriginal, hadRecord: row !== null },
  );

  return { removed, restoredOriginal };
}

/** 供 config 模块复用的整文件哈希。 */
export function fileHash(buf: Buffer): string {
  return sha256Hex(buf);
}
