/**
 * 元数据发现适配器（tasks 4.1；agent-onboarding spec「元数据发现与显式选择」）。
 *
 * 硬性边界（spec：发现阶段 MUST 只返回类型、路径、大小等元数据）：
 * - 全程只使用 lstat / readdir 获取元数据，绝不 read/open 任何文件内容；
 *   正文读取只发生在用户显式勾选之后的快照层。
 * - 符号链接只判定、不跟随：lstat 判定为符号链接即跳过并记入 skippedNotes，
 *   防止借链接越出白名单范围。
 * - 候选来源仅来自固定白名单相对路径；不递归扫描 homeDir 全盘，
 *   不访问 AppData/Documents 等其他位置，不发起任何网络访问。
 * - 网络路径（UNC，`\\` 或 `//` 前缀）直接抛 E_FORBIDDEN。
 * - 逐文件上限 maxFileBytes（默认 10 MiB）：超限文件不列入正文候选，
 *   只记 skippedNotes（oversized）；总文件数上限 maxFiles（默认 500）
 *   先到先停，并在受影响候选上注明。
 * - 结果按 (agentKind, path) 排序，同一文件系统状态下输出确定。
 */

import { lstat, readdir } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import path from 'node:path';

import { err } from '../core/errors.js';

// ---------------------------------------------------------------------------
// 公开类型
// ---------------------------------------------------------------------------

/** 已识别的 Agent 宿主类型。 */
export type AgentKind = 'claude-code' | 'cursor' | 'copilot' | 'openclaw' | 'workbuddy';

/** 来源类别：memory = Agent 记忆正文来源；rules = 指令/规则文件来源。 */
export type SourceKind = 'memory' | 'rules';

/** 单个候选来源的解析器标识（快照层据此选择解析方式）。 */
export type SourceParser =
  | 'markdown-memory-index'
  | 'markdown-topics'
  | 'markdown-daily'
  | 'markdown-user-profile'
  | 'mdc-rules'
  | 'markdown-instructions'
  | 'markdown-workspace'
  | 'markdown-export';

export interface SourceCandidate {
  agentKind: AgentKind;
  sourceKind: SourceKind;
  /** 绝对路径；目录类来源 = 聚合目录本身。 */
  path: string;
  /** 已列入候选的文件字节总数；被跳过的文件不计入。 */
  byteSize: number;
  /** 目录类来源 = 内部列入的文件数；单文件来源 = 1；被跳过（符号链接/超限）时为 0，仅携带 skippedNotes。 */
  fileCount: number;
  parser: SourceParser;
  /** 能力边界说明（公开路径依据、fixture-only / 手动导出等），中文字符串。 */
  capabilityNote: string;
  /** 因符号链接、超限、文件数上限等原因被跳过的子项说明；无跳过时省略。 */
  skippedNotes?: string[];
}

export interface DiscoverOptions {
  /** 合成 HOME：用于 ~/.claude、~/.cursor、~/.openclaw、~/.workbuddy 等 home 级来源。 */
  homeDir: string;
  /** 项目根列表：用于 .github/copilot 指令、AGENTS.md 与项目根 .cursor/rules；homeDir 本身不会自动当作项目根。 */
  projectRoots?: string[];
  /** 全局文件数上限（先到先停）。默认 500。 */
  maxFiles?: number;
  /** 单文件字节上限。默认 10 MiB。 */
  maxFileBytes?: number;
}

export const DEFAULT_MAX_FILES = 500;
export const DEFAULT_MAX_FILE_BYTES = 10 * 1024 * 1024;

// ---------------------------------------------------------------------------
// 能力边界说明（capabilityNote）
// ---------------------------------------------------------------------------

const NOTE_CC_INDEX =
  'Claude Code 项目记忆索引（公开路径 ~/.claude/projects/*/memory/MEMORY.md）；正文仅在用户显式勾选后由快照层读取';
const NOTE_CC_TOPICS =
  'Claude Code 项目记忆主题文件（与 MEMORY.md 同目录聚合，仅顶层 .md）；正文仅在用户显式勾选后由快照层读取';
const NOTE_CURSOR_RULES =
  'Cursor 规则文件（公开路径 ~/.cursor/rules 与项目根 .cursor/rules；仅顶层 .mdc，子目录不展开）';
const NOTE_COPILOT_SINGLE =
  'GitHub Copilot 自定义指令（公开路径 .github/copilot-instructions.md；仅项目根层）';
const NOTE_COPILOT_DIR =
  'GitHub Copilot 按文件类型指令目录（.github/instructions/*.instructions.md；仅顶层匹配文件）';
const NOTE_AGENTS_MD =
  '跨 Agent 工作区规则标准（AGENTS.md；Cursor、Copilot 等宿主均读取，此处归入项目根规则来源）；仅项目根顶层文件，不解析嵌套目录';
const NOTE_OPENCLAW_USER = 'OpenClaw 工作区用户画像（公开工作区路径 ~/.openclaw/workspace/USER.md）';
const NOTE_OPENCLAW_MEMORY = 'OpenClaw 工作区记忆索引（~/.openclaw/workspace/MEMORY.md）';
const NOTE_OPENCLAW_DAILY = 'OpenClaw 每日记忆目录（~/.openclaw/workspace/memory/*.md；仅顶层 .md）';
const NOTE_WORKBUDDY =
  'WorkBuddy 手动导出的记忆存档（~/.workbuddy/exports/memory-export.md，需用户先在宿主内手动导出）；MCP 配置路径官方未公开，不列入记忆来源';

// ---------------------------------------------------------------------------
// 内部辅助：只做 lstat / readdir 的元数据原语
// ---------------------------------------------------------------------------

type FileInspection = { type: 'absent' | 'symlink' | 'file' | 'other'; size: number };

/**
 * lstat 检查单个路径。发现是非致命的元数据扫描：任何 fs 错误
 * （不存在、无权限、竞态消失等）一律视为 absent，静默不产生来源；
 * 只有 UNC 网络路径这类明确禁止的输入才抛 E_FORBIDDEN。
 */
async function inspectFile(filePath: string): Promise<FileInspection> {
  let st: Stats;
  try {
    st = await lstat(filePath);
  } catch {
    return { type: 'absent', size: 0 };
  }
  if (st.isSymbolicLink()) return { type: 'symlink', size: 0 };
  if (st.isFile()) return { type: 'file', size: st.size };
  return { type: 'other', size: 0 };
}

/** lstat 检查目录（符号链接不视为目录，因此不会被跟随）。 */
async function dirTypeOf(dirPath: string): Promise<'absent' | 'directory' | 'other'> {
  try {
    return (await lstat(dirPath)).isDirectory() ? 'directory' : 'other';
  } catch {
    return 'absent';
  }
}

/** 列出目录条目名并排序（确定性）；目录不可读时视为空。 */
async function listNames(dirPath: string): Promise<string[]> {
  try {
    return (await readdir(dirPath)).sort();
  } catch {
    return [];
  }
}

function symlinkNote(p: string): string {
  return `symlink: 跳过符号链接 ${p}（发现阶段不跟随链接，防止越界访问）`;
}

function oversizedNote(p: string, size: number, max: number): string {
  return `oversized: 跳过超限文件 ${p}（${size} 字节超过单文件上限 ${max} 字节），不列入正文快照候选`;
}

// ---------------------------------------------------------------------------
// 白名单相对路径与名称匹配
// ---------------------------------------------------------------------------

const isMdName = (n: string): boolean => n.endsWith('.md');
const isMdcName = (n: string): boolean => n.endsWith('.mdc');
const isInstructionsName = (n: string): boolean => n.endsWith('.instructions.md');

interface SingleSpec {
  agentKind: AgentKind;
  sourceKind: SourceKind;
  filePath: string;
  parser: SourceParser;
  capabilityNote: string;
}

interface DirSpec {
  agentKind: AgentKind;
  sourceKind: SourceKind;
  dirPath: string;
  parser: SourceParser;
  capabilityNote: string;
  /** 只聚合匹配名称的顶层条目；目录、其他扩展名一律静默忽略。 */
  match: (name: string) => boolean;
}

// ---------------------------------------------------------------------------
// 扫描状态：预算与候选收集
// ---------------------------------------------------------------------------

class ScanState {
  readonly out: SourceCandidate[] = [];
  readonly maxFiles: number;
  readonly maxFileBytes: number;
  remaining: number;
  /** 因预算耗尽而跳过后续计划位置时置位，收尾时补一条全局停止说明。 */
  stopAfterBudget = false;

  constructor(maxFiles: number, maxFileBytes: number) {
    this.maxFiles = maxFiles;
    this.maxFileBytes = maxFileBytes;
    this.remaining = maxFiles;
  }

  get open(): boolean {
    return this.remaining > 0;
  }

  markStop(): void {
    if (this.remaining === 0) this.stopAfterBudget = true;
  }

  async addSingle(spec: SingleSpec): Promise<void> {
    if (!this.open) {
      // 预算耗尽：只做存在性检查；仅当该位置确有可列内容时才记为提前停止，
      // 避免对本来就不存在的来源产生误报说明。
      const ins = await inspectFile(spec.filePath);
      if (ins.type === 'file' || ins.type === 'symlink') this.markStop();
      return;
    }
    const ins = await inspectFile(spec.filePath);
    if (ins.type === 'symlink') {
      // 单文件来源本身是符号链接：不产生可快照来源，只保留跳过说明（fileCount = 0）。
      this.push(spec, spec.filePath, [], [symlinkNote(spec.filePath)]);
      return;
    }
    if (ins.type !== 'file') return; // absent / 目录 / 其他：静默不产生来源
    if (ins.size > this.maxFileBytes) {
      this.push(spec, spec.filePath, [], [oversizedNote(spec.filePath, ins.size, this.maxFileBytes)]);
      return;
    }
    this.remaining -= 1;
    this.push(spec, spec.filePath, [{ path: spec.filePath, size: ins.size }], []);
  }

  async addDir(spec: DirSpec): Promise<void> {
    if (!this.open) {
      // 预算耗尽：只做存在性检查，目录确有匹配条目才记为提前停止。
      if ((await dirTypeOf(spec.dirPath)) === 'directory') {
        const names = await listNames(spec.dirPath);
        if (names.some((n) => spec.match(n))) this.markStop();
      }
      return;
    }
    if ((await dirTypeOf(spec.dirPath)) !== 'directory') return;
    const names = await listNames(spec.dirPath);
    const files: { path: string; size: number }[] = [];
    const notes: string[] = [];
    let truncated = 0;
    for (const name of names) {
      if (!spec.match(name)) continue;
      const filePath = path.join(spec.dirPath, name);
      const ins = await inspectFile(filePath);
      if (ins.type === 'absent' || ins.type === 'other') continue; // 竞态消失或非常规文件：静默
      if (ins.type === 'symlink') {
        notes.push(symlinkNote(filePath));
        continue;
      }
      if (ins.size > this.maxFileBytes) {
        notes.push(oversizedNote(filePath, ins.size, this.maxFileBytes));
        continue;
      }
      if (this.remaining <= 0) {
        truncated += 1;
        continue;
      }
      files.push({ path: filePath, size: ins.size });
      this.remaining -= 1;
    }
    if (truncated > 0) {
      notes.push(`maxFiles: 已达全局文件数上限 ${this.maxFiles}，目录内剩余 ${truncated} 个候选文件未列入`);
    }
    this.push(spec, spec.dirPath, files, notes);
  }

  /** 预算耗尽导致后续计划位置被跳过时，在最后一个候选上补全局停止说明。 */
  finish(): void {
    if (!this.stopAfterBudget || this.out.length === 0) return;
    const last = this.out[this.out.length - 1] as SourceCandidate;
    const notes = last.skippedNotes ?? (last.skippedNotes = []);
    if (!notes.some((n) => n.startsWith('maxFiles:'))) {
      notes.push(`maxFiles: 已达全局文件数上限 ${this.maxFiles}，后续来源位置停止扫描`);
    }
  }

  private push(
    spec: { agentKind: AgentKind; sourceKind: SourceKind; parser: SourceParser; capabilityNote: string },
    candidatePath: string,
    files: { path: string; size: number }[],
    notes: string[],
  ): void {
    if (files.length === 0 && notes.length === 0) return;
    this.out.push({
      agentKind: spec.agentKind,
      sourceKind: spec.sourceKind,
      path: candidatePath,
      parser: spec.parser,
      capabilityNote: spec.capabilityNote,
      byteSize: files.reduce((sum, f) => sum + f.size, 0),
      fileCount: files.length,
      ...(notes.length > 0 ? { skippedNotes: notes } : {}),
    });
  }
}

// ---------------------------------------------------------------------------
// 输入校验与路径边界
// ---------------------------------------------------------------------------

/** 拒绝网络路径（UNC：`\\` 或 `//` 前缀），返回解析后的绝对本地路径。 */
function assertLocalPath(raw: string, label: 'homeDir' | 'projectRoot'): string {
  const resolved = path.resolve(raw);
  for (const candidate of [raw, resolved]) {
    if (candidate.startsWith('\\\\') || candidate.startsWith('//')) {
      throw err('E_FORBIDDEN', `${label} 指向网络路径（UNC），发现阶段禁止访问`, { label });
    }
  }
  return resolved;
}

function resolveProjectRoots(projectRoots: DiscoverOptions['projectRoots']): string[] {
  if (projectRoots === undefined) return [];
  if (!Array.isArray(projectRoots)) throw err('E_VALIDATION', 'projectRoots 必须是字符串数组');
  const fold = process.platform === 'win32' ? (s: string) => s.toLowerCase() : (s: string) => s;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of projectRoots) {
    if (typeof raw !== 'string' || raw.trim() === '') {
      throw err('E_VALIDATION', 'projectRoots 条目必须是非空字符串路径');
    }
    const resolved = assertLocalPath(raw, 'projectRoot');
    const key = fold(resolved);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(resolved);
  }
  return out;
}

function compareCandidates(a: SourceCandidate, b: SourceCandidate): number {
  if (a.agentKind !== b.agentKind) return a.agentKind < b.agentKind ? -1 : 1;
  if (a.path !== b.path) return a.path < b.path ? -1 : 1;
  return 0;
}

// ---------------------------------------------------------------------------
// 各宿主的白名单枚举（顺序固定 → 输出确定）
// ---------------------------------------------------------------------------

/** claude-code：仅 ~/.claude/projects/<各项目目录>/memory/（项目级 CLAUDE.md 与 ~/.claude/CLAUDE.md 首版不扫描）。 */
async function discoverClaudeCodeHome(home: string, state: ScanState): Promise<void> {
  const projectsDir = path.join(home, '.claude', 'projects');
  if ((await dirTypeOf(projectsDir)) !== 'directory') return;
  for (const name of await listNames(projectsDir)) {
    const projectDir = path.join(projectsDir, name);
    // 符号链接/文件形式的 project 条目整项静默跳过：无候选可承载说明，且绝不跟随链接。
    if ((await dirTypeOf(projectDir)) !== 'directory') continue;
    const memoryDir = path.join(projectDir, 'memory');
    // 预算耗尽时 addSingle/addDir 只做存在性检查；确有内容才记为提前停止。
    await state.addSingle({
      agentKind: 'claude-code',
      sourceKind: 'memory',
      filePath: path.join(memoryDir, 'MEMORY.md'),
      parser: 'markdown-memory-index',
      capabilityNote: NOTE_CC_INDEX,
    });
    await state.addDir({
      agentKind: 'claude-code',
      sourceKind: 'memory',
      dirPath: memoryDir,
      parser: 'markdown-topics',
      capabilityNote: NOTE_CC_TOPICS,
      match: (n) => n.endsWith('.md') && n !== 'MEMORY.md',
    });
  }
}

/**
 * 元数据发现：列出可识别的 Agent 记忆与规则来源候选。
 * 只返回元数据；正文读取计数为零；不修改任何来源文件。
 */
export async function discoverSources(opts: DiscoverOptions): Promise<SourceCandidate[]> {
  const { homeDir, projectRoots, maxFiles = DEFAULT_MAX_FILES, maxFileBytes = DEFAULT_MAX_FILE_BYTES } = opts ?? {};
  if (typeof homeDir !== 'string' || homeDir.trim() === '') {
    throw err('E_VALIDATION', 'homeDir 必须是非空字符串路径');
  }
  if (!Number.isInteger(maxFiles) || maxFiles < 1) {
    throw err('E_VALIDATION', `maxFiles 必须是正整数，收到 ${String(maxFiles)}`);
  }
  if (!Number.isInteger(maxFileBytes) || maxFileBytes < 1) {
    throw err('E_VALIDATION', `maxFileBytes 必须是正整数，收到 ${String(maxFileBytes)}`);
  }

  // 先完成全部输入校验（含 UNC 拒绝），再做任何文件系统访问。
  const home = assertLocalPath(homeDir, 'homeDir');
  const roots = resolveProjectRoots(projectRoots);

  const state = new ScanState(maxFiles, maxFileBytes);

  // --- home 级来源 ---
  if ((await dirTypeOf(home)) === 'directory') {
    await discoverClaudeCodeHome(home, state);
    await state.addDir({
      agentKind: 'cursor',
      sourceKind: 'rules',
      dirPath: path.join(home, '.cursor', 'rules'),
      parser: 'mdc-rules',
      capabilityNote: NOTE_CURSOR_RULES,
      match: isMdcName,
    });
    await state.addSingle({
      agentKind: 'openclaw',
      sourceKind: 'memory',
      filePath: path.join(home, '.openclaw', 'workspace', 'USER.md'),
      parser: 'markdown-user-profile',
      capabilityNote: NOTE_OPENCLAW_USER,
    });
    await state.addSingle({
      agentKind: 'openclaw',
      sourceKind: 'memory',
      filePath: path.join(home, '.openclaw', 'workspace', 'MEMORY.md'),
      parser: 'markdown-memory-index',
      capabilityNote: NOTE_OPENCLAW_MEMORY,
    });
    await state.addDir({
      agentKind: 'openclaw',
      sourceKind: 'memory',
      dirPath: path.join(home, '.openclaw', 'workspace', 'memory'),
      parser: 'markdown-daily',
      capabilityNote: NOTE_OPENCLAW_DAILY,
      match: isMdName,
    });
    await state.addSingle({
      agentKind: 'workbuddy',
      sourceKind: 'memory',
      filePath: path.join(home, '.workbuddy', 'exports', 'memory-export.md'),
      parser: 'markdown-export',
      capabilityNote: NOTE_WORKBUDDY,
    });
  }

  // --- 项目根级来源（homeDir 不会自动当作项目根；调用方需要时自行传入）---
  for (const root of roots) {
    if ((await dirTypeOf(root)) !== 'directory') continue;
    await state.addSingle({
      agentKind: 'copilot',
      sourceKind: 'rules',
      filePath: path.join(root, '.github', 'copilot-instructions.md'),
      parser: 'markdown-instructions',
      capabilityNote: NOTE_COPILOT_SINGLE,
    });
    await state.addDir({
      agentKind: 'copilot',
      sourceKind: 'rules',
      dirPath: path.join(root, '.github', 'instructions'),
      parser: 'markdown-instructions',
      capabilityNote: NOTE_COPILOT_DIR,
      match: isInstructionsName,
    });
    await state.addSingle({
      agentKind: 'copilot',
      sourceKind: 'rules',
      filePath: path.join(root, 'AGENTS.md'),
      parser: 'markdown-workspace',
      capabilityNote: NOTE_AGENTS_MD,
    });
    await state.addDir({
      agentKind: 'cursor',
      sourceKind: 'rules',
      dirPath: path.join(root, '.cursor', 'rules'),
      parser: 'mdc-rules',
      capabilityNote: NOTE_CURSOR_RULES,
      match: isMdcName,
    });
  }

  state.finish();
  return state.out.sort(compareCandidates);
}
