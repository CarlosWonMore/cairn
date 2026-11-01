## ADDED Requirements

### Requirement: lesson 类型表达「曾经错了」

系统 SHALL 支持 `lesson` 记忆类型，用于记录被纠正过的认知；`lesson` MUST 与 `procedure`（该怎么做）、`fact`（是什么）区分，不得把一般性做法误标为 lesson。

#### Scenario: 记录一次纠正
- **WHEN** 用户纠正了某种做法并说明原因
- **THEN** 系统以 `lesson` 类型保存「曾经这样做 / 为什么错 / 今后怎么做」，而不是塞进 procedure 或 fact

#### Scenario: 一般做法不标 lesson
- **WHEN** 内容只是常规操作步骤且没有被纠正的背景
- **THEN** 系统使用 `procedure`，不滥用 `lesson`

### Requirement: 类型扩展不破坏既有数据

系统 SHALL 在扩展记忆种类时保证既有记忆、修订、证据、关系与冲突记录完整保留；迁移 MUST 通过行数比对与外键检查验证，MUST NOT 静默丢数据。

#### Scenario: 迁移后数据完整
- **WHEN** 库中存在引用 memory 表的子表数据时执行类型扩展迁移
- **THEN** 迁移完成后子表行数不变、外键检查为空、既有记忆种类取值仍合法

#### Scenario: 迁移幂等
- **WHEN** 同一迁移被重复执行
- **THEN** 不重复改动结构，不产生数据变化
