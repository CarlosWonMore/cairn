# AGENTS.md — AI Memory 项目工作约定

## 当前入口

- **接手先读 `docs/handoff-2026-11-12-session-summary-and-next.md`**：2026-11-11～12 四提案归档的完整交接（做了什么、验证证据、关键设计陷阱、四个待办任务的逐步推进路线、事故记录、接手纪律）。它自足，不需要上一段会话的上下文。
- 再读 `docs/M0-session-handoff.md`（含 2026-10-25 五节会话记录，以及此后三次追加：第 6 节自动整理的实施方案与实测、第 7 节浏览器点击级验收、第 8 节 2026-10-31 归档记录）。
- 四个变更均已归档：`add-local-first-memory-mvp`（本地 MVP）、`add-real-cloud-sync`（OBS/ECS 云同步；经三轮外部独立验证 + 第四轮归档门禁，见 `docs/verify-cloud-sync-round4-2026-10-25.md`）、`add-memory-workbench`（本地控制台：预览页 + 工作台 + 双层建议 + 静态导出；28/28 tasks，2026-10-29 归档，主规格新增 `local-console` 与 `memory-review`）、`add-auto-onboarding`（策略预授权的自动整理 + 写入时判断与查重 + 导入工作台抽屉化；43 tasks + 追加 8.1–8.5，2026-10-31 归档，主规格新增 `auto-onboarding`，改写 `local-console` 与 `memory-governance`）。**仓库当前没有活动变更。**

- **2026-11-14 `refine-drawer-nav-reachability` 归档**：抽屉打开时主导航可达——`nav` 抬到遮罩之上（`z-index: 60` > 遮罩 50，CSS 注释约定「任何覆盖层必须 > 60」），一次点击完成「关抽屉 + 切视图」；抽屉如实声明非模态（不再声明 `aria-modal`）。三条实施陷阱：遮罩点击坐标必须取内容区（x > 导航列 190px，否则 Playwright「可接收事件」必失败）；`focus()` 证明不了层级（被盖元素照样能 programmatic focus，真断言是 `elementFromPoint` 命中）；规格修正类断言改动要全仓 grep（提案只列了 2 处 aria-modal 断言，实际 3 处）。详见 `docs/M0-session-handoff.md` 2026-11-14 节。
- **2026-11-11 四个提案批量归档**：`add-stable-project-identity`（项目身份 UUID + 别名，主键不再用路径）、`add-scope-migration`（cairn rescope 作用域迁移 + scope_exit 迁出通知 + needs_rescope 批注；schema v6 重建 outbox CHECK）、`add-agent-managed-revision`（AI 修订提案方案卡：MCP 只能 propose/list，采纳复用 reviseMemory 记 user_confirmed，控制台新增「修订提案」视图）、`add-cloud-backup`（设备快照加密上云：backups/<设备>/ 前缀 + deriveBackupKey 设备维度，syncd 无 DELETE 诚实降级）。关键设计陷阱见 `docs/M0-session-handoff.md` 2026-11-11 节：迁回靠 reentry 强制重发、未知事件必须跳过不卡链、静态页断言必须行为级。
- **2026-11-02 DSH 面板这条线也已归档**：`add-dsh-memory-plugin`（Host 侧召回/注入）、`add-memory-usage-panel`（会话内面板）、`add-memory-panel-split-layout`（左右两栏 + 拖拽 + 布局持久化）、`fix-memory-panel-session-scope`（按会话切片 + 累计注入 + 点选高亮）、`refine-memory-panel-requirement`（正文压到 500 字符内）。主规格 `agent-interfaces` 的「记忆调用对用户可见」现在要求：面板按会话呈现、两栏各自滚动、栏宽可拖拽且记住、左下是本会话注入过的记忆（去重、跨轮累计）、活动记录可点选高亮。归档后 `openspec validate --specs --strict` 为 9/9。
- **归档时的一条实测结论**：真实库 533 条快照里只有 329 条是实质正文（127 KB），其余 204 条是结构残片（143）、blocked 占位符（45）、碎片（3）与加粗小标题（13）。规则引擎对这 533 条已跑到天花板——判 191 条 skip、342 条判 `promote` 但**全部来自兜底规则 `S-CLEAN-DEFAULT`、置信度一律 medium**，等于没有判断。因此「再补规则就能自动处理」不成立，语义判断必须交给 AI 层。
- **`add-auto-onboarding` 的四条不许退让的边界**（已进主规格，改实现前先读 `openspec/specs/auto-onboarding/spec.md`）：策略复用 `approved_by='local_cli'` + `channel='policy:<id>:<hash8>'`（不改 CHECK 枚举）；`judgement` 只能影响"值不值得记"，不能改敏感度/扩作用域/当审批；查重是 `findDuplicate` 一个函数三个调用点（写入 / 计划生成 / 计划应用）；`memory_decide` 不能签发策略。方案要点见 `openspec/changes/archive/2026-10-31-add-auto-onboarding/design.md`，使用说明见 `docs/cairn-auto-onboarding.md`。
- **"已晋升"这个谓词只有一处出处：`src/onboarding/batches.ts` 的 `promotedPredicate()`。** 它曾经在 6 个文件里各写一份，撤销语义就是在其中一处漏掉的——别再手写 `EXISTS (… item_promoted …)`。
- **撤销是粘的**：`onboarding revoke` 把记忆转墓碑，普通重跑**不会**把它们写回来；要重做必须显式 `--redo`（同时放宽选择与规则层两处）。撤销"结果"（`onboarding revoke`）与撤销"授权"（`policy revoke`）是两件不同的事。
- 控制台（`cairn ui`）入口与边界见 `docs/cairn-console.md`；只读冒烟脚本 `node scripts/smoke-console.mjs`（对真实库前后做字节级 sha256 与表行数比对，报告落 `artifacts/console-smoke-<date>.json`，不入库；已覆盖 `/api/imports`、`/api/policies`、抽屉的 archive items 与"GET 打写端点必须 404"）。
- 端到端验收 `npm run test:e2e`（`scripts/e2e-onboarding.mjs`）：临时 HOME 里灌一份与真实库同构的 533 条 fixture（143 结构残片 / 45 blocked / 23 组重复正文），跑完整自动整理，断言"人工队列两位数 + 同内容只留一条 active"。**不碰真实库，跑完自删**（`CAIRN_KEEP_E2E=1` 保留样本）。2026-10-29 实测：applied 336 / skipped 152 / failed 0，`maxPerContent = 1`。
- 宿主 MCP 接入已于 2026-10-28 自检通过并完成配置写入（见 `docs/verify-host-mcp-2026-10-28.md`）：`~/.workbuddy/mcp.json` 已加入 `cairn` 条目，指向 `dist/src/interfaces/mcp/server.js`，**改 `src/` 后须 `npm run build` 才对新会话生效**；信任状态需用户在连接器 UI 确认。日常自检用 `npm run mcp:smoke`（默认只读真实库，写库须 `--write --home <临时目录>`）。
- 三个宿主已接入，配置形态**不同**：WorkBuddy `~/.workbuddy/mcp.json` 与 ZCode `~/.zcode/cli/config.json` 是 `mcp.json` 形态；**DSH 不吃 `mcp.json`**，走 Cordis——`D:\AIAgents_Data\DSH_DATA\profiles\desktop\cordis.patch.yml` 里一条 `name: '@deepseek-ai/dsh-mcp-client'` 的 stdio 条目（见 `docs/M0-session-handoff.md` §9）。**本 agent 涉及记忆读取与管理的地方一律走 cairn MCP（工具前缀 `mcp__cairn__`）**，不要用原生记忆承担跨设备共享职责。
- **「整个 DSH 会话都走 cairn」的落点是 user-global 指令层**，不是逐个项目改：`D:\AIAgents_Data\DSH_DATA\AGENTS.md`（= `$DSH_HOME/AGENTS.md`）由 `@deepseek-ai/dsh-agent-instructions` 在**每个会话首个请求**加载，与项目级 `AGENTS.md` **叠加而非覆盖**（另有 `~/.agents/AGENTS.md` 为同级第二根）。已写入与 `ROUTER_BLOCK_CONTENT` 一致的受管块（`cairn-router` / revision 1）。注意 `cairn agent` 的 `AGENT_KINDS` **不含 dsh**，这条是手工复用受管块格式，不是产品命令（见 `docs/M0-session-handoff.md` §10）。
- **DSH 的 patch 行必须写成 `- insert:` 再嵌套条目**，不能直接写 `- id: mcp-cairn`：顶层数组是补丁行（覆盖/禁用既有条目），裸 id 行找不到目标就被静默丢弃，日志只留一行 `[warn] patch: entry "mcp-cairn" not found`。**这条我已踩过一次**（2026-11-01），改正后热加载即生效。改前已备份 `cordis.patch.yml.bak-pre-cairn-20261101`。2026-11-01 20:35 端到端确认：插件 state 1→2、cairn 进程 ppid 为 DSH NEXT.exe、14 个 `mcp__cairn__*` 工具可调。
- 浏览器点击级验收 `npm run test:ui`（`scripts/e2e-console-ui.mjs`，Playwright + 系统 Chrome，`channel: 'chrome'` 不下载 Chromium）：真点导航/抽屉/折叠/批量/静态页，断言 `role=dialog`、焦点移入与归还、Esc·遮罩·按钮三入口、地址往返还原、只读预览页无写入口。**依赖是一次性的，未写入 package.json**：缺 playwright 时脚本 exit 2 并给出 `npm i --no-save --no-package-lock playwright`，不静默跳过。2026-10-30 实测 46/46，报告落 `artifacts/console-ui-<date>.json`。
- 测试基线：`npm test` 默认不联网，恒 846 项 / 845 通过 / 0 失败 / 1 显式 skip（2026-11-14 起；e2e-console-ui 为 112/112）；真实云端往返用 `npm run test:real`（需 `OBS_*` 五个变量齐全，缺任一即 exit 2，不静默 skip）。
- 下一入口候选（需用户决定）：macOS 平台 CI（用户 2026-10-28 明确暂缓）；项目/自定义空间的云同步扩展；公开发布准备（private→public、npm 发包、`@cairn/memory` 包名核查）。
- **DSH 插件相关的问题，先读源码再动手，不要猜 API。** 2026-11-02 实测教训：做 DSH 记忆插件时连续 8 轮修改都失败，根因是猜宿主 API——`ctx.tools.call` 不存在、`tools.get()` 返回的定义上没有 `call`。真实入口是 `ctx.tools.execute({callId,name,arguments,signal,agent})` 与 `definition.execute(args,exec)`。**权威来源**：`D:\Program Files\DSH NEXT\resources\app.asar` 里的实现（可按字节串 grep），以及已装插件 `profiles/desktop/node_modules/*/lib/*.js` 的真实用法。三次交接（ZCode 两次、CodeBuddy 一次）都比自查有效：ZCode 找到 list slot 要 `id`、`session/event` 是双参数 `(session,event)`；CodeBuddy 找到 `execute`。**但 2026-11-02 12:36 后的实测更进了一步**：本机部署默认是 **ptc 呈现模式**，`tools.execute` 对非 `run_code` 的直呼一律折叠成 `UNKNOWN_TOOL`（错误文案 `only \`run_code\` is callable directly`），所以插件内**主路径应是 `tools.get(name, scope)` → `definition.execute(args, exec)`**，`tools.execute` 只在定义上没有 `execute` 时兜底。顺序写反的代价不是失败，是每轮六条查询各撞一次必然拒绝、并把假错误永久写进 `usage?debug=1` 的 `lastError`——排查时会被它带偏。
- **DSH 插件改动必须重建 `dist`**：插件从 `plugin/dsh/dist/index.js` 加载，只改 `src/` 不 `npx tsc -p tsconfig.json` 等于没改。我已经在这上面栽过一次。
- **同一判断不要在两处各写一份**：投影摘要的 `firstLine` 曾同时在 `recall.ts`（注入文本）与 `usage-state.ts`（面板）各有一份，修了后者没修前者，导致注入里仍显示 `---`。现已统一从 `usage-state.ts` 导出。这是继 `promotedPredicate` 之后第二次同类失误。
- **判断 DSH 是否真的重启，只认 `app.asar\lib\host.js` 进程的创建时间。** 关窗口不杀宿主（`closeToTrayOnWindows: true`）；新实例发现已有实例时常在数秒内自退。2026-11-02 我连续四轮用 `Get-Process 'DSH NEXT' | Select-Object -First 1` 取启动时间，拿到的永远是最旧的那个进程，据此误判「已重启但仍失败」，白改了两轮代码。正确查法：`Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'DSH NEXT.exe' -and $_.CommandLine -like '*host.js*' } | Select-Object ProcessId, CreationDate`。同理，插件端可用自建探针（如 `usage?debug=1` 里的 `renderProbe`）确认新代码是否进内存——**探针为空就是旧代码，此时任何「修复无效」的结论都不成立**。
- **状态字段被覆盖，是「数据自相矛盾」类 bug 的常见元凶。** 2026-11-02 面板显示「未命中」但同一 payload 里 `candidates: 5`、`bytesUsed: 1182`；真因是 `pre-step` 每步都跑一次召回，去重后早退分支仍写了 `lastUsage`，把上一步的真实结果覆盖成空。排查顺序应是：先确认「谁在写这个字段、有没有多个写入者」，再怀疑算法。
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
