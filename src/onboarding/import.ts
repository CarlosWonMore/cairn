import { readFile, stat, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { CairnStore } from '../store/open.js';
import { ImportSourceKind } from '../store/archives.js';
import { scanText } from '../core/secrets.js';
import type { SecretScanResult } from '../core/types.js';
import { sha256Hex } from '../core/hash.js';
import { uuidv7 } from '../core/ids.js';
import { err } from '../core/errors.js';

/**
 * 快照导入（任务 4.2 / spec agent-onboarding「不可变快照与默认本地档案」）：
 *
 * 1. 读取来源字节并计算 sha256；【源文件绝不修改】（导入后重读比对做诚实
 *    的 TOCTOU 检测）。
 * 2. 原始字节写入 dataDir 旁的 snapshotsDir/<sha256前16位>-<basename>，
 *    已存在则不覆盖（不可变快照）。
 * 3. 档案幂等：(sourceLocator = 路径+大小+mtime 稳定序列化, contentHash = 文件
 *    sha256) 命中即复用，零新增档案与条目（spec「重复导入同一来源」）。
 * 4. markdown-generic 解析：空行分隔的块；每条记 byteOffset 与
 *    sourceRef `basename#item-N`（N 与 item_index 一致，0 起）。
 * 5. 每条 scanText：命中秘密/注入 → scan_state='blocked'，content 以占位符
 *    入库（原文只存在于不可变快照文件，DB 绝不落秘密原文），scan_findings
 *    只存 kind+masked 摘要；全部 clean → 'scanned_clean'，有 blocked →
 *    'scanned_blocked'（spec memory-governance「秘密与提示注入阻断」）。
 * 6. 审计 record('import', ...) 记录 snapshot_created / snapshot_reused。
 *
 * 两层导入模型中的档案层：导入完成内容即本地可检索（imported_unverified、
 * local_only），晋升为正式记忆是 batches.ts 的另一层，需治理计划+真实审批，
 * 全程不依赖模型可用。
 */

export const DEFAULT_MAX_ITEM_BYTES = 64 * 1024;

/** 当前唯一实现的解析器；其他 parser 名一律 E_VALIDATION（诚实拒绝，不静默降级）。 */
const SUPPORTED_PARSERS: ReadonlySet<string> = new Set(['markdown-generic']);

const SOURCE_KINDS: readonly ImportSourceKind[] = ['markdown', 'jsonl', 'agent_memory_file', 'manual_export'];

export interface ImportSourceInput {
  /** 来源 Agent 类型：'claude-code' | 'cursor' | 'copilot' | 'openclaw' | 'workbuddy' | 'manual'。 */
  agentKind: string;
  /** 用户勾选的来源文件路径。 */
  sourcePath: string;
  /** 默认 'markdown-generic'。 */
  parser?: string;
  /** 默认新建（uuidv7）。 */
  batchId?: string;
  /** 默认 'markdown'。 */
  sourceKind?: ImportSourceKind;
  /** 默认 64KB；超长条目按行（单行再按 UTF-8 安全字节边界）再切。 */
  maxItemBytes?: number;
}

export interface ImportOutcome {
  /** 新建档案 id；幂等复用时为 null。 */
  archiveId: string | null;
  /** 幂等复用的既有档案 id；新建时为 null。 */
  reusedArchiveId: string | null;
  batchId: string;
  /** archive 是否新建。 */
  created: boolean;
  /** 本次新登记条目数（重复导入为 0）。 */
  itemCount: number;
  /** 秘密/注入命中被阻断的条目数。 */
  skippedItems: number;
  /** 导入前源文件 sha256。 */
  sourceHashBefore: string;
  /** 导入后源文件 sha256（成功返回时必与 before 相等，不等已抛 E_IO）。 */
  sourceHashAfter: string;
}

interface ParsedItem {
  content: string;
  byteOffset: number;
}

interface SrcLine {
  text: string;
  /** 该行首字节在源文件中的偏移。 */
  byteStart: number;
}

export async function importSnapshot(store: CairnStore, input: ImportSourceInput): Promise<ImportOutcome> {
  if (typeof input.agentKind !== 'string' || input.agentKind.trim().length === 0) {
    throw err('E_VALIDATION', 'agentKind 不能为空');
  }
  const parser = input.parser ?? 'markdown-generic';
  if (!SUPPORTED_PARSERS.has(parser)) {
    throw err('E_VALIDATION', `暂不支持的解析器: ${parser}（当前仅 markdown-generic）`);
  }
  const sourceKind: ImportSourceKind = input.sourceKind ?? 'markdown';
  if (!SOURCE_KINDS.includes(sourceKind)) {
    throw err('E_VALIDATION', `非法 sourceKind: ${String(sourceKind)}`);
  }
  const maxItemBytes = input.maxItemBytes ?? DEFAULT_MAX_ITEM_BYTES;
  if (!Number.isInteger(maxItemBytes) || maxItemBytes < 16) {
    throw err('E_VALIDATION', 'maxItemBytes 必须是不小于 16 的整数');
  }

  // 1. 读取源字节（不存在 → E_NOT_FOUND）；只读，绝不写回源文件。
  let bytes: Buffer;
  try {
    bytes = await readFile(input.sourcePath);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      throw err('E_NOT_FOUND', `来源文件不存在: ${input.sourcePath}`);
    }
    throw err('E_IO', `无法读取来源文件 ${input.sourcePath}: ${(e as Error).message}`);
  }
  const sourceHashBefore = sha256Hex(bytes);

  let st: Awaited<ReturnType<typeof stat>>;
  try {
    st = await stat(input.sourcePath);
  } catch (e) {
    throw err('E_IO', `无法获取来源文件元数据 ${input.sourcePath}: ${(e as Error).message}`);
  }
  // sourceLocator：路径 + 大小 + mtime 的稳定序列化（resolve 消除相对路径差异）。
  const sourceLocator = JSON.stringify({
    v: 1,
    path: resolve(input.sourcePath),
    size: bytes.byteLength,
    mtimeMs: st.mtimeMs,
  });

  // 2. 解析先行：空文件/无条目在任何写入发生前即 E_VALIDATION（零副作用）。
  const items = parseMarkdownItems(bytes, maxItemBytes);
  if (items.length === 0) {
    throw err('E_VALIDATION', '来源文件没有可导入的条目（空文件或仅空白行）');
  }

  // 3. 不可变快照：wx 标志写入，已存在则不覆盖。
  const base = basename(input.sourcePath);
  const snapshotPath = await ensureSnapshot(store.paths.snapshotsDir, sourceHashBefore, base, bytes);

  const batchId = input.batchId ?? uuidv7();

  // 4-6. 档案登记 + 条目扫描 + 审计，全部包在单事务里保证原子性。
  const result = store.db.transaction(() => {
    const { archive, created } = store.archives.createArchive({
      batchId,
      sourceKind,
      sourceLocator,
      sourceLabel: `${input.agentKind}:${base}`,
      byteSize: bytes.byteLength,
      contentHash: sourceHashBefore,
      snapshotPath,
      parser,
    });

    if (!created) {
      // 幂等复用：零新增档案与条目；已入库条目不重扫、不换批。
      store.audit.record('import', 'snapshot_reused', { type: 'archive', id: archive.id }, {
        sourceHash: sourceHashBefore,
        itemCount: 0,
        blockedCount: 0,
        agentKind: input.agentKind,
      });
      return { archive, created, itemCount: 0, skippedItems: 0 };
    }

    let blockedCount = 0;
    for (let index = 0; index < items.length; index++) {
      const it = items[index] as ParsedItem;
      const scan = scanText(it.content);
      let content = it.content;
      let scanFindings: string | undefined;
      if (!scan.clean) {
        blockedCount++;
        // 阻断条目的 content 用占位符入库：原文只存在于不可变快照文件，
        // DB（含审计与任何 dump）绝不落秘密/注入原文；仅 kind+masked 摘要。
        content = blockedPlaceholder(scan);
        scanFindings = JSON.stringify({
          secrets: scan.findings.map((f) => ({ kind: f.kind, masked: f.masked })),
          injections: scan.injectionFindings.map((f) => ({ kind: f.kind, rule: f.rule })),
        });
      }
      store.archives.addItem({
        archiveId: archive.id,
        itemIndex: index,
        content,
        byteOffset: it.byteOffset,
        sourceRef: `${base}#item-${index}`,
        scanState: scan.clean ? 'clean' : 'blocked',
        scanFindings,
        batchId,
      });
    }
    store.archives.setRedactionState(archive.id, blockedCount > 0 ? 'scanned_blocked' : 'scanned_clean');
    store.archives.setStatus(archive.id, 'indexed');
    store.audit.record('import', 'snapshot_created', { type: 'archive', id: archive.id }, {
      sourceHash: sourceHashBefore,
      itemCount: items.length,
      blockedCount,
      agentKind: input.agentKind,
    });
    return { archive, created, itemCount: items.length, skippedItems: blockedCount };
  });

  // 7. TOCTOU 诚实检测：导入后重读源文件，字节变化即 E_IO（导入本身仍基于
  //    读取时点的快照成立，但必须把不一致大声暴露，绝不静默吞掉）。
  const sourceHashAfter = await rehashSource(input.sourcePath, sourceHashBefore);

  return {
    archiveId: result.created ? result.archive.id : null,
    reusedArchiveId: result.created ? null : result.archive.id,
    batchId: result.created ? batchId : (input.batchId ?? result.archive.batchId),
    created: result.created,
    itemCount: result.itemCount,
    skippedItems: result.skippedItems,
    sourceHashBefore,
    sourceHashAfter,
  };
}

/** 不可变快照：写入 snapshotsDir/<hash前16位>-<basename>；EEXIST 视为快照已存在，不覆盖。 */
async function ensureSnapshot(snapshotsDir: string, contentHash: string, base: string, bytes: Buffer): Promise<string> {
  const snapshotPath = join(snapshotsDir, `${contentHash.slice(0, 16)}-${base}`);
  try {
    await writeFile(snapshotPath, bytes, { flag: 'wx' });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw err('E_IO', `无法写入不可变快照 ${snapshotPath}: ${(e as Error).message}`);
    }
    // 已存在：不可变快照语义，保持原字节不动。
  }
  return snapshotPath;
}

async function rehashSource(sourcePath: string, before: string): Promise<string> {
  let after: Buffer;
  try {
    after = await readFile(sourcePath);
  } catch (e) {
    throw err('E_IO', '导入完成后无法重新读取源文件（TOCTOU 检测失败，来源可能已被移动或删除）', {
      reason: (e as Error).message,
    });
  }
  const afterHash = sha256Hex(after);
  if (afterHash !== before) {
    throw err('E_IO', '导入期间源文件字节发生变化：本次导入基于读取时点完成，请核对来源后重试', {
      sourceHashBefore: before,
      sourceHashAfter: afterHash,
    });
  }
  return afterHash;
}

/** blocked 条目入库占位符：只含 kind/rule 名，不含任何原文片段。 */
function blockedPlaceholder(scan: SecretScanResult): string {
  const kinds = [...scan.findings.map((f) => f.kind), ...scan.injectionFindings.map((f) => f.rule)];
  return `[blocked:${kinds.join(',')}]`;
}

/**
 * markdown-generic 解析：按空行（trim 后为空）分隔成块，连续非空行为一条；
 * 去掉每行 Markdown 引用前缀（'> '）后作为 content；byteOffset 是该条内容
 * 首字节在源文件中的真实字节偏移（按 UTF-8 字节计，多字节字符安全）。
 * 超过 maxItemBytes 的块再切分：优先按行边界；单行超长按 UTF-8 安全字节
 * 边界硬切（绝不切断多字节字符），拼接可无损还原。
 */
export function parseMarkdownItems(buf: Buffer, maxItemBytes: number): ParsedItem[] {
  const text = buf.toString('utf8');
  const lines: SrcLine[] = [];
  let byteStart = 0;
  for (const raw of text.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    lines.push({ text: line, byteStart });
    byteStart += Buffer.byteLength(raw, 'utf8') + 1; // +1 为换行符本身
  }

  const out: ParsedItem[] = [];
  let block: SrcLine[] = [];
  const flushBlock = (): void => {
    if (block.length > 0) {
      out.push(...emitChunked(block, maxItemBytes));
      block = [];
    }
  };
  for (const line of lines) {
    if (line.text.trim().length === 0) flushBlock();
    else block.push(line);
  }
  flushBlock();
  // 纯引用符号等剥完前缀为空白的块不构成条目。
  return out.filter((it) => it.content.trim().length > 0);
}

function emitChunked(block: SrcLine[], maxItemBytes: number): ParsedItem[] {
  const stripped: SrcLine[] = block.map((l) => {
    const m = /^> ?/.exec(l.text);
    const prefixBytes = m ? Buffer.byteLength(m[0], 'utf8') : 0;
    return { text: m ? l.text.slice(m[0].length) : l.text, byteStart: l.byteStart + prefixBytes };
  });

  const full = stripped.map((l) => l.text).join('\n');
  if (Buffer.byteLength(full, 'utf8') <= maxItemBytes) {
    return [{ content: full, byteOffset: stripped[0]!.byteStart }];
  }

  const out: ParsedItem[] = [];
  let cur: { parts: string[]; start: number; size: number } | null = null;
  const flush = (): void => {
    if (cur == null) return;
    out.push({ content: cur.parts.join('\n'), byteOffset: cur.start });
    cur = null;
  };
  for (const line of stripped) {
    const lineBytes = Buffer.byteLength(line.text, 'utf8');
    if (lineBytes > maxItemBytes) {
      // 单行超长：按 UTF-8 安全字节边界硬切（回退到字符起始字节）。
      flush();
      const lineBuf = Buffer.from(line.text, 'utf8');
      let off = 0;
      while (off < lineBuf.length) {
        let end = Math.min(off + maxItemBytes, lineBuf.length);
        if (end < lineBuf.length) {
          while (end > off) {
            const b = lineBuf[end];
            if (b !== undefined && (b & 0xc0) === 0x80) end--;
            else break;
          }
        }
        out.push({ content: lineBuf.subarray(off, end).toString('utf8'), byteOffset: line.byteStart + off });
        off = end;
      }
      continue;
    }
    if (cur != null && cur.size + 1 + lineBytes > maxItemBytes) flush();
    if (cur == null) cur = { parts: [], start: line.byteStart, size: 0 };
    cur.parts.push(line.text);
    cur.size += (cur.parts.length > 1 ? 1 : 0) + lineBytes; // 行间 '\n' 占 1 字节
  }
  flush();
  return out;
}
