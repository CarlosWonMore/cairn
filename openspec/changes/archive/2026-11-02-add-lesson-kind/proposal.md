# Proposal: 新增 lesson 记忆类型

## Why

现有 `MEMORY_KINDS` 有 7 种（instruction / preference / fact / decision / episode / procedure / environment），但没有一种能准确表达「**过去做错了什么、以及为什么错**」。

这不是分类洁癖。2026-11-01 首次全量整理 488 条导入条目时，最有长期价值的一批正是用户对我工作方式的纠正——「交付物给文件夹不要压缩包，因为 zip 名含中文打不开」「编译验证禁用 `/t:Rebuild`，因为 lib 下产物未纳管、Clean 会不可逆删除」「技能修改必须先经用户确认」。这些被强行塞进 `procedure`（该怎么做）或 `fact`（是什么），但它们的语义是「**曾经这样做，错了，别再犯**」。

分类退化的代价是检索与投影时无法把它们单独拎出来。而这类经验恰恰是最该在会话开始时提醒模型的。

外部佐证：`dsh-meow-memory` 的七层记忆里专门有 `lesson`（教训与纠正）一层，与 `fact` / `topic` 并列。

## What Changes

- `MEMORY_KINDS` 增加 `'lesson'`，同步 `MemoryKind` 类型、MCP 工具 schema 枚举、写入校验。
- 数据库层面：`memory.kind` 是**硬编码 CHECK 约束**，加值必须重建表。新增迁移 `004_memory_kind_lesson`。
- 明确判据边界（写进 spec，否则分类必然退化）：`procedure` = 该怎么做；`fact` = 是什么；`lesson` = **曾经这样做是错的，原因是 X，别再犯**。
- 投影简报中 `lesson` 优先占用预算（最该在会话开场被看到）。

### 迁移的技术难点（已实测）

`memory` 表被 **8 个表**通过外键引用，且有 FTS 触发器与 6 个索引。SQLite 官方重建流程在这里有两个坑：

1. **事务内 `PRAGMA foreign_keys=OFF` 无效**——SQLite 明确该 pragma 在事务内是 no-op，而现有 `runMigrations` 在事务内执行 SQL。
2. **`DROP TABLE m_old` 会级联删光子表数据**。实测：子表 1 行变 0 行，而 `PRAGMA foreign_key_check` 仍报干净——**静默丢数据**，最危险的一类失败。

**可用方案（已实测通过）**：`BEGIN` 之前关外键 → 事务内加 `PRAGMA legacy_alter_table=ON`（防 RENAME 把子表 FK 改写成 `m_old`）→ 重建 → `DROP` → 提交后开回外键。实测子表保持 1 行、`foreign_key_check` 为空、新 kind 可插入。

因此迁移框架需要支持「在事务外准备/收尾」的迁移类型。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `memory-store`：记忆类型集合新增 lesson，并给出与 procedure/fact 的判据边界。
- `memory-governance`：判断与晋升需识别 lesson，投影优先级不同。

## Impact

- 修改：`src/core/types.ts`、`src/store/schema.ts`（迁移 004）、`src/store/migrate.ts`（事务外 pragma）、`src/interfaces/mcp/server.ts`（工具枚举）、`src/projection/brief.ts`（lesson 优先）。
- 测试：`tests/store/migrate-lesson.test.ts`（迁移正确性、子表不丢、FK 干净、幂等）、扩展 `tests/projection/brief.test.ts`。
- **风险：迁移可能丢数据。** 已实测两种失败模式，方案必须通过「迁移前后行数比对 + foreign_key_check」双重断言。
- 回滚：迁移单向；回滚需从备份恢复（`cairn backup` 已存在）。
