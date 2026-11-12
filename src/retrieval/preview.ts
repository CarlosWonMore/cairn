/**
 * 检索预览的单点投影（add-two-stage-memory-recall D2）。
 *
 * 语义与插件面板的 firstLine（usage-state.ts）同源：frontmatter 结构行不进预览，
 * name:/description: 值优先。差异只有两点——这里输出**单行**（注入行是单行格式）、
 * **有界**（默认 300 字符），并如实报告 truncated 与原始长度。
 *
 * 不变量（与投影通道同一纪律，brief.ts:5-17）：
 * - 确定性：同输入同字节，不含 now() 等易变因素；
 * - 纯函数：不读库、无副作用。
 *
 * 这是「摘要怎么算」的唯一出处——插件消费端直接渲染 preview，不再各自截断全文。
 */

export interface MemoryPreview {
  preview: string;
  /** 有效内容超出预览上限时为 true（预览外还有正文，全文经 memory_get）。 */
  truncated: boolean;
  /** 原始正文总长（字符数）。 */
  contentLength: number;
}

export const PREVIEW_MAX = 300;

function isSeparator(l: string): boolean {
  return l === '---' || l === '***' || l === '...';
}

function isStructLine(l: string): boolean {
  return /^[A-Za-z_][\w-]*\s*:/.test(l);
}

function fieldValue(lines: string[], key: string): string {
  const re = new RegExp('^' + key + '\\s*:\\s*(.+)$');
  for (const l of lines) {
    const m = re.exec(l);
    if (m && m[1]) return m[1].trim().replace(/^["']|["']$/g, '');
  }
  return '';
}

/** frontmatter 感知的有效内容行：跳过 frontmatter 块、空行、分隔线与结构行。 */
function meaningfulLines(content: string): string[] {
  const lines = content.split(/\r?\n/).map((l) => l.trim());
  let start = 0;
  if (lines[0] !== undefined && isSeparator(lines[0]!)) {
    let close = 1;
    while (close < lines.length && !isSeparator(lines[close]!)) close++;
    start = close < lines.length ? close + 1 : 0; // 未闭合 → 视为无 frontmatter
  }
  const out: string[] = [];
  for (let i = start; i < lines.length; i++) {
    const l = lines[i]!;
    if (!l || isSeparator(l) || isStructLine(l)) continue;
    out.push(l);
  }
  return out;
}

export function memoryPreview(content: string, max: number = PREVIEW_MAX): MemoryPreview {
  const contentLength = content.length;
  const lines = content.split(/\r?\n/).map((l) => l.trim());
  const head = fieldValue(lines, 'name') || fieldValue(lines, 'description');
  const body = meaningfulLines(content);
  const stream = (head ? [head, ...body] : body).join(' ');
  // 单行化：折叠连续空白（换行、多空格），预览就是一行摘要。
  const flat = stream.replace(/\s+/g, ' ').trim();
  const truncated = flat.length > max;
  const preview = truncated ? flat.slice(0, max - 1).trimEnd() + '…' : flat;
  return { preview, truncated, contentLength };
}
