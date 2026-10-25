# Tasks

## 1. 工程骨架与本地权威库

- [x] 1.1 建立 TypeScript ESM、Node.js 22+、npm/npx 包结构与锁文件，配置 lint、build、test；验证全新目录安装和 `npm run build && npm test` 成功。
- [x] 1.2 按 design D2 封装 `node:sqlite` 适配层和版本化迁移，实现事务、WAL、外键、忙超时与迁移版本检查；用中断迁移和重复迁移测试验证不会留下半迁移库。
- [x] 1.3 实现空间、项目、设备、Agent、自定义空间及组合作用域模型；用合法/非法作用域测试验证预设、校验和默认 `local_only` 策略。
- [x] 1.4 实现记忆、不可变修订、来源、冲突、tombstone、导入档案、计划审批、outbox 和受管区块的 v1 Schema；用 Schema 与外键负向测试验证职责边界。
- [x] 1.5 实现一致性备份、恢复校验和设备克隆身份检测；用备份前后计数、损坏库和克隆目录测试验证可恢复及旧身份暂停写入。

## 2. 显式记忆与隔离检索

- [x] 2.1 实现显式记忆新增、详情、更正、归档、遗忘和当前修订解析；用生命周期测试验证历史不可无痕修改、用户纠正形成 supersedes。
- [x] 2.2 实现统一作用域策略入口并接入写入、详情、导出、投影和 outbox；用跨项目、跨设备、跨 Agent 与替代入口负向测试验证无旁路。
- [x] 2.3 实现 FTS5 trigram 与短查询有界 LIKE 回退，保留原始正文和来源摘要；复用 M0 中文 18 查询并验证两字、混合查询、非法查询与索引降级。
- [x] 2.4 实现活动/候选/冲突/过期/被替代结果的区分与排序；用冲突、过期和未验证导入 fixtures 验证默认结果不伪装成用户确认事实。
- [x] 2.5 实现可迁移 JSON 导出和受作用域约束的重建输入；验证被遗忘内容不进入活动导出、导出包含来源修订且重复导入幂等。

## 3. 候选治理与真实审批

- [x] 3.1 实现规范化 `OnboardingPlan`、`plan_id/plan_hash`、操作和目标修订快照；用字段顺序、正文、作用域或来源变化测试验证哈希稳定与篡改可检测。
- [x] 3.2 实现独立本地 CLI 审批签发和一次性 `approval_id`；用伪造 `user_confirmed`、过期、重放、错误哈希和目标新修订测试验证全部拒绝。
- [x] 3.3 实现 `add/merge/keep_both/skip` 的幂等计划应用与可恢复进度；用 halfway 崩溃、重复应用和重复批次测试验证无重复记录或副作用。
- [x] 3.4 实现冲突队列与并发修订保留；用同祖先冲突修订验证不按 mtime 覆盖、检索明确展示双方证据。
- [x] 3.5 实现秘密扫描、不可信指令隔离和日志脱敏，并接入 Agent 批次、计划应用、投影和 outbox；用安全 fixtures 验证秘密不回显、不晋升、不上行。

## 4. 首次发现、导入与对话式初始化

- [x] 4.1 实现允许根目录内的元数据发现适配器与符号链接防护；用合成 HOME 验证发现阶段正文读取为零、私有或越界来源明确跳过。
- [x] 4.2 实现独立授权的来源选择、不可变快照和 `imported_unverified + local_only` 档案；验证源哈希不变、重复导入零新增且无上行任务。
- [x] 4.3 实现授权批次读取、分批计划、差异展示和中断续跑；模拟 Agent 会话中止后验证可在新会话续跑且不扩大授权范围。
- [x] 4.4 实现无模型时的档案检索与导出入口；在没有任何模型调用的情况下验证已导入档案可用且未验证标识清晰。
- [x] 4.5 实现 `observe/router/mcp-primary` 模式和唯一受管入口；验证 observe 零写入、router 幂等、无公开关闭接口时只给手动步骤、卸载恢复原字节。

## 5. CLI、MCP 与后台任务隔离

- [x] 5.1 建立 CLI/MCP 共用应用服务，提供 init、add、search、show、export、plan、approve、apply、doctor、worker、uninstall；用命令级 JSON 与退出码测试验证规则一致。
- [x] 5.2 使用官方 MCP SDK 实现 stdio initialize、tools/list、tools/call、取消、超时和断开；复用 M0 协议合同并验证 stdout 只有 JSON-RPC、日志仅 stderr/文件。
- [x] 5.3 实现有界本地 outbox 与 `worker run-once`，默认不安装同步 hook；用 worker 崩溃、超时和 MCP 进程退出测试验证模拟 Agent 会话存活及任务可重试。
- [x] 5.4 实现 doctor 能力分级、数据库/索引/配置/协议检查和脱敏报告；验证无模型无云端仍判核心可用，fixture-only 与真实 CLI 验证不混报。
- [x] 5.5 编写 CLI/MCP 使用与审批流程文档；按文档在干净合成 HOME 执行首次显式记忆和一次对话式初始化，验证命令可复制执行。

## 6. Agent 配置与受管投影

- [x] 6.1 实现 `agent plan/apply/doctor/uninstall` 通用流程、目标哈希、原子写入与备份；验证 plan 零写入、目标变化拒绝、卸载只移除本产品。
- [x] 6.2 实现公开 JSON 配置合并和外来同名冲突；用未知顶层字段、其他服务器、同名外来条目测试验证保留与硬冲突。
- [x] 6.3 按公开能力建立 Claude Code、Cursor、Copilot、OpenClaw、WorkBuddy 适配器清单和降级指引；验证无公开接口时不逆向、不宣称原生记忆已接管。
- [x] 6.4 实现受管 Markdown 投影的生成、重建、停用与防回环；验证作用域过滤、重复生成无重复区块、卸载不影响其他规则。
- [x] 6.5 在合成 HOME 完成五宿主 fixture 测试，并在条件具备时隔离复跑 Copilot CLI；输出能力矩阵，验证每项都标为 real-cli-tested、fixture-only 或 blocked。

## 7. 安全、恢复与分发硬化

- [x] 7.1 将 M0 安全对抗集转为项目 fixtures，覆盖提示注入、秘密、scope 逃逸、伪造授权、路径穿越、设备克隆、回滚、恶意 Markdown 和 MCP 权限；运行确定性测试并保留非零断言结果。
- [x] 7.2 执行 4 进程并发写入、重复/乱序任务、备份恢复、索引损坏和进程崩溃故障注入；验证记录完整、冲突不丢失、Agent 会话不被终止。
- [x] 7.3 完成 npm pack、全新临时目录离线安装、固定版本 CLI 与 MCP 启动冒烟；验证无全局安装、无运行时下载、包内不含真实记忆、日志或临时产物。
- [x] 7.4 编写安全边界、备份恢复、卸载与故障排查文档；按文档执行一次恢复和卸载演练并保存机器可读结果。

## 8. 本地 MVP 集成验收

- [x] 8.1 跑通“发现→勾选→快照→档案检索→Agent 计划→独立审批→应用→投影→卸载”完整合成链路；验证三次独立授权不可捆绑且全过程可回滚。
- [x] 8.2 用两个独立 MCP 客户端验证同一本地库跨 Agent 读写、作用域隔离与冲突保留；验证一个客户端断开后另一个及 CLI 仍可使用。
- [x] 8.3 执行全部 build/test/integration/pack 检查并核对非零测试数、实际文件和结果；更新 `docs/M0-session-handoff.md` 的实现接续状态，所有外部未验证项单独列出且不虚标完成。

## Workflow follow-up

- 用户审阅 proposal、specs、design 和 tasks 后，在新会话明确启动 `/opsx:apply`。
- apply 完成后执行 OpenSpec verify 与独立验收，再决定是否 archive。
- 真实 ECS/OBS、macOS/Linux 和更多宿主实机验证分别另立变更，不阻塞本地 MVP 的诚实交付。

## 实现验证记录（2026-10-25，主会话独立复跑）

| 组 | 任务 | 验证证据 |
|---|---|---|
| 1 | 1.1–1.5 | tests/store/*.test.ts 30 项通过（迁移中断恢复、作用域校验、备份恢复、克隆暂停写入） |
| 2 | 2.1–2.5 | tests/retrieval/ 46 项 + tests/store/memories（生命周期/修订链/tombstone 导出） |
| 3 | 3.1–3.5 | tests/governance/ 28 项（伪造审批/篡改/重放/续跑幂等/秘密复检）+ tests/core/secrets 21 项 |
| 4 | 4.1–4.5 | tests/onboarding/ 56 项（金丝雀零正文读取、快照幂等、审计即晋升游标）+ tests/agents/adapters |
| 5 | 5.1–5.5 | tests/interfaces/ CLI 5 + MCP 4；docs/cairn-usage.md 全命令实测 |
| 6 | 6.1–6.5 | tests/agents/ 27 项 + tests/projection/ 21 项（五宿主 fixture-only/blocked 矩阵，未宣称 real-cli-tested） |
| 7 | 7.1–7.4 | tests/security/ 32 项对抗 + tests/integration/concurrency（4 进程×有界重试）+ npm pack 全新目录安装冒烟 + docs/cairn-security.md |
| 8 | 8.1–8.3 | tests/integration/e2e（发现→导入→计划→审批→应用→投影→卸载、双 MCP 客户端、worker 故障隔离）+ 本文件勾选与 docs/M0-session-handoff.md 更新 |

汇总：单元与集成合计296 项测试全部通过（npm test = build + tsx --test --test-concurrency=2，exit 0）。

**保留的外部边界（未虚标）**：真实 ECS/OBS 同步、macOS/Linux、真实宿主 CLI 认证（全部 fixture-only/blocked）、Copilot CLI 复跑（条件不具备，未执行）、better-sqlite3 比较、完整供应链审计。这些另立变更，不阻塞本地 MVP。
