# AI Memory：M0 会话交接与实施入口

日期：2026-10-24  
项目目录：`D:\Project\AI MemoryGLM`（2026-10-24 原文写为 AI Memory，迁移后为 AI MemoryGLM）  
当前阶段：本文 §1–§5 为 2026-10-24 的规划原文，保留不改；实际进展见文末「追加」各节——两个 OpenSpec 变更均已实现并归档（2026-10-25），2026-10-28 完成宿主 MCP 接入自检。

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

关键安全断言（负向均有覆盖）：伪造 `user_confirmed` 拒绝；批准后计划篡改/目标推进拒绝；已应用计划的审批重放幂等短路（alreadyApplied，不消耗审批）；未应用计划的重放拒绝（E_APPROVAL_REPLAY）；local_only 上行任务物理排除（触发器兜底）；秘密不进日志/DB/导出（masked 摘要）；设备克隆暂停写入。

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
2. ~~决定是否 archive~~（已于 2026-10-25 归档；注意 §7 的遗留缺陷修复晚于归档）。
3. 真实云端同步、跨平台 CI、宿主实机验证分别另立变更提案。


# 2026-10-25 追加（二）：第二轮验证与遗留缺陷修复

## 1. 第二轮独立验证结论（docs/verify-add-local-first-memory-mvp-round2-2026-10-25.md）

- 第一轮 3 个 P1 中：包入口、打包卫生彻底修好；MCP 测试竞态修好。
- **新发现产品缺陷**：多进程同时冷启动同一新库，部分进程在 `openStore` 的 meta/device 写入抛 `SQLITE_READONLY(8)`（约 10–20% 失败率）。根因：`CairnDb.open` 的 `PRAGMA journal_mode = WAL` 与他方建库/加锁交错后连接进入只读状态，`busy_timeout` 不吸收 READONLY。
- 3 处归档后文档错误（README/config.yaml/handoff 写"尚未 archive"）+ 归档时机过早（修复提交 39 秒后即归档、无稳定性复跑）。

## 2. 修复（本轮）

1. `CairnDb.open`：打开 + journal_mode 校验（必须返回 wal）整体有界重试（5 次，50–250ms），对 SQLITE_READONLY(8)/BUSY(5)/LOCKED(6) 重开连接。
2. `openStore`：open → migrations → meta → device 序列整体纳入同一重试（关闭连接重开）。
3. 确定性回归测试 `tests/store/cold-start.test.ts`：独立子进程持未提交写事务 1.2s，父进程 openStore 必须经重试成功并可写入（父线程同步阻塞时 setTimeout 无法触发，故持锁必须在子进程）。
4. 文档三处修正 + 本节说明。

## 3. 复验结果

- 冷启动回归 4/4；concurrency.test.ts 单文件 6/6；全量 npm test 连续 5 轮全绿（见 git 记录）。
- Node 22.22.2 已纳入验证（两轮独立验证均在 22 上执行）。


# 2026-10-25 追加（三）：真实云同步变更 add-real-cloud-sync 完成并验证

## 1. 一句话结论

OpenSpec 变更 `add-real-cloud-sync`（capability: cloud-sync）已实现并在用户真实环境完成验证：华为云 OBS 双设备同步 8 步 PASSED（含密文审计证明 local_only 物理未上行）、阿里云 ECS syncd 部署完成且 Windows↔Linux 跨平台双向同步 PASSED、密钥丢失场景 PASSED。全量测试 385 项绿（1 项真实云端用例按凭据门控跳过）。变更尚未 archive。

## 2. 交付内容

- OBS v2 签名客户端（对照官方 SDK 规则核实，中文 key URL 编码坑已锁进测试）；E2EE（@noble/ciphers XChaCha20-Poly1305，AAD 绑定，HKDF 空间密钥，恢复材料导出/导入）。
- chunk/manifest 协议：内容寻址不可变 chunk、manifest 单写者 headSeq 防回退、先 chunk 后 manifest、断点续拉游标。
- 拉取合并：内容哈希血统对齐跨设备记忆身份（本地 id 不可跨设备引用——真实环境暴露的核心修正）、幂等应用、等待依赖、冲突保留、遗忘传播。
- worker sync_upstream 真实实现 + `cairn vault init-remote/import-key/status/export-key`、`cairn sync push/pull`；doctor remote 三态。
- ECS syncd（零依赖单文件，Bearer + 代次 CAS + 防穿越，仅绑 Tailscale 接口），systemd 部署。
- 文档：docs/cairn-sync.md；验收证据：artifacts/cloud-sync-2026-10-25/（不入库）。

## 3. 真实环境验证记录

| 验证 | 结果 |
|---|---|
| 真实 OBS 往返（selftest 对象） | PASSED |
| 真实 OBS 双设备 8 步（含密文审计证明 local_only 未上行） | PASSED（real-obs-two-device-verification.json） |
| ECS syncd 部署 + 本机↔ECS 契约 | PASSED |
| 跨平台 Windows↔Linux 双向同步（3 条记忆互通） | PASSED |
| 密钥丢失 pull | PASSED（E_VALIDATION 明确报错，不半还原） |
| doctor 诚实分级 | PASSED（无凭据环境如实 configured_untested） |

## 4. 边界与已知项

- 首版仅同步 personal-global 空间；项目/自定义空间同步属后续。
- syncd 单用户单 vault、无 TLS（只绑内网/Tailscale）；数据目录备份责任在运维。
- ECS 自连 Tailscale IP 每请求有秒级开销（文档建议回环/内网直连）。
- ECS 上曾修复 DNS（/etc/systemd/resolved.conf.d/cairn-verify-dns.conf，可逆）；OBS 主账号 AK/SK 经环境变量注入，建议后续换 IAM 子用户。
- 全量测试曾出现的并发冷启动失败已在归档后修复（见追加二），本轮 5 连续全绿基线成立。


# 2026-10-25 追加（四）：第三轮云同步验证问题修复

第三轮独立验证（docs/verify-cloud-sync-2026-10-25.md）确认主线成立（冷启动修复有效、真实 OBS/syncd 可用），但发现 2 个 P1 + 1 个 P2 + 1 组 P3，全部已修复并复验：

1. **P1 syncd 无 vault 隔离**：第二 vault 的存在会让 pull 整链 auth_tag_invalid。修复：vaults/<vaultId>/ 键前缀（与 OBS 对齐）+ pull 对外来/不可解密对象降级跳过并审计。现场复现验证通过（ECS 上双 vault 并存，vault1 同步不受影响、新事件照常流通）。
2. **P1 泄漏审计恒真**：chunk 明文是 gzip(JSON)，不解压直接搜金丝雀必然搜不到。修复：审计解压后比对 + 反向注入对照用例（故意注入必须被检出）。
3. **P2 代次 CAS 对真实密文失效**：服务器 JSON.parse 密文恒抛导致 CAS 形同虚设。修复：代次旁路 .gen 文件；二进制 body 回归锁定 409。
4. **P3**：--help/README/AGENTS/cairn-sync.md 对齐；OBS 桶清理 12 个遗留验证对象，验证脚本增加收尾 purge（桶 cairn/ 现已清空）；ECS 按新布局重新部署。

测试基线：388 项（新增 3 项第三轮回归）连续 3 轮全绿。syncd 键布局含 vaults/ 段为**破坏性变更**，旧验证数据已清空重建。变更仍未 archive，建议第四轮复核后再归档。


# 2026-10-25 追加（五）：add-real-cloud-sync 归档

第四轮归档门禁（docs/verify-cloud-sync-round4-2026-10-25.md，自验性质已注明）：全量测试连续 5 轮 388/0/1 全绿；专项回归（双 vault 隔离、密文 CAS、泄漏审计反对照、冷启动）3 轮全绿；ECS syncd 健康；OBS cairn/ 前缀无遗留。`add-real-cloud-sync` 已归档为 `archive/2026-10-25-add-real-cloud-sync`，cloud-sync 规格落入 `openspec/specs/`（6 份规格 strict 校验全过）。

归档时已知边界（未消失）：仅同步 personal-global 空间；macOS 未验证；syncd `vaults/` 键布局为破坏性变更（旧部署需清目录重建 vault）；第四轮为修复会话自验，独立性弱于前三轮外部复核。

仓库状态：main 分支干净，全部推送至 CarlosWonMore/cairn（私有）。

# 2026-10-28 追加（六）：宿主 MCP 接入自检与假绿脚本修复

背景：ZCode 会话积分耗尽中断在「真实 HOME 冒烟」这一步，代码零改动、结论零记录。本轮由 WorkBuddy 独立接续复核，报告见 `docs/verify-host-mcp-2026-10-28.md`。

结论：MCP 接入本身可用——8 工具全链路 12 项断言全过（add→search→get→context→status→update→propose 只落 candidate→forget 墓碑且检索归零），全量测试 389/389 连续 2 轮全绿（Node 22.22.2），`cairn-mcp.cmd` 真实入口 initialize 正常。

修掉的证据缺陷：中断会话留下的 `scripts/mcp-smoke.mjs` 是假绿——按 `body.results` 取值（真实字段是 `items`）必然抛错，而 `finally` 里 `process.exit(0)` 把异常和退出码一起吞掉，表现恒为「零输出 + 退出码 0」。已重写：默认只读真实库、按真实字段取值、退出码分级 0/1/2、`--write` 必须显式 `--home`（写真实库另需 `--allow-real-write`）、新增 `npm run mcp:smoke`。另补 `tests/interfaces/mcp-roundtrip.test.ts`，锁定修订留痕（更正后保留 2 条修订）、墓碑含 reason、遗忘后检索归零，并显式断言 `memory_search` 不再出现 `results` 别名。

待决（未改）：
- `npm test` 现在会真实访问 OBS（凭据在用户环境变量里，门控用例从 skip 变执行，总数 388→389）。若要保持纯本地可复现，建议改为显式开关 `CAIRN_TEST_REAL_OBS=1`，而非仅凭环境变量存在与否。
- `memory_propose` 收单个 `{content,kind}`，`onboarding_propose` 收 `items[]`，误用报错为「content 不能为空」，易误判为产品 bug。
- 宿主注册仍 `blocked`（WorkBuddy 只有 UI 自定义连接器，无公开配置路径），需用户手动或显式授权。
- 真实库 `~/.cairn` 保留 1 条 active 记忆与 1 条 pending outbox（未配置远端，不上行）——用户确认保留。

下一入口候选（需用户决定）：macOS 平台 CI；项目/自定义空间云同步扩展；`npm test` 与真实云端解耦；公开发布准备（private→public、发包、`@cairn/memory` 包名核查）。

仓库状态：本轮新增冒烟脚本、1 项回归用例与验证报告，已提交为 2 个本地提交（`fix(mcp):` 与 `docs:`），**尚未推送**，等用户确认后再 push。

# 2026-10-28 追加（七）：测试与云端解耦、宿主 MCP 注册、推送补完

用户本轮决定：① 由我直接写入宿主 MCP 配置，用户自行点信任；② 同意把 npm test 与真实云端解耦；③ macOS 暂不验证；④ 复测推送。

**1) 推送补完（上一轮判断有误）**

上一轮判定「GitHub 连接被重置、推不上去」是误判。`git ls-remote` 与 `git push` 均正常，三个本地提交已推送，`main` 已建立 upstream（`6bad7cd..5a28554`）。当时失败的真实原因是 `2>/dev/null` 丢掉了 stderr、且分支没有 upstream 引用，不是网络问题。

**2) 宿主 MCP 注册已完成**

在 `~/.workbuddy/mcp.json` 的 `mcpServers` 下新增 `cairn` 条目（`command: node`，`args: ["D:/Project/AI MemoryGLM/dist/src/interfaces/mcp/server.js"]`），原有 `jira` / `agentctl` 未改动。按该配置原样拉起实测：initialize 成功（cairn 0.1.0）、`tools/list` 返回 8 个工具、`memory_status` 只读调用正常、stdout 无非 JSON 行。

注意两点：一是该配置指向 `dist/`，改动 `src/` 后必须 `npm run build` 才对新会话生效；二是信任状态需用户在连接器 UI 点击确认后才激活。

**3) npm test 与真实云端解耦**

`tests/sync/obs-store.test.ts` 的真实云端用例改为**显式开关** `CAIRN_TEST_REAL_OBS=1`。原实现只要机器上存在 `OBS_*` 凭据就自动联网，后果是同一份代码在不同机器上跑出 389 与 390 两个数、网络抖动会被伪装成测试失败。

新增 `npm run test:real`（`scripts/test-real-obs.mjs`）：在子进程内设置开关再 spawn，绕开 Windows cmd.exe 不识别 `VAR=value` 前缀的问题；五个 `OBS_*` 缺任一即 exit 2 并明确报出缺哪几个，不静默 skip。

实测三种情况：

| 命令 | 条件 | 结果 |
|---|---|---|
| `npm test` | 默认（不联网） | 390 项 / 389 通过 / 0 失败 / **1 skip** |
| `npm run test:real` | `OBS_*` 齐全 | 47/47 通过 / 0 skip（真实 OBS 往返约 4s） |
| `npm run test:real` | 缺凭据 | exit 2，明确列出缺失变量 |

**剩余边界**

- macOS 平台未验证（用户本轮明确暂缓）。
- **宿主端到端闭环已完成（2026-10-28 18:46）**：宿主会话直接经 MCP 调用 `memory_add` 落库一条 `instruction`（id `01a1821e-a66b-7458-b5b2-34040057d8f5`，scope `personal-global`，authority `user_explicit`），`memory_get` 读回完整内容与 1 条 revision、`memory_search` 由 fts 命中、`active` 计数 1→2。说明信任已生效、stdio 通道可用，不再是待办。
- `npm test` 从此恒为 389 通过 / 1 skip，README 已按此对齐。

仓库状态：第七轮改动（README、handoff、AGENTS、`obs-store.test.ts` 门控、`package.json`、`scripts/test-real-obs.mjs`）已提交并推送至 `origin/main`（`2323ae6`）。推送曾因 git 未走本机 `127.0.0.1:7890` 代理而间歇超时，用 `git -c http.proxy=... push` 解决，未改全局配置。

# 2026-10-28 追加（八）：WorkBuddy/CodeBuddy 记忆导入与工作台提案

**1) 导入完成（用户授权范围：用户级 4 份 + 江南大学 47 份）**

共 51 份、全部落在 `imported_unverified + local_only`，源文件零改动（8 份待定文件的 sha256 导入前后逐个 `sha256sum -c` 全 OK）。库终态：`import_archive` 51、`import_item` 533（clean 488 / blocked 45）、`memories` active 2 / candidate 0、`outbox` pending 2、`doctor` 报 `ok:true`（integrity ok、FK 违例 0、FTS5 ok）。导入前备份 `~/.cairn/backups/cairn-pre-import8-20261028-194407.db`。

两点实测结论：

- `cairn import` 输出的 `itemCount` 是净落库条数，`skippedItems` 就是被判 blocked 的数量；剩余 8 份的 237/26 与事先用临时库试导的预估数字逐项吻合，说明导入是确定性的。
- batch 粒度是**每文件一批**（51 文件 = 51 批）。`onboarding status` 不带 `--batch` 只显示 `activeBatchId()` 一个批次（当前显示 total 7，那是 `reference_teamai_mcp_reconcile_drift.md`），不是数据丢失。CLI 缺"列出全部批次"的入口，这是本轮提案的直接动因之一。

**2) 新变更 `add-memory-workbench`（已 propose，未 apply）**

用户要求：命令行发起，静态页或 webui 皆可；预览页只读；工作台要能看层级/状态/快照/批次/审批、能操作审批、突出待处理并给处理建议、能触发同步；风格参考本机 Archify。

第二轮修订按用户五点意见收敛：端口不固定（默认 7767，占用即换）；Archify 已安装故改用其真实 token；建议改为「规则层打底 + AI 层叠加」；静态导出默认输出完整记忆正文；页面支持检索状态恢复与摘要/全文切换。

产物（5 个 spec、28 tasks，`openspec validate` 与 `--strict` 均通过）：

- `proposal.md`：定位为薄壳视图层，不新增治理语义；非目标排除"网页改/删记忆"与远程访问。
- `design.md`：D1 双形态共用装配层、D2 零新增依赖、D3 API 契约（21 端点，全部映射既有 `AppService`）、D4 双层建议、D5 审批通道参数化、D6 安全边界、D7 视觉系统（Archify 真实 token）、D8 静态导出完整正文、D9 只读并发、D10 可恢复视图状态。
- `specs/local-console/spec.md`：新能力，13 条 Requirement。
- `specs/memory-review/spec.md`：新能力，6 条 Requirement（来源可追溯、人工发起、整批校验、无执行权、分歧不自动裁决、陈旧失效）。
- `specs/agent-interfaces/spec.md`、`specs/memory-governance/spec.md`：两个 delta。

设计取向上有三处明确取舍：**AI 判断只能在 Agent 会话内产生**（控制台不持凭据、不外发记忆，复核包 → 会话 → 写回闭环）；**不提供记忆正文编辑与删除接口**（避免把"能开网页"变成"能改历史"）；**不新增数据库表**（AI 建议落 `~/.cairn/console/`，否则 `user_version` 推到 3 会让旧版 cairn 拒绝打开、回滚从"删目录"变成"恢复备份"）。

**3) Archify 参考的来源**

用户于 22:15 安装，`~/.workbuddy/skills/archify` 是指向 `D:/DevelopEnvironment/skills/archify` 的符号链接（首轮排查时尚未安装，故当时判定"未检出"）。色值直接取自其 `assets/template.html` 的 `[data-theme]` 块（第 173–257 行）：7 类箭头色（cyan/emerald/violet/amber/rose/orange/slate）+ 双主题面板色，一一映射为 cairn 的语义色（amber=待处理、emerald=健康、violet=待审、cyan=层级、rose=敏感、orange=同步、slate=次要）。字体沿用其系统栈，但不内嵌 JetBrains Mono，省体积给正文。

下一入口：等用户审阅提案 → `/opsx:apply add-memory-workbench`。四个待决项已由用户定：端口不固定、Archify 用已装版本、建议采用双层叠加、导出含完整正文。

# 2026-10-29 追加（九）：`add-memory-workbench` 实施完成

用户拍板「默认包含；继续推进」后从 `tasks.md` 1.1 起实施完毕：**28 项中 24 项完成**，剩 7.1–7.4 四件收尾（7.1/7.3/7.4 本轮已实跑，见下）。`npm test` 三连跑全绿：510 项 / 509 通过 / 0 失败 / 1 显式 skip；`npm run typecheck` 干净；`npm pack --dry-run` 202 文件 / 281.2 kB（解包 1.1 MB）。

**1) 代码落点**

- `src/interfaces/console/`：`model.ts`（只读装配）、`security.ts`（令牌/Host/Origin/掩码）、`server.ts`（21 端点 + `normalizeProposedItems`）、`suggestions.ts`（8 条规则 + inbox）、`review-store.ts`（复核包/写回/陈旧）、`export.ts`（单文件导出）、`assets/{page,ui-css,ui-js,url-state,text}.ts`。
- CLI：`cairn ui [--port N] [--no-open] [--json] [--export <file>] [--redact]`、`cairn review pack|submit|list`。
- MCP：新增 `memory_review`（`action: pack|submit|list`），与 CLI 共用 `review-store` 同一实现与校验。
- `AppService.approve(planId, { channel })`：审计 action 参数化为 `issued_via_<channel>`，默认 `cli`（回归安全）。

**2) 测试增量（新增 13 个文件、120 项：基线 390 → 510）**

`tests/console/{model,security,server,suggestions,review-store,export,assets,url-state,render,workbench,cli-ui}.test.ts` 与 `tests/interfaces/{approval-channel,review-cli}.test.ts`。其中 server（18 项）、cli-ui（8 项）、workbench（7 项）、review-cli（4 项）走真实进程/真实 HTTP，不用桩。

**3) 实施期发现并修掉的真问题**

- **写服务句柄悬空**：`getWriter()` 缓存的 `AppService` 在每请求 `finally` 里被 close，第二次写操作命中已关闭的库（`database is not open` → 500）。改为常驻到服务关闭；test 13 覆盖。
- **UI 草稿与计划层字段不匹配**：页面提交 `opType`（promote/merge/keep_both/skip）与 `content: null`，而 `ProposeItem` 要 `opHint` + `content`，直接提交会被整批判空。新增 `normalizeProposedItems()`：动作词表映射 + 按 `itemId` 从 `import_item` 回填权威正文（页面因此不必回传正文，摘要模式下也没得回传）。
- **URL 状态双实现**：`readUrl/writeUrl` 原本内联在 42KB 脚本里无法测。抽出 `assets/url-state.ts`（`URL_STATE_SRC` 源码字符串，页面原样嵌入，测试实例化同一字符串），9 项断言覆盖往返/默认视图/mode 优先级/中文与 `__proto__` 注入。
- **S-NUMERIC-CONFLICT 永不命中**（轮次内已修）：冲突判定必须早于近似重复，否则数值不同但 trigram ≥0.8 的条目会被判成 merge。
- 前端补 `data-action="mode"`（控件与快捷键共用 `toggleMode` 的机械标识）。

**4) 真实库只读冒烟（任务 7.3）**

`node scripts/smoke-console.mjs`：对 `~/.cairn` 起 `cairn ui --port 0 --no-open`，打 10 个只读端点 + 两个负向用例（无令牌→401、`GET /api/sync/push`→404），前后对 `cairn.db` 做字节级 sha256 与 9 张表行数比对。结论 **PASS**：sha256 前后一致（`9266cde6e359e339…`），零表变化，端点全 200。报告 `artifacts/console-smoke-2026-10-28.json`（不入库）。全程未发任何 POST、未生成复核包、未导出明文产物。

**5) 两条必须留档的事实**

- **blocked 条目原文物理不可得**：`import.ts` 在入库前就把被判拦截的正文替换成 `[blocked:<kind>]`，原文从未写库。因此「导出含 blocked 正文」在当前数据模型下无法实现——不是开关问题。预览页如实标注"原文未入库"，`--redact` 只是附加掩码。用户要求"默认包含"已在能包含的范围内落实（记忆含 sensitive 默认全量输出、`--redact` 为唯一反向开关、取消 `--include-blocked` 以免组合歧义）。
- **真实库 45 条 blocked 中 42 条是 `exfiltrate_all_memories` 正则误报**（另有 2 条 `escalate_scope`、1 条 `fake_approval`），无一条是真实秘密；误报来源是中文叙述里"导出……全部记忆"这类邻近匹配。修它会改动既有扫描器行为与 45 条既有数据的语义，属独立变更，**未在本轮动手**，待用户决定。

**6) 两处既有行为（本轮未改，但要说清）**

- `applyPlan` 对 `plan.status==='applied'` 直接返回 `alreadyApplied: true` 的空报告（幂等重试语义），不是报错。workbench 测试按此断言"不得产生新副作用、记忆不得复制成两条"。
- 计划哈希绑定只比对 `approval.plan_hash` 与 `plan.plan_hash` 两处存量值，不重算 `plan_operation`；签发后手工改库不会被识别为篡改。改它动治理层，属独立变更。

下一入口：用户决定是否（a）归档 `add-memory-workbench`（先补 7.2 收尾核对）、（b）修 `exfiltrate_all_memories` 误报的正则、（c）统一 `plan_operation` 重算校验。

# 2026-10-29 追加（十）：`add-memory-workbench` 归档 + `add-auto-onboarding` 立提案

用户对上一轮评估的拍板是三点：先归档再开新变更、自动应用走策略预授权、重复导入界面去重且「处理完成归档后只有一条」。本轮完成归档并立了新提案，**代码未改动**。

**1) 归档结果**

`add-memory-workbench` 按 OpenSpec 归档流程走完：`status` 显示 4/4 制品 `done`、`list` 显示 28/28 tasks、delta 与主规格先同步再移动。

- 同步后主规格：`agent-interfaces` 6→7（新增「本地控制台入口」）、`memory-governance` 6 条不变（「计划绑定真实审批」整块替换，补入浏览器通道与缺少有效审批两个场景）、`local-console` 0→13（新建）、`memory-review` 0→6（新建）。
- `openspec validate --specs --strict` 8/8 通过；`validate --all --strict` 同步通过。
- 变更移至 `openspec/changes/archive/2026-10-29-add-memory-workbench/`，`openspec/changes/` 下已无 active change（立提案前）。
- 归档前核对：`npm test` 510/509/0/1 三连绿、`tsc --noEmit` 干净、`npm pack --dry-run` 202 文件 281.2 kB、真实库只读冒烟 PASS。

**2) 归档时补做的真实库实测（本轮新增证据）**

对 `~/.cairn` 只读查询得到四组此前没有的数字：

- **533 条里只有 329 条是实质正文（127,332 字）**；其余 204 条为结构残片 143（frontmatter/标题/`---`，其中 `---` 单独成条 18 次）、blocked 占位符 45（**42 份是同一个字符串** `[blocked:exfiltrate_all_memories]`）、碎片 3、加粗小标题 13。长度分布：1–50 字 139 条、51–200 字 157 条、201–800 字 205 条、801–2000 字 31 条、2000+ 1 条。
- **规则引擎对全库跑完只要 74 ms**，结果 `promote 342 / skip 191 / needs_human 0 / merge 0`。342 条 promote **全部来自兜底规则 `S-CLEAN-DEFAULT`、置信度一律 medium**，即规则层没有给出判断，只是没话可说时的默认值。因此「补规则就能自动处理」不成立——补规则最多再砍 13 条（2%）。
- **重复量**：51 个档案只有 49 个不重复来源（`codebuddy:MEMORY.md` 导了 3 次，合计 64,924 B）；跨档案正文完全重复 23 组、冗余 79 条；与已有 4 条记忆正文重复 0 条。
- **晋升路径没有按内容查重**：`memory` 表无内容唯一约束，`apply` 的 `add` 分支直接 `memories.add()`，插入前不查同作用域是否已有相同正文。这意味着同一段正文从多个快照分别晋升会变成多条 active 记忆——用户要求的「只有一条」当前不成立。

**3) 新提案 `add-auto-onboarding` 的范围**

三个 capability delta：

- `auto-onboarding`（新，7 条需求）：策略签发与内容哈希绑定、条件逐条判定、自动应用不改变确定性审批约束、结果可撤销、例外集中上报、AI 层分派回收、不在会话关键路径运行。
- `memory-governance`（ADDED 1 条）：「内容重复不产生重复记忆」——生成时合并同哈希条目、应用时 `add` 前查重。
- `local-console`（MODIFIED 1 条 + ADDED 4 条）：批次进度行并入快照信息、抽屉式详情、抽屉内批量处理、来源折叠、自动整理结果呈现。

**4) 四个关键设计决策（详见 `design.md`）**

- **策略怎么签**：复用 `approved_by='local_cli'` + `channel='policy:<id>:<hash8>'`。`approval.approved_by` 有 CHECK 枚举，SQLite 加枚举值要重建表；而 `channel` 是自由 TEXT，天然能承载策略标识。配套三条约束：签发路径唯一（只有 `policyAutoApply()` 能写 `policy:` 前缀）、审计强制带 `policyHash`、负向用例验证伪造 channel 被拒。
- **去重放两处**：生成时合并解决「一次计划内重复」，应用时查重解决「跨计划重复 + 重试幂等」。只做一处都达不到用户要的结果。
- **不用唯一索引**：`UNIQUE(scope_id, normalized_content) WHERE status='active'` 会与 `keep_both` 直接冲突（用户显式要求两条矛盾并存时可能同内容），历史修订也会让 normalized_content 在 active/superseded 间交错。改为非唯一索引 `memory_scope_content` 加速，判定留代码里。
- **MCP 不能签发策略**：`memory_decide` 只有 `next|submit|auto`，不接受策略内容、不接受 channel 参数。签发只能 `cairn policy sign`（终端）或工作台（回环 + 令牌）。这样"谁能授权自动化"始终在人手里。

**5) 状态**

`openspec validate add-auto-onboarding` 与 `--strict` 均 valid，4/4 制品齐全，38 项 tasks 未开始（`openspec list` 计数）。**按 AGENTS.md 约定，propose 后须用户审阅才 apply，本轮未动任何 `src/`、`tests/`。**

下一入口：等用户审阅提案。审阅通过后从 tasks 1.1 起实施，建议顺序 1（策略层）→ 3（去重）→ 2（自动编排）→ 4（导入视图）→ 5/6（CLI/MCP）→ 7（验收）。

# 2026-10-29 追加（十一）：`add-auto-onboarding` 实施完成

## 1. 一句话结论

43/43 tasks 完成，全量测试 **606 项 / 605 通过 / 0 失败 / 1 显式 skip**，只读冒烟 18 个端点全绿且数据目录字节级 sha256 前后一致。产品上多了三件东西：**写入时判断**（Agent 在场时顺手给结论）、**策略预授权**（一份能核对哈希的授权，决定"哪些能自动过"）、**导入工作台**（一条来源一次导入一行的单表 + 抽屉 + 撤销入口）。

## 2. 两处方案在实施中被改掉

### 2.1 「AI 判断」从"事后分派"改成"写入时优先"（用户提出）

原方案把 AI 判断放在"打包 → 判断 → 回收"里。用户 2026-10-29 指出：WorkBuddy 这类 Agent 的记忆本来就是 Agent 自己在管，**判断应该在写入那一刻就做完**，而不是事后单看一段脱了上下文的文本。这一点成立，方案据此改写：

- 写入时（`memory_add` / `cairn add` 带 `judgement`）与存量导入（`memory_decide` 三步闭环）**共享同一套判定与落库路径**；
- 落成 design 的 **D10 权力边界表**：`judgement` 只影响"这条值不值得记"，不能改敏感度、不能扩作用域、不构成审批凭证；
- spec 增加 6 个 Scenario，其中「两个通道结论冲突」专门钉住"后写的不覆盖先写的"。

### 2.2 「撤销」的语义（实施中撞出来的）

原计划里撤销只是"转 tombstone"。测试暴露出两个真问题：

1. **撤销后重新整理拿不到建议**。`computeSuggestions` 按"存在 `item_promoted` 审计"过滤已处理条目，撤销不抵消这条审计，于是重新整理时规则层一律返回 `needs_human`，`applied=0`——重做变成空转。
   → 修法不是放宽撤销，而是给 `computeSuggestions` 加 `includePromoted`，**只在 `--redo` 时打开**。只放宽选择不放宽规则层，等于什么都没做。
2. **撤销必须"粘"**。如果撤销让条目自动回到待整理，一次定时任务或一次续跑就会把用户刚撤销的记忆写回来。所以默认重跑恒定 `applied=0`，重做必须显式 `--redo`（同时放宽选择与规则层两处）。

配套两条实现事实：

- `markItemPromoted` 允许"原目标已被遗忘时改挂到新记忆"并追加审计（旧映射留在历史里）。否则条目会永远卡在"已晋升到一条不存在的记忆"。只认明确的 tombstone：记忆行不存在时宁可报冲突，不猜。
- `revoked` 审计补 `batchIds` 数组。整策略撤销时 `batchId=null`，不记 `batchIds` 的话界面与排查都无法把撤销挂回某个批次，表现为"撤了但看不出撤过"。

## 3. 「已晋升」谓词曾经写在 6 个地方

`EXISTS (… item_promoted …)` 这个子句在 `batches.ts` / `auto.ts` / `app-service.ts` / `review-store.ts` / `model.ts` / `suggestions.ts` / `server.ts` 里各写了一份。撤销语义就是在其中一处漏掉的——**同一判定写 N 份，改的时候一定漏**。

现在只有一处：`src/onboarding/batches.ts` 的 `promotedPredicate(alias)`，其余 6 处全部改调它（`model.ts` 用 `%ALIAS%` 占位符）。这条已写进 AGENTS.md，别再手写。

顺带修掉一个静默降级：`auto.ts` 生成 merge op 时用 `findDuplicate(content)` 取目标，而规则层的 merge 建议针对"语义近似但正文不同"的条目——按正文查重根本查不到，结果 merge 被静默降级成 add，多出一条重复记忆。现在取规则层给的 `targetMemoryId`。

## 4. 实施顺序与实际

建议顺序是 1（策略）→ 3（去重）→ 2（编排）→ 4（视图）→ 5/6（CLI/MCP）→ 7（验收）；实际按 **3 → 1 → 2 → 5/6 → 4 → 7** 推进。把去重提到最前是因为它不依赖策略层，且直接对应"同一段正文会变成多条 active 记忆"这个已实测的缺陷。

## 5. 交付清单

**新增源码**：`governance/dedup.ts`、`onboarding/judgement.ts`、`onboarding/policy.ts`、`onboarding/auto.ts`。

**修改**：`app-service.ts`（`addMemory` 接受 `judgement`，四个写分支）、`governance/propose.ts`（写入查重 + 批内 `repeatOf:` 前缀）、`store/schema.ts` + `migrate.ts`（迁移 `003_dedup_v1` 非唯一索引）、`console/model.ts`（`buildImportRows` + `AutoRunView`）、`console/server.ts`（`/api/imports`、`/api/policies`、`/api/onboarding/{auto,revoke}`）、`console/assets/{ui-js,ui-css,url-state}.ts`（单表 + 抽屉 + 折叠 + 批量 + 地址字段）、`cli/main.ts`（`policy sign|list|show|revoke`、`onboarding auto|revoke`、`--redo`/`--items`）、`mcp/server.ts`（`memory_add.judgement`、`memory_decide`）。

**新增测试**：`judgement`(19) / `dedup`(10) / `write-judgement`(10) / `policy`(14) / `auto`(13) / `policy-cli`(11) / `decide-mcp`(5)，加 console 侧 imports/抽屉/地址往返/端点 共 22 项。测试从 510 → 606。

**文档**：新增 `docs/cairn-auto-onboarding.md`（策略字段 / 条件顺序与理由 / 撤销路径 / `judgement` 权力边界 / 出错对照表）。

## 6. 状态与下一步

- `openspec/changes/add-auto-onboarding/`：**43/43 tasks 打勾**，4/4 制品齐全，`validate` 与 `--strict` 均 valid。
- 只读冒烟：`node scripts/smoke-console.mjs` → `verdict PASS`，18 端点全 ok，`bytesIdentical true`，`changedTables []`（报告在 `artifacts/console-smoke-2026-10-29.json`，不入库）。
- 合成 HOME 端到端（新增 `npm run test:e2e` → `scripts/e2e-onboarding.mjs`，`verdict PASS`）：

  | 项 | 实测 |
  | --- | --- |
  | 灌入 | 533 条 / 63,049 B（143 结构残片、45 blocked、23 组重复共 79 条） |
  | 导入后 | total 533 / clean 488 / blocked 45 |
  | dry-run | auto 488、manual 45、applied 0、balanced true |
  | 正式跑 | applied 336、skipped 152、**failed 0**、balanced true |
  | 人工队列 | 45（两位数） |
  | 收敛 | 336 条 active 对应 336 个不同正文，`maxPerContent = 1` |

  这张表回答了归档前悬着的那个问题：**"重复正文会变成多条 active 记忆"确实被修掉了**，而且人工队列从 533 降到 45。
- 未做：浏览器端点击级验证（抽屉/折叠/批量只有源码级断言 + 真服务接口冒烟 + 端到端脚本；没有 jsdom，也不值得为此引一个前端测试栈）。**已于 2026-10-30 补上，见第七节。**
- "撤销是粘的、重做必须 `--redo`"这个语义：**用户已于 2026-10-30 确认接受**。

## 7. 2026-10-30 浏览器点击级验收（补上第六节"未做"那一项）

第六节收尾时留了一句"浏览器端点击级验证没做"。这次补上了，并且**一补就连着抓出三个真缺陷**——都是"源码看着对、真点下去不对"的类型，源码级断言看不见。

做法：`scripts/e2e-console-ui.mjs`（`npm run test:ui`），Playwright 驱动**系统已装的 Chrome**（`channel: 'chrome'`，不下载 Chromium），临时 HOME 里造"同路径导两次 + 自动整理"的场景，跑完自删。playwright 作为一次性依赖 `npm i --no-save --no-package-lock`，**故意不写进 package.json**；缺它时脚本 exit 2 并打印安装命令，不静默跳过。

### 抓到的三个缺陷

| 缺陷 | 症状 | 根因 | 修法 |
| --- | --- | --- | --- |
| 摘令牌时清掉整个 query | 分享出去的链接打开永远回到概览；`&drawer=` 打不开抽屉 | 页面拿到 `?t=` 后执行 `history.replaceState(null,'',location.pathname)`，把 `view`/`drawer`/`q` 一起抹了 | 只 `keep.delete('t')`，其余参数原样写回 |
| 切视图不关抽屉 | 抽屉里"确认生成计划"跳审批后整页点不动，后续任何点击都超时 | 抽屉是整页遮罩，`go()` 只改 `state.view` 不 `closeDrawer()` | `go()` 里切视图先清 `drawer`/`item` 再 `closeDrawer()` |
| 策略下拉不记选择 | 预演完直接点真跑，只得到"先选一个策略"，像是按钮坏了 | 预演后 `load()` 重建整块 `autoBar`，`select` 选中值没存进 state | 加 `state.policy`，`change` 时写回、重建时恢复 |

前两个是**功能坏了**（分享失效、界面锁死），第三个是**流程断了**（预演→真跑这条最自然的路径走不通）。三个都留了形状断言在 `tests/console/assets.test.ts`，以后重构退化会直接红。

### 覆盖范围（46 项，全通过）

- 无令牌访问 `/api/status` → 401
- 导航只剩 5 个视图，`snapshots`/`batches`/`inbox` 已不存在
- 同源折叠：`details` 初始 `open=false`、历史行**不可见**；展开后可见（要断言可见性，历史行一直在 DOM 里，数行数没意义）
- 抽屉：`role=dialog` + `aria-modal` + `aria-label`；打开后焦点落在「关闭」上；`Esc`/遮罩/按钮三入口都能关；`Esc` 关完焦点**还回「查看」按钮**；关闭后地址不再带 `drawer`
- 带 `drawer=` 刷新能自动还原抽屉（这条以前是坏的）
- 批量面板：先摊开「确认生成计划（5 项）」与动作分布，**不直接执行**；无人判断时不出现"需人判断 0（不纳入）"这种噪音；确认后跳审批、抽屉已收、地址不带旧 `drawer`
- 自动整理：只列已签发策略、页面无签发入口、「只预演」真的零写入（`应用 0`）、真跑后出现「按策略撤销」、撤销前确认文案说明"转墓碑"、取消确认不执行
- 静态预览页（`ui --export`）：文件名带 `-personal` 后缀、无「自动整理」与「按策略撤销」、能看单表、点「查看」仍能开抽屉、无脚本异常
- 工作台全程零脚本错误

### 验收数字

- `npm test`：**609 项 / 608 通过 / 0 失败 / 1 skip**（从 606 涨到 609：三条形状断言）
- `npm run test:ui`：46/46，报告 `artifacts/console-ui-2026-10-30.json`
- `openspec validate add-auto-onboarding --strict`：valid；tasks 43/43 + 追加 8.1–8.5

### 仍然没做的

- 没有 Firefox/Safari 覆盖，只验证了 Chrome（`role`/`aria` 与焦点行为是标准 API，风险不高但没测）。
- 没做视觉回归（像素比对），版式改动不会报警。

### 收尾结论（2026-10-30）

两件悬着的事都定了：

1. **"撤销是粘的、重做必须 `--redo`"——用户确认接受。** 理由站得住：撤销表达的是"这条不该被记住"，而下一次定时任务或续跑并不知道这个意图；若普通重跑也能重做，撤销就只生效到下一次调度。粘住 + 显式重做，把决定权留在人手里。
2. **改动已推送。** 4 个 commit 按关注点拆分（核心库层 / 接口层 / 控制台 / 脚本与文档），已推到 `origin/main`。

至此 `add-auto-onboarding` 的 43 项任务与追加的 8.1–8.5 全部落地并验证，无待确认项。

## 8. 2026-10-31 归档 `add-auto-onboarding`

变更目录已移到 `openspec/changes/archive/2026-10-31-add-auto-onboarding/`（用 `git mv`，历史保留；`.openspec.yaml` 随目录走）。`openspec list` 现在返回空数组——**仓库没有活动变更了**。

归档前先做了主规格同步（用户选择"先同步再归档"），三个 delta 形态不同，处理方式也不同：

| Delta | 主规格原状态 | 差异 | 同步结果 |
| --- | --- | --- | --- |
| `auto-onboarding` | 不存在 | 8 条全 ADDED | 新建主规格，Purpose 逐字复制，8 条需求 26 个场景 |
| `local-console` | 13 条 | 1 条 MODIFIED + 4 条 ADDED | 「批次进度全局可见」整块改写（并入快照来源/字节数/脱敏状态，加"档案与批次一一对应"场景），追加 4 条 → 17 条 |
| `memory-governance` | 6 条 | 1 条 ADDED | 追加「内容重复不产生重复记忆」→ 7 条 |

两点值得记住：

- **`auto-onboarding` 与既有的 `agent-onboarding` 是两个能力，不是笔误。** 后者管初始化与接管（元数据发现、三类操作独立授权、快照、分批初始化、原生记忆渐进接管、受管入口移除），前者管自动化的许可边界（策略签发、条件判定、可撤销、判断在写入时生效）。名字近，读规格前先分清。
- **`local-console` 那条 MODIFIED 是替换而非补充。** 旧版只要求"列出全部批次"，新版要求把快照来源、字节数、脱敏状态并入同一行，并明确「MUST NOT 把快照与批次拆成两个视图」。不同步就归档的话，主规格会一直描述着一个已经被删掉的三视图界面，下一次写 delta 会以错误基线为准。

验证：

- `openspec validate --specs` 与 `--specs --strict`：9 passed / 0 failed
- `openspec validate --all --strict`：9 passed / 0 failed
- 主规格内无残留 `## ADDED/MODIFIED/REMOVED/RENAMED Requirements` 头
- 逐条机械核对：三个 delta 的 15 条需求、45 个场景全部在主规格中存在

本轮只改 Markdown（主规格 + 三处文档），未触碰 `src/`、`tests/`，因此没有重跑测试；代码基线仍是 609 项 / 608 通过 / 0 失败 / 1 skip。

### 归档后仍未验证的项（不因归档消失）

- 浏览器只在 Chrome 上验证过，Firefox/Safari 未覆盖（`role`/`aria` 与焦点行为是标准 API，但没实测）。
- 没有视觉回归（像素比对），版式改动不会报警。

## 9. 2026-11-01 把 cairn 接进 DSH（第三个宿主）

WorkBuddy（`~/.workbuddy/mcp.json`）与 ZCode（`~/.zcode/cli/config.json`）都是 mcp.json 形态，各加一个 cairn 条目即可。**DSH 不是**——它不吃 `mcp.json`，全盘扫过 `D:\AIAgents_Data\DSH_DATA` 没有任何文件含 `mcpServers` 字样。它的配置是 Cordis 树：profile 根 `cordis.yml` 是空数组，实际条目全在 `D:\AIAgents_Data\DSH_DATA\profiles\desktop\cordis.patch.yml`（注释里明写"编辑它，别改 cordis.yml"的那一层）。

接入形态是一条 insert 式条目，走 DSH 自带的 `@deepseek-ai/dsh-mcp-client`（在 app.asar 里，不是 profile 的依赖）：

```yaml
- insert:
    - id: mcp-cairn
      name: "@deepseek-ai/dsh-mcp-client"
      config:
        serverName: cairn
        transport: stdio
        command: "D:/Program Files/nodejs/node.exe"
        args:
          - "D:/Project/AI MemoryGLM/dist/src/interfaces/mcp/server.js"
        failOnStartupError: false
```

**`insert:` 这层不能省。** 这是我第一次踩的坑，写在这里免得下一个人重犯：`cordis.patch.yml` 的顶层数组是**补丁行**，不是**条目行**。带 `id` 但不带 `insert` 的行，语义是"覆盖/禁用某个已在某 bundle 层里存在的条目"；找不到就丢弃。所以直接把一条新插件写成 `- id: mcp-cairn` 会被静默忽略——日志里只有一行 `[warn] patch: entry "mcp-cairn" not found`，重启一次多一行，看起来像"没生效"，实际上是从没进过配置树。源码位置：asar 内的 patch 应用循环，`if (insert) { data.push(...insert); buildMap(insert); continue }` 在前，`if (!target) { warn('patch: entry %C not found', id); continue }` 在后。

几个决定和理由：

- **command 写绝对路径而不是 `node`。** DSH 从 Electron 里起子进程，PATH 不可依赖；WorkBuddy/ZCode 用 `node` 能跑不代表这里能跑。实测用绝对路径 + 只给 `{ HOME }` 的最小 env、cwd 设为项目目录，同样握手成功。
- **`failOnStartupError: false`。** 默认就是 false，显式写出来是为了表达意图：DSH 的 startup policy 允许可选 MCP 条目失败而不中止整个 harness。设 true 的话，哪天 dist/ 没重新构建、DSH 起不来，排查成本比"少几个工具"高得多。真出问题应该在 stderr/日志里看，不该让宿主开不了机。
- **`serverName: cairn` 决定工具名前缀**，注册后是 `mcp__cairn__memory_search` 这种形状。它必须匹配 `[A-Za-z0-9_-]{1,32}`。

验收（都是真跑，不是看文档推断）：

- YAML 用 **DSH 自己那一份 yaml@2.9.0**（从 app.asar 里按正确偏移解出来的）解析：PARSE_OK，7 个条目 id 无重复，其余六个条目（computer-use-cua-driver-native / dsh-connect-workbuddy / agent-default-model / ui-settings-account / ui-chat / ui-settings）原样未动。顺带一提，asar 里的 offset 是**相对数据区**的，得加上 `8 + headerSize` 才是文件真实偏移——第一次按绝对偏移解出来是 wasm 反汇编代码，差点误判。
- stdio 握手真跑：initialize → `{name:"cairn",version:"0.1.0"}`，tools/list → **14 个工具**（memory_context/search/get/add/propose/update/forget/status、onboarding_status/next_batch/propose/apply、memory_review/decide）。
- 改前备份 `cordis.patch.yml.bak-pre-cairn-20261101`。

### 生效条件（与另两个宿主同一条纪律）

**改 src/ 之后必须 npm run build，新会话才拿得到新代码**——三个宿主都指向 `dist/src/interfaces/mcp/server.js`，配置里没有编译步骤。当前 dist 的 mtime 晚于 src，是新的。

### 2026-11-01 20:35 端到端确认（推翻上一版"尚未验证"的结论）

上一版写完时我说"配置合法 + 服务端握手正常已验证，但 DSH 里能不能调到尚未验证"。**用户重启后一查，发现根本没生效**——就是上面那个漏 `insert:` 的错。修正后 DSH **热加载**（不需要重启）即生效，四条独立证据：

| 证据 | 内容 |
| --- | --- |
| 插件状态 | `plugin.state {"pluginId":"include:mcp-cairn","module":"@deepseek-ai/dsh-mcp-client","previous":0,"state":1}` → `previous:1,state:2`（加载完成） |
| 进程归属 | 新增 `node ... server.js` 的 **ppid = DSH NEXT.exe**（另一个同类进程 ppid 是 ZCode.exe，属既有接入，别混淆） |
| 服务自述 | 日志 `[cairn-mcp] stdio server ready (pid 36568)` |
| 工具可调 | 会话内 14 个 `mcp__cairn__*` 已注册；实调 `memory_status` 返回库统计、`memory_context` 返回 9 条 active 记忆正文 |

教训记一条：**`[warn] patch: entry "X" not found` 是"配置根本没进树"，不是"还没生效"。** 遇到它不要等重启，直接查 patch 行的形态。

### 日常自检

`npm run mcp:smoke`（默认只读真实库；写库须 `--write --home <临时目录>`）。


## 10. 2026-11-01 让「整个 DSH 会话」都走 cairn

§9 解决的是"DSH 能调到 cairn 工具"，这一节解决"每个会话都被要求用它"。两件事不同：前者是能力，后者是指令。

### DSH 的指令是两层叠加，不是二选一

`@deepseek-ai/dsh-agent-instructions`（dsh-base 默认挂载，budget 65536 B）在**每个会话的首个请求**建立一份 baseline，内容是：

1. **user-global 层**：`$DSH_HOME/AGENTS.md`（即 `D:\AIAgents_Data\DSH_DATA\AGENTS.md`），然后是 `$DSH_AGENTS_HOME/AGENTS.md`（默认 `~/.agents/AGENTS.md`）
2. **project 层**：从项目根向下到会话工作目录的每一级 `AGENTS.md` / `CLAUDE.md`，broad→specific

两层是**追加**关系，不是覆盖。所以想让"所有 DSH 会话"都遵循 cairn，正确落点是 user-global 层，而不是去改每个项目。

两个 user-global 位置此前**都不存在**（`~/.agents` 目录在，但只有 skills/ 和空的 mcp.json）。已创建 `$DSH_HOME/AGENTS.md`，写入与 `ROUTER_BLOCK_CONTENT`（`src/agents/config.ts:54`）逐字一致的五条路由文案，并套 cairn 受管块标记（`cairn-router` / revision 1），这样将来 cairn 的卸载逻辑仍能精确移除它。

### 为什么没有用 `cairn agent` 命令

`AGENT_KINDS = ['claude-code','cursor','copilot','openclaw','workbuddy']`（`src/agents/adapters.ts:44`）——**DSH 不在支持列表里**，`cairn agent plan --host dsh` 会直接 E_VALIDATION。所以这条手工复用受管块格式，而不是等产品支持。若将来要给 DSH 加正式适配器，需要：`adapters.ts` 加 kind + 能力矩阵、CLI 接受新 kind、以及 §9 那种 Cordis patch 写入能力（现有 `write_mcp_config` 只处理 `mcpServers` JSON，不处理 Cordis 树）——这是一次真实的产品变更，不是加一行枚举。

### 验收

- 写入后**当前会话立即**收到 `<system-reminder> Additional instructions from: $DSH_HOME/AGENTS.md`，正文与文件一致——这是运行时注入证据，不是"文件存在"的推断。
- 源码确认两层叠加：`userGlobalRoots()` 返回 `['user-global','agents-global']` 两个根，`instructionCandidateGroup()` 把两者归一成同一候选组去重；`USER_GLOBAL_FILE = 'AGENTS.md'`。
- 每会话都会跑：发现逻辑在 baseline 组装时执行，不是一次性热加载。
- 项目 `AGENTS.md` 的 cairn 块仍在（两处并存，各自 revision 1）。

### 一个必须知道的边界

**user-global 层能约束"行为"，不能约束"能力"。** 它让每个 DSH 会话都读到"记忆走 cairn"这条指令，但 cairn 工具本身能否被调用，取决于 §9 那条 Cordis patch 是否加载成功。两者要分别验证——§9 差点被我误判成"已接入"，就是只验了配置、没验加载。

## 11. 2026-11-01 `cairn agent --host dsh` 落地（add-dsh-host-adapter）

§9 与 §10 都是**手工**接入 DSH，改的是用户机器上的文件；本节是把这件事变成产品能力。变更 `add-dsh-host-adapter` 按 OpenSpec 走完 proposal → specs → design → tasks → apply → verify。

### 核心判断：新增一个「配置形态」维度

`HostAdapter` 原来只抽象了「路径 + JSON 顶层键名」，这套抽象表达不了 DSH。于是加入 `mcpConfigKind: 'json' | 'cordis-patch' | 'none'`，在四个入口（plan/apply/doctor/uninstall）按形态分派，而不是在四处各写一个 `if (kind === 'dsh')`。

### 最关键的设计取舍：不引入 YAML 依赖

项目运行时依赖只有三项，而 `cordis.patch.yml` 是 43 KB / 1277 行、由 DSH 与用户**共写**的文件。任何 YAML 反序列化再序列化都会丢注释与键序——那是真实的回归风险。因此 `src/agents/cordisPatch.ts` 做**行级定向编辑**：只定位并替换/删除本产品那一个 `- insert:` 块。

代价是编辑器依赖该文件的缩进与键序约定。所以**结构不符一律硬失败**（`E_CONFIG_CONFLICT` 且零写入），绝不「尽力修复」：在配置接入这件事上，「没接上」远好于「接歪了还不知道」。

### 实测验收（真跑，不采信自述）

| 项 | 结果 |
| --- | --- |
| 全量测试 | **636 项 / 635 通过 / 0 失败 / 1 skip**（基线 609 → 净增 27） |
| 单向 typecheck | `tsc --noEmit` 零错误 |
| 真实 DSH 只读 doctor | `configExists=true`、`cairnEntryPresent=true`、`blockPresent=true`，并**如实报告**「无安装记录（视为外来条目）」而非假装是自己装的 |
| plan 零写入 | 对真实文件副本执行 plan，前后 sha256 完全一致 |
| 写入闭环 | 真实形态副本上 plan→apply→doctor→uninstall，**uninstall 后 sha256 与原始逐字节一致**，`insert` 块归零 |
| 幂等 | 连续两次 apply，第二次内容未变化并跳过写入 |
| 负向：外来条目 | 对含手工 `mcp-cairn` 的真实副本执行 apply → 冲突检出、**退出码 4**、文件哈希未变 |
| 真实文件未受损 | 全程只操作临时副本；真实 `cordis.patch.yml` sha256 始终为 `08654CE5…` |

### 一个必须记住的操作顺序陷阱

`agent plan` 的输出用 `--out` **不会**写文件——`out()` 只把 JSON 打到 stdout。要落盘必须用 shell 重定向；但 PowerShell 的 `>` 默认写 UTF-16 BOM，`agent apply --plan-file` 会以 `SyntaxError: Unexpected token` 失败。**正确做法是用 node 以 `encoding:'utf8'` 捕获再写盘**。这个坑在验收时踩过，不是实现缺陷。

### 未做（不因归档消失）

- 只在**单机单版本**（DSH 桌面端，profile=desktop）验证过形态与加载结果，没有跨 DSH 版本矩阵，故分级仍是 `fixture-only`，不标 `real-cli-tested`。
- DSH 的 profile 未做自动发现，默认 `desktop`，可用 `--dsh-profile` 覆盖。
- `workbuddy` 的 `blocked` 分级**未改动**：官方文档确实未公开该路径。用户环境里 `~/.workbuddy/mcp.json` 可用是环境事实，不构成翻案依据。

## 12. 2026-11-01 跳过事实（add-onboarding-skip-ledger）

首次全量整理收尾时暴露了一个语义缺口：533 条导入条目里 18 条晋升、其余判跳过，但控制台的「待晋升」计数**降不下来**。

根因不是渲染：`remaining` 只认 `item_promoted` 一种审计事实，而系统**没有「跳过」这个事实**。判 skip 只记在当次运行的 summary 里，不落库。于是「判过跳过」= 「没判过」，条目永远留在队列里。这条路径历史上从没被真实走过，缺陷一直潜伏。

### 设计取舍

- **不复用 `item_promoted`**：审计只增不改，让一个动作兼表两义会让「已晋升」这个唯一谓词对消费方说谎，且污染不可逆。新增 `item_skipped`。
- **谓词仍只有一处出处**：`promotedPredicate()` 扩展为三组——`exists`（晋升，语义不变）、`skippedExists`、`handledExists`（任一，用于「还要不要处理」）。这是项目踩过的坑：该谓词曾在 6 个文件各写一份，撤销语义就是在其中一处漏掉的。
- **跳过是粘性的**：普通重跑不复活跳过的条目；`--redo` 才重判，且不删既有审计。
- **出队但可查**：`remaining` 不含跳过，「已跳过」单独成列，抽屉里每条有 `handled` 状态，CLI 有 `onboarding skipped --batch`。这是用户明确要求的取舍。

### 途中抓到一个潜伏 bug

`handledExists` 内含**两处** `%ALIAS%` 占位符，而 `console/model.ts` 用的是 `String.replace()`——只替换第一处，残留 `%` 导致 `near "%": syntax error`，一次性打挂 11 个控制台测试。

这个陷阱以前不会触发：所有谓词都只有一处占位符。改 `replaceAll` 修复，并加断言锁定「必须含两处」，防止将来有人把谓词再拼一层时重蹈。

### 实测

| 项 | 结果 |
| --- | --- |
| 全量测试 | **649 项 / 648 通过 / 0 失败 / 1 skip**（基线 636，净增 13） |
| 控制台测试 | 129/129 |
| 归档 | auto-onboarding +2、local-console 改 1；主规格 9 passed / 0 failed |
| 真实库处理 | 已晋升 18（未动）、已跳过 **470**、remaining **0**、blocked 45（未动） |
| `activeBatchId` | `null`（「没有待整理批次」） |

跳过依据分布：`project_work_context` 310 / `tool_doc_not_memory` 90 / `local_context_not_reusable` 63 / `too_short_fragment` 7。

### 一个必须说清的边界

design 写的是「历史不回填」，指的是**系统自动**不替历史条目伪造事实。本次那 470 条是**显式执行**的：走 `markItemSkipped` 正常 API 逐条写入，每条带依据码，审计里可查来源与理由。不是直接改库。

## 13. 2026-11-01 演化研讨：七方案对比 + 投影简报落地

用户要求对比 7 个外部记忆方案取长补短。调研中**推翻了自己上一轮的三处判断**，这些更正比结论本身更重要：

| 我原先说 | 核实后 |
| --- | --- |
| Cairn「完全没有注入通道」 | **错**。有受管投影（`generateProjection`），只是只写固定路由文案、从不投影记忆正文 |
| 建议照搬 prime-memory/meow 的实时注入 | **错**。两者是 Cordis 插件（`dsh.bundle.patch`）能挂 `agent/pre-step`；Cairn 是 MCP server，独立进程，订阅不到 `session/event` |
| 排序「没有时效维度」 | **半对**。FTS 路径只按 bm25，但 `last_used_at` 字段已存在且在维护 |

### 各宿主投影能力的取证

| 宿主 | 结论 | 证据 |
| --- | --- | --- |
| WorkBuddy | **不是 blocked** | 应用代码 `MemoryCollector.getWorkingMemoryContent()` 读 `<cwd>/.workbuddy/memory/MEMORY.md`，包成 `<working_memory_content>` 注入，上限 `Hs=1e4` 字符；用户级 `~/.workbuddy/MEMORY.md` 另为 `4e3` |
| ZCode | 有，但**只能放索引** | 内置文档明写「never put memory content there」，每行 ~200 字符 |
| Copilot | 有，但**与 Copilot Memory 并存** | 官方文档：Copilot Memory 含 Repository-level facts + User-level preferences，服务端自动创建 |
| Cursor | 四类 rules，**支持 AGENTS.md** | 官方文档：models 不保留记忆；嵌套 AGENTS.md 与父目录合并，更具体者优先 |
| Claude Code | 支持 `CLAUDE.md` + `.claude/rules/` + **`AGENTS.md`** | 官方文档目录 |

### 已归档：add-memory-projection-brief

- 投影内容升级为「路由文案 + 记忆简报」，按宿主分级（brief/index/none）与预算（DSH/Claude/Cursor/Copilot 2KB，WorkBuddy 8KB）。
- 三条不变量：**敏感排除在取数阶段**、**同输入同字节**、**预算含全部开销**。
- 摘要用确定性渲染而非 LLM——引入模型会让「同输入同字节」不成立。

### 实施中发现并修掉的两个真问题

1. **设计文档写了不存在的字段**：排序键用了 `importance`，但 `memory` 表实际没有该列（只有 `confidence`）。核对 schema 后改 design 与 tasks，属于未核实的疏漏。
2. **预算算错导致超限**：首版只扣了简报部分，实际输出 2063 字节 > 2048。两次修正：先扣 header（626 字节），再补受管标记余量（96 字节），最终 1850/2048。已加断言「任意预算下输出字节不得超限」锁死。

### 验证

- 全量测试 **660 项 / 659 通过 / 0 失败 / 1 显式 skip**（基线 649）。
- 真实库只读核对：投影含 20 条记忆摘要、1850 字节、无敏感泄露（DB 中 sensitive/blocked 为 0 条）。
- 归档：`agent-interfaces` +3、`agent-onboarding` 改 1；主规格 9 passed / 0 failed。

### 后续两个独立变更（未启动）

- `add-lesson-kind`：新增 `lesson` 记忆类型。`kind` 是硬编码 CHECK 约束，需 SQLite 表重建迁移。
- `add-dsh-memory-plugin`：DSH Cordis 插件，以 MCP 为内核做实时召回注入。插件放 monorepo `packages/dsh-plugin`，不独立建仓。

决策记录：投影 2KB / 交接块 4KB；Q1–Q8 均按推荐执行。

## 14. 2026-11-02 插件注入写坏会话日志（已修）

**现象**：DSH 历史加载失败，报 `stored session "session-1d2ddcb3-…" is corrupt: … session event at seq 7426 lacks an identified message`。

**根因**：`plugin/dsh/src/index.ts` 的 `makeInjectionMessage()` 只给了 `role/content/source`，**没有 `id`**。宿主把消息写进 session log 后，重放时 `assertMessageEventShape`（app.asar）要求 `user/message` 的 `data` 本身带非空字符串 `id`，缺失即抛上述错误，整段会话被判 corrupt。宿主自己的 `createUserMessage` 走 `createMessage()`，必带 `id: randomUUID()`——对照源码即可确认这是插件侧的形状缺陷，不是宿主问题。

**影响面**：`session-1d2ddcb3` 3 条（seq 7426/7526/7543），`session-0f6517a9` 累计 111 条注入中 14 条缺 id。其余 4 个会话无注入、无问题。

**修复**：
- 插件补 `id: randomUUID()`（+2 条回归测试，`npx tsx --test tests/injector.test.ts` 29/29 通过）。
- `scripts/repair-session-log.mjs`：逐帧解压，只给「`source.kind=cairn-memory-injection` 且缺 id」的事件补 UUID，只重压改动帧（其余帧保留原始字节，帧边界不变），先 `.bak` 再原子替换。`--scan` 扫全部会话，`--apply` 写盘。
- 两个会话已修复并复验：0 问题、0 重复 id，`.bak-repair-*` 留档。

**两条新纪律**（继「改 src 必须重建 dist」之后的下一层）：
1. **重建 `dist` 不等于生效**——ESM 模块在进程启动时已加载，必须让 HMR 重载插件或重启宿主。
2. **HMR 可重载已链接包**：`@deepseek-ai/dsh-hmr` 的 profile 监听会替换「已加载文件在磁盘上发生变化」的插件，包括 `node_modules` 下已安装包与已链接包的目标。touch `profiles/desktop/cordis.patch.yml`（纯注释变更即可）就触发一次重新组合，日志可见 `plugin.state` 迁移与 `cairn-memory-injection` 从改后首条起带 id。**不需要重启 DSH。**
   - 注意：重载日志里会出现 `webserver: duplicate exact route "/plugins/cairn-dsh-memory/usage"` 与 `cannot get property "webServer" without inject`，是旧实例路由未及时释放导致的噪声，新实例仍成功进入 state 3（active）。这条噪声值得单独查。
3. 任何往 session log 里写 `user/message` 的地方（不止插件），都必须提供非空 `id`。

### 附：重载时 `duplicate exact route` 的真正根因（同日续查）

`webServer.register(route)` **返回 disposer**（见 app.asar 实现：`return () => table.delete(route.path)`），宿主的用法一律是 `owner.effect(() => owner.webServer.register(route), label)`，靠 effect 在 fiber 销毁时回收路由。

插件原先裸调 `register()`、把 disposer 丢掉 → HMR 重载时**旧路由不被释放**，新实例注册同路径抛
`webserver: duplicate exact route "/plugins/cairn-dsh-memory/usage"`，整条 fiber 失败；`/usage` 从此由**旧闭包**响应，返回的是重载前的陈旧数据（实测停在 03:08:31 不动）。

已修：`registerUsageOn()` 改为可走 `owner.effect` 托管，拿不到 owner 时降级裸注册（面板不丢）。+2 条测试，插件测试 **31/31 通过**。

**但泄漏掉的那批旧路由补不回来**——`effect` 只对本次之后注册的路由生效。所以：

- 本次会话里 `/usage` 仍会响应陈旧数据，直到**重启 DSH**。
- 重启后 HMR 重载不再撞重复路由（新代码已带 disposer）。

结论：**改插件路由注册后必须重启一次宿主**，不能只靠 HMR 指望清掉历史泄漏。这条与 §14 的两条纪律合起来构成完整规则：
1. 改 `src/` → 必须 `npm run build`；
2. 改路由/effect 注册 → 必须重启宿主（HMR 只能回收它自己见过 disposer 的路由）；
3. 往 session log 写 `user/message` → 必须带非空 `id`。

另记：`patch: entry "dsh-zcode-plan-bridge" not found` 是既有噪声（该插件不在当前 profile 里），与本问题无关。

---

## 2026-11-03 追加：add-operation-audit 实现并归档（经插件开关决策后复活）

- **决策轨迹**：Round-9 用户要全操作留痕 → 提案 add-operation-audit（2b60bac）→ Round-10 用户改选「插件内开关（内存默认/落盘可选）」→ 提案撤回 → Round-13 用户明确「openspec 提案帮我实现」→ 恢复提案、TDD 实现、当日归档 `2026-11-03-add-operation-audit`。
- **实现要点**：读取操作（search/get）记 `operation` 类目；写入沿用既有 `memory` 类目**不重复记**（相对原提案的修正，归档前已改 delta）。保留期白名单只清 `operation`（治理/写入审计永不自动删）。`memory_audit` MCP 只读工具 + `cairn audit list` CLI。开关 `audit.operations`、保留期 `audit.retentionDays`（env > ~/.cairn/config.json > 默认 true/30）。FAIL-OPEN：审计坏不影响业务。
- **证据**：核心 678 pass / 0 fail / 1 gated skip（+10 新测试）；e2e verdict PASS applied=336 与基线一致；`validate --specs --strict` 通过；写放大基准 ~0.13ms/search（artifacts/audit-bench-2026-11-03.txt）。
- **DSH 面板接入审计史（原任务 5.x）延后**：面板已有独立「落盘」开关（JSONL）且经用户目视确认；审计史已可经 memory_audit/CLI 查询，面板要接审计数据源时再做。
- **同日插件侧**（此前轮次）：记忆 tab 化、活动环+筛选器、持久化开关、Rules-of-Hooks 崩溃修复、主题对比度自适应（文字：自动/白字/黑字）。dist 已含全部变更，用户重启即生效。
- ~~**遗留**：migrate-lesson.test.ts 两个 TS 严格索引报错~~ → 2026-11-03 已修（守卫处 `?? 0` 合并空值，断言语义不变），`npx tsc -p tsconfig.json` 全库干净。

---

## 2026-11-11 四提案批量推进：实现 → 验证 → 归档（主会话，无派发）

- **范围**：用户要求把 openspec 全部 4 个未归档提案推进到「完成 → 验证测试 → 归档 → 提交」。当日全部归档，主规格 10/10 严格通过，`openspec list` 无活动变更。
- **add-stable-project-identity**：已实现（26/26，随 `2bace73` 提交过），本次做独立验证复跑（759/758/0/1 基线吻合）+ 归档。变异抽查复做：去掉 `.git` 剥离 → git 等价用例独自红。
- **add-scope-migration**（777/776/0/1）：`cairn rescope` + `scope_exit` 迁出通知（schema v6，outbox CHECK 加值重建表）。三条关键设计：
  - 迁出通知走**独立 jobType `sync_scope_exit`**：sync_upstream 入队有物理排除（local_only 作用域直接拒绝），且 spec 要求「迁移到 local_only 未产生新的上行任务」——固定键会被已完成历史任务挡住，迁出/迁回的幂等键都必须带时间戳。
  - 对端「不再持有」= `archived` 状态 + meta 标记（`scope_exit:<id>`）：archived 让检索/投影免费排除、无墓碑；meta 标记区分用户主动归档并支持迁回解除。**迁回靠 `reentry` 标记的强制重发修订快照**（普通 upsert 在修订未变时被 push 幂等跳过，对端永远收不到重新持有信号）。
  - 未知事件类型 = 跳过 + 审计 + **游标照常推进**：旧语义 throw 会被 applyEvents 转成 waited，卡死该设备整条链。
- **add-agent-managed-revision**（792/791/0/1；e2e-console-ui 46→**66/66**）：方案卡 `console/revision-proposals.json`（照 annotations 模式）；MCP 只有 `revision_propose`/`revision_list`；采纳复用 `reviseMemory`，权威经新增 `ReviseOptions.authority` 记 `user_confirmed`（MCP 不暴露该参数）；版本一致性两层（提案层 revisionIdAtPropose + revise 的 expectedCurrentRevisionId）。拒绝允许从 stale 发起（否则陈旧卡清不掉）。控制台新增「修订提案」视图。
  - **静态页断言的坑**：静态导出内嵌完整 UI 源码，字符串级断言「页面无 data-rev-apply」必然假红/假绿——源码里必然有这个字符串。守卫是 `data-static="1"` 属性 + `!STATIC` 分支，行为级验证只能真开浏览器（e2e 已覆盖）。
- **add-cloud-backup**（797/796/0/1）：`deriveBackupKey`（独立 HKDF salt + deviceId）；`backups/<设备>/` 前缀与同步链双向隔离；对象名内嵌明文 sha256（`cairn-backup-<ms>.db-<sha256>.enc`），恢复链 = 解密 → sha 比对 → verifyBackup；`--force` 覆盖前自动 `pre-restore-*.db`。保留策略走 `RemoteStore.deleteObject?`（可选方法）：OBS 已有实现，**syncd 无 DELETE 路由 → 诚实降级只上传不删（pruneWarning 明示）**，不改 syncd 协议（真实 ECS 升级属运维）。含一条真实本地 syncd 的 CLI e2e。任务 6.6（真实环境上云）**未执行，需用户单独授权**。
- **流程教训（本次新增）**：
  - **变异还原绝不能用 `git checkout`**——本次用它还原 app-service.ts 的变异，把未提交的 rescopeMemory 实现整体冲掉，靠 Edit 重写恢复。变异/负对照一律 Edit 改、Edit 还原。
  - **CLI/子进程测试跑 dist 产物**：改 `src/` 后不 `npm run build`，测试打在旧代码上（本次踩两次：rescope 退出码合同、MCP proposedBy 的 channel 判定）。
- 基线：**797/796/0/1**；CHANGELOG Unreleased 已补三条；真实云端操作（真实库上云首次 push、真实 syncd 备份、macOS CI）仍未做，均需用户拍板。

> 本节的完整版（含验证证据表、API 地图、四个待办任务的逐步推进路线、接手纪律与事故记录）见 `docs/handoff-2026-11-12-session-summary-and-next.md`。
