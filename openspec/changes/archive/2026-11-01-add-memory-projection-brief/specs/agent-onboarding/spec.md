## MODIFIED Requirements

### Requirement: 原生记忆渐进接管

系统 SHALL 默认保留 Agent 原生记忆，提供 `observe`、`router` 和准备式 `mcp-primary` 模式；实际关闭原生能力 MUST 需要独立确认且只能使用公开支持的方式。

`router` 模式写入受管入口时，MUST 携带经作用域过滤的记忆摘要，而非固定文案；无正文落点的宿主 MUST 退化为只写路由说明。

#### Scenario: 默认路由模式
- **WHEN** 用户选择 `router`
- **THEN** 系统仅添加简短受管入口，将跨设备共享记忆指向本产品，同时保留 Agent 私有原生草稿，并按宿主能力附带记忆摘要

#### Scenario: 敏感记忆不得进入投影
- **WHEN** 库中存在 `local_only` 作用域、`sensitive` 敏感度或 `blocked` 状态的记忆
- **THEN** 这些记忆一律不出现在投影中，无论预算是否充足

#### Scenario: 原生能力无公开关闭接口
- **WHEN** 用户选择 `mcp-primary` 但宿主没有公开关闭方式
- **THEN** 系统只提供备份和手动步骤，不宣称已接管或关闭原生记忆
