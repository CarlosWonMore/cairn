# AGENTS.md — AI Memory 项目工作约定

## 当前入口

- 先读 `docs/M0-session-handoff.md`（含 2026-10-25 五节会话记录与 2026-10-28 追加第六、七节）。
- 三个变更均已归档：`add-local-first-memory-mvp`（本地 MVP）、`add-real-cloud-sync`（OBS/ECS 云同步；经三轮外部独立验证 + 第四轮归档门禁，见 `docs/verify-cloud-sync-round4-2026-10-25.md`）、`add-memory-workbench`（本地控制台：预览页 + 工作台 + 双层建议 + 静态导出；28/28 tasks，2026-10-29 归档，主规格新增 `local-console` 与 `memory-review`）。
- **归档时的一条实测结论**：真实库 533 条快照里只有 329 条是实质正文（127 KB），其余 204 条是结构残片（143）、blocked 占位符（45）、碎片（3）与加粗小标题（13）。规则引擎对这 533 条已跑到天花板——判 191 条 skip、342 条判 `promote` 但**全部来自兜底规则 `S-CLEAN-DEFAULT`、置信度一律 medium**，等于没有判断。因此「再补规则就能自动处理」不成立，语义判断必须交给 AI 层。
- **当前有一个已实现待归档的变更 `add-auto-onboarding`（策略预授权的自动整理 + 写入时判断与查重 + 导入工作台抽屉化）：43/43 tasks 完成，4/4 制品齐全。** 方案要点见 `openspec/changes/add-auto-onboarding/design.md`，使用说明见 `docs/cairn-auto-onboarding.md`。四条不许退让的边界：策略复用 `approved_by='local_cli'` + `channel='policy:<id>:<hash8>'`（不改 CHECK 枚举）；`judgement` 只能影响"值不值得记"，不能改敏感度/扩作用域/当审批；查重是 `findDuplicate` 一个函数三个调用点（写入 / 计划生成 / 计划应用）；`memory_decide` 不能签发策略。
- **"已晋升"这个谓词只有一处出处：`src/onboarding/batches.ts` 的 `promotedPredicate()`。** 它曾经在 6 个文件里各写一份，撤销语义就是在其中一处漏掉的——别再手写 `EXISTS (… item_promoted …)`。
- **撤销是粘的**：`onboarding revoke` 把记忆转墓碑，普通重跑**不会**把它们写回来；要重做必须显式 `--redo`（同时放宽选择与规则层两处）。撤销"结果"（`onboarding revoke`）与撤销"授权"（`policy revoke`）是两件不同的事。
- 控制台（`cairn ui`）入口与边界见 `docs/cairn-console.md`；只读冒烟脚本 `node scripts/smoke-console.mjs`（对真实库前后做字节级 sha256 与表行数比对，报告落 `artifacts/console-smoke-<date>.json`，不入库；已覆盖 `/api/imports`、`/api/policies`、抽屉的 archive items 与"GET 打写端点必须 404"）。
- 端到端验收 `npm run test:e2e`（`scripts/e2e-onboarding.mjs`）：临时 HOME 里灌一份与真实库同构的 533 条 fixture（143 结构残片 / 45 blocked / 23 组重复正文），跑完整自动整理，断言"人工队列两位数 + 同内容只留一条 active"。**不碰真实库，跑完自删**（`CAIRN_KEEP_E2E=1` 保留样本）。2026-10-29 实测：applied 336 / skipped 152 / failed 0，`maxPerContent = 1`。
- 宿主 MCP 接入已于 2026-10-28 自检通过并完成配置写入（见 `docs/verify-host-mcp-2026-10-28.md`）：`~/.workbuddy/mcp.json` 已加入 `cairn` 条目，指向 `dist/src/interfaces/mcp/server.js`，**改 `src/` 后须 `npm run build` 才对新会话生效**；信任状态需用户在连接器 UI 确认。日常自检用 `npm run mcp:smoke`（默认只读真实库，写库须 `--write --home <临时目录>`）。
- 浏览器点击级验收 `npm run test:ui`（`scripts/e2e-console-ui.mjs`，Playwright + 系统 Chrome，`channel: 'chrome'` 不下载 Chromium）：真点导航/抽屉/折叠/批量/静态页，断言 `role=dialog`、焦点移入与归还、Esc·遮罩·按钮三入口、地址往返还原、只读预览页无写入口。**依赖是一次性的，未写入 package.json**：缺 playwright 时脚本 exit 2 并给出 `npm i --no-save --no-package-lock playwright`，不静默跳过。2026-10-30 实测 46/46，报告落 `artifacts/console-ui-<date>.json`。
- 测试基线：`npm test` 默认不联网，恒 609 项 / 608 通过 / 0 失败 / 1 显式 skip（2026-10-30 起）；真实云端往返用 `npm run test:real`（需 `OBS_*` 五个变量齐全，缺任一即 exit 2，不静默 skip）。
- 下一入口候选（需用户决定）：macOS 平台 CI（用户 2026-10-28 明确暂缓）；项目/自定义空间的云同步扩展；公开发布准备（private→public、npm 发包、`@cairn/memory` 包名核查）。
- 使用文档在 `docs/cairn-usage.md`、`docs/cairn-security.md`、`docs/cairn-sync.md`、`docs/cairn-console.md`、`docs/cairn-auto-onboarding.md`；运行入口见 README"快速开始"（Windows 不要直接运行 .ts/.js 文件）。

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

<!-- cairn:begin block="cairn-router" revision="1" -->
本区块由 Cairn（本地优先记忆层）受管，请勿手工编辑；卸载时会被精确移除。
跨设备共享的长期记忆统一经 Cairn MCP 读写：需要保存、检索、更正或遗忘共享记忆时，显式调用 Cairn 工具。
用户明确要求“记住 / 更正 / 遗忘”某条信息时，先通过 Cairn 工具完成，再按需回复。
不要在每次对话开始时无条件检索记忆；仅在与当前任务相关时检索。
Agent 私有的原生记忆继续保留：会话草稿与本机偏好留在原生记忆，不承担跨设备共享职责。
<!-- cairn:end block="cairn-router" -->
