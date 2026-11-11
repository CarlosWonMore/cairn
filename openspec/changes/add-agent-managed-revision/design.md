# Design: Agent 处置批注的修订提案

## 上下文

两个已确认的事实决定了整个设计：

```
用户：批注不允许修改记忆，但是使用 AI 进行记忆批注处置可以修改。
用户：AI 修改，必须出具修改方案卡由人确认。
```

而项目核心约束是：

```
模型只生成候选；作用域、审批、来源、修订、冲突与删除由确定性代码执行。
```

三者能同时成立，**当且仅当**把 Agent 的动作定性为「提案」而非「修改」——修改的执行者是人。

## 决策

### D1：Agent 拿提案权，人拿写入权

**选择**：MCP 只暴露 `revision_propose` / `revision_list`；`apply` 只在 CLI 与控制台。

理由：这不是「加个确认弹窗」的 UX 问题，是**权限边界**问题。Cairn 的整个治理模型建立在「模型不持有写入权」上；一旦 Agent 能 apply，`user_confirmed` 这个权威级别就失去意义。

**代价**：Agent 不能「一次搞定」。但这正是用户要的——他说了「必须出具方案卡由人确认」。

### D2：提案不新造修订机制，采纳时复用 `memory_update`

**选择**：卡片只是「待执行的意图」；apply 时逐条调既有的 `memory_update`。

理由：记忆中已经有不可变修订链、冲突检测、秘密复检、审计。另造一条写入路径意味着要把这些**全部重做一遍**，且必然漏掉其中几条。本项目已经在这类「同一判断两处实现」上栽过两次（`promotedPredicate`、`firstLine`）。

### D3：新鲜度用 `revisionIdAtPropose` 判定

**选择**：卡片记录提出时的当前修订 id；apply 时对比，不一致则拒绝并标 `stale`。

理由：`memory_update` 本身已支持 `expectedCurrentRevisionId`——**直接复用它**，不新造乐观锁。这样「两个人同时改」与「AI 提案过期」走同一套判定。

### D4：权威记为 `user_confirmed`

**选择**：采纳后新修订权威是「人已确认」。

理由：内容由 Agent 起草，但**批准动作来自人**。这跟 `add-candidate-promote-command` 里对候选晋升的处理完全一致（那次也是 `agent_inferred` → `user_confirmed`）。写成 `agent_inferred` 会低估它，写成 `user_explicit` 会高估（用户没有亲口说这句话）。

### D5：卡片存 JSON，不进库

**选择**：`~/.cairn/console/revision-proposals.json`，与 `annotations.json` / `ai-reviews.json` 同一模式。

理由：卡片是派生数据（Agent 生成的草稿），不进同步、不需索引。放进库会让它参与同步协议与迁移，收益远小于成本。

**代价**：卡片不能按内容检索，大库场景需要改表——当前规模无影响。

### D6：秘密扫描在生成时就做，不等到应用

**选择**：`revision_propose` 时 `scanText`，命中拒绝整条。

理由：卡片本身要落盘给人看。若等到 apply 才查，秘密已经写进 JSON 文件了——落盘即泄露。

## 威胁模型

| 威胁 | 后果 | 缓解 |
|---|---|---|
| Agent 通过多轮提案耗尽人的注意力 | 人疲劳后无脑点采纳 | 卡片必须展示正文对照；`revision_list` 默认只返回待审；不做自动采纳 |
| 提案绕过版本检查 | 覆盖别人刚做的修改 | D3 复用 `expectedCurrentRevisionId` |
| 提案文件含秘密 | 落盘泄露 | D6 生成时扫描 |
| 卡片被当成已生效 | 人以为改了其实没改 | 界面强制标注「待确认」；`revision_list` 与记忆状态分开展示 |

## 迁移与回滚

- 无数据库迁移。
- 回滚：删除卡片目录即回到现状；已采纳的改动是正常修订，可继续用 `memory_update` 改回。

## 可观测性

| 观察点 | 位置 |
|---|---|
| 待审提案数 | `cairn revision list --status pending` / 控制台 / doctor notes |
| 采纳与拒绝 | 卡片上的 `resolvedBy` / `resolvedAt` / `reason` |
| 陈旧卡片数 | 列表顶部汇总 |
