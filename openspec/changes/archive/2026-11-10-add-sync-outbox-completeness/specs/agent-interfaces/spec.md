## ADDED Requirements

### Requirement: 同步对账命令入口

系统 SHALL 提供本地命令 `cairn sync backfill`，与该域既有命令 `sync push` / `sync pull` 处于同一命令族；命令 SHALL 支持机器可读输出与稳定退出码，并在未指定应用参数时保持只读。

#### Scenario: 命令出现在帮助与同族命令中

- **WHEN** 用户查看命令行帮助
- **THEN** `sync` 命令族下同时列出 `push`、`pull` 与 `backfill`，且 `backfill` 标注默认只读

#### Scenario: 只读与应用的退出码一致

- **WHEN** 用户分别以只读与应用参数执行对账
- **THEN** 两次都以成功退出码结束，差异只体现在输出报告的写入计数上

#### Scenario: 应用参数错误时拒绝执行

- **WHEN** 用户给出不被支持的对账参数
- **THEN** 系统以用法类稳定退出码结束，且不写入任何待办任务
