# Proposal: 记忆作用域迁移（active 记忆可改归属）

## Why

用户 2026-11-11 的实际需求：**把已有记忆从 `personal-global` 降到 `project-device`**，用来隔离 `D:\Neusoft` 下的项目内容，避免私人项目与企业项目混在一个空间。

**现在做不到。** 实测原因：

| 事实 | 出处 |
|---|---|
| 唯一能改 `memory.scope_id` 的公开入口是 `promoteToActive` | `src/store/memories.ts:214`，但它入口处要求 `status === 'candidate'`（`memories.ts:201`） |
| 用户的 54 条记忆全是 `active` | `cairn status` 实测 |
| 因此只能「删了重建」 | 丢 id、修订历史、证据链，且留墓碑 |

用户原话：*「我有做过几个修改的批注，需要把部分记忆降级为 project-device 的」*——批注只能表达意图，**执行路径不存在**。

底层能力其实已在（`UPDATE memory SET scope_id` 在 `promoteToActive` 里跑通了），本变更把它**按 active 记忆的需要**暴露出来，并补齐迁移必然牵动的三件事：同步队列重建、云端副本语义、安全阀。

## What Changes

- **`cairn rescope <id> --scope-preset <p> [--project-id <pid>]`**：把一条 active 记忆迁移到目标作用域。
- **批量**：`--ids-file <file>`，逐条报告成功/失败/跳过。
- **安全阀**（design D4）：冲突中的记忆拒绝迁移；高权威记忆需 `--force`；迁移前打印「将失去同步的条数」。
- **同步队列重建**：与 `promoteCandidate` 完全同构——作废旧作用域下的 pending 任务，在新作用域允许上行时重新入队（`app-service.ts:429-442` 的既有做法）。
- **云端副本处理**：迁出可同步作用域时，**发送一个 `scope_exit` 事件**，让其他设备把该条标为「本设备不再持有」，既不删除也不继续更新（用户 2026-11-11 选择方案 C）。
- **批注联动**：`pending_forget` 之外新增处置类别的执行入口——批注标记后可在终端一键迁移（不改变「批注本身不改记忆」的边界）。

### 明确不做的事

- **不在 WebUI 直接执行迁移**。批注只表达意图，执行仍在终端（与 `pending_forget` 同一套哲学：破坏性动作需要完整上下文与显式确认）。
- **不允许迁移到 `sensitive` 作用域**：`core/scope.ts:212` 已有硬规则「sensitive 必须 local_only」，迁移过去等于放宽，不做。
- **不删除云端既有密文对象**：对象存储是追加语义，删除需要独立 purge 能力（本变更不做）。
- **不做跨设备的作用域合并**：两端各自迁移到同一目标时按正常冲突流程处理。

## Impact

- Affected specs: `memory-store`（作用域可变性）、`cloud-sync`（scope_exit 事件）、`local-console`（批注联动入口）
- Affected code: `src/store/memories.ts`（新增 `migrateScope`）、`src/interfaces/app-service.ts`（`rescopeMemory`）、`src/sync/push.ts` / `apply.ts`（新事件类型）、`src/interfaces/cli/main.ts`
- **不涉及数据库迁移**：`memory.scope_id` 列已存在
- 回滚：新 CLI 命令可移除；已迁移的记忆可用同样命令迁回

## 风险与回滚

| 风险 | 处置 |
|---|---|
| 用户误把记忆迁到更窄作用域，其他设备看不到 | 迁移前打印影响（可见范围变化 + 是否失去同步）；高权威需 `--force` |
| 迁出后云端旧副本仍被其他设备拉到 | 引入 `scope_exit` 事件；SPEC 明确「收到后不删除、不显示」 |
| 迁移中断留下半成品 | 迁移与 outbox 重建在同一事务；失败回滚 |
| `project-device` 缺 projectId | 校验层已有约束（`core/scope.ts:191`）；CLI 显式报错，不静默降级 |
