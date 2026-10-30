# Tasks

## 1. 服务骨架与安全边界

- [x] 1.1 新增 `src/interfaces/console/model.ts`：只读装配 `ConsoleModel`（scopes + 每层计数、memories 按状态聚合、archives 全量、batches 全量、plans/approvals 联表、outbox、sync 状态），支持 `mode=brief|full` 决定正文裁切。验证：`tests/console/model.test.ts` 对 fixture 库断言各段计数与实测一致、`activeBatchId` 只返回 1 个时 `batches` 仍返回全部行、`mode=brief` 返回体不含完整正文子串。
- [x] 1.2 新增 `src/interfaces/console/security.ts`：会话令牌生成与校验、`Origin` 白名单、`Host` 白名单、`sensitive`/`blocked` 掩码函数、`no-store` 响应头。验证：`tests/console/security.test.ts` 覆盖令牌缺失/错误、跨源 POST、非回环 Host、掩码不泄原文（断言响应体不含原文子串）。
- [x] 1.3 新增 `src/interfaces/console/server.ts`：`node:http` 路由绑定 D3 契约表；写路由只接受 POST；请求日志只记方法与状态码。验证：`tests/console/server.test.ts` 用随机端口起真实服务做 fetch 断言（GET 只读、POST 缺令牌 401、错误 Origin 403、日志无正文）。
- [x] 1.4 CLI 分支：`cairn ui [--port N] [--no-open] [--export <file>] [--redact]`，默认 7767、占用则换系统分配端口并打印实际 URL；`--export` 不监听。验证：`tests/console/cli-ui.test.ts` 子进程断言 stdout 含 `http://127.0.0.1:`；`--export` 时断言进程期间无监听端点建立。

## 2. 规则层建议引擎

- [x] 2.1 实现 D4 规则集（`S-BLOCKED` / `S-DUP-EXACT` / `S-DUP-NEAR` / `S-FRAGMENT` / `S-FRONTMATTER` / `S-CODE-HEAVY` / `S-NUMERIC-CONFLICT` / `S-CLEAN-DEFAULT`），每条纯函数。验证：`tests/console/suggestions.test.ts` 每条规则至少一正例一反例，并断言 `basis` 数组非空且含可复算值。
- [x] 2.2 排序与稳定性：`needs_human > merge > promote > skip`，同级按 batch remaining 降序；trigram 相似度实现对同一输入稳定。验证：构造乱序 fixture 断言输出顺序；同输入两次调用结果深相等。
- [x] 2.3 规则层不落盘断言：调用前后对 `memory`/`onboarding_plan`/`approval`/`import_item` 全表做行数与内容哈希比对，并断言 `~/.cairn/console/` 未新增文件。验证：断言完全一致。

## 3. AI 层：复核包与写回

- [x] 3.1 `src/interfaces/console/review-store.ts`（`buildReviewPack`，与 3.2 落盘同模块）：按批次生成复核包（`itemId` + 正文片段（默认 1200 字符/条）+ 规则层结论 + 动作枚举 + 输出 schema），写出 JSON 并返回条数与字符总量。验证：`tests/console/review-store.test.ts` 断言包内每条都带 rule 结论、条目数与批次实际一致、截断行为正确。
- [x] 3.2 `src/interfaces/console/review-store.ts`：AI 建议落 `~/.cairn/console/ai-reviews.json`，原子写（临时文件 + rename）、带 `runId` 与生成时间、同 `itemId` 新结果覆盖旧结果，并向 `audit_event` 写 `category='review'` 记录。验证：`tests/console/review-store.test.ts` 断言并发两次写入后文件可解析、覆盖语义正确、审计行数增加。
- [x] 3.3 写入校验与整批拒绝：条目归属批次、动作枚举、理由非空、目标记忆存在性、建议文本过 `scanText` 秘密/注入复检。验证：`tests/console/review-store.test.ts` 五个负例各断言整批拒绝且库无变化、错误含条目索引且不回显正文。
- [x] 3.4 陈旧标记：条目内容哈希或扫描状态变化后，旧建议标记 stale 且不参与默认采纳。验证：改 fixture 条目内容后重算，断言该条建议 `stale=true`。
- [x] 3.5 CLI 与 MCP 通道：`cairn review pack|submit|list` 与 MCP 工具 `memory_review`，二者共用同一实现与校验。验证：`tests/interfaces/review-cli.test.ts` 断言 CLI 与 MCP 对同一非法输入的拒绝码一致。

## 4. 前端视图

- [x] 4.1 设计 token 与布局骨架：`assets/ui.css` 落实 D7 的 Archify 色板映射（7 类箭头色 + 双主题面板色）、字体栈、焦点环、`prefers-reduced-motion`。验证：`tests/console/assets.test.ts` 断言 CSS 含全部 7 个语义色 token、不含 `http(s)://` 外链、含两个媒体查询。
- [x] 4.2 预览视图：作用域层级折叠 frame（空层级显示空态）、记忆卡片与详情（内容/状态/权威/敏感度/修订/证据）、快照列表（含 clean/blocked 拆分）、批次全量列表、审批态。验证：`tests/console/render.test.ts` 渲染 HTML 字符串，断言关键区块存在、空层级有空态文案、无编辑/删除控件（断言不存在 `data-action="edit"` 等）。
- [x] 4.3 待处理队列双层呈现：rule 与 ai 两枚 chip 并列、分歧高亮、默认不预选、basis 可展开、采纳后才进计划草稿。验证：渲染断言 `needs_human` 排在 `skip` 之前、分歧条目带 `data-conflict` 属性、无 `checked` 预选。
- [x] 4.4 查询与状态恢复：解析 `view/q/scope/status/kind/mode/batch/plan`，加载时重放一次查询；过滤变更用 `replaceState`、视图切换用 `pushState`；结果区显示命中总数与已展示数。验证：`tests/console/url-state.test.ts` 断言参数编解码往返一致、`mode` 缺省取 localStorage、URL 优先于 localStorage。
- [x] 4.5 摘要/全文切换：`M` 键与控件双向同步，摘要模式由服务端裁切，切换后地址同步。验证：`tests/console/url-state.test.ts` 断言切换后 URL 含 `mode=full`，且 brief 模式请求路径带 `mode=brief`。
- [x] 4.6 工作台写操作：计划草稿（可逐条改动作）→ `POST /api/plans` → 展示 `plan_hash` 前 8 位 → 页内输入校验后签发 → 应用；同步区按 `vaultStatus` 禁用并说明缺项。验证：`tests/console/workbench.test.ts` 走完整链路（fixture 库），断言审批前 apply 被拒、错误哈希前缀被前端拦截、未配置 vault 时按钮 disabled。
- [x] 4.7 键盘与动效：`1`–`4`、`/`、`P`、`T`、`M`、`?`、`Esc` 绑定；动画仅在 `prefers-reduced-motion: no-preference` 下生效。验证：`assets.test.ts` 断言快捷键绑定表存在、动画规则位于对应媒体查询内。

## 5. 静态导出

- [x] 5.1 `export.ts` 生成单文件 HTML：内联 CSS/JS/模型 JSON，默认输出全部正文（记忆含 sensitive、快照含 blocked），`source_label` 绝对路径转 `~`，文件名追加 `-personal`，文件头警示，stdout 打印含明文提示与条目数。验证：`tests/console/export.test.ts` 断言产物含 fixture 中敏感记忆与 blocked 条目的完整正文、不含 `C:\Users\`、含警示文案与 `-personal` 文件名。
- [x] 5.2 开关行为：`--redact` 同时掩码 sensitive 记忆与 blocked 条目正文，其余照常；无单独 blocked 开关（避免组合歧义）。验证：同 fixture 两例分别断言默认导出含 blocked 正文、`--redact` 后 sensitive 与 blocked 正文均不出现且掩码结构完整。
- [x] 5.3 离线与体积：断言产物不含任何 `http(s)://` 引用（工作台跳转按钮在静态产物中隐藏）；超 8 MB 触发降级并标注截断条数。验证：外链正则零命中；构造大 fixture 触发降级分支。

## 6. 审批通道参数化

- [x] 6.1 `AppService.approve(planId, { channel })` 参数化，默认 `'cli'`；审计 action 为 `issued_via_<channel>`。验证：`tests/interfaces/approval-channel.test.ts` 断言默认调用产生 `issued_via_cli`（回归），传 `webui` 产生 `issued_via_webui`，两者在 TTL、单次使用、哈希绑定上行为一致。
- [x] 6.2 越权负向：无审批应用、过期审批应用、计划改动后应用，三者在 webui 通道下必须与 CLI 通道返回同一治理拒绝码。验证：同一测试文件三场景断言错误码相等。

## 7. 收尾与验收

- [x] 7.1 全量 `npm test` 连续 3 轮全绿 + `npm run typecheck` 干净；`npm pack --dry-run` 文件数与体积增量记录。验证：三轮输出与打包清单。（实测：510/509/0/1 三连跑，typecheck 干净，pack 202 文件 281.2 kB / 解包 1.1 MB）
- [x] 7.2 文档：新增 `docs/cairn-console.md`（启动、端口、令牌、两种形态、导出含明文的风险与开关、双层建议与复核流程、安全边界与不防御项、与 CLI/MCP 的职责划分），README 增加一行入口，`AGENTS.md` 与 handoff 回写。验证：按文档命令可复制执行。（`docs/cairn-console.md` 已写，README「快速开始」与状态段、AGENTS.md 入口、handoff 第九节已回写）
- [x] 7.3 真实库只读冒烟：对 `~/.cairn` 起 `cairn ui` 并 `curl` 只读端点，断言 `doctor ok` 且 `memory`/`plan`/`approval` 行数前后不变；不执行任何写操作，不生成复核包。验证：机器可读前后对比记录（入 `artifacts/`，不入库）。（`node scripts/smoke-console.mjs` → PASS：db sha256 前后一致、9 表零变化、10 端点全 200；报告 `artifacts/console-smoke-2026-10-28.json`）
- [x] 7.4 OpenSpec 校验：`openspec validate add-memory-workbench` 与 `--strict` 均通过，4/4 制品状态齐全。验证：命令输出。（`openspec validate add-memory-workbench` 与 `--strict` 均 valid，4/4 制品齐全，21 条 delta）
