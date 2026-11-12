# Proposal: 两级记忆检索——列表给预览，全文按需取

## Why

三个已核实的断点（2026-11-12 代码考古）：

**① `memory_search` 名为预览、实为全文直出。** 工具描述写「按关键词检索记忆预览（不返回全文上下文注入）」，实际 `summarize()` 返回 `content: m.content` 未截断（server.ts:739）。ZCode/WorkBuddy 里模型每次显式检索，返回的就是 N 条全文进对话——描述与线协议不符，token 开销不可预算。

**② 注入行不带记忆标识，模型无法下钻。** DSH 注入渲染只有 `[kind] + firstLine≤160字`（recall.ts:130），模型看到「有这条记忆」却拿不到 id，无法调用 `memory_get` 取全文——两级检索缺「第二级」的入口。

**③ `memory_get` 只能单条。** 即使有了 id，下钻多条记忆要多轮工具调用。

参考 claude-mem（thedotmack/claude-mem）的 progressive disclosure：SessionStart 只注入 ~1000 token 索引（每行 = id + 类型 + 标题 + 全文 token 估算），全文经 `get_observations(ids)` 批量按需取。其可借鉴的核心是**索引行携带可下钻的句柄 + 让模型自己权衡值不值得取全文**；其教训也必须带上——README 的 "~10x token savings" 被 issue #4138 打掉，最终改口为 "per-record size ratio, not a measured saving"。本变更**不承诺端到端节省倍数**：省的是单次检索结果的 token 与长尾（真实库均值 395 字节/条，均值收益有限；DSH 自动注入已有 1536B 硬预算，边际小）；主要收益在 MCP 显式检索路径与下钻能力补全。

## What Changes

- **检索列表返回有界预览而非全文**：`memory_search` / `memory_context` 条目以 `preview`（有界、确定性、frontmatter 感知的摘要，服务端单点生成）替代全文 `content`，附带 `truncated` 与 `content_length`；全文只经 `memory_get`。
- **`memory_get` 支持唯一前缀与批量**：`id` 接受完整 id 或唯一前缀（≥8 字符，歧义时报候选）；新增可选 `ids` 数组批量取（上限 10），逐条执行作用域检查。
- **注入行携带记忆标识前缀**：DSH 注入行带 id 前 8 字符，模型可据此直接调 `memory_get` 下钻；注入预算（1536B）与去重语义不变。
- **工具描述内嵌两段式纪律**：`memory_search` / `memory_context` / `memory_get` 的 description 明示「先看预览，确需全文再 get（可批量）」。
- 服务端 preview 单点化后，插件本地 `firstLine`（recall.ts 注入行）退役改用 server preview，消除「同一判断两处各写一份」的隐患（`promotedPredicate` / 投影 `firstLine` 的历史教训）。

### 明确不做的事（红线）

- **不引入向量/嵌入**：违反「不下载模型或推理运行时」边界；FTS5 trigram + BM25 已达标（与 claude-mem 主通道同款，其 Chroma 向量实测 5–7 CPU 秒/条更不可取）。
- **不做 digest/summary 存储列**：无本地模型生成摘要；存量 533 条多为残片，收益低。preview 是渲染期确定性投影，不是存储列；等下次 schema 重建再议。
- **不改注入预算与去重语义**：1536B、会话去重、压缩后重注入全部保持。
- **不改作用域过滤语义**：preview 与 id 前缀解析都走既有 `scopeAllowsRead`；前缀解析在 agent 通道内进行，不构成绕过入口。

## Impact

- Affected specs: `scoped-retrieval`（ADDED「检索列表返回有界预览而非全文」「详情读取支持唯一前缀与批量」）、`agent-interfaces`（ADDED「注入内容携带可下钻的记忆标识」）
- Affected code: `src/interfaces/mcp/server.ts`（preview + get 前缀/批量 + 描述）、`src/retrieval/`（preview 单点函数）、`plugin/dsh/src/recall.ts`（注入行带 id、渲染 server preview）、`plugin/dsh/src/usage-state.ts`（firstLine 退役路径）
- 不涉及数据库迁移
- 测试影响：现有断言 `memory_search` 返回全文的测试需改为断言 preview；`npm run test:ui` 面板断言不受影响（面板本就只显示摘要）；`mcp:smoke` 需核对返回形状
- 与 `add-memory-scope-visibility` 同改 `summarize()`，**实施顺序在其之后**；本变更 delta 全部为 ADDED，归档顺序不影响彼变更

## 风险与回滚

| 风险 | 处置 |
|---|---|
| 下钻多一跳反而更贵（模型总是 get 全文） | 预览长度取「多数查询停在第一层」的值；工具描述纪律引导；任务里加「注入后 0 次 get 是常态」的口径说明而非强制 |
| preview 截断破坏 frontmatter 感知摘要 | preview 由服务端单点函数生成（frontmatter 感知），插件不再自行截断全文；单测钉住 frontmatter 记忆的 preview 输出 |
| id 前缀歧义导致取错记忆 | ≥8 字符 + 唯一性校验；歧义时报错并列出候选全 id，绝不猜测 |
| 批量 get 被用来绕过作用域 | 逐条 `scopeAllowsRead`；不可读条目只返回标记不带正文；上限 10 |
| 旧测试/调用方依赖全文返回 | 变更面集中在 MCP 层与插件；console（`cairn ui`）走 app-service 直连不经 `summarize()`，不受影响；任务里逐一核对 |
