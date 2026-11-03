# operation-audit Specification

## Purpose
TBD - created by archiving change add-operation-audit. Update Purpose after archive.

## Requirements

### Requirement: 操作留痕
系统 SHALL 在每次**读取类**记忆操作完成时记录一条类目为 `operation` 的本地审计事件（检索 `memory_search`、单条读取 `memory_get`）。事件 SHALL 包含：发生时间、动作名、受影响对象标识（如适用）、以及摘要计数（候选数、命中通道、耗时）。**写入与维护操作**（`memory_add`/`memory_update`/`memory_forget` 等）SHALL 沿用既有 `memory` 类目审计，MUST NOT 在 `operation` 类目重复记录——`memory_audit` 查询入口 SHALL 能跨类目读到两者，任何操作皆可追溯。

#### Scenario: 检索操作留痕
- GIVEN 一个含至少一条 active 记忆的本地库
- WHEN 调用方执行一次 `memory_search`
- THEN 产生一条 `operation` 类事件，action 标明 `memory_search`，detail 含调用次数内的候选数与命中通道

#### Scenario: 写操作留痕沿用既有类目
- WHEN 调用方执行一次 `memory_add` 成功
- THEN 产生一条既有 `memory` 类目事件，detail 含新记忆的 id、不含记忆正文；且不产生重复的 `operation` 行

#### Scenario: 治理类目维持既有语义
- WHEN 一次计划审批完成
- THEN 治理审计事件按既有要求记录，且不受本能力新增开关的影响

### Requirement: 摘要纪律
操作审计事件 MUST NOT 包含：查询文本、调用参数、返回内容、记忆正文或任何敏感明文。审计事件 MUST 仅承载摘要计数与标识符。

#### Scenario: 敏感记忆被检索不泄露
- GIVEN 库中存在一条 sensitive 记忆
- WHEN 调用方检索并命中该记忆
- THEN 审计事件只含 id 与计数，事件中不存在该记忆正文的任何片段

#### Scenario: 查询原文不入库
- WHEN 调用方以任意文本执行 `memory_search`
- THEN 审计事件中不存在该查询文本或其片段

### Requirement: 失败不阻断
审计写入失败 MUST NOT 中断或改变记忆操作的结果。审计写入异常 SHALL 仅记录到 stderr 或日志文件，不得进入 stdio stdout。

#### Scenario: 审计表不可写时检索照常
- GIVEN 审计表被以只读方式锁定（模拟损坏）
- WHEN 调用方执行 `memory_search`
- THEN 检索正常返回结果，stderr 出现审计失败记录，stdout JSON-RPC 不受污染

### Requirement: 保留期治理
系统 SHALL 支持按天数配置 `operation` 类目事件的保留期（配置键 `audit.retentionDays`，默认 30），并在启动与定期维护时清理过期事件。清理 MUST 显式排除治理类目事件；治理类目 MUST NOT 因保留期被自动删除。

#### Scenario: 过期操作事件被清理
- GIVEN 一条 31 天前的 `operation` 事件，保留期为 30 天
- WHEN 保留期清理执行
- THEN 该事件被删除，且清理结果计入维护日志

#### Scenario: 治理事件豁免清理
- GIVEN 一条 365 天前的计划审批事件，保留期为 30 天
- WHEN 保留期清理执行
- THEN 该治理事件仍然存在

### Requirement: 操作审计总开关
系统 SHALL 支持 `audit.operations=false` 停写 `operation` 类目事件；该开关 MUST NOT 影响治理类目审计的写入。

#### Scenario: 关闭后停写
- GIVEN `audit.operations=false`
- WHEN 调用方执行任意记忆操作
- THEN 不产生新的 `operation` 事件，治理审计照常写入

### Requirement: 只读查询入口
系统 SHALL 提供只读查询入口访问审计事件：MCP 工具 `memory_audit` 与 CLI 子命令 `cairn audit list`。两者 SHALL 支持 category、action、起始时间与条数过滤（limit 默认 50、上限 200），返回摘要字段。查询入口 MUST NOT 提供修改或删除审计事件的能力。

#### Scenario: 按类目过滤
- GIVEN 库中同时存在治理与 `operation` 事件
- WHEN 以 `category=operation` 调用 `memory_audit`
- THEN 仅返回 `operation` 类事件的摘要列表

#### Scenario: 无写入口
- WHEN 审计任何入口尝试提交删除或修改审计事件的请求
- THEN 不存在这样的入口（工具面与 CLI 均无对应命令）
