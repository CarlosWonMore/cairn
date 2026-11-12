# Design: 两级记忆检索——列表给预览，全文按需取

## 上下文

- `summarize()`（server.ts:714-744）是列表条目形状单点；`content: m.content` 全文直出是「名为预览」的根源。
- 现有截断全部在消费端：注入行 160 字（recall.ts:68 `LINE_MAX`）、面板 60 字（usage-state.ts:35）、投影 brief 120 字（brief.ts:40）——**服务端零截断**。
- `firstLine`（usage-state.ts:45-66）是 frontmatter 感知的摘要提取，被注入渲染（recall.ts 曾各写一份，已统一导出）与面板共用；它跳过 `---`/frontmatter 行、优先 `name:`/`description:` 值。
- memory id 是 uuidv7（36 字符）；注入预算 1536B、`LINE_MAX` 160、每条一行的格式是实测稳定形态。
- claude-mem 参照：索引行 = `#2591 | 时间 | 类型图标 | 标题 | ~token估算`；`get_observations(ids[])` 批量取全文；其 "~10x savings" 口径已被社区打掉（issue #4138）。

## 决策

### D1：preview 统一应用于 `memory_search` 与 `memory_context`

**选择**：两个列表工具一律返回预览，不设 `include_content` 之类开关。

**理由**：口径单一。若 `memory_context` 保留全文，「什么时候拿到的是全文」就取决于调用了哪个工具——行为不可预测，工具描述纪律也写不清。模型确实需要全文时多一次 `memory_get`（前缀已缓存，边际成本 = 输出 token + 一轮延迟），这与 claude-mem 的使用形态一致（其 SessionStart 注入同样是索引 + 按需 get）。

**放弃的备选**：`memory_context` 保持全文、仅 `memory_search` 改预览——被否，理由如上（口径分裂）。

### D2：preview 是「frontmatter 感知的确定性投影」，不是裸前缀截断

**选择**：服务端新增单点预览函数（置于检索层，如 `src/retrieval/preview.ts`），逻辑以现 `firstLine`（usage-state.ts:45-66）为基底推广到固定上限（目标 300 字符，任务期可调），输出确定（同输入同字节、无 `now()`，遵守 brief.ts:5-17 的投影不变量纪律）。

**理由**：裸前缀截断会把 frontmatter 原文漏进预览（注入行会显示 `---` / `key: value` 垃圾）；frontmatter 感知逻辑已经存在且被两处消费，**提升到服务端单点**而不是在服务端再抄一份——这是 AGENTS.md「同一判断不要在两处各写一份」纪律的顺向修复：server preview 落地后，插件 `recall.ts` 的注入行直接渲染 server preview（本地 160 字截断保留为预算护栏），`usage-state.ts` 的 `firstLine` 退役或降级为面板兜底。

### D3：注入行标识用 16 字符前缀，`memory_get` 支持前缀解析

**选择**：注入行渲染 id 前 16 字符；`memory_get` 的 `id` 参数接受完整 id 或 ≥8 字符的唯一前缀，歧义时报错并列候选。

**理由**：完整 uuid（36 字符）每行挤占预算且可读性差；歧义有显式错误兜底（绝不猜测）。

**实施期修正（2026-11-13，TDD 实测）**：初版按 8 字符设计，但测试立即打脸——**uuidv7 的前 12 hex 是毫秒时间戳**，同一毫秒写入的记忆共享前 ≥13 字符，所以「8 字符前缀唯一」在新建库（全部记忆同毫秒生成）上几乎必然歧义。注入行改为渲染 16 字符（时间戳 + 版本 + rand_a 首位，同毫秒冲突空间 4096），解析层仍接受 ≥8 的唯一前缀（歧义报候选）。教训与 §「同一判断不要两处写」同级：**id 形状决定前缀长度，不能照抄 claude-mem 的自增数字 id 经验**。**限制**：前缀解析只在 agent 通道（MCP 工具）支持，内部 API 不提供前缀语义，避免「标识即主键」的语义扩散。

### D4：批量 get 上限 10，逐条作用域检查，不可读条目显式标记

**选择**：`memory_get` 增加可选 `ids` 数组（与既有 `id` 并存，二者恰传其一）；上限 10；结果逐条 `scopeAllowsRead`，不可读条目返回 `{ id, readable: false }` 不带正文。

**理由**：上限对齐 `memory_search` 默认 topK（5）的两倍余量，防一条指令拉全库；不可读条目**显式标记**而非静默跳过——静默跳过会让模型误以为「只有两条」，显式标记保持可推断面诚实（与全通道作用域隔离的「不返回可推断内容」一致：标记本身不泄露内容）。

### D5：工具描述承载纪律，不加新工具

**选择**：两段式纪律写进 `memory_search` / `memory_context` / `memory_get` 三个工具的 description；不新增 `memory_get_batch` 之类的独立工具。

**理由**：claude-mem 的 `important_workflow` 模式证明 description 是模型最稳定读到纪律的位置；新增工具会扩大工具面（每字节都进请求 header，schema 变更 = prompt-changed 整包重算的风险面，见 fix-onboarding-tool-surface-flip 的动机），能并就并。

### D6：诚实口径

proposal 与 README/使用文档（任务项）中的收益表述一律为「单次检索结果 token 有界化 + 长尾按需 + 下钻能力补全」，禁止"节省 N 倍"式表述；验收只断言形状（无全文字段、预览有界、长度如实），不断言节省率。

## 兼容性核对

- console（`cairn ui`）走 app-service 直连、不经 MCP `summarize()`，检索视图不受影响。
- DSH 插件 `rankHits` 计分用命中词 vs 内容（recall.ts:221-231）：改用 server preview 后，查询词来自用户消息、命中词本就出现在正文，preview 含正文首段——计分输入等价；单测钉住。
- `TRACKED_TOOLS` 排除 `memory_search` 的理由（index.ts:269-273「返回 preview 列表，参数里没有 id」）在列表真的变成 preview 后更加成立，注释顺势修正。
- 既有断言 search 返回 `content` 的测试需改写——这是形状变更的预期破坏，任务里逐个迁移。
