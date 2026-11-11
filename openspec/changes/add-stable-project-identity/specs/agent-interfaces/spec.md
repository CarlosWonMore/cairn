## ADDED Requirements

### Requirement: 项目解析的命令与工具入口

系统 SHALL 提供本地命令 `cairn project resolve <path-or-url>` 与 MCP 工具用于解析项目身份。

两者 SHALL 使用同一套解析与归一化实现，MUST NOT 各自独立实现（避免同一路径在 CLI 与 Agent 侧得到不同结果）。

输出 SHALL 区分「命中已有项目」与「新建项目」，并在机器可读模式下给出稳定的对象结构。

#### Scenario: CLI 与 MCP 结果一致
- **WHEN** 用同一路径分别通过 CLI 与 MCP 解析
- **THEN** 两次返回的项目标识与命中状态完全相同

#### Scenario: 新建项目时如实标注
- **WHEN** 用一个未登记过的路径解析
- **THEN** 返回结果中明确标注为新建，并给出新分配的项目标识

#### Scenario: 提供项目名
- **WHEN** 解析时一并给出项目显示名
- **THEN** 新建时使用该名；命中已有项目时不覆盖原显示名

### Requirement: 项目清单可读

系统 SHALL 提供列出已登记项目的能力，返回项目标识、显示名与别名列表。

列出 MUST NOT 触发新建；MUST 只读。

#### Scenario: 列出项目
- **WHEN** 执行项目清单命令
- **THEN** 返回全部已登记项目及其别名，且不新增任何项目行
