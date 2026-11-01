# Design

见 `proposal.md`。本文件记录怎么做，尤其是迁移那部分——它是本变更唯一的真实风险点。

## Context

- `memory.kind` 是硬编码 CHECK：`CHECK (kind IN ('instruction',...,'environment'))`。加值只能重建表。
- `memory` 被 8 个表外键引用：memory_revision、evidence、relation、conflict 等（`ON DELETE CASCADE` 居多）。
- `memory` 上有 3 个 FTS 触发器（ai / ad / au）与 6 个索引。
- `runMigrations` 在 `db.transaction()` 内执行 `m.sql`。

## Goals / Non-Goals

**Goals**：加 `lesson` 且**不丢任何数据**；迁移可验证、可幂等。

**Non-Goals**：不动其他 kind 的语义；不做 kind 的运行时可配置（那会让 CHECK 失去意义）。

## Decisions

### D1：迁移必须在事务外关闭外键

SQLite 的 `PRAGMA foreign_keys` 在事务内是 **no-op**（已实测：事务内设置后读回仍是 1）。而 `runMigrations` 在事务内跑。

因此引入 `Migration` 的可选字段：`preTransactionPragma` / `postTransactionPragma`。迁移器在 `BEGIN` 前执行前者，`COMMIT` 后执行后者。

**替代方案**：把这条迁移改成完全不用事务。放弃——那样中断会留下半迁移状态，比现状更糟。

### D2：必须同时开 `legacy_alter_table`

`ALTER TABLE memory RENAME TO memory_old` 在默认模式下会把**子表的外键定义改写成 `memory_old`**，之后即便重建表，子表仍指向旧名。

`PRAGMA legacy_alter_table=ON` 阻止这种重写。已在事务内实测有效（该 pragma 与 foreign_keys 不同，事务内可设）。

### D3：崩溃点是 `DROP TABLE memory_old`

实测：外键仍指向 `memory` 时，`DROP TABLE memory_old` 会**级联删光子表数据**，且 `PRAGMA foreign_key_check` 仍报干净——**静默丢数据**。

这是本变更最大的风险，也是 D1+D2 组合必须同时成立的原因：关掉外键 + 不重写子表引用，DROP 才不会级联。

### D4：验证用双重断言，不信任单一信号

因为 `foreign_key_check` 在丢数据时仍可能报干净，所以：
- 迁移前记录 `memory` 与全部子表的行数；
- 迁移后逐表比对；
- 再跑 `foreign_key_check`。

两者都过才算成功。测试要对一个**有真实子表数据**的库跑，而不是空库。

### D5：lesson 在投影中优先

`selectProjectionCandidates` 的排序键前置 `kind = 'lesson'` 标记：`lesson 优先 → confidence desc → updated_at desc → id asc`。

**为什么**：lesson 承载「曾经错了、别再犯」，是会话开场最有价值的信息。这不影响字节可复现性（kind 是记忆属性，不随时间变）。

## Risks / Trade-offs

- **迁移丢数据** → D4 双重断言 + 有数据 fixture + 迁移失败即回滚事务。
- **旧版本打开新库** → 既有 `schemaVersion > latest` 检查会拒绝，行为不变。
- **`lesson` 被滥用** → spec 已写判据边界；投影层不做额外判断（那需要语义理解）。

## Migration Plan

- 前进：`004_memory_kind_lesson`，一次性。
- 回滚：无自动回滚；需从 `cairn backup` 恢复。文档须写明。

## Open Questions

- 是否需要在 `cairn doctor` 里报告「库中含 lesson 条数」。可延后。