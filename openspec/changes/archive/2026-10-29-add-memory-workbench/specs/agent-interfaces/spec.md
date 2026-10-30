## ADDED Requirements

### Requirement: 本地控制台入口
系统 SHALL 提供 `cairn ui` 作为可选的本地控制台入口，并 SHALL 支持 `--export <file>` 生成不启动服务的只读静态预览；两类形态 MUST 共享同一份只读数据装配逻辑，且 MUST NOT 成为其他命令的前置依赖。

#### Scenario: 控制台按需启动
- **WHEN** 用户执行 `cairn ui` 并按 Ctrl-C 结束
- **THEN** 系统正常关闭监听并以 0 退出，退出后 CLI、MCP 与库内容均与启动前一致

#### Scenario: 无服务环境导出
- **WHEN** 用户在不能监听端口的受限环境中执行 `cairn ui --export report.html`
- **THEN** 系统仍能产出完整静态预览并报告被脱敏排除的条目数

#### Scenario: 未安装可选依赖
- **WHEN** 用户仅安装发布包而未安装任何前端工具链
- **THEN** 控制台仍可用，因为其实现不依赖外部前端包与构建步骤
