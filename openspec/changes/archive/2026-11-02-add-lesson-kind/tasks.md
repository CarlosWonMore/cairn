# Tasks

## 1. 类型与校验

- [x] 1.1 `src/core/types.ts`：`MEMORY_KINDS` 增加 `'lesson'`；验证：`tests/core` 或既有类型测试断言 8 种 kind
- [x] 1.2 `src/interfaces/mcp/server.ts`：工具 schema 枚举自动跟随 `MEMORY_KINDS`（已用 spread，确认无需改）；验证：MCP 工具列表含 lesson
- [x] 1.3 `src/store/memories.ts` 与 `src/governance/propose.ts` 的校验复用 `MEMORY_KINDS`，确认自动生效；验证：写入 `kind='lesson'` 通过、非法 kind 仍被拒

## 2. 迁移框架扩展

- [x] 2.1 `src/store/migrate.ts`：`Migration` 增加可选 `preTransactionPragma` / `postTransactionPragma`，迁移器在 `BEGIN` 前与 `COMMIT` 后执行；验证：`tests/store/migrate.test.ts` 断言调用顺序（用临时 pragma 观测）
- [x] 2.2 保持既有迁移行为不变：无这两个字段的迁移完全照旧；验证：既有迁移测试全绿

## 3. 迁移 004

- [x] 3.1 `src/store/schema.ts` 增加 `MIGRATION_004_KIND_LESSON`：`preTransactionPragma: foreign_keys=OFF`、事务内 `legacy_alter_table=ON`、RENAME → 建新表（CHECK 含 lesson）→ 复制数据 → DROP 旧表、`postTransactionPragma: foreign_keys=ON`；验证：迁移在新库上成功且 `INSERT kind='lesson'` 可执行
- [x] 3.2 必须按原 DDL 逐字重建：全部列、CHECK、DEFERRABLE 外键、6 个索引、3 个 FTS 触发器；验证：`sqlite_master` 中新表的索引与触发器数量与迁移前一致
- [x] 3.3 迁移必须重建 FTS 内容（`INSERT INTO memory_fts(memory_fts) VALUES('rebuild')`）；验证：迁移后旧内容仍可被全文检索到

## 4. 数据完整性验证

- [x] 4.1 `tests/store/migrate-lesson.test.ts`：造一个含 memory + memory_revision + evidence + relation + conflict 各若干行的库，跑迁移；验证：逐表行数前后一致、`foreign_key_check` 为空、`integrity_check` ok
- [x] 4.2 幂等：重复跑迁移不改变数据；验证：第二次 `runMigrations` 的 `applied` 为空
- [x] 4.3 负向：迁移失败时事务回滚，库仍为旧 schema；验证：注入一条会失败的 SQL 后断言版本号未变

## 5. 投影优先

- [x] 5.1 `src/projection/brief.ts`：`selectProjectionCandidates` 排序前置 lesson；验证：`tests/projection/brief.test.ts` 断言预算紧张时 lesson 被保留
- [x] 5.2 字节可复现不受影响：验证：同一集合两次渲染字节相同

## 6. 文档与验收

- [x] 6.1 `docs/cairn-usage.md` 写明 lesson 的含义与判据边界（procedure / fact / lesson 三分）
- [x] 6.2 真实库只读核对：迁移在**库副本**上跑一次，比对行数与 FK 检查；**绝不直接迁移真实库**
- [x] 6.3 `npm test` 全绿，计数较基线（660）净增，0 失败

## Workflow follow-up

- 归档前需用户审阅四个制品。
- 归档时把 delta 合并进 `memory-store` 与 `agent-interfaces` 主规格。
- 真实库迁移需用户明确指令后再执行。
