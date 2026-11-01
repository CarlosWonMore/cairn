import { err } from '../core/errors.js';

/**
 * Cordis 插件树 patch 文件的**行级**编辑器（tasks 2.1–2.4，design D2/D3）。
 *
 * 为什么不用 YAML 库：
 * - 项目运行时依赖只有三项，不为一个宿主再加依赖；
 * - 更要紧的是，任何 YAML 反序列化再序列化都会丢失注释与键序，而 cordis.patch.yml
 *   是 DSH 与用户共写的共享文件（本机实测 43 KB / 1277 行，含用户注释）。
 *
 * 因此这里只做一件事：定位**本产品那一个** `- insert:` 块，整体替换或删除它。
 * 认不出的结构一律硬失败（E_CONFIG_CONFLICT），绝不猜测性重写。
 *
 * 目标文件形态（实测样本）：
 *
 *     # 注释行
 *     - { id: some-entry, disabled: false }
 *     - id: some-plugin
 *       name: "@deepseek-ai/some-plugin"
 *       config:
 *         key: value
 *     - insert:
 *         - id: mcp-cairn
 *           name: "@deepseek-ai/dsh-mcp-client"
 *           config:
 *             serverName: cairn
 *     - id: another-plugin
 */

/** 本产品在 DSH 侧的条目 id 与插件名（与手工接入时一致，便于识别既有安装）。 */
export const CAIRN_DSH_ENTRY_ID = 'mcp-cairn';
export const CAIRN_DSH_PLUGIN_NAME = '@deepseek-ai/dsh-mcp-client';

const INSERT_LINE = /^(\s*)- insert:\s*$/;
const ROW_LINE = /^(\s*)- /;
const CAIRN_ID_LINE = new RegExp(`^(\\s*)- id:\\s*${CAIRN_DSH_ENTRY_ID}\\s*$`);

export interface PatchBlock {
  /** `- insert:` 行的行下标（0 基）。 */
  startLine: number;
  /** 块最后一行的下一个下标（不含）。 */
  endLine: number;
  /** `- insert:` 自身缩进（字符数）。 */
  indent: number;
  /** 块内是否含本产品条目。 */
  containsCairn: boolean;
}

function splitLines(text: string): string[] {
  return text.split('\n');
}

function indentOf(line: string): number {
  const m = /^(\s*)/.exec(line);
  return m === null ? 0 : m[1]!.length;
}

function isBlank(line: string): boolean {
  return line.trim().length === 0;
}

function isComment(line: string): boolean {
  return line.trimStart().startsWith('#');
}

/**
 * 找出顶层（缩进为 0）的 `- insert:` 块。
 *
 * 块范围：从 `- insert:` 行开始，向下直到遇到「缩进 <= insert 缩进 且以 `- ` 开头」的下一行，
 * 或文件结束。空行与注释行若出现在块*内部*会被吸收（它们属于该块），
 * 但**末尾**的连续空行不计入块（避免删块时把段落分隔也删掉）。
 */
export function scanPatchBlocks(text: string): PatchBlock[] {
  const lines = splitLines(text);
  const blocks: PatchBlock[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const m = INSERT_LINE.exec(line);
    if (m === null) continue;
    // 只认顶层 insert（缩进 0）；嵌套 insert 语义未验证，遇到即视为结构不符。
    if (m[1]!.length !== 0) {
      throw err(
        'E_CONFIG_CONFLICT',
        `cordis.patch.yml 第 ${i + 1} 行出现非顶层的 insert 块：本适配器只处理顶层 insert，拒绝猜测嵌套语义`,
      );
    }
    let end = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      const cur = lines[j]!;
      if (isBlank(cur) || isComment(cur)) continue;
      const row = ROW_LINE.exec(cur);
      if (row !== null && row[1]!.length <= 0) {
        end = j;
        break;
      }
    }
    // 修剪块尾的空行/注释行，使其留在块外
    let trimmed = end;
    while (trimmed > i + 1) {
      const prev = lines[trimmed - 1]!;
      if (isBlank(prev) || isComment(prev)) trimmed--;
      else break;
    }
    const body = lines.slice(i, trimmed);
    const containsCairn = body.some((l) => CAIRN_ID_LINE.test(l));
    blocks.push({ startLine: i, endLine: trimmed, indent: 0, containsCairn });
    i = trimmed - 1;
  }
  return blocks;
}

/** 本产品块的唯一性校验：0 个 → null；1 个 → 该块；≥2 → 结构不符。 */
export function findCairnInsert(text: string): PatchBlock | null {
  // 先确认这是顶层数组形态：否则"没找到本产品块"与"根本不是 patch 文件"会被混为一谈。
  assertTopLevelArray(splitLines(text));
  const blocks = scanPatchBlocks(text);
  const ours = blocks.filter((b) => b.containsCairn);
  if (ours.length > 1) {
    throw err(
      'E_CONFIG_CONFLICT',
      `cordis.patch.yml 中出现 ${ours.length} 个含 ${CAIRN_DSH_ENTRY_ID} 的 insert 块：结构不确定，拒绝改动（请先手工合并为一块）`,
    );
  }
  return ours[0] ?? null;
}

export interface CordisEntrySpec {
  /** MCP 命令（如 node 的绝对路径）。 */
  command: string;
  /** 命令参数（如 server.js 的绝对路径）。 */
  args: string[];
}

function yamlQuote(v: string): string {
  // 只用双引号并转义反斜杠与双引号：对 Windows 路径足够，且不引入 YAML 库的转义规则。
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * 渲染本产品的 insert 块（含 `- insert:` 行）。
 *
 * 采用与手工接入时一致的缩进（insert 的列表项缩进 4 空格，其字段缩进 6 空格），
 * 因为该形态已在真实 DSH 上验证过能被正确加载。
 */
export function renderCairnInsert(spec: CordisEntrySpec): string[] {
  if (typeof spec.command !== 'string' || spec.command.length === 0) {
    throw err('E_VALIDATION', 'cordis insert: command 不能为空');
  }
  if (!Array.isArray(spec.args)) throw err('E_VALIDATION', 'cordis insert: args 必须是数组');
  const out = [
    '- insert:',
    `    - id: ${CAIRN_DSH_ENTRY_ID}`,
    `      name: ${yamlQuote(CAIRN_DSH_PLUGIN_NAME)}`,
    '      config:',
    '        serverName: cairn',
    '        transport: stdio',
    `        command: ${yamlQuote(spec.command)}`,
  ];
  if (spec.args.length === 0) {
    out.push('        args: []');
  } else {
    out.push('        args:');
    for (const a of spec.args) out.push(`          - ${yamlQuote(a)}`);
  }
  out.push('        failOnStartupError: false');
  return out;
}

function assertTopLevelArray(lines: string[]): void {
  const meaningful = lines.findIndex((l) => !isBlank(l) && !isComment(l));
  if (meaningful < 0) {
    throw err('E_CONFIG_CONFLICT', 'cordis.patch.yml 没有任何条目行：拒绝在空文件上猜测结构');
  }
  const first = lines[meaningful]!;
  const row = ROW_LINE.exec(first);
  if (row === null || row[1]!.length !== 0) {
    throw err(
      'E_CONFIG_CONFLICT',
      `cordis.patch.yml 顶层不是 YAML 数组（首个有效行: ${JSON.stringify(first.slice(0, 60))}）：拒绝改动`,
    );
  }
}

export interface UpsertResult {
  output: string;
  changed: boolean;
  /** 本次是新增、替换还是未变。 */
  action: 'inserted' | 'replaced' | 'unchanged';
}

/**
 * 新增或替换本产品的 insert 块（task 2.2）。
 *
 * - 不存在 → 追加到文件末尾（保留原结尾换行风格）；
 * - 存在且内容不同 → 整体替换该块；
 * - 存在且内容相同 → changed=false，输出逐字节等于输入（幂等）。
 */
export function upsertCairnInsert(text: string, spec: CordisEntrySpec): UpsertResult {
  const lines = splitLines(text);
  assertTopLevelArray(lines);
  const rendered = renderCairnInsert(spec);
  const existing = findCairnInsert(text);

  if (existing === null) {
    const endsWithNewline = text.endsWith('\n');
    const base = endsWithNewline ? text.slice(0, -1) : text;
    const separated = base.length === 0 ? '' : base + '\n';
    return { output: separated + rendered.join('\n') + '\n', changed: true, action: 'inserted' };
  }

  const current = lines.slice(existing.startLine, existing.endLine);
  if (current.join('\n') === rendered.join('\n')) {
    return { output: text, changed: false, action: 'unchanged' };
  }
  const next = [...lines.slice(0, existing.startLine), ...rendered, ...lines.slice(existing.endLine)];
  return { output: next.join('\n'), changed: true, action: 'replaced' };
}

export interface RemoveResult {
  output: string;
  changed: boolean;
}

/**
 * 移除本产品的 insert 块（task 2.3）。
 *
 * 删除的是**整个** `- insert:` 块（含其首行），而不是只删内部行——
 * 否则会留下空的 `insert:`，DSH 侧表现为 dangling patch row。
 */
export function removeCairnInsert(text: string): RemoveResult {
  const existing = findCairnInsert(text);
  if (existing === null) return { output: text, changed: false };
  const lines = splitLines(text);
  let start = existing.startLine;
  // 连带吃掉紧邻的前导空行，避免卸载后留下多余空行
  while (start > 0 && isBlank(lines[start - 1]!) && existing.endLine === lines.length) start--;
  const next = [...lines.slice(0, start), ...lines.slice(existing.endLine)];
  let out = next.join('\n');
  if (out.length > 0 && !out.endsWith('\n')) out += '\n';
  return { output: out, changed: true };
}

/** 是否已含本产品条目（doctor 用；结构不符时同样抛出）。 */
export function hasCairnInsert(text: string): boolean {
  return findCairnInsert(text) !== null;
}
