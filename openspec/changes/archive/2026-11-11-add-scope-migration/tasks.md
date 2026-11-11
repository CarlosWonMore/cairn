# Tasks: 记忆作用域迁移

> 硬边界：迁移只改 `scope_id`，不改 status / authority / 正文；迁移与 outbox 重建同事务；迁出用新事件类型不复用墓碑。
>
> 实施记录（2026-11-11，主会话实现）：`npm test` 759/758/0/1 → **777/776/0/1**（+18）。变异对照（6.4）：删掉「作废旧任务」DELETE 后 **2 条用例变红**（迁出/迁入两条都直接断言该 DELETE 的效果），还原复绿。负对照（6.5）：`MAX_EVENTS_PER_CHUNK` 200→201 **零红**。「不再持有」的落点是 meta 标记（`scope_exit:<id>`）+ `archived` 状态（3.3 二选一的组合：archived 让检索/投影免费排除，meta 标记区分用户主动归档并支持迁回解除）。迁回靠 `reentry` 标记的强制重发修订快照（幂等键带时间戳，否则迁出→迁回→再迁出的第二轮通知会被历史任务挡住）。

## 1. 存储层

- [x] 1.1 `src/store/memories.ts` 新增 `migrateScope(id, targetScopeId, actor)`：只更新 `memory.scope_id` 与对应 `memory_revision.scope_id`，同事务。
- [x] 1.2 **不要**复用 `promoteToActive`（它会改 status 与 authority）。
- [x] 1.3 测试：迁移后 status / authority / content / currentRevisionId / 修订链长度全部不变，只有 scope_id 变。

## 2. 编排层（AppService）

- [x] 2.1 `rescopeMemory(id, { scopePreset, projectId?, force? })`：解析目标作用域 → 安全阀校验 → `migrateScope` → 重建 outbox → 审计，同事务。
- [x] 2.2 安全阀：冲突状态拒绝（`E_CONFLICT_STATE`）；项目类作用域缺 projectId 拒绝（`E_VALIDATION`）；`user_explicit` 且无 `force` 拒绝。
- [x] 2.3 outbox 重建**照抄** `promoteCandidate` 的既有写法（作废旧 pending + 新作用域允许时入队）。
- [x] 2.4 迁出可同步作用域且该记忆曾同步过时，产生 `scope_exit` 事件（见 3.x）。
- [x] 2.5 测试：四种安全阀各一条；迁移后 outbox 状态符合预期；事务回滚不留半成品。

## 3. 同步：scope_exit 事件

- [x] 3.1 `src/sync/events.ts` 的 `SyncEventType` 增加 `'scope_exit'`，payload 含 `lastContentHash`。
- [x] 3.2 `push.ts`：迁移出同步边界时生成该事件。
- [x] 3.3 `apply.ts`：收到 `scope_exit` → 把本地该记忆标为「不再持有」（需要一个状态或标记位；**优先复用现有字段，不要为它加表列**——若无合适字段则用 tombstone 表的独立 kind 或 meta 标记，实现时二选一并说明）。
- [x] 3.4 收到未知事件类型：跳过 + 审计，**不中断整链**（对齐既有 `undecryptable_chunk` 行为）。
- [x] 3.5 测试：迁出事件跨设备生效；迁出≠遗忘（无墓碑）；迁回后重新同步；未知事件不阻断；重复推送幂等。

## 4. CLI

- [x] 4.1 `cairn rescope <id> --scope-preset <p> [--project-id] [--force]`。
- [x] 4.2 `cairn rescope --pending [--dry-run]`：处理批注中 `needs_rescope` 的条目，先打印清单再执行。
- [x] 4.3 `--ids-file` 批量，逐条报告成功/失败/跳过。
- [x] 4.4 执行前打印汇总：将迁移 N 条，其中 M 条将失去同步。
- [x] 4.5 帮助文本。
- [x] 4.6 测试：dry-run 零写入；批量部分失败如实计数；缺 projectId 退 2；冲突退 4。

## 5. 批注联动

- [x] 5.1 `DISPOSITIONS` 增加 `needs_rescope`。
- [x] 5.2 控制台 UI 增加该类别；`pending_forget` 的提示样式复用。
- [x] 5.3 测试：批注本身不改记忆（回归既有断言）。

## 6. 全量验收

- [x] 6.1 `npm run typecheck` 0 错误。
- [x] 6.2 `npm test` 全量通过，报告四个数字并与基线（759/758/0/1）对比。
- [x] 6.3 `openspec validate add-scope-migration --strict` 通过。
- [x] 6.4 变异对照：去掉 outbox 重建里的「作废旧任务」→ 确认对应用例变红且只有它红。
- [x] 6.5 负对照：改无关常量 → 零红。

## 7. 文档

- [x] 7.1 `docs/cairn-usage.md` 补「作用域迁移」小节，**必须写清**：迁到设备类作用域会失去同步、云端旧密文不会自动删除。
- [x] 7.2 `docs/cairn-sync.md` 补 `scope_exit` 事件语义。
- [x] 7.3 `CHANGELOG.md` Unreleased。
