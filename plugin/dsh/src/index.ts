/**
 * Cairn 记忆插件（DSH）。
 *
 * 定位：**体验层，不是内核**。
 * 记忆存储、作用域判定、审批全部由 Cairn MCP server 负责；本插件只补 DSH 专属的
 * 实时召回与注入。这是用户选定的 Q1-B：插件以 MCP 为内核，与「守住单一内核」不冲突。
 *
 * 失败策略（design D4）：插件任何一步出错都只跳过本次注入，绝不把错误抛进会话。
 * 降级后模型仍可通过 mcp__cairn__* 工具直接读写记忆。
 */

import {
  createDedupeState,
  filterInjectable,
  renderInjection,
  shouldInject,
  type RecallHit,
} from './recall.js';

export interface PluginConfig {
  enabled?: boolean;
  /** 单次注入的字节预算。 */
  budgetBytes?: number;
  /** 一次召回最多取几条。 */
  topK?: number;
}

export interface RecallFn {
  (query: string, topK: number): Promise<RecallHit[]>;
}

export interface InjectionOutcome {
  injected: boolean;
  reason: string;
  text: string;
  selected: number;
  truncated: number;
}

const DEFAULTS = { enabled: true, budgetBytes: 1536, topK: 5 } as const;

/**
 * 组装一次注入。
 *
 * 把「是否注入 / 召回 / 过滤 / 渲染 / 记账」串起来，但每一步都可单独测试。
 * `recall` 是注入进来的依赖：生产走 MCP，单测用 stub —— 这样插件逻辑不依赖宿主是否可用。
 */
export function createInjector(deps: { recall: RecallFn; config?: PluginConfig }) {
  const cfg = { ...DEFAULTS, ...(deps.config ?? {}) };
  const dedupe = createDedupeState();

  async function runOnce(message: string): Promise<InjectionOutcome> {
    const decision = shouldInject({
      enabled: cfg.enabled,
      alreadyInjected: new Set<string>(),
      message,
    });
    if (!decision.inject) {
      return { injected: false, reason: decision.reason, text: '', selected: 0, truncated: 0 };
    }

    let hits: RecallHit[] = [];
    try {
      hits = await deps.recall(message, cfg.topK);
    } catch (e) {
      // design D4：召回失败只跳过本次注入，不阻塞会话。
      return { injected: false, reason: 'recall_failed: ' + (e as Error).message, text: '', selected: 0, truncated: 0 };
    }

    const safe = filterInjectable(hits);
    const rendered = renderInjection(safe, {
      budgetBytes: cfg.budgetBytes,
      alreadyInjected: { has: (id: string) => dedupe.has(id) } as unknown as ReadonlySet<string>,
    });
    if (rendered.text.length === 0) {
      return { injected: false, reason: 'nothing_new', text: '', selected: 0, truncated: 0 };
    }

    // 记录已注入的 id：只记真正进了文本的那些。
    const injectedIds = safe
      .filter((h) => rendered.text.includes(h.content.split(/\r?\n/)[0]!.trim().slice(0, 20)))
      .map((h) => h.id);
    dedupe.add(injectedIds);

    return {
      injected: true,
      reason: 'ok',
      text: rendered.text,
      selected: rendered.selected,
      truncated: rendered.truncated,
    };
  }

  return { runOnce, resetSession: () => dedupe.reset(), seenCount: () => dedupe.size() };
}

export interface CairnPluginOptions {
  /** 由 DSH 注入的宿主上下文；未提供时插件不注册任何钩子（纯函数模式）。 */
  ctx?: unknown;
  config?: PluginConfig;
  /** 召回实现；生产环境由 MCP client 提供。 */
  recall?: RecallFn;
}

/**
 * Cordis 插件入口。
 *
 * 刻意做成「没给 ctx 也能构造」：这样单测与构建检查不需要宿主在场，
 * 也符合「插件不可用时降级为纯 MCP」的约束。
 */
export function createCairnMemoryPlugin(options: CairnPluginOptions = {}) {
  const injector = options.recall
    ? createInjector({ recall: options.recall, config: options.config })
    : null;

  return {
    name: 'cairn-dsh-memory',
    inject: [] as string[],
    apply(ctx?: unknown): void {
      // 没有召回实现（例如 MCP 未挂上）→ 不注册钩子，静默降级。
      if (!injector) return;
      const hooks = ctx as { on?: (event: string, fn: unknown) => void } | undefined;
      if (!hooks?.on) return;
      hooks.on('agent/pre-step', async (payload: { message?: string }) => {
        const message = payload?.message ?? '';
        const out = await injector.runOnce(message).catch(() => null);
        return out?.injected ? { inject: out.text } : undefined;
      });
    },
    resetSession: () => injector?.resetSession(),
  };
}

export default createCairnMemoryPlugin;
