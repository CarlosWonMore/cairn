# Proposal: 新增候选晋升命令（cairn promote）

## Why

`memory_propose` 写入的候选（`status='candidate'`）**没有任何合法的晋升入口**。2026-11-03 实测确认：

- `memory_decide` 是 onboarding 批次通道（`action=next` 返回「没有待整理的批次」），与 candidate 无关；
- `cairn review` 走 `reviewSubmit`，只处理 `import_item` 的复核建议，不处理 `memory.status='candidate'`；
- 控制台只有 `GET /api/memories`，无晋升写入口；
- `promoteToActive()` 仅被 `app-service.applyDecision()` 调用，而 `decideWrite()` 只在**写入路径命中重复**时才产出 `promote_candidate`。

也就是说，候选晋升当前唯一可用的路径是：**用完全相同的正文再写一次**，撞上查重（`findDuplicate` 把 `active` 与 `candidate` 同等看待）后被动晋升。这条路径有三个具体问题：

1. **正文必须逐字节相同**。候选正文若有前后空白差异，查重就落空，结果是**新建一条记忆**而非晋升，候选仍留在原地——重复且难以察觉。
2. **权威被静默改写**。`addMemory` 的 `authority` 默认取 `user_explicit`，且 MCP 侧不暴露该字段。走这条路径晋升时，候选的来源痕迹（`agent_inferred`）被覆盖成用户明确，与 `memory-governance` 中「模型或导入来源 MUST NOT 静默成为高权威活动记忆」的意图相悖——虽然晋升本身确实来自用户批准，但**批准应当是一个可审计的独立动作**，而不是写入副作用。
3. **无法表达作用域意图**。候选写入时作用域已固化在 `scope_id` 上，而 `reviseMemory()` 只改正文、不动作用域（`src/interfaces/app-service.ts:312-330`），全库无 `UPDATE memory SET scope_id` 路径。2026-11-03 用户要把 3 条含本机绝对路径的候选改为 `device-local`，**在现有代码下只能删了重建**，会丢失原 id、修订历史与证据链，并留下墓碑。

用户侧的痛感很直接：「这三条记忆我批准了，但系统没给我批准的办法」。

## What Changes

- 新增 CLI 命令 `cairn promote <id>`：把指定候选晋升为 `active`。
- 该命令支持 `--scope-preset`，允许在晋升的同时把作用域改为 `device-local`（含路径的机机专属内容不应跨设备共享）。作用域变更**必须**与晋升在同一事务内完成，并留下审计事件。
- 晋升需要**显式的批准凭据**，且必须记录批准来源通道（本地 CLI / 本地浏览器），与 `memory-governance` 的「计划绑定真实审批」一致。
- 候选被拒绝（不批准）时，提供 `cairn reject <id>` 把候选转为 `tombstoned`，让「不批准」也有确定终态，而不是永远悬在 `candidate`。

### 明确不做的事

- **不改 `memory_add` 的权威推导逻辑**。晋升是独立动作，不复用写入副作用。
- **不做批量晋升**。一次一条，避免批量操作里混入未逐条核对的条目。
- **不引入自动晋升**。候选转 active 永远是用户显式动作，`agent_inferred` 不得静默晋升（现有 `promoteToActive()` 的 `E_FORBIDDEN` 守卫保留）。

## Impact

- Affected specs: `memory-governance`（新增候选审批闭环要求）、`agent-interfaces`（CLI 入口）
- Affected code: `src/interfaces/cli/main.ts`（新增 `promote` / `reject` 分支）、`src/interfaces/app-service.ts`（新增 `promoteCandidate` / `rejectCandidate`）、`src/store/memories.ts`（作用域迁移的存储层方法）
- Affected tests: `tests/interfaces/cli`（命令行为与退出码）、`tests/store/memories`（作用域迁移的外键与审计）
- 不涉及数据库迁移：`memory.scope_id` 列已存在，本变更只增加受审计的更新路径。
- 面向用户：候选从「写进去就没人管」变成「有明确的批准 / 拒绝出口」。
