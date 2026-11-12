## MODIFIED Requirements

### Requirement: 检索结果来源可解释

系统 SHALL 为检索结果提供记忆标识、当前修订、来源摘要、权威级别、作用域和冲突状态，使用户能够追溯其形成依据。

面向 Agent 的检索列表结果（`memory_search` / `memory_context` 的条目）MUST 直接携带人读作用域名（scope preset）、记忆敏感度与作用域同步策略，MUST NOT 要求调用方另发一次详情调用才能得知这三项边界属性。人读作用域名 MUST 取自作用域表的实际记录，MUST NOT 以内部标识（UUID）替代。

#### Scenario: 查看命中记忆的依据
- **WHEN** 用户打开任一检索命中详情
- **THEN** 系统展示其来源、修订、权威级别和作用域，且未验证导入不得显示为用户确认事实

#### Scenario: 列表结果直接携带边界属性
- **GIVEN** 库中有一条 personal-global、敏感度 normal 的记忆与一条同步策略为 local_only 的记忆
- **WHEN** 调用方执行检索并查看返回条目
- **THEN** 每个条目都带有其作用域名、敏感度与同步策略，作用域名是 preset 名而非内部标识
