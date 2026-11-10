## ADDED Requirements

### Requirement: 上行入队完备性

对任何一条作用域允许上行（`syncPolicy = encrypted` 且未绑定具体设备）的记忆，系统 SHALL 在其**被创建、正文被修改、或被遗忘**时产生一条 `sync_upstream` 待办任务；该要求 SHALL 对**所有**写入入口一致成立，包括 CLI / MCP / 本地控制台 / 治理计划应用（`applyPlan`）与自动整理。

系统 MUST NOT 因写入入口不同而产生上行覆盖差异；系统 MUST NOT 在拉取路径（`sync pull` 应用远端事件）上产生上行任务。

作用域不允许上行的内容 MUST 在入队前被物理排除，且 MUST NOT 因本次变更产生任何 `outbox_job` 行。

#### Scenario: 治理计划应用后记忆进入上行队列

- **GIVEN** 一条作用域为 `personal-global` 的待应用计划，其操作包含新增记忆
- **WHEN** 用户消费审批并应用该计划
- **THEN** 该新增记忆存在一条 `sync_upstream` 待办任务，且任务的实体标识等于该记忆标识

#### Scenario: 自动整理产出的记忆与手工写入等价

- **GIVEN** 自动整理（策略预授权）被触发
- **WHEN** 该轮整理新增记忆若干条
- **THEN** 每条作用域允许上行的新增记忆都各自存在一条 `sync_upstream` 待办任务，其数量与新增记忆数量相等

#### Scenario: 拒绝候选与遗忘产生同形上行

- **GIVEN** 一条作用域允许上行的候选记忆与一条同作用域的活动记忆
- **WHEN** 用户拒绝该候选，并另行遗忘那条活动记忆
- **THEN** 两条记忆各自存在一条墓碑语义的 `sync_upstream` 待办任务，任务语义与既有遗忘路径一致

#### Scenario: 拉取不产生上行

- **GIVEN** 本地库为一个可读写的权威副本
- **WHEN** 执行 `cairn sync pull` 并应用了远端设备的事件（含新增与修订）
- **THEN** 本次拉取前后 `outbox_job` 中 `sync_upstream` 的待办数量不变，系统不产生任何新的上行任务

#### Scenario: 设备限定内容不产生上行任务

- **GIVEN** 一条作用域为 `device-local` 或 `sensitive` 的内容经由治理计划写入
- **WHEN** 计划应用完成
- **THEN** 该记忆存在且写入成功，但 `outbox_job` 中不存在以该记忆为实体的任何行

### Requirement: 冷启动对账

系统 SHALL 提供本地对账入口 `cairn sync backfill`，用于发现并补齐「作用域允许上行、但当前不存在 `sync_upstream` 待办任务」的活动记忆。

该命令 MUST 默认只读（dry-run），仅在显式指定应用参数时才写入；MUST 幂等（重复执行不产生重复任务）；MUST 只写本地待办队列，MUST NOT 与云端发生任何网络交互；MUST 以机器可读形式报告候选数、新增数、已存在数与被排除数，并以稳定退出码区分成功、用法错误与故障。

#### Scenario: 只读预演不改变库

- **GIVEN** 库中存在若干应上行但未入队的记忆
- **WHEN** 执行 `cairn sync backfill` 且未指定应用参数
- **THEN** 先后的 `outbox_job` 行数与内容完全相同，输出报告候选条数，并以成功退出码结束

#### Scenario: 应用后缺口归零

- **GIVEN** 库中存在 N 条应上行但未入队的记忆
- **WHEN** 执行 `cairn sync backfill --apply`
- **THEN** 输出报告新增 N 条，且再次执行 dry-run 时候选数为 0

#### Scenario: 重复应用幂等

- **WHEN** 连续两次执行 `cairn sync backfill --apply`
- **THEN** 第二次的新增数为 0，`outbox_job` 中不存在重复的待办任务

#### Scenario: 对账不触碰云端

- **GIVEN** 本地已配置远端但网络不可达
- **WHEN** 执行 `cairn sync backfill --apply`
- **THEN** 命令仍以成功退出码结束，且不产生任何网络请求

#### Scenario: 被排除内容不计入缺口

- **GIVEN** 库中存在作用域为 `device-local` 的活动记忆
- **WHEN** 执行 `cairn sync backfill` 
- **THEN** 该记忆不出现在候选列表中，也不产生任何 `outbox_job` 行

### Requirement: 上行缺口可观测

健康检查 SHALL 报告「作用域允许上行但未入队」的活动记忆条数；库处于健康状态时该计数 MUST 为 0。当该计数大于 0 时，健康检查 MUST 给出明确的、可执行的处置提示。

#### Scenario: 健康库的计数为零

- **GIVEN** 所有应上行的记忆都已有对应的待办任务
- **WHEN** 执行健康检查
- **THEN** 上行缺口计数为 0，且不因此产生任何告警条目

#### Scenario: 存在缺口时如实报告

- **GIVEN** 库中存在应上行但未入队的记忆
- **WHEN** 执行健康检查
- **THEN** 输出中该计数等于实际缺口条数，并给出指向对账命令的处置提示
