# agent-interfaces Specification

## Purpose
为不同能力等级的 Agent 提供统一、可诊断、可卸载的 CLI 与 MCP 接入，并保证任何后台故障都不会破坏当前会话。

## Requirements

### Requirement: MCP stdio 协议纯净
系统 SHALL 通过标准 MCP 提供记忆与治理工具，stdio 的 stdout MUST 只包含协议消息，日志 MUST 仅写入 stderr 或文件。

#### Scenario: 初始化并调用工具
- **WHEN** 客户端执行 initialize、tools/list 和 tools/call
- **THEN** 系统返回合法协议响应，stdout 中没有日志、警告文本或非协议输出

#### Scenario: 请求超时或断开
- **WHEN** 客户端取消请求、超时或断开连接
- **THEN** 系统终止对应短操作或保留可恢复任务，不向 stdout 写入异常文本，也不影响后续本地使用

### Requirement: CLI 离线管理与机器可读结果
系统 SHALL 提供本地初始化、显式记忆管理、检索、导出、配置计划、健康检查和卸载入口，并 SHALL 以稳定退出码及可选 JSON 输出区分成功、拒绝和故障。

#### Scenario: 无模型环境执行健康检查
- **WHEN** 用户在无模型、无云端环境执行 doctor
- **THEN** 系统检查本地库、协议和配置并报告真实状态，不将可选增强缺失判为核心不可用

### Requirement: 配置合并且不侵占宿主
系统 SHALL 让配置计划默认零写入，应用前备份并仅合并本产品条目； MUST 保留未知字段和其他服务器，同名外来条目 MUST 被视为冲突。

#### Scenario: 宿主已有其他 MCP 配置
- **WHEN** 用户批准添加本产品后执行卸载
- **THEN** 系统只移除本产品条目，其他服务器和未知字段保持不变

#### Scenario: 已存在同名外来条目
- **WHEN** 配置中存在并非由本产品管理的同名服务器
- **THEN** 系统停止应用并报告冲突，不覆盖原配置

### Requirement: 后台任务退出会话关键路径
系统 SHALL 将同步、抽取、嵌入和维护放入独立 worker、显式命令或系统计划任务；默认 MUST NOT 安装阻塞式同步 hook。

#### Scenario: 后台任务超时
- **WHEN** 网络、模型、维护或 worker 超时、崩溃或返回错误
- **THEN** 当前 Agent 会话继续可用，本地操作不被撤销，后台仅留下有界重试或待处理状态

#### Scenario: MCP 进程退出
- **WHEN** MCP stdio 进程随客户端会话结束而退出
- **THEN** 系统不要求该进程完成后台同步，未完成任务之后可由独立入口续跑

### Requirement: 受管投影与防回环
系统 SHALL 仅从经过作用域过滤的当前记忆生成受管文件投影，投影 MUST 幂等、可停用、可重建，且不得被默认反向导入形成回环。

#### Scenario: 重复生成与卸载投影
- **WHEN** 用户重复生成投影后卸载
- **THEN** 重复生成不产生重复区块，卸载只移除本产品受管内容，其他说明保持不变

### Requirement: 健康检查诚实反映能力边界
系统 SHALL 区分协议可用、fixture 验证、真实 CLI 验证和未公开接口，MUST NOT 将文档支持或模拟测试报告为真实宿主认证。

#### Scenario: 宿主仅有公开文件配置
- **WHEN** doctor 检查只有文件适配证据的宿主
- **THEN** 结果显示 fixture-only 或相应有限状态，不显示为全功能或真实原生记忆已接管
