# Design: 记忆作用域对用户与插件可见

## 上下文

- `summarize()`（`src/interfaces/mcp/server.ts:714-744`）是 `memory_search` / `memory_context` 条目形状的**单点**；`memory_get` 走独立的 `MemoryDetail`（已含完整 scope 行）。
- 检索返回的 `scopeId` 是 scope 行的 uuidv7（`src/store/scopes.ts:121`），人读 preset 名只存在 scope 表（`src/store/schema.ts:48-72`，preset CHECK 枚举 7 个值）。
- 敏感度有两个层面：memory 行自身 `sensitivity`（`normal`/`sensitive`/`blocked`，schema.ts:97；blocked 有触发器拒写 schema.ts:347-356）与 scope 行 `sensitivity`（`normal`/`sensitive`，schema.ts:63，CHECK 约束 sensitive → sync_policy = local_only）。插件闸关心的两类内容（敏感、设备限定）由 **memory.sensitivity** 与 **scope.sync_policy** 覆盖；scope 级 sensitive 被 CHECK 传递为 local_only，天然落入后一个判据。
- 插件闸现状空转：`filterInjectable`（recall.ts:59-65）检查的字段 MCP 不返回。
- 数据链路：MCP item → `RecallHit`（recall.ts:11-22，已有 `scopeId?/sensitivity?/syncPolicy?` 可选字段）→ `buildUsage`（index.ts:128 只传 `{id,kind,content}`）→ `InjectedMemory`（usage-state.ts:12-17）→ `client.js` 渲染。

## 决策

### D1：字段在 `summarize()` 单点扩展，scope 属性经一次 JOIN 预取

**选择**：`summarize()` 增加必传的 scope 属性参数（`scopePreset` / `syncPolicy`；`sensitivity` 来自 memory 行本身已在手）。检索装配处（search.ts 结果循环 / app-service 对应路径）按结果集里的 scopeId **批量预取** scope 行（一次 `IN` 查询或 JOIN），不在每条结果上单独查表。

理由：preset 名只能在 scope 表取到；插件端反查（对每条注入调 `memory_get`）是 N+1 次 MCP 往返，不可接受。「列表结果直接携带」也正好补齐 scoped-retrieval「检索结果来源可解释」现状只落到详情的缺口。

**不做**：不在注入文本行里加 preset（1536B 预算与行格式不动，属于 add-two-stage-memory-recall 之后另行评估的事）。

### D2：插件闸判定式与 fail-closed

判定式维持既有意图：`h.sensitivity !== 'normal' || h.syncPolicy === 'local_only'` → 过滤。新增 **fail-closed**：任一字段缺失（旧内核/异常返回）→ 视为不可注入，计入 `filteredCount`。

理由：这一层的定位就是「万一上游过滤有漏」的最后防线（recall.ts 头注释原文），防线对未知状态必须宁严勿松。同仓库同构建分发（插件 dist 与 MCP 同一次 `npm run build`），字段缺失窗口只有「只更新了插件、没重建/没重启 MCP」这种错位场景；fail-closed 的代价是错位期间少注入，不是错注入——方向正确。面板 `filteredCount` 会让这个状态可见而非静默。

#### 为什么取严（白话版）

这道闸（`filterInjectable`）是记忆注入会话前的最后一道门禁。它靠每条记忆上的两个标签判断放行还是拦截：`sensitivity`（敏不敏感）、`sync_policy`（能不能出本机）。改动前 MCP 从不发送这两个标签，闸拿到的一直是"空"→ 永远放行——**传感器没接线，第二道防线形同虚设**。本变更把线接上。

接线之后还有一个问题：如果哪天又读不到标签（典型场景是「只换了插件 dist、MCP server 还是旧文件」的半更新），门禁该怎么办？两个选项：

- **开门（fail-open，被否）**：读不到就当"普通记忆"放行。方便，但假如这条真敏感，就泄进模型上下文了。
- **关门（fail-closed，采纳）**：读不到就当"拿不准"，拦截并计入「已过滤」。可能冤枉几条无害记忆（漏注），但**绝不错注**。

错注和漏注的代价不对称：漏注＝这条记忆这一轮没帮上忙，是体验损失；错注＝敏感内容进了模型上下文——模型看得见、可能复述、可能进日志，踩的是「秘密与敏感内容不得进入注入/投影/上行」的项目红线。**安全边界上的未知状态永远取严**：门禁读不出工牌，正确做法是拦下来查，不是"读不出就当有牌放行"。

而且关门不是静默的：被拦条数计入面板「已过滤」计数。半更新真的发生时，面板已过滤数字上涨，一眼可见"闸在拦东西"，而不是莫名发现注入变少还以为没命中。**正常情况下这道闸零影响；只有版本错位这种异常时刻才生效，生效时的立场是"拿不准就不注入"。**

### D3：面板徽章只渲染 preset 原文，不渲染 UUID

左栏注入条目（client.js:396-412 一带）与右栏活动记录（client.js:477-519 一带）在 kind 标记旁加作用域徽章；样式按 preset 区分（device-local/agent-private 用警示色调，具体样式任务级决定）。`ActivityEntry.items` 与落盘 JSONL：items 在内存里带 scope 供 UI 用，**落盘仍不写 items**（既有纪律，index.ts:832-834 注释不变）。

### D4：与 add-two-stage-memory-recall 的边界

两个变更都动 `summarize()` 与插件 recall 链路。本变更只加字段；把 `content` 换成 `preview`、注入行带 id 属于 add-two-stage-memory-recall。**实施顺序：本变更先行**；两级检索的 delta 已经写为 ADDED 需求，不与本变更的 MODIFIED 需求重叠，归档顺序不影响彼此。

## 兼容性核对

- `scopeAllowsRead` 一行不动：本变更零过滤语义变化，纯「已有判定结果可见化」。
- 「面板不泄露记忆正文」不受影响：徽章是元数据；敏感/local_only 记忆本就进不了注入与面板 items（被闸在前面），被过滤的只计数。
- e2e-ui 既有 66 项断言不涉及作用域，补断言不重写。
