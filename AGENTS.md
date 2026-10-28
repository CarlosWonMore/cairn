# AGENTS.md — AI Memory 项目工作约定

## 当前入口

- 先读 `docs/M0-session-handoff.md`（含 2026-10-25 五节会话记录与 2026-10-28 追加第六、七节）。
- 两个变更均已归档：`add-local-first-memory-mvp`（本地 MVP）与 `add-real-cloud-sync`（OBS/ECS 云同步；经三轮外部独立验证 + 第四轮归档门禁，见 `docs/verify-cloud-sync-round4-2026-10-25.md`）。当前无活跃变更。
- 宿主 MCP 接入已于 2026-10-28 自检通过并完成配置写入（见 `docs/verify-host-mcp-2026-10-28.md`）：`~/.workbuddy/mcp.json` 已加入 `cairn` 条目，指向 `dist/src/interfaces/mcp/server.js`，**改 `src/` 后须 `npm run build` 才对新会话生效**；信任状态需用户在连接器 UI 确认。日常自检用 `npm run mcp:smoke`（默认只读真实库，写库须 `--write --home <临时目录>`）。
- 测试基线：`npm test` 默认不联网，恒 390 项 / 389 通过 / 1 显式 skip；真实云端往返用 `npm run test:real`（需 `OBS_*` 五个变量齐全，缺任一即 exit 2，不静默 skip）。
- 下一入口候选（需用户决定）：macOS 平台 CI（用户 2026-10-28 明确暂缓）；项目/自定义空间的云同步扩展；公开发布准备（private→public、npm 发包、`@cairn/memory` 包名核查）。
- 使用文档在 `docs/cairn-usage.md`、`docs/cairn-security.md`、`docs/cairn-sync.md`；运行入口见 README"快速开始"（Windows 不要直接运行 .ts/.js 文件）。

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

## 任务分发与验收

- 本地开发不再派发 CodeBuddy CLI（2026-10-25 起决策）。批量实现/测试/审计在 ZCode 内起独立子代理并行处理。
- 子代理必须写集隔离（各自独立的 src/tests 子目录），不 commit；主会话负责拆解、接口契约、集成、独立复跑验收与提交。
- 验收纪律不变：不采信子代理自述，独立复跑并核对磁盘产物、退出码和非零测试数；0 tests / 0 assertions / 报告与复跑矛盾均不算通过。

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
