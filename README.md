# AI Memory

个人、多设备、多 Agent 的本地优先记忆主权层。

当前阶段：M0 本地可执行验证已完成，首个 OpenSpec 变更待审阅，尚未进入产品实现。

## 新会话入口

1. 阅读 `AGENTS.md` 和 `docs/M0-session-handoff.md`。
2. 审阅 `openspec/changes/add-local-first-memory-mvp/` 下的 proposal、specs、design、tasks。
3. 用户确认后，在新会话执行 `/opsx:apply` 或明确要求应用 `add-local-first-memory-mvp`；不要重复创建同名提案。

## 关键资料

- `docs/AI-Memory-development-plan.md`：资料库开发方案的本地完整快照。
- `docs/M0-session-handoff.md`：本会话全部流程、结论、验收、阻塞和迁移说明。
- `artifacts/m0/`：原型、探针、测试、CLI 日志、审计和迁移清单。
- `openspec/config.yaml`：项目上下文、制品规则和 apply/archive 约束。

## 当前硬约束

本地 SQLite 为权威副本；MCP + CLI + 受管投影；记忆作用域贯穿检索、导出和后续同步；模型只提候选；后台故障不得中断 Agent 会话。当前不考虑本地模型，不做团队共享，不在首个变更连接真实 ECS/OBS 或接管 Agent 私有记忆。

`artifacts/m0/` 是证据与原型，不是生产代码。实现必须遵循 OpenSpec 变更并独立复跑验收。
