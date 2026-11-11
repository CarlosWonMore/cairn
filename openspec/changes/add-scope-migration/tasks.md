# Tasks: 记忆作用域迁移

> 硬边界：迁移只改 `scope_id`，不改 status / authority / 正文；迁移与 outbox 重建同事务；迁出用新事件类型不复用墓碑。

## 1. 存储层

- [ ] 1.1 `src/store/memories.ts` 新增 `migrateScope(id, targetScopeId, actor)`：只更新 `memory.scope_id` 与对应 `memory_revision.scope_id`，同事务。
- [ ] 1.2 **不要**复用 `promoteToActive`（它会改 status 与 authority）。
- [ ] 1.3 测试：迁移后 status / authority / content / currentRevisionId / 修订链长度全部不变，只有 scope_id 变。

## 2. 编排层（AppService）

- [ ] 2.1 `rescopeMemory(id, { scopePreset, projectId?, force? })`：解析目标作用域 → 安全阀校验 → `migrateScope` → 重建 outbox → 审计，同事务。
- [ ] 2.2 安全阀：冲突状态拒绝（`E_CONFLICT_STATE`）；项目类作用域缺 projectId 拒绝（`E_VALIDATION`）；`user_explicit` 且无 `force` 拒绝。
- [ ] 2.3 outbox 重建**照抄** `promoteCandidate` 的既有写法（作废旧 pending + 新作用域允许时入队）。
- [ ] 2.4 迁出可同步作用域且该记忆曾同步过时，产生 `scope_exit` 事件（见 3.x）。
- [ ] 2.5 测试：四种安全阀各一条；迁移后 outbox 状态符合预期；事务回滚不留半成品。

## 3. 同步：scope_exit 事件

- [ ] 3.1 `src/sync/events.ts` 的 `SyncEventType` 增加 `'scope_exit'`，payload 含 `lastContentHash`。
- [ ] 3.2 `push.ts`：迁移出同步边界时生成该事件。
- [ ] 3.3 `apply.ts`：收到 `scope_exit` → 把本地该记忆标为「不再持有」（需要一个状态或标记位；**优先复用现有字段，不要为它加表列**——若无合适字段则用 tombstone 表的独立 kind 或 meta 标记，实现时二选一并说明）。
- [ ] 3.4 收到未知事件类型：跳过 + 审计，**不中断整链**（对齐既有 `undecryptable_chunk` 行为）。
- [ ] 3.5 测试：迁出事件跨设备生效；迁出≠遗忘（无墓碑）；迁回后重新同步；未知事件不阻断；重复推送幂等。

## 4. CLI

- [ ] 4.1 `cairn rescope <id> --scope-preset <p> [--project-id] [--force]`。
- [ ] 4.2 `cairn rescope --pending [--dry-run]`：处理批注中 `needs_rescope` 的条目，先打印清单再执行。
- [ ] 4.3 `--ids-file` 批量，逐条报告成功/失败/跳过。
- [ ] 4.4 执行前打印汇总：将迁移 N 条，其中 M 条将失去同步。
- [ ] 4.5 帮助文本。
- [ ] 4.6 测试：dry-run 零写入；批量部分失败如实计数；缺 projectId 退 2；冲突退 4。

## 5. 批注联动

- [ ] 5.1 `DISPOSITIONS` 增加 `needs_rescope`。
- [ ] 5.2 控制台 UI 增加该类别；`pending_forget` 的提示样式复用。
- [ ] 5.3 测试：批注本身不改记忆（回归既有断言）。

## 6. 全量验收

- [ ] 6.1 `npm run typecheck` 0 错误。
- [ ] 6.2 `npm test` 全量通过，报告四个数字并与基线（759/758/0/1）对比。
- [ ] 6.3 `openspec validate add-scope-migration --strict` 通过。
- [ ] 6.4 变异对照：去掉 outbox 重建里的「作废旧任务」→ 确认对应用例变红且只有它红。
- [ ] 6.5 负对照：改无关常量 → 零红。

## 7. 文档

- [ ] 7.1 `docs/cairn-usage.md` 补「作用域迁移」小节，**必须写清**：迁到设备类作用域会失去同步、云端旧密文不会自动删除。
- [ ] 7.2 `docs/cairn-sync.md` 补 `scope_exit` 事件语义。
- [ ] 7.3 `CHANGELOG.md` Unreleased。
