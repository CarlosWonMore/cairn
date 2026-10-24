# AI Memory：M0 会话交接与实施入口

日期：2026-10-24  
项目目录：`D:\Project\AI Memory`  
当前阶段：M0 本地可执行验证已完成；首个 OpenSpec 变更已规划，尚未进入产品实现。

## 1. 一句话结论

AI Memory 值得继续做，但应做“个人记忆主权层”：每台设备一个本地 SQLite 权威库，以 MCP、CLI 和受管文件投影兼容不同 Agent；模型只提出候选，云端仅是后续可选的加密中继。首个实施变更已经准备好，新会话审阅后可直接进入 apply，不需要重新调研或重新提案。

本次不考虑本地模型。相关测试产物已删除；没有下载新模型，也没有安装本地推理运行时，既有模型文件和系统环境未被修改。

## 2. 本次需求如何收敛

### 2.1 产品边界

- 面向个人、多设备、多 Agent，不做团队共享或组织权限。
- 只管记忆生命周期，不做需求规格、任务拆解、验收门禁等规格驱动业务功能；OpenSpec 在这里只是本项目自身的开发流程。
- 支持个人公共、设备本地、项目、Agent 私有和受约束自定义空间；作用域必须贯穿写入、检索、投影、导出和后续同步。
- 本地优先、离线可用；ECS 与华为 OBS 后续共用加密 chunk/manifest 协议，首变更不写真实云端。
- 兼容采用分层策略：标准 MCP、CLI、受管投影、显式导入导出；不承诺接管所有 Agent 私有原生记忆。

### 2.2 首次初始化

采用“发现→授权→快照档案→AI 分批整理→独立审批→晋升”的两层机制：

1. 自动发现只看允许位置的元数据，不读正文。
2. 用户勾选后才创建不可变快照，源文件不变。
3. 导入档案默认可本地检索，但状态是 `imported_unverified + local_only`，不上行、不进入公共活动记忆。
4. 当前 Agent 只提出 `add/merge/keep_both/skip` 建议。
5. 计划绑定 `plan_hash + approval_id + 目标修订`；伪造确认、计划篡改、过期目标和重放均拒绝。
6. 会话中断可续跑，重复执行幂等。

记忆导入、MCP 配置、原生记忆修改是三个独立授权步骤。原生记忆默认保留；推荐 `router` 模式，共享记忆走 MCP，宿主原生区域保留 Agent 私有草稿。`mcp-primary` 只可在公开能力允许时另行确认，不能伪造接管。

### 2.3 会话安全

同步、抽取、嵌入和维护退出 Agent 会话关键路径。默认不安装同步 hook；MCP 进程只做有界本地操作和任务入队，独立 worker 或显式 CLI 处理后台任务。网络、模型、worker 或维护失败，只能留下可重试状态，不能终止当前 Agent 会话。

### 2.4 技术与商业化

- 独立轻核心：TypeScript ESM + Node.js 22+。
- MVP 采用 `node:sqlite` 适配层；保留未来替换驱动的边界。
- npm 发布、npx 试用、固定版本长期使用；uvx 不作为主分发。
- 建议 Apache-2.0；基础同步、E2EE、导出、自定义作用域保持开源。Pro 以后只验证托管 relay、桌面治理、设备健康和高级评测等真实增量。

## 3. 本次执行流程

1. 读取并保存原《AI Memory 系统构想》，将团队共享和 Postgres 权威层重构为个人、本地优先方案。
2. 核查 Claude Code、OpenClaw、WorkBuddy、Cursor、GitHub Copilot、TeamAI 的公开机制，并调研 Engram、agentmemory、basic-memory、claude-mem、MemPalace 等项目。
3. 将开发方案 2.0 回写资料库并回读核验，形成 19 章正文及参考资料。
4. 增加首次初始化附录 A，共 10 个小节，覆盖自动发现、授权导入、对话式合并、原生入口、卸载和回滚。
5. 用合成数据完成初始化合同、Node SQLite、中文检索、并发和 stdio 探针。
6. 将未完成项拆成独立批次，统一派发 CodeBuddy CLI，显式 `deepseek-v4.1-flash`、`effort=high`；主会话只做决策与独立验收。
7. 对超时批保留已有文件续跑；对报告和复跑矛盾的结果重新返工，不采信 CLI 自述。
8. 按用户决定取消本地模型路线并清理本次测试产物。
9. 将全部方案与 M0 证据迁移到新项目，初始化 OpenSpec，完成首个实施变更的 proposal、5 份 specs、design 和 tasks。

## 4. M0 批次最终状态

| 批次 | 状态 | 独立证据与结论 |
|---|---|---|
| A 存储与 Schema | 已完成（有限边界） | 主会话连续两轮 `run-all` 均为 45/45、四个探针通过、退出码 0；独立负向控制确认故意失败会使总控退出 1。已修复 WAL 生命周期竞争、Windows 入口判断和失败退出码假绿。`node:sqlite` 为当前 MVP 暂定选择；better-sqlite3 原生运行和其他 OS 仍未验证。 |
| B 真实 MCP 协议 | 已完成 | 官方 MCP SDK 1.32.2；独立复跑两轮均 25/25。覆盖 initialize/list/call/cancel/timeout/disconnect/stdio。 |
| C Agent 初始化适配 | 已完成（有限边界） | 先前复跑为 63 通过、1 跳过（Copilot CLI `probe-failed`）；最新主会话直接复跑运行器退出 0，64/64，真实 Copilot CLI 用例已在显式合成 HOME 通过。其余宿主仍按 fixture-only 或公开接口阻塞标记，不扩大为全面真实宿主认证。 |
| D1 评测集与评分器 | 已完成 | 22 个合成案例；评分器 20/20 变异自测。覆盖动作、作用域、证据、冲突、秘密和过期。 |
| D2 DeepSeek 盲答 | 已完成 | 22 条预测完整、ID 唯一、结构合法；未读取标准答案。 |
| D3 独立评分与审计 | 已完成 | 21/22，micro 0.9849；独立复跑 20/20 自测且评分输出逐字节一致。case_16 是真实过度拦截；另有 case_18/20 两处评分器未抓住的语义漂移。 |
| D4 本地模型 | 主动排除 | 按用户决定不再测试，不作为 blocked 或缺口；本次目录、日志和任务提示已清理。 |
| E 同步故障恢复 | 已完成（fake 边界） | 主会话连续两轮均为 50/50、0 失败、0 超时、0 不一致，smoke 与备份恢复 drill 通过；独立 checker 通过。故意失败探针已移出默认套件，负向控制确认 runner 返回 1、failed=1、总数一致且不污染正常结果。真实 OBS/ECS 和其他 OS 仍未测。 |
| F 源码/许可证/安全审计 | 已完成（有限审计） | 22 个对抗 fixtures，203/203 断言；独立复跑另有 78/78 报告一致性检查。仅覆盖两个仓库 1.34% 源码，不是完整供应链审计。 |

### 4.1 模型评测应如何使用

DeepSeek V4.1 Flash 在这 22 案上表现可用，但不能据此宣称“最优模型”或允许静默自动写入：

- 唯一评分失败 case_16：源文本同时含注入指令和真实构建事实，模型把整条都丢弃；正确行为是只丢指令、保留项目事实。
- case_18：自行增加未要求的过期时间，可能让健康提醒自动失效。
- case_20：去掉“好像/不确定”，把待确认信息写成确定事实。
- 评分器对短数字子串、冗余伪造证据、不确定语气和额外 expires_at 存在盲区；内容分数是上界，仍需人工抽查。

当前 MVP 无模型也能运行。当前宿主 Agent 与其他云模型尚未做同集对照，不构成本地 MVP 阻塞。

### 4.2 源码审计应如何使用

可吸收：数据库替换检测、宿主权威 session 绑定、PID+启动时间、严格 JSON 解码、摘要校验后安装、统一作用域检查。

不可照搬：默认允许的工具注册、安装器扩大权限、把召回正文当可信指令、把 scope 当普通过滤参数、只做 inode 防回滚、无锁文件依赖策略。

Engram/agentmemory 的归档均不完整；当前只有 26 个 size-matched 源码文件，传递依赖许可证、云传输、动态行为仍是 unknown。独立轻核心方向没有被反证，但“轻”不等于可以省略安全治理。

## 5. 仍需保留的外部验证与边界

以下不是本次可用模拟结果冒充完成的事项：

| 事项 | 当前原因 | 后续入口 |
|---|---|---|
| 真实 OBS/ECS | 没有专用测试资源与独立授权；本地 fake backend 不等于云端验收 | 另立同步变更，准备专用测试桶/服务器与凭据后执行 |
| macOS/Linux | 本轮只有 Windows x64 | 后续三平台 CI 与实机验证 |
| 更多真实 Agent | 部分宿主未安装，部分原生能力没有公开接口 | 按适配矩阵逐宿主授权验证；无接口时保持导入/投影降级 |
| `better-sqlite3` | 当前缺 native binding 和离线打包证据 | 当前 MVP 不需要；公开发布硬化时再比较 |
| 完整源码供应链审计 | 克隆/归档不完整，仅 1.34% 文件覆盖 | 后续网络允许时定向补读 store/auth/cloud transport，不阻塞本地 MVP |
| 当前宿主 Agent/其他云模型 | 未做同集盲测 | 需要选择候选时另立评测，不与本地模型绑定 |

## 6. OpenSpec 交付

已初始化 `openspec/`，并生成 CodeBuddy/WorkBuddy 的 6 个技能和 6 个命令。`openspec/config.yaml` 已写入项目技术边界、隐私约束、非阻塞要求、DeepSeek 分发和验收规则；`AGENTS.md` 提供新会话入口。

首个变更：`add-local-first-memory-mvp`

- `proposal.md`：为什么做、做什么、影响、非目标和回滚。
- `specs/memory-store/spec.md`：本地权威、作用域、修订、生命周期、恢复、设备身份。
- `specs/scoped-retrieval/spec.md`：全通道隔离、中文检索、溯源、冲突与失效。
- `specs/memory-governance/spec.md`：候选、真实审批、幂等、冲突、秘密和注入。
- `specs/agent-onboarding/spec.md`：发现、独立授权、快照、对话初始化、原生模式。
- `specs/agent-interfaces/spec.md`：CLI/MCP、配置、后台隔离、投影与 doctor。
- `design.md`：10 项技术决策、威胁模型、迁移回滚和验证证据。
- `tasks.md`：8 组、37 个未勾选实施任务，每项带验证方式。

普通校验与 `--strict` 校验均通过，状态 4/4 artifacts complete。当前没有产品实现任务被标记完成。

## 7. 迁移内容与目录

- `docs/AI-Memory-development-plan.md`：资料库最新方案的本地 Markdown 快照，含 19 章和附录 A 10 节。
- `artifacts/library/ai-memory-plan-readback.txt`：资料库回读证据。
- `artifacts/m0/session-files/`：原始方案快照、初始化附录、调研元数据、文档编辑动作和早期 CLI 任务文件。
- `artifacts/m0/delegated/`：各批 prompt、源码原型、fixtures、测试、结果和日志。
- `artifacts/m0/` 根目录：初始化/SQLite 探针、M0 启动报告和迁移脚本。
- `artifacts/m0/migration-manifest.json`：共 632 个文件、34,073,486 字节，记录逐项 SHA-256 与排除项；迁移后已重新计算并全部校验通过。

迁移排除 `node_modules`、`.git`、临时测试目录、可重建的合成 HOME/Copilot 运行时、取消的不完整仓库克隆和本地模型测试产物；保留源码、锁文件、测试、fixtures、报告与必要审计证据。既有模型权重不在会话工作区，未复制、未删除。最终复核时，早先误复制到目标目录的 `delegated/work/agent-adapters/synthetic-home` 因深层路径和访问权限拒绝而未能自动清除；它不在迁移清单的 632 个已验收文件内，不影响源码、测试报告或后续 OpenSpec apply，可在获得适当系统权限后单独清理。

资料库原方案保留“本地模型可作为混合路由”的调研原文；本地快照也保持这一历史基线。**当前项目决策由本文和 OpenSpec 覆盖：本次不考虑本地模型。**

资料库原文：https://www.workbuddy.cn/space/d/RI7ke8iN0VSvnTydcdscPL

## 8. 分发与积分记录

所有 M0 实现、评测和审计批次均显式指定 `deepseek-v4.1-flash`。主会话没有重复实现这些批次，只做拆分、独立复跑、文档和 OpenSpec 决策。

当前可解析日志观察到 74 个计费 step，`rawUsage.credit` step 合计 7.82；若按 conversation 最大值口径合计为 1.97。由于多个超时/达 turns 日志没有最终 JSON，这只是**可观测记录，不是完整账单或真实总消耗**。`total_cost_usd` 与 credit 不可混用。最终脚本与明细在 `artifacts/m0/delegated/aggregate_usage.py`、`reports/cli-usage.json`。

最后两轮修复仍按 `deepseek-v4.1-flash`、`effort=high` 派发，未使用子 Agent：存储批运行约 8 分 27 秒、35 turns 封顶；同步批约 11 分 22 秒、40 turns 封顶。日志分别为 `logs/storage-schema-repair.json`、`logs/sync-recovery-repair.json`，均只有 Max turns 文本，无法从中审计最终模型元数据、Skill 调用或新增 credit，也没有把 CLI 自述当验收。实际代码改动由主会话核对，并完成上述连续两轮独立复跑。

## 9. 新会话如何继续

1. 阅读 `AGENTS.md`、本文和 `openspec/changes/add-local-first-memory-mvp/`。
2. 先审阅 proposal、5 份 specs、design 和 37 项 tasks；不要重新生成同名变更。
3. 用户确认后执行 `/opsx:apply`，或明确要求“应用 add-local-first-memory-mvp”。
4. apply 按 tasks 顺序完成本地 MVP；非决策批量任务继续交 DeepSeek V4.1 Flash，主会话独立验收。
5. 真实 ECS/OBS、跨平台、更多宿主和发布硬化另立变更，不在首个 MVP 中扩 scope。

### 验收提醒

- 不看自述，复跑并核对实际文件、退出码和非零测试数。
- 报告与复跑矛盾时，以复跑为准并返工；同步批旧 50/50 和存储批“退出 0 但 44/45”都是反例。
- 0 tests、0 assertions、数学不一致、JSON 不可解析均不算通过。
- fake 不等于真实云端，fixture 不等于真实 Agent 认证，有限源码审计不等于安全清仓。

---

# 2026-10-25 追加：本地 MVP 实现完成（会话记录）

## 1. 一句话结论

`add-local-first-memory-mvp` 已在仓库内完整实现并通过全部测试（296 项测试全部通过，`npm test` exit 0）；GitHub 私有仓库 `CarlosWonMore/cairn` 已建立并持续提交；MIT 许可证就位。变更尚未 archive，未虚标的外部边界见第 4 节。

## 2. 本次执行流程

1. 读取交接文档与 OpenSpec 全部制品后进入 apply（用户明确指示"完成整个产品的研发、测试过程"）。
2. 建立 npm 包骨架（`@cairn/memory`，bin: cairn / cairn-mcp，MIT），创建 GitHub 私有仓库并首次推送。
3. 主会话实现决策密集层：`src/core`（类型/作用域/哈希/ID/错误/秘密扫描）、`src/store`（node:sqlite 适配层、v1 迁移、九类仓储、备份恢复、设备身份与写守卫）、`src/interfaces`（AppService、CLI、MCP stdio）。
4. 并行子代理（写集隔离、主会话逐个独立复跑验收）：元数据发现适配器、检索与导出、治理计划应用、onboarding 快照导入与分批、jobs/worker、投影与五宿主配置适配、安全对抗测试套件、使用与安全文档。
5. 集成验收：E2E 全链路（发现→导入→计划→审批→应用→投影→卸载、双 MCP 客户端、worker 故障隔离）、4 进程并发写入、npm pack 全新目录安装冒烟。
6. 产品化收尾：Windows 启动器（cairn.cmd/cairn.sh/cairn-mcp.cmd）、`npm run cli/mcp` 入口、tasks.md 全部勾选并附证据、README 重写。

## 3. 验证证据（独立复跑，非自述）

| 套件 | 结果 |
|---|---|
| tests/core（含秘密扫描） | 21 pass |
| tests/store（迁移/作用域/记忆/outbox/计划审批/备份/克隆） | 30 pass |
| tests/onboarding（发现 29 + 导入分批 27） | 56 pass |
| tests/retrieval | 46 pass |
| tests/governance | 28 pass（含变异自检） |
| tests/jobs | 22 pass（含子进程隔离合同） |
| tests/projection + agents | 48 pass |
| tests/security（对抗） | 32 pass |
| tests/interfaces（CLI 5 + MCP 4） | 9 pass |
| tests/integration（E2E 3 + 并发 1） | 4 pass |
| npm pack 全新目录安装 | CLI init/add/search + bin shim + MCP initialize 全通过 |

关键安全断言（负向均有覆盖）：伪造 `user_confirmed` 拒绝；批准后计划篡改/目标推进拒绝；审批一次性重放拒绝；local_only 上行任务物理排除（触发器兜底）；秘密不进日志/DB/导出（masked 摘要）；设备克隆暂停写入。

## 4. 保留的外部边界（不虚标）

- 真实 ECS/OBS 同步：outbox 只有本地任务边界与 `NotConfiguredRemote`；`doctor` 报 `remote=not_configured`。
- 平台：仅 Windows x64 + Node 24 验证；`node:sqlite` 在 Node 22 上未复验。
- 宿主适配：全部 fixture-only 或 blocked（未复跑真实宿主 CLI，含 M0 时代验过的 Copilot CLI）。
- 秘密正则只覆盖已知形态；导入层防回环依赖受管标记检测；`better-sqlite3` 与供应链审计仍未做。
- 治理计划在治理性中止后的恢复路径 = 重新 propose 相同 items（确定性去重）——已在文档如实记载。

## 5. 事件与教训

- 并行子代理曾触发用户并发上限（一次派发失败，重派解决）；秘密扫描子代理回合耗尽未产出文件，由主会话直接实现。
- 主会话在清理用户主目录 stray 安装副本时误删了 `C:\Users\Carlos\package.json` 与 `package-lock.json`（该目录 node_modules 还含有与本产品无关的既有包）。已生成 `C:\Users\Carlos\package.json.recovered.json` 供核对重建；此为本次会话的操作事故，已如实记录。
- Windows 文件关联导致直接运行 .ts/.js 弹"选择打开方式"——已用启动器与文档修正（用户反馈驱动）。

## 6. 新会话如何继续

1. 审阅本文件与 `openspec/changes/add-local-first-memory-mvp/tasks.md` 的验证记录。
2. 决定是否 `/opsx:verify` + archive 该变更（前提：接受第 4 节边界）。
3. 真实云端同步、跨平台 CI、宿主实机验证分别另立变更提案。
