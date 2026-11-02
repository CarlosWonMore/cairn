/**
 * 记忆调用状态：供 UI 面板读取的形状。
 *
 * 两条硬约束（design D2/D3）：
 * 1. 三态必须能用**文字**区分，不能只靠颜色——「被过滤」和「没找到」
 *    在用户眼里都是「什么都没发生」，但后者可能是安全规则正常工作。
 * 2. 只放摘要，**正文永不进入状态**。面板是高频可见区域，正文进来等于扩大泄露面。
 */

export type UsageStatus = 'injected' | 'filtered' | 'miss';

export interface InjectedMemory {
  id: string;
  kind: string;
  /** 摘要，不超过 60 字符，单行。 */
  summary: string;
}

export interface RecallUsage {
  status: UsageStatus;
  /** 本轮命中的候选数（过滤前）。 */
  candidates: number;
  /** 实际进入注入的条目。 */
  injected: InjectedMemory[];
  /** 命中通道。 */
  matchedBy: string;
  bytesUsed: number;
  bytesBudget: number;
  /** 因作用域/敏感被排除的条数。只计数，不记内容。 */
  filteredCount: number;
  /** 人类可读的状态文案（三态用文字标明）。 */
  label: string;
}

const SUMMARY_MAX = 60;

/**
 * 取正文的「第一段有意义的内容」。
 *
 * 2026-11-02 实测缺陷：不少记忆以 YAML frontmatter 开头（`---\nname: ...`），
 * 直接取首个非空行只会得到 `---`，面板上 4 条摘要全是横线。
 * 这里跳过分隔线与 frontmatter 的 `key: value` 行，优先用 `name:` / `description:`
 * 的值作摘要；都没有才退回首个真正的正文行。
 */
export function firstLine(s: string): string {
  const lines = s.split(/\r?\n/).map((l) => l.trim());
  const isSeparator = (l: string): boolean => l === '---' || l === '***' || l === '...';
  const field = (key: string): string => {
    const re = new RegExp('^' + key + '\\s*:\\s*(.+)$');
    for (const l of lines) {
      const m = re.exec(l);
      if (m && m[1]) return m[1].trim().replace(/^["']|["']$/g, '');
    }
    return '';
  };
  const named = field('name');
  if (named) return named;
  const described = field('description');
  if (described) return described;
  for (const l of lines) {
    if (!l || isSeparator(l)) continue;
    if (/^[A-Za-z_][\w-]*\s*:/.test(l)) continue;
    return l;
  }
  return '';
}
export function toSummary(content: string, max = SUMMARY_MAX): string {
  const line = firstLine(content);
  return line.length <= max ? line : line.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
}

export interface BuildUsageInput {
  /** 过滤前的候选数。 */
  candidates: number;
  /** 过滤后的安全条目。 */
  injectable: { id: string; kind: string; content: string }[];
  /** 实际进入文本的 id。 */
  injectedIds: string[];
  matchedBy: string;
  bytesUsed: number;
  bytesBudget: number;
  filteredCount: number;
}

const LABELS: Record<UsageStatus, string> = {
  injected: '已注入',
  filtered: '已过滤',
  miss: '未命中',
};

/**
 * 「还没有任何召回」时对外给出的完整形状。
 *
 * 2026-11-02 的教训：曾经用 `{status:'miss',label:'未命中'}` 当兜底，
 * client 详情段读 `usage.injected.length` 直接抛 TypeError，被宿主 slot
 * crash boundary 整个卸载——面板「一闪即逝」。对外形状必须字段完备，
 * 消费端（浏览器）没有崩溃的权利。
 */
export const EMPTY_USAGE: RecallUsage = {
  status: 'miss',
  candidates: 0,
  injected: [],
  matchedBy: 'none',
  bytesUsed: 0,
  bytesBudget: 0,
  filteredCount: 0,
  label: LABELS.miss,
};

/**
 * 三态判定：
 * - 有实际注入 → injected
 * - 没注入但候选里有被过滤的 → filtered（**不是 miss**，这是本设计的核心）
 * - 候选为空 → miss
 */
export function buildUsage(input: BuildUsageInput): RecallUsage {
  const injected = injectableToInjected(input.injectable, input.injectedIds);
  let status: UsageStatus;
  if (injected.length > 0) status = 'injected';
  else if (input.filteredCount > 0) status = 'filtered';
  else status = 'miss';

  return {
    status,
    candidates: input.candidates,
    injected,
    matchedBy: input.matchedBy,
    bytesUsed: input.bytesUsed,
    bytesBudget: input.bytesBudget,
    filteredCount: input.filteredCount,
    label: LABELS[status],
  };
}

function injectableToInjected(
  items: { id: string; kind: string; content: string }[],
  injectedIds: string[],
): InjectedMemory[] {
  const allow = new Set(injectedIds);
  return items
    .filter((i) => allow.has(i.id))
    .map((i) => ({ id: i.id, kind: i.kind, summary: toSummary(i.content) }));
}
