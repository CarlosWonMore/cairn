/**
 * Cairn 记忆插件（DSH）。
 *
 * 定位：**体验层，不是内核**。记忆存储、作用域判定、审批全部由 Cairn MCP server 负责。
 *
 * 三条踩过的坑（改实现前必读）：
 * 1. Cordis 用 Proxy 拦截 ctx 属性读取，**未在 inject 声明的服务一律抛**
 *    `cannot get property "x" without inject`，插件直接 fiberPhase: failed。
 *    因此插件对象只暴露 name / inject / apply，其余状态藏在闭包里。
 * 2. `agent/pre-step` 的真实签名是 `(payload, next)`，payload 含 { agent, signal }，
 *    且**必须 return next()** —— 不调用 next 会卡住整条链路。
 * 3. 调 MCP 工具需要 `inject: ['tools']`，工具名形如 mcp__cairn__memory_search。
 */

import {
  createDedupeState,
  filterInjectable,
  renderInjection,
  shouldInject,
  type RecallHit,
} from './recall.js';
import { buildUsage, type RecallUsage } from './usage-state.js';

export interface PluginConfig {
  enabled?: boolean;
  budgetBytes?: number;
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

export function createInjector(deps: { recall: RecallFn; config?: PluginConfig }) {
  const cfg = { ...DEFAULTS, ...(deps.config ?? {}) };
  const dedupe = createDedupeState();
  /** 最近一次召回的使用情况，供 UI 面板读取。 */
  let lastUsage: RecallUsage | null = null;

  async function runOnce(message: string): Promise<InjectionOutcome> {
    const decision = shouldInject({ enabled: cfg.enabled, alreadyInjected: new Set(), message });
    if (!decision.inject) {
      return { injected: false, reason: decision.reason, text: '', selected: 0, truncated: 0 };
    }
    let hits: RecallHit[] = [];
    try {
      hits = await deps.recall(message, cfg.topK);
    } catch (e) {
      return { injected: false, reason: 'recall_failed: ' + (e as Error).message, text: '', selected: 0, truncated: 0 };
    }
    const safe = filterInjectable(hits);
    const filteredCount = hits.length - safe.length;
    const rendered = renderInjection(safe, {
      budgetBytes: cfg.budgetBytes,
      alreadyInjected: { has: (id: string) => dedupe.has(id) } as unknown as ReadonlySet<string>,
    });

    // 记录本轮使用情况：三态由 buildUsage 判定，正文不进状态（只放摘要）。
    lastUsage = buildUsage({
      candidates: hits.length,
      injectable: safe.map((h) => ({ id: h.id, kind: h.kind, content: h.content })),
      injectedIds: safe
        .filter((h) => h.content && rendered.text.includes(h.content.split(/\r?\n/)[0]!.trim().slice(0, 20)))
        .map((h) => h.id),
      matchedBy: 'fts',
      bytesUsed: rendered.bytes,
      bytesBudget: cfg.budgetBytes,
      filteredCount,
    });

    if (rendered.text.length === 0) {
      return { injected: false, reason: 'nothing_new', text: '', selected: 0, truncated: 0 };
    }
    // 只记真正进了文本的那些，避免把被裁掉的也标记为已注入。
    const injectedIds = safe
      .filter((h) => rendered.text.includes(h.content.split(/\r?\n/)[0]!.trim().slice(0, 20)))
      .map((h) => h.id);
    dedupe.add(injectedIds);
    return { injected: true, reason: 'ok', text: rendered.text, selected: rendered.selected, truncated: rendered.truncated };
  }

  return {
    runOnce,
    lastUsage: () => lastUsage,
    resetSession: () => dedupe.reset(),
    seenCount: () => dedupe.size(),
  };
}

/** 从 ctx.tools 取 Cairn 检索能力的适配器；拿不到就返回 null（降级）。 */
function makeToolRecall(ctx: unknown): RecallFn | null {
  const tools = (ctx as { tools?: { call?: Function } } | undefined)?.tools;
  if (!tools || typeof tools.call !== 'function') return null;
  return async (query: string, topK: number) => {
    const res = await tools.call!('mcp__cairn__memory_search', { query, limit: topK });
    // MCP 返回形如 { content: [{ type, text }] }，正文是 JSON 字符串。
    const text = Array.isArray((res as { content?: unknown[] })?.content)
      ? ((res as { content: { text?: string }[] }).content[0] ?? {}).text ?? ''
      : '';
    const parsed = text ? (JSON.parse(text) as { items?: RecallHit[] }) : {};
    return Array.isArray(parsed.items) ? parsed.items : [];
  };
}

/**
 * 构造注入消息。
 *
 * 刻意不依赖宿主 createUserMessage：用最小可辨识形状（role/content/source），
 * 拿不到宿主工具函数时也能构造。真实宿主若要求更严格的形状，
 * 这一层就是唯一的改动点。
 */
export function makeInjectionMessage(text: string): { role: 'user'; content: { type: 'text'; text: string }[]; source: { kind: string } } {
  return {
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'cairn-memory-injection' },
  };
}

/** 插件名（必须与 package.json name 和 patch 行一致）。 */
export const name = 'cairn-dsh-memory';

/** 依赖的宿主服务：调 MCP 工具需要 tools。 */
export const inject = ['tools'] as string[];

/**
 * 插件入口。
 *
 * **必须是模块级导出的普通函数，不能是工厂函数**（踩过三次的坑）——
 * Cordis 的加载器见 `typeof plugin === 'function'` 就把它当 apply 调用：
 *   `apply: (ctx) => plugin(guarded(ctx))`
 * 于是传入的 ctx 变成第一个参数（若签名是 createXxx(options)，options 就是 ctx 的
 * Proxy，读 options.config / options.recall 立刻抛 cannot get property without inject）。
 * 正确形状是 `export default { name, inject, apply }`，apply 签名 (ctx, config)。
 */
export function apply(ctx: unknown, runtimeConfig?: PluginConfig): void {
  const config = runtimeConfig ?? {};
  // 第四轮面板排查：tools 服务（MCP stdio）是异步就绪的——apply 时可能尚未可用。
  // 绝不能在这里提前 return，否则 usage 路由与 pre-step 钩子全部丢失
  //（面板不可见 + 召回失效的直接根因）。recall 缺失时降级为空召回。
  const nullRecall: RecallFn = async () => [];
  const recall = makeToolRecall(ctx) ?? nullRecall;

  const injector = createInjector({ recall, config });

  // Client 面板通过这个端点取状态：Host 与 Client 分处两个进程，只能走 HTTP。
  // 只返回摘要级信息，正文永不外传（design D3）。
  const usagePath = '/plugins/cairn-dsh-memory/usage';
  let usageRegistered = false;
  const serveUsage = (req: { method?: string }, res: { writeHead?: Function; end?: Function }): void => {
    if (req.method !== 'GET') {
      res.writeHead?.(405, { 'content-type': 'application/json' });
      res.end?.(JSON.stringify({ error: 'method not allowed' }));
      return;
    }
    const usage = injector.lastUsage();
    res.writeHead?.(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end?.(JSON.stringify(usage ?? { status: 'miss', label: '未命中' }));
  };
  const registerUsageOn = (webServer: { register: (o: unknown) => unknown }): void => {
    webServer.register({
      kind: 'exact',
      path: usagePath,
      handler: serveUsage,
    });
    usageRegistered = true;
  };
  // 第三轮面板排查（toZcode-panel.md）：include-fiber 的 ctx 形态不确定——
  // 路径 1 走 runtime ctx.inject（与 dsh-client-modules 同款），路径 2 走直接属性访问；
  // 都失败只影响面板（诚实降级），不影响召回。诊断走 console.warn → host.stderr → DSH 日志。
  try {
    const c = ctx as { inject?: (deps: string[], cb: (c: unknown) => void) => unknown; webServer?: { register: (o: unknown) => unknown } };
    if (typeof c.inject === 'function') {
      c.inject(['webServer'], (webCtx: unknown) => {
        const web = webCtx as { webServer?: { register: (o: unknown) => unknown } };
        if (web && typeof web.webServer?.register === 'function') registerUsageOn(web.webServer);
      });
    }
  } catch (e) {
    console.warn('[cairn-dsh-memory] usage route path-1 failed:', (e as Error).message);
  }
  if (!usageRegistered) {
    try {
      const web = (ctx as { webServer?: { register: (o: unknown) => unknown } }).webServer;
      if (web && typeof web.register === 'function') registerUsageOn(web);
      else console.warn('[cairn-dsh-memory] webServer service unavailable; usage panel endpoint not registered');
    } catch (e) {
      console.warn('[cairn-dsh-memory] usage route path-2 failed:', (e as Error).message);
    }
  }

  // pre-step 的 payload 不含用户原文（只有 { agent, signal }），
  // 所以从 session/event 的 user/message 攒最近一条。
  let lastUserMessage = '';

  const hooks = ctx as { on?: (event: string, fn: unknown) => void } | undefined;
  if (typeof hooks?.on !== 'function') return;

  try {
    hooks.on('session/event', (evt: { type?: string; message?: { content?: { text?: string }[] } }) => {
      try {
        if (evt?.type !== 'user/message') return;
        const text = (evt.message?.content ?? []).map((c) => c?.text ?? '').join(' ').trim();
        if (text.length > 0) lastUserMessage = text;
      } catch {
        /* 结构不符就忽略 */
      }
    });
  } catch {
    /* 注册失败降级 */
  }

  try {
    hooks.on(
      'agent/pre-step',
      async (payload: { agent?: { inject?: (m: unknown) => void } }, next?: () => unknown) => {
        try {
          const out = await injector.runOnce(lastUserMessage);
          if (out.injected && typeof payload?.agent?.inject === 'function') {
            payload.agent.inject(makeInjectionMessage(out.text));
          }
        } catch {
          /* 任何异常都只跳过本次注入 */
        }
        // 必须调用 next()，否则整条链路卡住。
        return typeof next === 'function' ? next() : undefined;
      },
    );
  } catch {
    /* 注册失败降级 */
  }
}

/** Cordis 约定的默认导出：插件对象。 */
export default { name, inject, apply };
