# Proposal: 记忆批注与待处置队列（WebUI 标注 → Agent 处置）

## Why

用户 2026-11-10 的原话：**"我希望可以批量管理记忆，通过 WebUI 这个我认为比较合适"**、**"作为我人类管理记忆的一个切入口"**。

现状缺口（实测）：

| 能力 | 现状 |
|---|---|
| 看见记忆 | ✅ 控制台有只读列表与详情（`/api/memories`、`/api/memories/{id}`） |
| 改一条记忆 | ❌ 只能跑回终端 `cairn update <id> "..."` |
| 删一条记忆 | ❌ 只能 `cairn forget <id>`（还要先复制 uuid） |
| 表达"这条有问题、该怎么改" | ❌ 完全没有 |

问题不只是"少几个按钮"。真正的问题是：**人工判断无处存放**。用户看到一条过时的记忆，心里有明确意见（"这个日期错了""应该合并到那条""这条可以删"），但系统里没有任何地方能记下它——只能立刻执行，或者忘掉。而立刻执行往往不够谨慎（还没想清楚怎么改），忘掉则等于管理失效。

调研了社区同类实现（2026-11-10）：

| 项目 | stars | 与"批注"的关系 |
|---|---|---|
| `omdsh-dev/dsh-mnemon` | 959 | 只提供**直接编辑**，无批注 |
| `Phant0Meow/dsh-meow-memory` | 383 | 只提供**一键保存**（脑标），无批注 |
| `vectorize-io/hindsight` | — | 做**策展页**（architecture/conventions/in-flight），是知识层不是批注 |
| `mashanglinyu/luanyujia-workbench` | 535 | 记忆机制偏静态配置 |

**结论：逐条"批注 + 延后处置"是社区尚未覆盖的空白**，而它恰好对应"人类管理员批量管理"这个真实工作流。

## What Changes

- **WebUI 逐条批注**：在记忆详情/列表上对单条记忆写下处置意见（`disposition` 枚举 + 自由文本 `note`）。批注**不改变记忆正文**，只记录人类判断。
- **批量标记**：列表支持多选后批量打同一类标记（例如"这 20 条都是过期的"）。
- **待删清单（折中方案）**：接受"置为墓碑"这个诉求，但**不在 WebUI 直接执行**。WebUI 只能标 `pending_forget`，进入待删清单；真正执行仍需终端 `cairn forget --pending` 逐条确认。
- **Agent 拉取通道**：新增 MCP 工具 `memory_annotations_list` / `memory_annotation_resolve`，让 Agent 在会话里拉取"哪些记忆被标了、意见是什么"，处理完后回写状态。
- **批注本机私有**：批注存于 `~/.cairn/console/annotations.json`，**不参与云同步**；处置结果（修订、墓碑）走既有同步协议照常同步。

### 明确不做的事

- **不做 WebUI 直接改正文**。改正文（`cairn update` / `memory_update`）已存在且走不可变修订链，本变更不重复实现，只让批注成为它的**前置意见**。
- **不做 WebUI 直接墓碑**。见上面折中方案的理由。
- **不把批注写进 `memory` 表**。批注是人对记忆的旁注，不是记忆本体；写进库会让它参与同步、占 schema、还要处理冲突合并。派生数据放派生位置。
- **不同步批注本身**（用户 2026-11-10 明确选择）。跨设备只同步"处置结果"。
- **不做压缩重注入**。那是独立变更 `add-compaction-reinject`。

## Impact

- Affected specs: `local-console`（WebUI 批注与批量标记）、`agent-interfaces`（MCP 拉取工具）、`memory-governance`（批注与审批/处置的边界）
- Affected code: `src/interfaces/console/`（新 `annotations.ts` + server 路由 + UI）、`src/interfaces/mcp/server.ts`（两个新工具）、`src/interfaces/app-service.ts`（批注读写 + 待删清单）
- 不涉及数据库迁移：批注落在 JSON 文件，与 `ai-reviews.json` 同一模式
- 回滚：删除 `annotations.json` 即回到纯只读控制台；批注是派生数据，丢失不影响任何记忆

## 风险与回滚

| 风险 | 处置 |
|---|---|
| 批注文件被当成"权威数据"误依赖 | spec 明确批注是派生数据；删除文件后系统行为不变（只是丢失人的意见） |
| 待删清单被误当成"已删除" | WebUI 明确显示"仍为 active，未生效"；`cairn forget --pending` 逐条打印后再执行 |
| 批注内容含秘密 | 写入前复用既有 `scanText` 秘密扫描；命中即拒绝 |
| 多实例并发写同一 JSON | 同一 `~/.cairn` 下控制台单实例（沿用既有 token/端口模型）；写入用原子替换 |
