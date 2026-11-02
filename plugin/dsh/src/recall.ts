/**
 * 召回逻辑（纯函数，可单测）。
 *
 * 这里**不查库、不做检索**——检索走 Cairn 的 MCP 内核（design D1）。
 * 插件只负责三件事：该不该注入、注入什么、注入多少。
 */

import { firstLine } from './usage-state.js';

/** 一条召回命中（来自 Cairn MCP 的返回）。 */
export interface RecallHit {
  id: string;
  kind: string;
  content: string;
  scopeId?: string;
  sensitivity?: string;
  syncPolicy?: string;
}

export interface InjectionInput {
  /** 插件是否启用（跟随全局或按会话）。 */
  enabled: boolean;
  /** 本会话已注入过的记忆 id。 */
  alreadyInjected: ReadonlySet<string>;
  /** 当前用户消息（用于判断是否值得召回）。 */
  message: string;
}

export interface InjectionDecision {
  inject: boolean;
  reason: 'disabled' | 'empty_message' | 'all_seen' | 'ok';
}

/** 极短消息（如「继续」「好」）不值得触发召回：没有可检索的语义内容。 */
const MIN_QUERY_CHARS = 4;

/**
 * 是否应该注入。
 *
 * 刻意保持简单：不做语义判断、不看历史轮次。
 * ponytail: 只按长度阈值过滤，够用；若误判率高再考虑换判据。
 */
export function shouldInject(input: InjectionInput): InjectionDecision {
  if (!input.enabled) return { inject: false, reason: 'disabled' };
  if (input.message.trim().length < MIN_QUERY_CHARS) return { inject: false, reason: 'empty_message' };
  return { inject: true, reason: 'ok' };
}

/**
 * 二次断言：把不该外泄的命中剔除。
 *
 * **这不是复制检索逻辑**——检索与作用域判定仍由 MCP 完成。这里只做一道防线：
 * 万一上游过滤有漏，插件的注入是最后一道闸（spec: 注入内容同样受作用域约束）。
 */
export function filterInjectable(hits: readonly RecallHit[]): RecallHit[] {
  return hits.filter((h) => {
    if (h.sensitivity && h.sensitivity !== 'normal') return false;
    if (h.syncPolicy === 'local_only') return false;
    return true;
  });
}

/** 单条注入行的摘要截断长度。 */
const LINE_MAX = 160;

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
}

export interface RenderResult {
  text: string;
  selected: number;
  truncated: number;
  bytes: number;
}

/**
 * 把命中渲染成一条注入消息。
 *
 * 输出稳定：不含时间戳，同输入同字节（与投影通道保持同一纪律）。
 * 超预算按入参顺序裁剪并写明省略条数——不重排，否则「哪几条被裁」会漂移。
 */
export function renderInjection(
  hits: readonly RecallHit[],
  opts: { budgetBytes: number; alreadyInjected?: ReadonlySet<string> },
): RenderResult {
  if (!Number.isInteger(opts.budgetBytes) || opts.budgetBytes < 0) {
    throw new Error('budgetBytes 必须是非负整数');
  }
  const seen = opts.alreadyInjected ?? new Set<string>();
  const fresh = hits.filter((h) => !seen.has(h.id));
  if (fresh.length === 0) return { text: '', selected: 0, truncated: 0, bytes: 0 };

  const header = '以下记忆可能相关，仅供参照：';
  // 预留省略提示的字节（最坏情况按条数估）
  const noticeBytes = (n: number): number => Buffer.byteLength(`…（另 ${n} 条未显示）`, 'utf8') + 1;
  const maxNotice = noticeBytes(fresh.length);

  const lines: string[] = [];
  let used = Buffer.byteLength(header, 'utf8') + 1;
  let truncated = 0;

  for (let i = 0; i < fresh.length; i++) {
    const h = fresh[i]!;
    const line = `- [${h.kind}] ${truncate(firstLine(h.content), LINE_MAX)}`;
    const lineBytes = Buffer.byteLength(line, 'utf8') + 1;
    if (used + lineBytes + maxNotice > opts.budgetBytes) {
      truncated = fresh.length - i;
      break;
    }
    lines.push(line);
    used += lineBytes;
  }

  if (truncated > 0) {
    const notice = `…（另 ${truncated} 条未显示）`;
    while (lines.length > 0 && used + Buffer.byteLength(notice, 'utf8') + 1 > opts.budgetBytes) {
      const dropped = lines.pop()!;
      used -= Buffer.byteLength(dropped, 'utf8') + 1;
      truncated += 1;
    }
    if (used + Buffer.byteLength(notice, 'utf8') + 1 <= opts.budgetBytes) lines.push(notice);
  }

  const text = [header, ...lines].join('\n');
  return {
    text,
    selected: lines.length - (truncated > 0 && lines.length > 0 && lines[lines.length - 1]!.startsWith('…') ? 1 : 0),
    truncated,
    bytes: Buffer.byteLength(text, 'utf8'),
  };
}

/** 会话级去重状态。内存态，会话压缩时清空（design D3）。 */
export function createDedupeState(): {
  has(id: string): boolean;
  add(ids: readonly string[]): void;
  reset(): void;
  size(): number;
} {
  let seen = new Set<string>();
  return {
    has: (id) => seen.has(id),
    add: (ids) => { for (const id of ids) seen.add(id); },
    reset: () => { seen = new Set<string>(); },
    size: () => seen.size,
  };
}
