# Proposal: Agent 处置批注的修订提案（方案卡 + 人确认）

## Why

用户 2026-11-11 明确的两条：

> 批注不允许修改记忆，但是使用 AI 进行记忆批注处置可以修改。

> AI 修改，必须出具修改方案卡由人确认。

第一条与 Cairn 的核心设计**直接冲突**，必须先说清楚：

> 模型只生成候选；作用域、审批、来源、修订、冲突与删除由确定性代码执行

如果 Agent 能直接改记忆，这条设计就没了。但用户的真实需求是合理的：**批注攒了一堆，人工逐条改太慢**。

所以本变更做的事是：**让 Agent 把「改什么、为什么改」写成一张可审阅的方案卡，人一键采纳**。Agent 获得的是**提案权**，不是**写入权**。

这跟现有的 `review`（AI 建议层）与 `plan`（治理计划）是同一套哲学，只是**输入从「导入条目」换成了「人对记忆的批注」**。

## 现状缺口

已有能力：

| 能力 | 出处 |
|---|---|
| 批注（人在 WebUI 标了意见） | `add-memory-annotations`（已归档） |
| Agent 能读到批注 | MCP `memory_annotations_list` |
| Agent 能改记忆 | MCP `memory_update`（**直接改，无需人确认**） |

第三行正是问题：Agent 已经能直接改，但**没有任何「先给人看方案」的中间态**。用户要的正是这个中间态。

## What Changes

- **方案卡（proposal card）**：Agent 针对一条或多条批注，生成结构化修订提案，落盘为可审阅的文件。
- **卡片内容**：每条含记忆标识、当前正文摘要、拟改后的完整正文、改动理由、引用的批注、风险标记。
- **人审入口**：`cairn revision list|show|apply|reject`；WebUI 也可查看。
- **采纳即执行**：人 `apply` 时，逐条调用既有的 `memory_update` / `memory_forget`，权威记为「人已确认」。
- **MCP 侧只读 + 只写卡**：Agent 只能 `revision_propose`（写卡）与 `revision_list`（读卡），**不能** apply。

### 明确不做的事

- **不让 Agent 直接 apply**。应用必须是人的动作（CLI 或 WebUI 上的一次显式点击）。
- **不新造修订机制**。采纳时复用 `memory_update`，走既有不可变修订链——Agent 的方案卡只是「待执行的意图」。
- **不自动批量采纳**。默认逐条；批量需显式 `--all` 且逐条打印。
- **不做定时生成**。Agent 生成卡片是它自己的动作（在会话里），不是系统后台任务。

## Impact

- Affected specs: `memory-governance`（Agent 提案与人确认的边界）、`local-console`（卡片展示）、`agent-interfaces`（MCP 入口）
- Affected code: 新增 `src/governance/revision-proposal.ts`；`src/interfaces/cli/main.ts`、`src/interfaces/mcp/server.ts`、`src/interfaces/console/`
- 不涉及数据库迁移（卡片存 JSON，与 `annotations.json` 同一模式）
- 回滚：删除卡片目录即回到现状；已采纳的改动走既有修订链，可继续 `memory_update` 改回

## 风险与回滚

| 风险 | 处置 |
|---|---|
| Agent 写出「看起来对但实际更差」的修订 | 卡片必须展示**改前/改后全文**与理由；人逐条确认 |
| 卡片绕过审批直接生效 | MCP 不提供 apply；apply 只在 CLI/WebUI，且需要本地进程身份 |
| 卡片内容含秘密 | 生成卡片时复用 `scanText`；命中拒绝整张卡 |
| 卡片陈旧（记忆已被改过） | 用 `revisionIdAtPropose` 判定；apply 时不一致则拒绝（同 `expectedCurrentRevisionId` 语义） |
