## ADDED Requirements

### Requirement: 项目链与项目内容的跨设备同步

系统 SHALL 为每个已登记项目提供一条独立的同步链空间 `project/<projectId>`（`projectId` 是跨设备稳定 UUID，路径/别名只作别名）。作用域规则 MUST 为：

- `project-global` 内容 → 上行到本项目链；**所有设备** SHALL 列举并拉取项目链；
- `project-device` 内容 → 上行到本设备保管链（该作用域本就绑定设备），其他设备 MUST NOT 拉取；
- `device-local` 内容 → 保持既有语义，MUST NOT 复制到其他设备。

项目链 SHALL 复用既有 chunk/manifest 协议、内容寻址、代次 CAS 与端到端加密；空间密钥 SHALL 由 `deriveSpaceKey(vaultKey, spaceKey)` 派生，MUST NOT 引入新的密钥材料或恢复材料。

#### Scenario: 项目内容推送到项目链且他机可拉取

- **GIVEN** 设备 A、B 属于同一 vault，A 有一条 `project-global` 活动记忆
- **WHEN** A 执行 `cairn sync push`
- **THEN** 该记忆以 `memory_upsert` 事件发布在 `project/<projectId>` 链上，事件携带作用域描述符（preset=`project-global`、projectId、spaceName）
- **AND** B 执行 `cairn sync pull` 后在本地以同名项目作用域持有该记忆（active），而非 `personal-global`

#### Scenario: 项目限定内容不跨设备

- **GIVEN** 设备 A 有一条 `project-device` 活动记忆
- **WHEN** A 执行 `cairn sync push`，随后 B 执行 `cairn sync pull`
- **THEN** 该内容只出现在 A 的本设备保管链，B 的拉取范围不含该链，B 本地不出现该记忆

#### Scenario: 设备限定内容不跨设备复制

- **GIVEN** 设备 A 有一条 `device-local` 活动记忆
- **WHEN** A 与 B 各自执行同步
- **THEN** B 不因同步新增该记忆的任何副本（不复制、不改写 A 的副本）

#### Scenario: 空项目与新设备发现

- **GIVEN** vault 中存在若干项目链，且一台从未同步过的新设备加入
- **WHEN** 该设备执行 `cairn sync pull`
- **THEN** 系统通过列举 `project/` 前缀发现这些链并拉取其内容，无需事先在本地登记项目

### Requirement: 项目链事件解除「不再持有」标记

当接收端对某条记忆存在"不再持有"标记（此前收到过该记忆的迁出通知），且随后在项目链上收到同一记忆的 upsert 时，系统 SHALL 把该记忆恢复为活动内容：清除标记、把归档状态恢复为活动、并按事件的作用域描述符把记忆迁移到对应项目作用域。MUST NOT 把它当作"迁出后的迟到修订"跳过。

拉取结果 SHALL 以**追加**计数报告本次解除该标记的条数（`revived`）——这是接收端最重要的写入效果，不得只体现为净新增数。该计数 MUST NOT 改变既有事件计数语义：同一次事件仍按其合并结果计入 `applied` / `skipped`。

#### Scenario: 项目链 upsert 解除迁出标记

- **GIVEN** 设备 B 收到过 A 发出的某记忆迁出通知，本地该记忆被标记为不再持有并归档
- **WHEN** B 从项目链收到该记忆的 upsert 事件
- **THEN** B 清除该标记、把记忆恢复为活动，并把它落在对应项目作用域
- **AND** 该次恢复被写入审计（可区分于普通快进合并）

#### Scenario: 解除标记的条数在拉取结果中可见

- **GIVEN** 设备 B 对若干条记忆存在"不再持有"标记
- **WHEN** B 从项目链收到这些记忆的 upsert，且内容未变
- **THEN** 拉取结果的 `revived` 等于本次解除标记的条数，且这些事件同时计入 `skipped`
- **AND** 报告中的 `applied` / `skipped` 语义与既有行为一致

#### Scenario: 个人链的迟到修订仍被挡住

- **GIVEN** 设备 B 对某记忆存在"不再持有"标记
- **WHEN** B 从个人链收到该记忆的 upsert，且事件不带迁回重推标记
- **THEN** 该修订仍按既有语义被跳过并审计，不把记忆恢复为活动

### Requirement: 迁出通知携带终态作用域

迁出事件 SHALL 携带发出端的**终态作用域描述符**（preset、projectId、deviceId、spaceName 中适用的字段）。接收端 MUST 据此把本地留存副本的展示作用域与标签更新为终态，MUST NOT 复制内容、MUST NOT 产生墓碑。

#### Scenario: 迁往项目作用域的终态可展示

- **GIVEN** 设备 A 把一条记忆迁入 `project-global`（项目 P）并推送迁出通知
- **WHEN** 设备 B 收到该通知
- **THEN** B 本地留存副本被标记为不再持有，且其展示作用域为项目 P（而非个人全局）

#### Scenario: 迁往设备限定的终态可展示

- **GIVEN** 设备 A 把一条记忆迁入 `device-local` 并推送迁出通知
- **WHEN** 设备 B 收到该通知
- **THEN** B 本地留存副本被标记为不再持有，且其展示作用域为「设备限定」并携带归属设备为 A
- **AND** B MUST NOT 因此新增该记忆内容的任何副本

#### Scenario: 旧版本忽略未知字段

- **GIVEN** 一台不支持终态描述符的旧版本设备
- **WHEN** 它收到携带该字段的迁出事件
- **THEN** 它按既有语义处理（标记不再持有、不删数据），不因未知字段中断整条链

### Requirement: 项目链的对账与可观测

`cairn sync backfill` SHALL 把项目链纳入对账：发现「作用域为 `project-global`、状态为活动、归属设备为本机或未知（`memory.origin_device_id` 为空或等于本机设备标识）、且不存在本链推送证据（`sync_pushed:project/<projectId>:<memoryId>` 元数据）且不存在在途上行任务」的记忆并补齐，报告 MUST 按链分列（个人链 / 项目链 / 保管链）。该命令 MUST 保持默认只读、MUST 幂等、MUST NOT 与云端交互。

`doctor` 与 `status` SHALL 报告每条项目链的本地序号、拉取游标、待办任务数与缺口；健康时缺口 MUST 为 0。

#### Scenario: 存量项目内容首次入链

- **GIVEN** 库中存在从未进入项目链的 `project-global` 活动记忆，项目链尚不存在
- **WHEN** 执行 `cairn sync backfill --apply` 并 push
- **THEN** 这些记忆各产生一条路由到本项目链的上行任务，推送后项目链存在对应事件
- **AND** 再次执行 dry-run 时项目链候选数为 0

#### Scenario: 从个人链迁入项目、旧上行任务已完成但从未发布到项目链

- **GIVEN** 一条记忆曾在 `personal-global` 推送成功（存在完成状态的上行任务与个人链推送元数据），随后迁入项目 P；迁移时项目链尚不存在，因此那次上行任务以不可路由方式完成，记忆从未发布到 `project/<P>`
- **WHEN** 执行 `cairn sync backfill`
- **THEN** 该记忆出现在项目链候选中，并产生一条路由到 `project/<P>` 的上行任务
- **AND** 再次执行 dry-run 时候选数为 0

#### Scenario: 接收方副本不算缺口

- **GIVEN** 设备 A 把一条 `project-global` 记忆发布到 `project/<P>`，设备 B 拉取落地并记为归属设备 A
- **WHEN** 在 B 上执行健康检查或 `cairn sync backfill`
- **THEN** 项目链缺口为 0，且不因此产生任何上行任务
- **AND** B 自己创建的项目记忆仍如实计入缺口；归属设备未知（为空）的历史记忆同样仍计入缺口

#### Scenario: 项目链缺口被如实报告

- **GIVEN** 库中存在一条 `project-global` 活动记忆且无任何上行任务
- **WHEN** 执行健康检查
- **THEN** 输出包含项目链缺口计数 ≥ 1，并给出指向对账命令的处置提示

#### Scenario: 对账不触网

- **GIVEN** 已配置远端但网络不可达
- **WHEN** 执行 `cairn sync backfill --apply`
- **THEN** 命令以成功退出码结束，且不产生任何网络请求

## MODIFIED Requirements

### Requirement: 上行入队完备性

对任何一条记忆，系统 SHALL 在其**被创建、正文被修改、被遗忘、或作用域迁移**时产生上行待办任务，路由规则如下：个人全局内容 → 个人链；`project-global` 内容 → 本项目链（`project/<projectId>`）；保管模式开启时，设备限定与 `project-device` 内容 → 本设备保管链；保管模式关闭时，非个人全局且非项目全局内容 MUST 在入队前被物理排除。作用域迁移涉及个人链时，MUST 同时产生个人链的迁出任务与新空间可发布时的上行任务。

该要求 SHALL 对**所有**写入入口一致成立，包括 CLI / MCP / 本地控制台 / 治理计划应用（`applyPlan`）与自动整理。系统 MUST NOT 在拉取路径上产生上行任务。

#### Scenario: 治理计划应用后记忆进入上行队列

- **GIVEN** 一条作用域为 `personal-global` 的待应用计划，其操作包含新增记忆
- **WHEN** 用户消费审批并应用该计划
- **THEN** 该新增记忆存在一条上行待办任务，且任务的实体标识等于该记忆标识

#### Scenario: 项目内容进入项目链队列

- **GIVEN** 一条作用域为 `project-global` 的记忆被创建或更正
- **WHEN** 写入完成
- **THEN** 它存在一条路由到本项目链的上行待办任务

#### Scenario: 保管模式下设备限定写入入队

- **GIVEN** 保管模式开启
- **WHEN** 一条 device-local 记忆被创建
- **THEN** 它存在一条路由到本设备保管链的上行待办任务

#### Scenario: 关闭模式下设备限定写入不入队

- **GIVEN** 保管模式关闭
- **WHEN** 一条 device-local 记忆被创建
- **THEN** `outbox_job` 中不存在以该记忆为实体的任何行

#### Scenario: 设备限定内容不产生上行任务

- **GIVEN** 保管模式关闭，一条作用域为 `device-local` 或 `sensitive` 的内容经由治理计划写入
- **WHEN** 计划应用完成
- **THEN** 该记忆存在且写入成功，但 `outbox_job` 中不存在以该记忆为实体的任何行

#### Scenario: 自动整理产出的记忆与手工写入等价

- **GIVEN** 自动整理（策略预授权）被触发
- **WHEN** 该轮整理新增记忆若干条
- **THEN** 每条按路由规则应上行的记忆都各自存在一条上行待办任务，数量与写入入口无关

#### Scenario: 拒绝候选与遗忘产生同形上行

- **GIVEN** 一条作用域允许上行的候选记忆与一条同作用域的活动记忆
- **WHEN** 用户拒绝该候选，并另行遗忘那条活动记忆
- **THEN** 两条记忆各自存在一条墓碑语义的上行待办任务，语义与既有遗忘路径一致

#### Scenario: 迁出个人链产生迁出任务

- **GIVEN** 一条已同步的 `personal-global` 活动记忆
- **WHEN** 它被迁移到项目作用域
- **THEN** 产生一条固化来源为个人链的迁出任务，不因目的地可同步而缺失

#### Scenario: 拉取不产生上行

- **GIVEN** 本地库为一个可读写的权威副本
- **WHEN** 执行 `cairn sync pull` 并应用了远端事件
- **THEN** 本次拉取前后上行待办数量不变

### Requirement: 冷启动对账

系统 SHALL 提供本地对账入口 `cairn sync backfill`，发现并补齐「允许上行、但缺少本链推送证据且不存在在途上行任务」的活动记忆：个人全局内容 → 个人链（以个人链上行任务本身为证据）；`project-global` 内容 → 本项目链（以本链推送元数据 `sync_pushed:project/<projectId>:<memoryId>` 为证据，MUST NOT 以「不存在任何上行任务」为判据——从个人链迁入的记忆往往留着已完成但从未发布到项目链的上行任务）；保管模式开启时，设备限定与 `project-device` 内容 → 本设备保管链。保管模式关闭时，非个人全局且非项目全局内容 MUST NOT 出现在候选列表中。

三条链的缺口判据 MUST 排除本机不是发布者的副本：`sync_pushed` 元数据只由发布端写入，接收方永远没有它，若不排除则每台接收设备的每条外来记忆都恒被判为缺口。判据 SHALL 以归属设备（`memory.origin_device_id`）为依据——仅当归属设备为本机或未知（为空）时才算缺口；为空的记忆 MUST NOT 被判据一刀切排除。

系统 SHALL 同时发现并补齐**存量迁出通知缺口**：曾推送到个人全局链（同步元数据存在）、现已不在个人全局作用域、但从未产生过任何迁出任务的活动记忆。已有过迁出任务（不论状态）的记忆 MUST NOT 重复补发。

该命令 MUST 默认只读（dry-run），仅在显式指定应用参数时才写入；MUST 幂等；MUST 只写本地待办队列，MUST NOT 与云端发生任何网络交互；MUST 以机器可读形式报告候选数、新增数、已存在数与被排除数（按链分列），以及迁出通知补发数。

#### Scenario: 只读预演不改变库

- **GIVEN** 库中存在若干应上行但未入队的记忆
- **WHEN** 执行 `cairn sync backfill` 且未指定应用参数
- **THEN** 先后的 `outbox_job` 行数与内容完全相同，输出报告候选条数，并以成功退出码结束

#### Scenario: 应用后缺口归零

- **GIVEN** 库中存在 N 条应上行但未入队的记忆
- **WHEN** 执行 `cairn sync backfill --apply`
- **THEN** 输出报告新增 N 条（按链分列），且再次执行 dry-run 时候选数为 0

#### Scenario: 保管模式开启后存量上链

- **GIVEN** 保管模式开启，库中存在从未上云的设备限定与项目限定内容
- **WHEN** 执行 `cairn sync backfill --apply`
- **THEN** 它们各自产生路由到本设备保管链的待办任务，再次 dry-run 时候选数为 0

#### Scenario: 被排除内容不计入缺口

- **GIVEN** 保管模式关闭，库中存在作用域为 `device-local` 的活动记忆
- **WHEN** 执行 `cairn sync backfill`
- **THEN** 该记忆不出现在候选列表中，也不产生任何 `outbox_job` 行

#### Scenario: 重复应用幂等

- **WHEN** 连续两次执行 `cairn sync backfill --apply`
- **THEN** 第二次的新增数为 0，`outbox_job` 中不存在重复的待办任务

#### Scenario: 对账不触碰云端

- **GIVEN** 本地已配置远端但网络不可达
- **WHEN** 执行 `cairn sync backfill --apply`
- **THEN** 命令仍以成功退出码结束，且不产生任何网络请求

#### Scenario: 存量迁出通知补发

- **GIVEN** 一条记忆曾推送到个人全局链（同步元数据存在），其后在本变更之前的版本中被迁移到非个人全局作用域
- **WHEN** 执行 `cairn sync backfill --apply` 并推送
- **THEN** 该记忆产生一条固化来源为个人链的迁出任务，推送后对端把该记忆标记为不再持有；重复对账不再补发

### Requirement: 上行缺口可观测

健康检查 SHALL 报告「作用域允许上行但未入队」的活动记忆条数（按链分列：个人链 / 项目链 / 保管链）；库处于健康状态时该计数 MUST 为 0。当该计数大于 0 时，健康检查 MUST 给出明确的、可执行的处置提示。

#### Scenario: 健康库的计数为零

- **GIVEN** 所有应上行的记忆都已有对应的待办任务
- **WHEN** 执行健康检查
- **THEN** 上行缺口计数为 0，且不因此产生任何告警条目

#### Scenario: 存在缺口时如实报告

- **GIVEN** 库中存在应上行但未入队的记忆
- **WHEN** 执行健康检查
- **THEN** 输出中该计数等于实际缺口条数，并给出指向对账命令的处置提示

### Requirement: 迁出事件的通知语义

当一条已同步到个人全局链的记忆迁出该链（迁往项目作用域、设备限定作用域，或其他任何去向）时，系统 SHALL 向个人链上行一条「迁出」事件；迁出事件的上行 MUST NOT 依赖目的地的可同步性。该事件 SHALL 携带终态作用域描述符。

其他设备收到该事件后 MUST 把对应记忆标记为「本设备不再持有」，MUST NOT 物理删除它，MUST NOT 继续把它的新修订当作活动内容呈现（项目链 upsert 依上条要求解除该状态）。该标记 MUST 可被审计；MUST 与「遗忘（tombstone）」区分。

#### Scenario: 另一台设备收到迁出事件

- **GIVEN** 设备 A、B 同步过同一记忆
- **WHEN** A 把该记忆迁出个人全局链并 push
- **THEN** B 收到迁出事件后把该记忆标为不再持有，不删除数据，检索不再返回它

#### Scenario: 迁入不可同步作用域同样通知

- **GIVEN** 设备 A、B 同步过同一记忆
- **WHEN** A 把该记忆迁入设备限定作用域并 push
- **THEN** B 收到迁出事件并把该记忆标为不再持有——通知不因目的地不可同步而缺失

#### Scenario: 迁出不等于遗忘

- **WHEN** 一台设备收到迁出事件
- **THEN** 该记忆不产生墓碑记录，遗忘时间线不被改动

#### Scenario: 迁出后重新迁回

- **GIVEN** 记忆已被迁出并通知过对端
- **WHEN** 在该设备上把记忆迁回个人全局链并 push
- **THEN** 对端重新视为持有者，内容按正常修订链同步
