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

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  createDedupeState,
  filterInjectable,
  renderInjection,
  shouldInject,
  type RecallHit,
} from './recall.js';
import { buildUsage, EMPTY_USAGE, type RecallUsage } from './usage-state.js';

export interface PluginConfig {
  enabled?: boolean;
  budgetBytes?: number;
  topK?: number;
  /**
   * 留痕配置（活动记录写哪些动作）。
   * 审计完整性原则：记录默认全开；展示层的筛选/程度/时长由面板自己配。
   */
  record?: { /** 每轮对话前的自动召回。 */ recall?: boolean; /** 所有经 cairn MCP 工具的调用（含 agent 手动拉取）。 */ tools?: boolean };
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

/**
 * 把一句自然语言消息拆成一组**短查询**。
 *
 * 2026-11-02 实测教训：整句直接当查询词，FTS5 trigram 要求整段子串命中，
 * 候选恒 0。cairn 检索的分词只按标点切连续 CJK 段（≥3 字整段进 FTS 短语、
 * 2 字走有界 LIKE），所以这里在插件侧补上「消息 → 查询组」的构造，按命中
 * 可靠性排序：CJK 2-gram（top2，走 LIKE 通道，最可靠）→ ASCII 词（top2）→
 * 标点短句（各取前 8 字，FTS 短语）→ 整句前 24 字（用户引用原文时兜底）。
 * 去重、上限 max（默认 6）条——多几路查询对本地 SQLite 是微秒级开销。
 */
export function deriveQueries(message: string, max = 6): string[] {
  const out: string[] = [];
  const push = (q: string | undefined): void => {
    const t = (q ?? '').trim();
    if (t.length >= 2 && out.length < max && !out.includes(t)) out.push(t);
  };

  const clean = message.replace(/[^\u4e00-\u9fffA-Za-z0-9]+/g, '');
  const cjkGrams = new Map<string, number>();
  for (let i = 0; i + 2 <= clean.length; i++) {
    const g = clean.slice(i, i + 2);
    if (/^[\u4e00-\u9fff]{2}$/.test(g)) cjkGrams.set(g, (cjkGrams.get(g) ?? 0) + 1);
  }
  [...cjkGrams.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .forEach(([g]) => push(g));

  const asciiWords = new Map<string, number>();
  for (const w of message.match(/[A-Za-z0-9]{3,}/g) ?? []) asciiWords.set(w, (asciiWords.get(w) ?? 0) + 1);
  [...asciiWords.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .forEach(([w]) => push(w));

  for (const clause of message.split(/[，。！？!?；;、,.\n\r\t\s]+/)) {
    push(clause.slice(0, 8));
  }
  push(message.slice(0, 24));
  return out;
}

/**
 * 从 ctx.tools 取 Cairn 检索能力。
 *
 * **2026-11-02 实测纠正**：`ctx.tools.call(name, args)` 不存在（宿主里 `tools.call(` 零出现，
 * 运行时内省 `callType: "undefined"`）。tools 服务的原型方法只有 register/restrict/guard/
 * view/get/resolveExecution 等「注册与管控」接口。
 *
 * 真正的执行入口在**工具定义**上：`tools.get(name, scope)` → `definition.call(args, execution)`。
 * dsh-ops 也这么用（`tools.get(OFFICIAL_REPLACEMENTS[tool], agent)`）。
 */
function makeToolRecall(ctx: unknown, onOwnCall?: () => void): RecallFn | null {
  const tools = (ctx as {
    tools?: {
      get?: (name: string, scope?: unknown) => { call?: (args: unknown, exec: unknown) => Promise<unknown> } | undefined;
    };
  } | undefined)?.tools;
  if (!tools || typeof tools.get !== 'function') return null;

  return async (message: string, topK: number) => {
    const seen = new Set<string>();
    const merged: RecallHit[] = [];
    for (const query of deriveQueries(message)) {
      onOwnCall?.();
      const def = tools.get!('mcp__cairn__memory_search');
      if (typeof def?.call !== 'function') return [];
      // execution 参数：宿主 executor 传的是执行上下文（含 signal）。
      // 这里只需最小可辨识形状；缺 signal 时工具多半不读它，实测为准。
      const exec = { signal: new AbortController().signal };
      let res: unknown;
      try {
        res = await def.call({ query, limit: topK }, exec);
      } catch {
        continue; // 单路查询失败不影响其它路
      }
      const text = Array.isArray((res as { content?: unknown[] })?.content)
        ? ((res as { content: { text?: string }[] }).content[0] ?? {}).text ?? ''
        : '';
      let items: RecallHit[] = [];
      try {
        const parsed = text ? (JSON.parse(text) as { items?: RecallHit[] }) : {};
        items = Array.isArray(parsed.items) ? parsed.items : [];
      } catch {
        /* 非 JSON 响应：本路 0 条 */
      }
      for (const hit of items) {
        if (hit?.id && !seen.has(hit.id)) {
          seen.add(hit.id);
          merged.push(hit);
        }
      }
      if (merged.length >= topK) break;
    }
    return merged.slice(0, topK);
  };
}
/**
 * 从消息 content 字段提取纯文本。
 *
 * 兼容三种形态：字符串、`{type:'text',text}` 数组、单个 `{text}` 对象——
 * 宿主消息结构只从 asar 反推过，不能赌单一形状。
 */
export function extractText(content: unknown): string {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((c) => (typeof (c as { text?: string })?.text === 'string' ? (c as { text: string }).text : ''))
      .join(' ')
      .trim();
  }
  if (content && typeof content === 'object' && typeof (content as { text?: string }).text === 'string') {
    return ((content as { text: string }).text) ?? '';
  }
  return '';
}

/**
 * 从 pre-step payload 提取召回用文本。
 *
 * 2026-11-02 asar 实锤：waterfall 载荷是 `{ messages, ...position, signal }`，
 * messages 里就有本轮用户输入——**不依赖 session/event 攒消息**（旧做法读
 * `evt.message`，而真实形状是 `evt.data`，导致用户消息永远抓不到、召回一次没跑过）。
 * 从末尾向前找第一条有文本的 user（或未标 role）消息。
 */
export function extractStepText(payload: unknown): string {
  const messages = (payload as { messages?: unknown } | null | undefined)?.messages;
  if (!Array.isArray(messages)) return '';
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as { role?: string; content?: unknown } | null | undefined;
    const role = typeof m?.role === 'string' ? m.role : 'user';
    if (role !== 'user') continue;
    const text = extractText(m?.content);
    if (text.length > 0) return text;
  }
  return '';
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

// ———— 活动持久化（用户开关，默认关＝仅内存）————
// 开关状态落一个 marker 文件（存在即开），活动日志是 JSONL（每行一条摘要）。
// 目录随 Cairn 主权根走（CAIRN_HOME 优先，否则 ~/.cairn），与记忆数据同域。
export type ActivityEntry = { t: string; kind: 'recall' | 'tool'; summary: string };

export const ACTIVITY_FILE = 'activity-dsh.jsonl';
const ACTIVITY_ENABLED_MARKER = 'activity-dsh.enabled';
const ACTIVITY_RING_LIMIT = 120;
/** 轮转阈值：超过即滚动为 .old（默认 2MB；测试可用 CAIRN_ACTIVITY_MAX_BYTES 调小）。 */
function activityMaxBytes(): number {
  const v = Number(process.env.CAIRN_ACTIVITY_MAX_BYTES);
  return Number.isFinite(v) && v > 0 ? v : 2 * 1024 * 1024;
}

export function activityDir(): string {
  const home = process.env.CAIRN_HOME;
  return home && home.trim().length > 0 ? home : join(homedir(), '.cairn');
}

function activityPath(): string {
  return join(activityDir(), ACTIVITY_FILE);
}

function activityEnabledPath(): string {
  return join(activityDir(), ACTIVITY_ENABLED_MARKER);
}

/** 开关当前状态：marker 文件存在即开。读失败一律视为关（fail-safe 默认内存）。 */
export function readPersistEnabled(): boolean {
  try {
    return existsSync(activityEnabledPath());
  } catch {
    return false;
  }
}

export function setPersistEnabled(on: boolean): void {
  try {
    mkdirSync(activityDir(), { recursive: true });
    if (on) writeFileSync(activityEnabledPath(), new Date().toISOString(), 'utf8');
    else if (existsSync(activityEnabledPath())) rmSync(activityEnabledPath());
  } catch (e) {
    console.error('[cairn-dsh-memory] persist toggle failed:', (e as Error).message);
  }
}

/** 从 JSONL 尾部加载持久化条目（坏行跳过，形状不符跳过）。 */
export function loadPersistedActivity(limit = ACTIVITY_RING_LIMIT): ActivityEntry[] {
  try {
    const file = activityPath();
    if (!existsSync(file)) return [];
    const lines = readFileSync(file, 'utf8').split('\n').filter((l) => l.trim().length > 0);
    const out: ActivityEntry[] = [];
    for (const line of lines.slice(-limit)) {
      try {
        const e = JSON.parse(line) as ActivityEntry;
        if (e && typeof e.t === 'string' && (e.kind === 'recall' || e.kind === 'tool') && typeof e.summary === 'string') {
          out.push({ t: e.t, kind: e.kind, summary: e.summary });
        }
      } catch {
        /* 坏行跳过 */
      }
    }
    return out;
  } catch {
    return [];
  }
}

function appendActivityFile(entry: ActivityEntry): void {
  try {
    mkdirSync(activityDir(), { recursive: true });
    const file = activityPath();
    try {
      if (statSync(file).size > activityMaxBytes()) {
        const old = file + '.old';
        if (existsSync(old)) rmSync(old);
        renameSync(file, old);
      }
    } catch {
      /* 大小检查失败就继续追加 */
    }
    appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8');
  } catch (e) {
    // FAIL-OPEN：持久化失败绝不影响记忆操作与留痕的内存环
    console.error('[cairn-dsh-memory] activity append failed:', (e as Error).message);
  }
}

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
  // 自己发起的 memory_search 会在 tools/post-execute 里也出现——用时间窗压住防重复留痕。
  let suppressToolLogUntil = 0;
  const nullRecall: RecallFn = async () => [];
  const recall = makeToolRecall(ctx, () => { suppressToolLogUntil = Date.now() + 3000; }) ?? nullRecall;

  const injector = createInjector({ recall, config });

  // 摘要级诊断（不含正文），usage?debug=1 可读：用于区分「hook 没挂上 /
  // 事件形状不符 / 召回失败」——本轮排查就是靠它才能不靠用户来回试。
  const diag = {
    lastEventType: '' as string,
    /** session/event 到达总数：0 = 事件根本没送达（fallback 失效的判据）。 */
    lastEventCount: 0,
    lastCapture: { captured: false, textLen: 0, sourceKind: '' },
    lastPreStep: { fired: false, messageLen: 0, reason: '', selected: 0, injected: false },
    lastRecall: { queries: 0, candidates: 0, ms: 0 },
    toolHookRegistered: false,
    toolEvents: 0,
  };

  // 活动记录（用户要求：所有经 cairn 的操作留痕）。只存摘要，正文/参数永不入条目。
  // 持久化由用户开关控制（默认关＝内存；开＝JSONL 落盘，随 Cairn 主权根目录）。
  const activity: ActivityEntry[] = [];
  let persistOn = readPersistEnabled();
  if (persistOn) {
    // 重启回放：把持久化尾部并入内存环（按 t+summary 去重防重复加载）
    for (const e of loadPersistedActivity()) {
      if (!activity.some((x) => x.t === e.t && x.summary === e.summary)) activity.push(e);
    }
  }
  const recordCfg = { recall: config.record?.recall !== false, tools: config.record?.tools !== false };
  const pushActivity = (kind: ActivityEntry['kind'], summary: string): void => {
    const entry: ActivityEntry = { t: new Date().toISOString(), kind, summary };
    activity.push(entry);
    if (activity.length > ACTIVITY_RING_LIMIT) activity.splice(0, activity.length - ACTIVITY_RING_LIMIT);
    if (persistOn) appendActivityFile(entry);
  };

  // Client 面板通过这个端点取状态：Host 与 Client 分处两个进程，只能走 HTTP。
  // 只返回摘要级信息，正文永不外传（design D3）。
  const usagePath = '/plugins/cairn-dsh-memory/usage';
  let usageRegistered = false;
  const serveUsage = (req: { method?: string; url?: string }, res: { writeHead?: Function; end?: Function }): void => {
    if (req.method !== 'GET') {
      res.writeHead?.(405, { 'content-type': 'application/json' });
      res.end?.(JSON.stringify({ error: 'method not allowed' }));
      return;
    }
    const usage = injector.lastUsage();
    const payload: Record<string, unknown> = { ...(usage ?? EMPTY_USAGE), persist: persistOn };
    // 活动记录随 payload 走：默认带最近 15 条，?history=1 带全部（上限 120）。
    try {
      const u = new URL(req.url ?? '/', 'http://local');
      if (u.searchParams.get('history') === '1') {
        payload.recent = activity;
        if (u.searchParams.get('debug') === '1') payload.debug = diag;
      } else {
        payload.recent = activity.slice(-15);
        if (u.searchParams.get('debug') === '1') payload.debug = diag;
      }
    } catch {
      payload.recent = activity.slice(-15);
      /* url 解析失败就当没有参数 */
    }
    res.writeHead?.(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    // 兜底必须字段完备（EMPTY_USAGE）：client 详情段会读 injected 等字段，
    // 退化形状会让面板在宿主 crash boundary 下被整个卸载。
    res.end?.(JSON.stringify(payload));
  };
  // 持久化开关端点：GET 查状态，POST {enabled:boolean} 切换。
  // 状态落 marker 文件（host 侧权威），面板刷新/重启后仍保持用户选择。
  const persistPath = '/plugins/cairn-dsh-memory/persist';
  const servePersist = (req: { method?: string; on?: (ev: string, cb: (chunk?: unknown) => void) => void }, res: { writeHead?: Function; end?: Function }): void => {
    if (req.method === 'GET') {
      res.writeHead?.(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end?.(JSON.stringify({ enabled: persistOn }));
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead?.(405, { 'content-type': 'application/json' });
      res.end?.(JSON.stringify({ error: 'method not allowed' }));
      return;
    }
    let body = '';
    try {
      req.on?.('data', (chunk: unknown) => {
        body += typeof chunk === 'string' ? chunk : String(chunk ?? '');
        if (body.length > 1024) body = ''; // 上限保护：超限直接作废
      });
      req.on?.('end', () => {
        try {
          const parsed = body.length > 0 ? (JSON.parse(body) as { enabled?: unknown }) : {};
          if (typeof parsed.enabled !== 'boolean') {
            res.writeHead?.(400, { 'content-type': 'application/json' });
            res.end?.(JSON.stringify({ error: 'enabled must be boolean' }));
            return;
          }
          setPersistEnabled(parsed.enabled);
          persistOn = parsed.enabled;
          if (persistOn) {
            // 开启时把已有持久化尾部并入环，避免面板瞬间只剩空环
            for (const e of loadPersistedActivity()) {
              if (!activity.some((x) => x.t === e.t && x.summary === e.summary)) activity.push(e);
            }
          }
          res.writeHead?.(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
          res.end?.(JSON.stringify({ enabled: persistOn }));
        } catch {
          res.writeHead?.(400, { 'content-type': 'application/json' });
          res.end?.(JSON.stringify({ error: 'bad json' }));
        }
      });
    } catch {
      res.writeHead?.(400, { 'content-type': 'application/json' });
      res.end?.(JSON.stringify({ error: 'bad request' }));
    }
  };
  const registerUsageOn = (webServer: { register: (o: unknown) => unknown }): void => {
    webServer.register({
      kind: 'exact',
      path: usagePath,
      handler: serveUsage,
    });
    webServer.register({
      kind: 'exact',
      path: persistPath,
      handler: servePersist,
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

  // pre-step 的 payload 自带 messages（2026-11-02 asar 实锤：waterfall 载荷
  // `{ messages, ...position, signal }`），直接从里面取用户原文；
  // session/event 只作兜底（真实监听签名是 (session, event) 两个参数——
  // 本轮排查发现旧实现只收了一个参数，把 session 对象当事件用了）。
  let lastUserMessage = '';

  const hooks = ctx as { on?: (event: string, fn: unknown) => void } | undefined;
  if (typeof hooks?.on !== 'function') return;

  try {
    hooks.on(
      'session/event',
      (
        _session: unknown,
        evt: { type?: string; data?: { content?: unknown; source?: { kind?: string } }; message?: { content?: { text?: string }[] } },
      ) => {
        try {
          diag.lastEventCount += 1;
          diag.lastEventType = evt?.type ?? '(no type)';
          if (evt?.type !== 'user/message') return;
          // 真实宿主形状：消息体在 evt.data（含 source.kind）。只认真实用户输入，
          // agent-instructions 之类的 user-role 注入不驱动召回。
          const kind = evt.data?.source?.kind;
          if (kind !== undefined && kind !== 'user') return;
          const text = extractText(evt.data?.content ?? evt.message?.content);
          diag.lastCapture = { captured: text.length > 0, textLen: text.length, sourceKind: kind ?? '?' };
          if (text.length > 0) lastUserMessage = text;
        } catch {
          /* 结构不符就忽略 */
        }
      },
    );
  } catch {
    /* 注册失败降级 */
  }

  try {
    // asar 实锤签名：`on("tools/post-execute", async (exec, result, next) => …)`。
    // 只记工具名与结果状态，参数与返回内容一律不留（秘密纪律）。
    hooks.on(
      'tools/post-execute',
      async (exec: { name?: string; tool?: string }, result: unknown, next?: (r?: unknown) => unknown) => {
        try {
          diag.toolEvents += 1;
          const toolName = typeof exec?.name === 'string' ? exec.name : typeof exec?.tool === 'string' ? exec.tool : '';
          if (recordCfg.tools && toolName.startsWith('mcp__cairn__') && Date.now() >= suppressToolLogUntil) {
            const failed = result && typeof result === 'object' && 'error' in (result as Record<string, unknown>);
            pushActivity('tool', `${toolName.replace('mcp__cairn__', 'cairn.')}${failed ? ' → 错误' : ''}`);
          }
        } catch {
          /* 留痕失败不影响工具执行 */
        }
        return typeof next === 'function' ? next(result) : undefined;
      },
    );
    diag.toolHookRegistered = true;
  } catch {
    /* 注册失败降级 */
  }

  try {
    hooks.on(
      'agent/pre-step',
      async (
        payload: { agent?: { inject?: (m: unknown) => void }; messages?: unknown },
        next?: () => unknown,
      ) => {
        diag.lastPreStep.fired = true;
        try {
          const stepText = extractStepText(payload) || lastUserMessage;
          diag.lastPreStep.messageLen = stepText.length;
          diag.lastRecall.queries = stepText ? deriveQueries(stepText).length : 0;
          const startedAt = Date.now();
          const out = await injector.runOnce(stepText);
          diag.lastRecall.ms = Date.now() - startedAt;
          diag.lastRecall.candidates = injector.lastUsage()?.candidates ?? 0;
          diag.lastPreStep.reason = out.reason;
          diag.lastPreStep.selected = out.selected;
          diag.lastPreStep.injected = out.injected;
          if (recordCfg.recall && stepText) {
            const usage = injector.lastUsage();
            pushActivity(
              'recall',
              usage
                ? `自动召回 候选${usage.candidates} 注入${out.selected}${out.reason !== 'ok' ? ` (${out.reason})` : ''}`
                : `自动召回 跳过 (${out.reason})`,
            );
          }
          if (out.injected) {
            const agent = payload?.agent;
            if (typeof agent?.inject === 'function') {
              agent.inject(makeInjectionMessage(out.text));
            } else {
              diag.lastPreStep.reason = out.reason + ' (agent.inject 不可用，未注入)';
            }
          }
        } catch (e) {
          diag.lastPreStep.reason = 'threw: ' + (e as Error).message;
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
