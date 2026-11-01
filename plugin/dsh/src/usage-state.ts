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

function firstLine(s: string): string {
  const line = s.split(/\r?\n/).find((l) => l.trim().length > 0) ?? '';
  return line.trim();
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
