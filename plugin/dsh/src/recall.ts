/**
 * 召回逻辑（纯函数，可单测）。
 *
 * 这里**不查库、不做检索**——检索走 Cairn 的 MCP 内核（design D1）。
 * 插件只负责三件事：该不该注入、注入什么、注入多少。
 */


/** 一条召回命中（来自 Cairn MCP 的返回）。 */
export interface RecallHit {
  id: string;
  kind: string;
  content: string;
  scopeId?: string;
  /** 人读作用域名（scope 表 preset，如 personal-global）；面板徽章用。 */
  scopePreset?: string;
  sensitivity?: string;
  syncPolicy?: string;
  /** 重要度 1-5（MCP 带出）；NULL = 未判断。 */
  importance?: number | null;
  /** 被主动请求次数（自动注入不计）。 */
  usageCount?: number;
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
 * MCP 线协议条目 → RecallHit：显式字段映射。
 *
 * 线协议形状由 MCP summarize() 决定，snake/camel 混合（scopeId 是 camel，
 * scope_preset / sync_policy / usage_count 是 snake）——直接把解析结果当
 * RecallHit 用会让闸读错键、恒拿 undefined。映射集中在这一处，别处不要再抄。
 *
 * add-two-stage-memory-recall 起线协议条目带 `preview`（有界预览）而非 `content`
 * 全文；`preview` 落到 RecallHit.content（插件内的「内容」从今起就是预览，
 * 全文经模型显式 memory_get 获取）。保留 content 键兜底旧内核（半更新窗口）。
 */
export function toRecallHit(raw: unknown): RecallHit | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r['id'] !== 'string' || r['id'].length === 0) return null;
  const content = typeof r['preview'] === 'string'
    ? r['preview']
    : typeof r['content'] === 'string' ? r['content'] : '';
  return {
    id: r['id'],
    kind: typeof r['kind'] === 'string' ? r['kind'] : 'memory',
    content,
    scopeId: typeof r['scopeId'] === 'string' ? r['scopeId'] : undefined,
    scopePreset: typeof r['scope_preset'] === 'string' ? r['scope_preset'] : undefined,
    sensitivity: typeof r['sensitivity'] === 'string' ? r['sensitivity'] : undefined,
    syncPolicy: typeof r['sync_policy'] === 'string' ? r['sync_policy'] : undefined,
    importance: typeof r['importance'] === 'number' ? r['importance'] : null,
    usageCount: typeof r['usage_count'] === 'number' ? r['usage_count'] : 0,
  };
}

/**
 * 二次断言：把不该外泄的命中剔除。
 *
 * **这不是复制检索逻辑**——检索与作用域判定仍由 MCP 完成。这里只做一道防线：
 * 万一上游过滤有漏，插件的注入是最后一道闸（spec: 注入内容同样受作用域约束）。
 *
 * add-memory-scope-visibility 起这道闸基于 MCP 返回的真实元数据判定，并 **fail-closed**：
 * 任一标签缺失（旧内核半更新、异常返回）＝「拿不准」，按不可注入处理——宁可漏注不错注。
 * 被拦条数计入面板「已过滤」，不静默。被拦内容不进注入、不进面板条目，只留计数。
 */
export function filterInjectable(hits: readonly RecallHit[]): RecallHit[] {
  return hits.filter((h) => {
    if (typeof h.sensitivity !== 'string' || typeof h.syncPolicy !== 'string') return false;
    if (h.sensitivity !== 'normal') return false;
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
  /**
   * 实际进入文本的命中 id，按渲染顺序。
   *
   * 2026-11-02 教训：调用方曾用 `text.includes(toSummary(content))` 反推，
   * 但渲染截断到 160 字符、摘要截断到 60 字符，长内容必然匹配失败，
   * 于是 candidates>0 却 injected=[]，状态被误判为 miss。
   * 渲染函数自己知道放进去了哪些，就别让调用方猜。
   */
  includedIds: string[];
}

/** 常规召回的注入表头：语义是「这可能与当前问题相关」。 */
const HEADER_RECALL = '以下记忆可能相关，仅供参照：';
/**
 * 压缩后重注入的表头（design D3）。
 *
 * **必须与常规召回不同措辞**：模型对「你之前涉及过」和「这可能相关」的语义预期不同，
 * 混用会让它把压缩前的旧上下文当成新证据。
 */
const HEADER_REINJECT = '以下记忆在本次会话中涉及过（上下文压缩后恢复，仅供参考）：';

/**
 * 两种注入共用的渲染器。
 *
 * 输出稳定：不含时间戳，同输入同字节（与投影通道保持同一纪律）。
 * 超预算按入参顺序裁剪并写明省略条数——不重排，否则「哪几条被裁」会漂移。
 */
function renderRows(
  hits: readonly Pick<RecallHit, 'id' | 'kind' | 'content'>[],
  opts: { budgetBytes: number; header: string; alreadyInjected?: ReadonlySet<string> },
): RenderResult {
  if (!Number.isInteger(opts.budgetBytes) || opts.budgetBytes < 0) {
    throw new Error('budgetBytes 必须是非负整数');
  }
  const seen = opts.alreadyInjected ?? new Set<string>();
  const fresh = hits.filter((h) => !seen.has(h.id));
  if (fresh.length === 0) return { text: '', selected: 0, truncated: 0, bytes: 0, includedIds: [] };

  const header = opts.header;
  // 预留省略提示的字节（最坏情况按条数估）
  const noticeBytes = (n: number): number => Buffer.byteLength(`…（另 ${n} 条未显示）`, 'utf8') + 1;
  const maxNotice = noticeBytes(fresh.length);

  const lines: string[] = [];
  const includedIds: string[] = [];
  let used = Buffer.byteLength(header, 'utf8') + 1;
  let truncated = 0;

  for (let i = 0; i < fresh.length; i++) {
    const h = fresh[i]!;
    // add-two-stage-memory-recall：注入行携带 16 字符记忆标识——模型可据此调
    // memory_get 下钻全文。为什么不是 8：uuidv7 前 12 hex 是毫秒时间戳，同一毫秒
    // 写入的记忆共享前 ≥13 字符，8 字符前缀在新建库上几乎必然歧义；16 字符
    // （时间戳 + 版本 + rand_a 首位）才具备实用唯一性。includedIds 仍记录完整 id。
    // h.content 在 toRecallHit 之后就是服务端 preview（frontmatter 感知单行），
    // 这里不再过 firstLine——「摘要怎么算」只有服务端 preview 一处出处。
    const line = `- [${h.id.slice(0, 16)}|${h.kind}] ${truncate(h.content, LINE_MAX)}`;
    const lineBytes = Buffer.byteLength(line, 'utf8') + 1;
    if (used + lineBytes + maxNotice > opts.budgetBytes) {
      truncated = fresh.length - i;
      break;
    }
    lines.push(line);
    includedIds.push(h.id);
    used += lineBytes;
  }

  if (truncated > 0) {
    const notice = `…（另 ${truncated} 条未显示）`;
    while (lines.length > 0 && used + Buffer.byteLength(notice, 'utf8') + 1 > opts.budgetBytes) {
      const dropped = lines.pop()!;
      // includedIds 必须跟着弹：否则会报出「已被挤掉、实际没进文本」的 id，
      // 去重层就会把一条用户从未看到的记忆记成已注入。
      includedIds.pop();
      used -= Buffer.byteLength(dropped, 'utf8') + 1;
      truncated += 1;
    }
    if (used + Buffer.byteLength(notice, 'utf8') + 1 <= opts.budgetBytes) lines.push(notice);
  }

  const text = [header, ...lines].join('\n');
  return {
    text,
    selected: includedIds.length,
    truncated,
    bytes: Buffer.byteLength(text, 'utf8'),
    includedIds,
  };
}

/** 常规召回渲染：表头「可能相关」。 */
export function renderInjection(
  hits: readonly RecallHit[],
  opts: { budgetBytes: number; alreadyInjected?: ReadonlySet<string> },
): RenderResult {
  return renderRows(hits, { budgetBytes: opts.budgetBytes, header: HEADER_RECALL, alreadyInjected: opts.alreadyInjected });
}

/**
 * 压缩后重注入渲染：表头「本会话涉及过」。
 *
 * 不复用常规召回的 `alreadyInjected`——重注入的目的就是把被压缩掉的记忆**重新**塞回去，
 * 过滤既不合语义也会让它一条都进不来。
 */
export function renderReinjection(
  entries: readonly Pick<RecallHit, 'id' | 'kind' | 'content'>[],
  opts: { budgetBytes: number },
): RenderResult {
  return renderRows(entries, { budgetBytes: opts.budgetBytes, header: HEADER_REINJECT });
}

/**
 * 虚词二元组（黑名单）。
 *
 * 2026-11-02 实测：`deriveQueries` 取消息里出现次数最高的二元组，中文里这几乎
 * 总是「一个 / 这个 / 可以」这类虚词。它们照样能在库里 LIKE 出一堆互不相干的记忆——
 * 用户看到的表现是「别的会话用过的记忆跑到了这个会话」
 * （实测：一条视频制作的会话里注入了 HSR6 项目与 ZCode 迁移的记忆）。
 *
 * 这不是分词器，只是一张**挡住虚词**的短名单：宁可漏挡，也不能把「记忆」「投影」
 * 这类有实义的二字词误伤——它们恰恰是中文里最有效的检索单元。
 */
const STOP_TERMS = new Set([
  '一个', '一下', '这个', '那个', '这些', '那些', '这样', '那样', '这里', '那里', '哪里',
  '什么', '怎么', '怎样', '如何', '我们', '你们', '他们', '它们', '咱们',
  '可以', '可能', '应该', '需要', '是否', '不是', '就是', '没有', '现在', '知道',
  '能否', '方便', '还是', '然后', '因为', '所以', '但是', '如果', '时候', '已经',
  '通过', '以及', '或者', '而且', '并且', '不过', '只是', '真的', '比较', '非常',
  '有点', '一起', '自己', '大家', '两个', '三个', '几个', '多少', '是不', '有没',
]);

/** 该查询词是不是虚词二元组（这类词命中什么都正常，不能当相关性证据）。 */
export function isStopTerm(term: string): boolean {
  return STOP_TERMS.has(term.trim());
}

/** 词是否真的出现在正文里（大小写无关）。命中路自报的材料不可全信。 */
export function containsTerm(content: string, term: string): boolean {
  if (!content || !term) return false;
  return content.toLowerCase().includes(term.toLowerCase());
}

/**
 * 一条命中的相关性计分：强词 2 分、弱词 1 分，虚词不计分。
 *
 * 强词＝汉字 ≥3 字或 ASCII 词（短语级，FTS 精确）；弱词＝有实义的两字词（LIKE）。
 */
export function scoreHit(content: string, terms: Iterable<string>): { strong: number; weak: number; score: number } {
  let strong = 0;
  let weak = 0;
  for (const term of terms) {
    if (!containsTerm(content, term)) continue;
    if (isStopTerm(term)) continue;
    if (/^[\u4e00-\u9fff]+$/.test(term) && term.length === 2) weak += 1;
    else strong += 1;
  }
  return { strong, weak, score: strong * 2 + weak };
}

export interface ScoredHit {
  hit: RecallHit;
  terms: readonly string[];
}

/**
 * 按相关性重排并截断。
 *
 * 旧实现的顺序就是查询顺序，而查询顺序恰恰从最泛的二元组开始——于是预算永远先给
 * 最不相关的那几条，真正对得上的短语反而被挤掉。现在按分数降序，同分保持首次命中
 * 顺序（稳定，便于复现）。
 */
export function rankHits(entries: readonly ScoredHit[], topK: number): RecallHit[] {
  return entries
    .map((e, i) => ({ e, i, s: scoreHit(e.hit?.content ?? '', e.terms) }))
    .filter((x) => x.e.hit?.id)
    .sort((a, b) => (b.s.score - a.s.score) || (a.i - b.i))
    .slice(0, Math.max(0, topK))
    .map((x) => x.e.hit);
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
