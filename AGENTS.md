# AGENTS.md — AI Memory 项目工作约定

## 当前入口

- 先读 `docs/M0-session-handoff.md`，再读 `openspec/changes/add-local-first-memory-mvp/`。
- 当前变更已完成 proposal、specs、design、tasks，并通过普通与严格校验；它仍处于待审阅阶段。
- 只有用户明确要求 apply 时才进入实现。不要在读取项目或总结进度时自动写产品代码。

## 产品与技术边界

- 产品是个人、多设备、多 Agent 的本地优先记忆主权层，不是规格驱动业务平台。
- 本地 SQLite 是每设备权威副本；Markdown 是派生投影，云端仅是后续可选加密中继。
- TypeScript ESM + Node.js 22+；npm 发布、npx 试用、固定版本长期使用。MVP 使用 `node:sqlite` 适配层。
- MCP stdio 的 stdout 只能是 JSON-RPC；日志仅 stderr 或文件。
- 同步、抽取、嵌入和维护退出 Agent 会话关键路径；默认不安装同步 hook。
- 本次及当前 MVP 不考虑本地模型，不下载模型或推理运行时，不恢复相关评测任务。
- 首版不做团队共享、图数据库、实时双向原生记忆镜像或 Agent 私有数据库接管。

## 安全与授权

- 不读取真实个人记忆，除非用户明确指定来源并授权；发现阶段只看元数据。
- 记忆导入、MCP 配置、原生记忆修改是三个独立授权步骤。
- `local_only` 和设备限定内容必须在上行任务生成前物理排除。
- 模型只生成候选；`plan_hash + approval_id`、目标修订和一次性有效期由确定性代码校验。
- 调用方声明 `user_confirmed` 不代表真实批准；秘密和注入文本不得进入日志、投影或上行内容。
- 默认只用合成 HOME、合成记忆和 fake backend；真实 Agent 配置或云端资源需要另行明确授权。

## OpenSpec 流程

- 使用 `spec-driven`：proposal → specs → design → tasks → apply → verify → archive。
- 新变更先通过 `/opsx:propose`，审阅后才 `/opsx:apply`；不要在同一工作流里越过审阅。
- 规格使用 RFC 2119 SHALL/MUST 与可测试场景；delta 不写实现步骤。
- 每次修改提案后运行普通和 `--strict` 校验，并检查 4/4 制品状态。
- archive 前核对测试证据和文档；外部未验证项不得靠归档消失。

## 任务分发与积分控制

- 非决策型批量实现、测试和审计优先派给独立 CodeBuddy CLI，显式模型 `deepseek-v4.1-flash`、`effort=high`。
- 主会话负责拆解、决策、验收与汇总，不重复实现已派发工作。
- 并行批必须写集隔离；保留 prompt、日志、机器可读结果和实际模型记录。
- 复用已有文件和会话断点，避免超时后整批重做。`total_cost_usd` 与 `rawUsage.credit` 分开统计，不宣称零积分。

## 验收纪律

- 不采信 CLI 或报告自述；必须独立复跑并核对磁盘产物、退出码和测试数。
- 0 tests、0 assertions、结果无法解析、汇总数学不一致或报告与复跑矛盾，均不算通过。
- 失败分为可返工、外部条件阻塞、需用户决策；fake backend 不等于真实云端，fixture 不等于真实 Agent 认证。
- 每批实现同时带测试和必要文档，不把全部测试拖到项目末尾。

## 目录职责

- `docs/`：开发方案、当前决策、会话交接与实施文档。
- `artifacts/m0/`：原型、探针、fixtures、CLI 日志和审计证据；不是生产源码，公开分发时不得打入这些运行产物。
- `openspec/`：当前规格与变更的唯一流程事实源。
- 后续 `src/`、`migrations/`、`tests/`：仅由明确 apply 的实现工作创建。

完成实质性工作后更新 `docs/M0-session-handoff.md` 的当前状态和下一入口；跨会话只保留长期结论，不记录临时错误或一次性搜索过程。
