## ADDED Requirements

### Requirement: MCP 工具面在进程生命周期内稳定

MCP server 的工具清单（工具集合、名称、描述与 schema）SHALL 在单个 server 进程的生命周期内保持稳定；受库状态影响的条件工具（如待整理条目驱动的 onboarding 工具）MUST 在进程启动时判定一次，进程运行期间 MUST NOT 随库状态增减。

判定 MUST NOT 影响常驻工具的可用性；判定失败时 MUST 以不暴露条件工具的方式降级（fail-closed）并留下可诊断日志，MUST NOT 让 server 拒绝启动。

条件工具集合的变化 SHALL 通过进程重启（对 stdio 形态即新会话）生效；系统 MUST NOT 引入运行中的动态工具通知机制作为替代。

#### Scenario: 启动时有待整理条目
- **GIVEN** server 进程启动时存在待整理导入条目
- **WHEN** 任意一次 ListTools 请求
- **THEN** 条件工具出现，且在该进程的整个生命周期内每次 ListTools 结果一致

#### Scenario: 运行中条目翻转不改变工具面
- **GIVEN** server 启动时无待整理条目（条件工具未暴露）
- **WHEN** 进程运行期间另一进程执行导入，使待整理条目数从 0 变为大于 0
- **THEN** 该进程的 ListTools 结果不变，条件工具仍不出现；重启后按新状态判定

#### Scenario: 判定失败时降级不拒启
- **WHEN** 进程启动时的状态判定本身失败（如健康检查抛错）
- **THEN** server 正常启动，常驻工具全部可用，条件工具不暴露，且留下可诊断日志

#### Scenario: 会话中途治理动作不改变工具面
- **WHEN** 会话内调用使待整理条目数清零（如 onboarding 应用完成）
- **THEN** 本会话的 ListTools 结果保持不变，已暴露的条件工具在下一次调用前不消失
