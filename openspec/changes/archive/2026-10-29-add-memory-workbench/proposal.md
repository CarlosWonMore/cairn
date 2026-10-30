# Proposal

## Why

记忆库已经有内容，但**只有机器能看清它**。

当前唯一交互面是 CLI 与 MCP stdio。真实库现状（2026-10-28 实测）：51 个导入档案、533 条快照条目（clean 488 / blocked 45）、51 个批次、2 条 active 记忆、2 条待上行 outbox。需要人做判断的三类东西全部看不见：

- **批次进度**：`onboarding status` 不带 `--batch` 时只看 `activeBatchId()` 一个批次，51 个批次里只显示 1 个；用户无法回答"我总共还欠多少待整理"。
- **审批差异**：`cairn approve` 前要人看计划差异，但 `planSummary` 是 JSON，在终端里读 100+ 条操作不现实，实际结果是"要么盲签要么不签"——这直接削弱了治理模型最关键的支点。
- **快照与隔离**：45 条 blocked 条目只有 `import_item.scan_state` 可查，没有任何聚合视图说明"被拦的都是什么类型"。

同时，`AppService` 已经暴露了全部所需读写（`status` / `showMemory` / `search` / `batchStatus` / `batchChunk` / `proposeForBatch` / `approve` / `applyPlan` / `planSummary` / `vaultStatus` / `syncPushCmd` / `syncPullCmd` / `doctor`）。**缺的不是业务能力，是人能用的视图。** 因此本变更定位为薄壳视图层，不新增任何治理语义。

## What Changes

- 新增 `cairn ui`：启动本地 HTTP 控制台，只绑 `127.0.0.1`，启动时生成一次性会话令牌并把带令牌的 URL 打印到 stdout。
- 新增 `cairn ui --export <file.html>`：生成单文件自包含的静态预览页，可直接双击打开或离线查看。**按用户要求默认输出全部正文**（记忆含 sensitive、快照含 blocked），靠 `-personal` 文件名、文件头警示与导出提示三层告知"这是含明文的产物"；`--redact` 是唯一的反向开关，一键回到" sensitive 与 blocked 全掩码"的脱敏模式。
- 两个视图：
  - **预览（preview）**：只读浏览记忆（按作用域层级 / 状态 / kind / 敏感度分组）、快照、批次、审批态。`--export` 产物只有这一个视图。
  - **工作台（workbench）**：在预览之上开放三类受控写操作——审批签发、计划应用、同步推送/拉取。
- 工作台信息架构：
  - 作用域层级树（`scope.preset` × `scope_kind`：personal-global / device-local / project / agent-private / session-ephemeral / custom），逐层展开记忆。
  - 记忆状态分布（active / candidate / conflicted / superseded / archived / tombstoned）与 sensitivity 标记。
  - 快照列表（`import_archive` 51 条：来源、字节、`redaction_state`、条目数、clean/blocked 拆分）。
  - 批次进度一览（51 行，每行 total / clean / blocked / promoted / remaining），不再只显示活跃批次。
  - 审批态（plan：draft / awaiting_approval / approved / applied / expired / invalidated；approval：签发时间、有效期、已用次数）。
- **待处理看板 + 双层建议**（本变更的核心理顺点）：把所有"等人决定"的东西合并成一个按优先级排序的队列——待晋升批次条目、待批准计划、blocked 条目分类、未解决冲突、同步待办。
  - 第一层 **规则层**：确定性启发式（哈希比对、trigram 相似度、长度/结构阈值、扫描状态），每条附规则 id 与实测证据值。
  - 第二层 **AI 层**：在当前 Agent 会话内经显式请求产出判断，与规则层**并列保存**而非覆盖；两层冲突时并列呈现、由人裁决。
  - 两层都标注为 advisory：不自动执行，不写库，进入 `plan` 仍需一次性审批。
- 建议写入通道：新增 `cairn review` 与对应 MCP 工具，把 AI 判断按 `itemId + action + reason` 落库并标注来源与模型标识；UI 只做读写与呈现，不直连任何模型 API、不外发记忆。
- 页面具备可检索与可恢复的视图状态：检索条件与展示模式写入 URL，刷新后自动重放；支持"摘要 / 完整正文"全局切换，并记住偏好。
- 审批通道参数化：`AppService.approve(planId, { channel })`，webui 通道签发同样的一次性审批（`plan_hash` 绑定 + TTL + 单次使用），审计事件记录 `channel=webui`，与 CLI 通道完全同权同约束。
- 前端零依赖：`node:http` + 内联 HTML/CSS/JS，无 web 框架、无构建步骤、无外部字体/CDN。

## Capabilities

### New Capabilities

- `local-console`：本地回环控制台（预览页 + 工作台）、只读快照数据模型、双层建议呈现、受控审批与同步操作、单文件静态导出、URL 可恢复的视图状态。
- `memory-review`：建议的双层存储与写入通道（规则层 + AI 层）、来源标注、两层冲突的并列裁决规则、AI 建议不得自动应用的治理约束。

### Modified Capabilities

- `agent-interfaces`：新增 `cairn ui` 入口；本地监听面必须只绑回环地址并可被 Ctrl-C 终止；`--export` 必须不启动服务。
- `memory-governance`：审批通道来源成为一等字段（cli / webui），浏览器通道不得放宽任何校验；UI 产生的建议不得绕过 `plan_hash + approval` 链路。

## Impact

- 新增 `src/interfaces/console/`（HTTP 服务、只读数据装配、规则层建议引擎、复核包与 AI 建议存储、内联前端资源）。
- 修改 `src/interfaces/cli/main.ts`（新命令与标志）、`src/interfaces/app-service.ts`（`approve` 通道参数化、只读聚合方法）。
- 新增 `tests/console/`（API 契约、安全边界、规则层建议、复核包与写回校验、URL 状态、导出）。
- 不新增数据库表、不改 schema（`user_version` 保持 2）；AI 建议落 `~/.cairn/console/`，属派生物，删除即回到干净状态。
- 不改：同步协议、MCP 协议主体（仅新增一个工具）、检索语义、治理判定规则。
- 不新增运行时依赖。`package.json` 的 `dependencies` 保持 3 项。

## 非目标与当前决策

- **不做记忆正文编辑与删除**。工作台只开放审批、应用、同步三类写操作；改动/遗忘记忆仍走 CLI 或 MCP，避免把"能点开网页"变成"能改历史"。
- **不做远程访问**。不绑 `0.0.0.0`，不做鉴权体系、不做 TLS、不做多用户。远程看记忆属于另一个变更（需要隧道或反向代理方案）。
- **控制台不直连模型**。UI 进程不发任何模型请求、不持有任何模型凭据、不外发记忆正文。AI 判断只能由用户在 Agent 会话内显式发起，经 `cairn review` / MCP 工具写回本地库。这样"谁看过我的记忆"始终等于"我在哪个会话里让它看过"。
- **AI 建议不等于结论**。两层建议并列保存，AI 层不得覆盖规则层，冲突时由人裁决；任一层都不能直接触发应用。
- **不做 WYSIWYG、不做图表库、不做前端构建链**。静态导出是一份 HTML，不是一套工程。
- 不把静态导出当备份。备份仍是 `cairn backup`；导出仅作浏览与分享。

## 风险与回滚

- **本地端口暴露面**：浏览器里任何页面都能向 `127.0.0.1` 发请求（CSRF）。缓解：随机会话令牌 + `Origin` 与 `Host` 双校验 + 写操作必须 POST；任一校验失败 403 且不落正文。
- **审批被误点**：网页上"批准"成本远低于终端输入命令。缓解：签发前要求在页内输入计划哈希前 8 位，且一次性审批 30 分钟过期、单次使用；应用后计划哈希变动即失效（沿用现有触发器）。
- **敏感内容落到浏览器与磁盘**：工作台仍默认掩码，`sensitive` 与 `blocked` 需逐条揭示；但**静态导出按用户要求输出全部正文**（记忆含 sensitive、快照含 blocked），因此导出产物不再具备"可随手转发"的性质。缓解：导出文件名带 `-personal` 后缀、文件头显式警示、导出完成在 stdout 打印含明文提示与条目数，并保留 `--redact` 作为唯一反向开关一键回到全掩码。这是用户的明确取舍：完整的可审计性优先于默认保守，风险以三层告知承担而非技术阻断。
- **建议被误当成结论**：缓解：两层建议都标 advisory 且逐条附依据；AI 层附模型标识与生成时间；两层冲突时并列高亮，不预选其一；"采纳"只预填计划草稿，仍需签发审批。
- **AI 层把记忆送到模型**：缓解：控制台本身不发模型请求，只在用户主动的 Agent 会话内发生；复核包默认只含待判断条目的必要片段，范围与条数在生成时打印，可先审后发。
- **回滚**：整块新增目录 + 一个 CLI 分支 + 一个方法签名默认参数（`channel` 缺省 `'cli'`）。删除即回到当前行为，无 schema 迁移、无数据改写。
