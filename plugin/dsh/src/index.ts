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
 *    正确写法是 `ctx.tools.get(name, scope)` 取定义再 `definition.execute(args, exec)`；
 *    `ctx.tools.execute({...})` 也存在，但本部署默认 ptc 呈现，它会把手动直呼折叠成
 *    UNKNOWN_TOOL（详见 makeToolRecall 注释）。**没有 `tools.call`，也没有 `definition.call`**。
 */

import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  createDedupeState,
  filterInjectable,
  isStopTerm,
  rankHits,
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
  /** scope：宿主 agent 对象。tools.get(name, scope) 需要它才能命中正确的可见层。 */
  (query: string, topK: number, scope?: unknown): Promise<RecallHit[]>;
}

export interface InjectionOutcome {
  injected: boolean;
  reason: string;
  text: string;
  selected: number;
  truncated: number;
  /** 本次实际写进上下文的记忆 id（按渲染顺序）。调用方用它记「本会话累计注入」。 */
  injectedIds: string[];
}

const DEFAULTS = { enabled: true, budgetBytes: 1536, topK: 5 } as const;

export function createInjector(deps: { recall: RecallFn; config?: PluginConfig }) {
  const cfg = { ...DEFAULTS, ...(deps.config ?? {}) };
  const dedupe = createDedupeState();
  /** 最近一次召回的使用情况，供 UI 面板读取。 */
  let lastUsage: RecallUsage | null = null;

  async function runOnce(message: string, scope?: unknown): Promise<InjectionOutcome> {
    const decision = shouldInject({ enabled: cfg.enabled, alreadyInjected: new Set(), message });
    if (!decision.inject) {
      return { injected: false, reason: decision.reason, text: '', selected: 0, truncated: 0, injectedIds: [] };
    }
    let hits: RecallHit[] = [];
    try {
      hits = await deps.recall(message, cfg.topK, scope);
    } catch (e) {
      return { injected: false, reason: 'recall_failed: ' + (e as Error).message, text: '', selected: 0, truncated: 0, injectedIds: [] };
    }
    const safe = filterInjectable(hits);
    const filteredCount = hits.length - safe.length;
    const rendered = renderInjection(safe, {
      budgetBytes: cfg.budgetBytes,
      alreadyInjected: { has: (id: string) => dedupe.has(id) } as unknown as ReadonlySet<string>,
    });

    // 记录本轮使用情况：三态由 buildUsage 判定，正文不进状态（只放摘要）。
    // 由渲染函数直接给出入选 id，不再靠文本比对反推。
    // 2026-11-02 两次踩坑：先用「正文首行前 20 字」匹配（frontmatter 记忆恒失败），
    // 后用 toSummary(60 字符) 匹配渲染行（渲染行截断在 160 字符，长内容仍失败）。
    // 渲染函数本来就知道放进了哪些，直接返回即可。
    const injectedIds = rendered.includedIds;
    // 运行时探针：离线正确但线上仍 miss，需要看到真实 hits/rendered 的形状。
    Object.assign(renderProbe, {
      hits: hits.length,
      safe: safe.length,
      included: rendered.includedIds.length,
      selected: rendered.selected,
      textLen: rendered.text.length,
      bytes: rendered.bytes,
      firstHitId: hits[0]?.id ?? '(none)',
      firstIncludedId: rendered.includedIds[0] ?? '(none)',
    });

    // 只在**真正有内容注入**时更新 lastUsage。
    // 2026-11-02 缺陷：pre-step 每步都跑一次 runOnce，去重后 fresh 为空即早退；
    // 早退若也写 lastUsage，会用「空」覆盖掉上一步的真实结果，
    // 于是端点显示 candidates=5 但 injected=[]、status=miss —— 而注入其实发生过。
    if (rendered.includedIds.length > 0) {
      lastUsage = buildUsage({
        candidates: hits.length,
        injectable: safe.map((h) => ({ id: h.id, kind: h.kind, content: h.content })),
        injectedIds,
        matchedBy: 'fts',
        bytesUsed: rendered.bytes,
        bytesBudget: cfg.budgetBytes,
        filteredCount,
      });
    }

    if (rendered.text.length === 0) {
      return { injected: false, reason: 'nothing_new', text: '', selected: 0, truncated: 0, injectedIds: [] };
    }
    dedupe.add(injectedIds);
    return {
      injected: true,
      reason: 'ok',
      text: rendered.text,
      selected: rendered.selected,
      truncated: rendered.truncated,
      injectedIds,
    };
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
  // 虚词二元组（「一个 / 这个 / 可以」）排在出现次数最前列，但它们命中什么都正常——
  // 当查询用只会把无关记忆捞进来。跳过它们，从有实义的两字词里取 top2。
  [...cjkGrams.entries()]
    .filter(([g]) => !isStopTerm(g))
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

/** 召回链路诊断：记录 tools.get / tools.execute / definition.execute 每一步的失败原因。 */
export const renderProbe: Record<string, unknown> = {};

export const recallDiag: {
  hasTools: boolean;
  hasGet: boolean;
  hasExecute: boolean;
  defFound: boolean;
  /** 定义上真实可用的执行方法类型；dsh 的 ToolDefinition 用 `execute`，没有 `call`。 */
  executeType: string;
  /** 最近一次成功走通的路径：`tools.execute` 或 `definition.execute`。 */
  execPath: string;
  lastError?: string;
  lastTextLen: number;
  attempts: number;
} = {
  hasTools: false,
  hasGet: false,
  hasExecute: false,
  defFound: false,
  executeType: 'unknown',
  execPath: '',
  lastTextLen: 0,
  attempts: 0,
};

/** Cairn 检索工具的公开名（dsh-mcp-client 命名契约：mcp__<server>__<raw>）。 */
const RECALL_TOOL = 'mcp__cairn__memory_search';
/** 召回卡在 pre-step 里，必须有上限：一次挂起的 MCP 调用不能拖死整轮。 */
const RECALL_TIMEOUT_MS = 3000;

/** dsh-tools 的 ToolDefinition：执行方法是 execute(args, exec)，**没有 call**。 */
type ToolDefinitionLike = { execute?: (args: unknown, exec: unknown) => Promise<unknown> };

/** ContentBlock[] → 纯文本（非 text 块忽略）。 */
function blocksText(blocks: unknown): string {
  if (!Array.isArray(blocks)) return '';
  return blocks
    .map((b) => (typeof (b as { text?: unknown })?.text === 'string' ? (b as { text: string }).text : ''))
    .join('');
}

/**
 * 归一两条调用路径的返回值。
 *
 * - tools.execute → ToolExecutionResult：`{ content, value, isError }`（content 是渲染块）
 * - definition.execute → 工具自报的原始值：MCP 桥是 `{ content, structuredContent }`
 *
 * 两者都能从 content 取到文本；value.content 只是 MCP 桥的另一种摆法。
 */
function resultText(res: unknown): string {
  if (!res || typeof res !== 'object') return '';
  const r = res as { content?: unknown; value?: unknown };
  return blocksText(r.content) || blocksText((r.value as { content?: unknown } | undefined)?.content);
}

function isErrorResult(res: unknown): boolean {
  return !!res && typeof res === 'object' && (res as { isError?: unknown }).isError === true;
}

function errorText(res: unknown): string {
  const err = (res as { error?: { message?: unknown } } | undefined)?.error?.message;
  return typeof err === 'string' ? err : resultText(res) || 'unknown error';
}

/**
 * 从 ctx.tools 取 Cairn 检索能力。
 *
 * **权威契约（2026-11-02，取自 app.asar 内 @deepseek-ai/dsh-tools 的 api-catalog 与源码）**：
 *
 * - `ToolRuntime`（= `ctx.tools`）公开方法含 `get(name, scope)` 与
 *   `execute(exec: ToolExecutionInput): Promise<ToolExecutionResult>`；
 *   `ToolExecutionInput = { callId, name, arguments, signal, agent?, rootCallId?, parent?, schema? }`。
 * - 工具定义上的执行方法是 `execute(args, exec)`，**不是 `call`**——前八轮全卡在找 `call`。
 * - `tools.call(name, args)` 从不存在；`resolveExecution` 是 executor 内部用的可见性判定，不是调用入口。
 *
 * 实测（2026-11-02，本机部署）：默认是 **ptc 呈现模式**，`tools.execute` 对非
 * `run_code` 的直呼一律折叠成 `UNKNOWN_TOOL`——所以 `tools.execute` 在这个部署里
 * 从来不是可用路径。主路径因此是**直调定义体 `definition.execute`**：它在 native /
 * ptc 下都成立（插件是宿主侧调用方，不是模型发起的直呼；工具可见性已由
 * `get(name, scope)` 先判过，per-agent restrict 依然生效）。
 * 仅当定义上没有 execute 时退回 `tools.execute`。
 */
function makeToolRecall(ctx: unknown, onOwnCall?: () => void): RecallFn | null {
  const tools = (ctx as {
    tools?: {
      get?: (name: string, scope?: unknown) => ToolDefinitionLike | undefined;
      execute?: (input: {
        callId: string;
        name: string;
        arguments: unknown;
        agent?: unknown;
        signal: AbortSignal;
      }) => Promise<unknown>;
    };
  } | undefined)?.tools;
  recallDiag.hasTools = !!tools;
  recallDiag.hasGet = typeof tools?.get === 'function';
  recallDiag.hasExecute = typeof tools?.execute === 'function';
  if (!tools || typeof tools.get !== 'function') return null;

  let seq = 0;

  /**
   * 一次检索调用 → 文本。顺序是**实测定的**，不是偏好：
   *
   * 本部署默认 ptc 呈现模式，`tools.execute` 对非 `run_code` 的直呼一律折叠成
   * `UNKNOWN_TOOL`，六条查询就是六次必然失败 + 六条被写进诊断的假错误。
   * `definition.execute` 在 native / ptc 下都成立，所以它是主路径；
   * 只有定义上没有 execute 时才退回 `tools.execute`（那时至少还能过一遍策略）。
   */
  const searchOnce = async (
    def: ToolDefinitionLike,
    args: { query: string; limit: number; increment_usage: boolean },
    scope: unknown,
    onServiceCall?: () => void,
  ): Promise<string> => {
    if (typeof def.execute === 'function') {
      try {
        const res = await def.execute(args, { signal: AbortSignal.timeout(RECALL_TIMEOUT_MS) });
        recallDiag.execPath = 'definition.execute';
        // 成功即清空：一条早已失效的旧错误不许陪着顺利的召回一直显示（上一轮就有人被它误导）。
        recallDiag.lastError = undefined;
        return resultText(res);
      } catch (e) {
        recallDiag.lastError = (e as Error).message;
      }
    }
    if (typeof tools.execute !== 'function') return '';
    // 只有走服务层才会触发插件自己的 tools/post-execute 留痕，压制窗口只在这种情况需要。
    onServiceCall?.();
    try {
      const res = await tools.execute({
        callId: `cairn-recall-${++seq}`,
        name: RECALL_TOOL,
        arguments: args,
        ...(scope === undefined ? {} : { agent: scope }),
        signal: AbortSignal.timeout(RECALL_TIMEOUT_MS),
      });
      if (!isErrorResult(res)) {
        recallDiag.execPath = 'tools.execute';
        recallDiag.lastError = undefined;
        return resultText(res);
      }
      recallDiag.lastError = errorText(res);
    } catch (e) {
      recallDiag.lastError = (e as Error).message;
    }
    return '';
  };

  return async (message: string, topK: number, scope?: unknown) => {
    // 每条命中带上「它被哪些查询词带回来」，用来算相关性下限（见 recall.ts）。
    const merged = new Map<string, { hit: RecallHit; terms: string[] }>();
    for (const query of deriveQueries(message)) {
      // 必须带 scope：可见层按 agent 解析，不带只会看全局层。
      const def = tools.get!(RECALL_TOOL, scope);
      recallDiag.defFound = !!def;
      recallDiag.executeType = typeof def?.execute;
      recallDiag.attempts += 1;
      // 单路取不到定义不终止整轮：其余查询路仍可能命中。
      if (!def) continue;
      // increment_usage: false —— 自动注入**不计** usage_count（只写 last_used_at）。
      // 插件每轮都注入（实测一个会话 202 次注入 / 6 种内容 / 97% 重复），
      // 计入次数会让「注入频率」取代「真实需求」决定排序，形成正反馈死锁。
      // 见 add-memory-importance-and-usage-signal D5。
      const text = await searchOnce(def, { query, limit: topK, increment_usage: false }, scope, onOwnCall);
      if (text.length > 0) recallDiag.lastTextLen = text.length;
      let items: RecallHit[] = [];
      try {
        const parsed = text ? (JSON.parse(text) as { items?: RecallHit[] }) : {};
        items = Array.isArray(parsed.items) ? parsed.items : [];
      } catch {
        /* 非 JSON 响应：本路 0 条 */
      }
      for (const hit of items) {
        if (!hit?.id) continue;
        const cur = merged.get(hit.id);
        if (cur) {
          // 同一段正文可能被多个词带回来——多一个词就多一分相关性，别去重掉。
          if (!cur.terms.includes(query)) cur.terms.push(query);
          continue;
        }
        merged.set(hit.id, { hit, terms: [query] });
      }
      if (merged.size >= topK * 2) break;
    }
    return rankHits([...merged.values()], topK);
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
 * **必须带 `id`**：宿主把消息写进 session log 后，重放时的
 * `assertMessageEventShape`（app.asar）要求 `user/message` 的 data 本身就是一条
 * 带非空字符串 `id` 的完整消息，否则抛
 * `session event at seq N lacks an identified message` → 整个会话被判 corrupt、历史加载失败。
 * 2026-11-02 实测踩坑：本函数原先只给 role/content/source，三条注入把会话写坏。
 * 宿主自己的 `createUserMessage` 走 `createMessage`，同样是 `id: randomUUID()`。
 */
export function makeInjectionMessage(text: string): { id: string; role: 'user'; content: { type: 'text'; text: string }[]; source: { kind: string } } {
  return {
    id: randomUUID(),
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
export type ActivityEntry = {
  t: string;
  kind: 'recall' | 'tool';
  summary: string;
  /** 归属会话；老版本落盘的行没有这个字段（见 loadPersistedActivity 的注释）。 */
  s?: string;
  /**
   * 这次操作涉及的记忆（仅「自动召回」有）——面板点选时用来高亮左侧条目，
   * 重启回放时也靠它重建「本会话累计注入」。只放摘要，不放正文。
   */
  items?: { id: string; kind: string; summary: string }[];
};

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

  // ———— 会话隔离（2026-11-02 用户实测：面板把多个会话的记录叠在一起）————
  // 旧实现里 injector（含去重集合与 lastUsage）与 activity 都是插件级单例：
  // A 会话注入过的记忆，B 会话就再也不会被注入；面板也永远只显示「最后跑过的那一步」。
  // 现在所有状态都按会话键分开——Agent.id 就是 SessionId，pre-step 的 payload.agent 自带。
  type SessionState = {
    injector: ReturnType<typeof createInjector>;
    activity: ActivityEntry[];
    /** 本会话累计注入过的记忆，按首次注入顺序去重（会话内同一 id 只会注入一次）。 */
    injected: Map<string, { id: string; kind: string; summary: string }>;
    touched: number;
  };
  const DEFAULT_SESSION = 'default';
  const sessions = new Map<string, SessionState>();
  // 单调序号而不是时间戳：同一毫秒内连着两步会话时，时间戳分不出先后。
  let touchSeq = 0;
  const shortKey = (k: string): string => (k ? k.slice(0, 8) : '(none)');
  /** 取会话键：显式 id 优先，其次 agent.id；都取不到才落到 'default'。 */
  function sessionKey(agent: unknown, explicit?: unknown): string {
    if (typeof explicit === 'string' && explicit.length > 0) return explicit;
    const id = (agent as { id?: unknown } | undefined)?.id;
    return typeof id === 'string' && id.length > 0 ? id : DEFAULT_SESSION;
  }
  function stateFor(key: string): SessionState {
    let st = sessions.get(key);
    if (!st) {
      st = { injector: createInjector({ recall, config }), activity: [], injected: new Map(), touched: ++touchSeq };
      sessions.set(key, st);
    }
    return st;
  }
  /**
   * 记下「本会话注入过这条记忆」。
   *
   * 会话内同一 id 只会被注入一次（renderInjection 用去重集合挡掉重复），所以这里
   * 不需要计数；重复命中时只刷新摘要/类型（记忆可能被修订过）。
   */
  function rememberInjected(st: SessionState, m: { id: string; kind: string; summary: string }): void {
    if (!m || typeof m.id !== 'string' || m.id.length === 0) return;
    const cur = st.injected.get(m.id);
    if (cur) {
      cur.kind = m.kind;
      cur.summary = m.summary;
      return;
    }
    st.injected.set(m.id, { id: m.id, kind: m.kind, summary: m.summary });
  }
  /** 没带 session 参数时（curl 自检）挑最近活跃的那个，别让端点变成空壳。 */
  function mostRecentKey(): string {
    let best = '';
    let at = -1;
    for (const [k, st] of sessions) if (st.touched > at) { at = st.touched; best = k; }
    return best;
  }

  // 摘要级诊断（不含正文），usage?debug=1 可读：用于区分「hook 没挂上 /
  // 事件形状不符 / 召回失败」——本轮排查就是靠它才能不靠用户来回试。
  const diag = {
    lastEventType: '' as string,
    /** session/event 到达总数：0 = 事件根本没送达（fallback 失效的判据）。 */
    lastEventCount: 0,
    lastCapture: { captured: false, textLen: 0, sourceKind: '' },
    lastPreStep: { fired: false, session: '', messageLen: 0, reason: '', selected: 0, injected: false },
    lastRecall: { queries: 0, candidates: 0, ms: 0 },
    toolHookRegistered: false,
    toolEvents: 0,
    render: renderProbe,
    recall: recallDiag,
  };

  // 活动记录（用户要求：所有经 cairn 的操作留痕）。只存摘要，正文/参数永不入条目。
  // 持久化由用户开关控制（默认关＝内存；开＝JSONL 落盘，随 Cairn 主权根目录）。
  let persistOn = readPersistEnabled();
  if (persistOn) {
    // 重启回放：按会话归档。落盘行不含 items（摘要也不落盘），所以「本会话累计注入」
    // 重启后从空开始——这是隐私取舍，不是遗漏。
    // 旧版本落盘的行没有 s 字段，统一落到 'default' 桶：它们本来就分不清属于哪个会话，
    // 宁可不出现在任何真实会话面板里，也不该再像以前那样叠给所有人看。
    for (const e of loadPersistedActivity()) {
      const st = stateFor(e.s ?? DEFAULT_SESSION);
      if (st.activity.some((x) => x.t === e.t && x.summary === e.summary)) continue;
      st.activity.push(e);
    }
  }
  const recordCfg = { recall: config.record?.recall !== false, tools: config.record?.tools !== false };
  const pushActivity = (
    key: string,
    kind: ActivityEntry['kind'],
    summary: string,
    items?: { id: string; kind: string; summary: string }[],
  ): void => {
    const st = stateFor(key);
    const entry: ActivityEntry = {
      t: new Date().toISOString(),
      kind,
      summary,
      s: key,
      ...(items && items.length > 0 ? { items } : {}),
    };
    st.activity.push(entry);
    if (st.activity.length > ACTIVITY_RING_LIMIT) st.activity.splice(0, st.activity.length - ACTIVITY_RING_LIMIT);
    st.touched = ++touchSeq;
    // 落盘**不写 items**：摘要是正文的前缀，文件是长期留存面，不能跟内存环同等待遇。
    // 代价是重启后「本会话累计注入」从空开始——这个取舍写进 README。
    if (persistOn) appendActivityFile({ t: entry.t, kind, summary, s: key });
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
    // 会话切片：?session=<SessionId> 由面板带上；不带（curl 自检）就取最近活跃的那个。
    let requested = '';
    let history = false;
    let wantDebug = false;
    try {
      const u = new URL(req.url ?? '/', 'http://local');
      requested = u.searchParams.get('session') ?? '';
      history = u.searchParams.get('history') === '1';
      wantDebug = u.searchParams.get('debug') === '1';
    } catch {
      /* url 解析失败就当没有参数 */
    }
    const key = requested || mostRecentKey();
    const st = key ? sessions.get(key) : undefined;
    const usage = st?.injector.lastUsage() ?? null;
    const payload: Record<string, unknown> = {
      ...(usage ?? EMPTY_USAGE),
      persist: persistOn,
      session: key,
      // 本会话累计注入（去重）。用户问的就是这个：这个会话一共注入过哪些记忆。
      sessionInjected: st ? [...st.injected.values()] : [],
    };
    // 活动记录随 payload 走：默认带最近 15 条，?history=1 带全部（上限 120）。
    const ring = st?.activity ?? [];
    payload.recent = history ? ring : ring.slice(-15);
    if (wantDebug) {
      // 会话 id 只给前 8 位：够对齐面板与宿主，又不是完整标识。
      payload.debug = { ...diag, session: { requested: requested ? shortKey(requested) : '(none)', resolved: shortKey(key), known: sessions.size } };
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
            // 开启时把已有持久化尾部并按会话并入，避免面板瞬间只剩空环
            for (const e of loadPersistedActivity()) {
              const st = stateFor(e.s ?? DEFAULT_SESSION);
              if (st.activity.some((x) => x.t === e.t && x.summary === e.summary)) continue;
              st.activity.push(e);
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
  // webServer.register() 返回 disposer。**必须交给 owner.effect 托管**，否则插件被
  // HMR 重载时旧路由不会被释放：新实例注册同路径直接抛
  // `webserver: duplicate exact route "…"`，插件整条 fiber 失败，面板端点留在旧闭包上
  // （2026-11-02 实测：重载后 /usage 一直返回重载前的陈旧数据）。
  // 宿主自己的 connection 包就是这么做的：`owner.effect(() => owner.webServer.register(route))`。
  const registerUsageOn = (webServer: { register: (o: unknown) => unknown }, owner?: { effect?: (fn: () => unknown, label?: string) => unknown }): void => {
    const routes = [
      { kind: 'exact', path: usagePath, handler: serveUsage },
      { kind: 'exact', path: persistPath, handler: servePersist },
    ];
    for (const route of routes) {
      if (typeof owner?.effect === 'function') owner.effect(() => webServer.register(route), `cairn-dsh-memory: ${route.path}`);
      else webServer.register(route); // 拿不到 owner 时退回裸注册（面板可用，但重载前需重启）
    }
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
        if (web && typeof web.webServer?.register === 'function') registerUsageOn(web.webServer, webCtx as { effect?: (fn: () => unknown, label?: string) => unknown });
      });
    }
  } catch (e) {
    console.warn('[cairn-dsh-memory] usage route path-1 failed:', (e as Error).message);
  }
  if (!usageRegistered) {
    try {
      const web = (ctx as { webServer?: { register: (o: unknown) => unknown } }).webServer;
      if (web && typeof web.register === 'function') registerUsageOn(web, ctx as { effect?: (fn: () => unknown, label?: string) => unknown });
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
      async (
        exec: { name?: string; tool?: string; agent?: { id?: unknown } },
        result: unknown,
        next?: (r?: unknown) => unknown,
      ) => {
        try {
          diag.toolEvents += 1;
          const toolName = typeof exec?.name === 'string' ? exec.name : typeof exec?.tool === 'string' ? exec.tool : '';
          if (recordCfg.tools && toolName.startsWith('mcp__cairn__') && Date.now() >= suppressToolLogUntil) {
            const failed = result && typeof result === 'object' && 'error' in (result as Record<string, unknown>);
            // 谁调的工具就记在谁头上：exec.agent.id 就是会话 id。
            pushActivity(sessionKey(exec?.agent), 'tool', `${toolName.replace('mcp__cairn__', 'cairn.')}${failed ? ' → 错误' : ''}`);
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
          // 会话键：payload.agent.id。整个面板都是按这个键切片的。
          const key = sessionKey(payload?.agent);
          const st = stateFor(key);
          diag.lastPreStep.session = shortKey(key);
          diag.lastPreStep.messageLen = stepText.length;
          diag.lastRecall.queries = stepText ? deriveQueries(stepText).length : 0;
          const startedAt = Date.now();
          const out = await st.injector.runOnce(stepText, payload?.agent);
          diag.lastRecall.ms = Date.now() - startedAt;
          diag.lastRecall.candidates = st.injector.lastUsage()?.candidates ?? 0;
          diag.lastPreStep.reason = out.reason;
          diag.lastPreStep.selected = out.selected;
          diag.lastPreStep.injected = out.injected;
          // 只有真的注入了才更新「本会话累计」：nothing_new 时 lastUsage 是旧的，
          // 拿它去 bump 会把上一轮的注入重复记一遍。
          const fresh = out.injectedIds.length > 0 ? (st.injector.lastUsage()?.injected ?? []) : [];
          for (const m of fresh) rememberInjected(st, m);
          if (recordCfg.recall && stepText) {
            const usage = st.injector.lastUsage();
            pushActivity(
              key,
              'recall',
              usage
                ? `自动召回 候选${usage.candidates} 注入${out.selected}${out.reason !== 'ok' ? ` (${out.reason})` : ''}`
                : `自动召回 跳过 (${out.reason})`,
              fresh,
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
