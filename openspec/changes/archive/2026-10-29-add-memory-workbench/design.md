# Design — 本地控制台与记忆工作台

## Context

现有系统已经完成三层分离：本地 SQLite 是唯一可写权威、`import_*` 是不可变候选快照、`onboarding_plan + approval` 是确定性治理管线、`sync` 是可选加密中继。控制台属于第四层之下的**视图层**：它读权威数据，写治理动作，不拥有任何状态。

数据面事实（2026-10-28 实测，正式库 `~/.cairn`）：

| 事实 | 值 | 对本设计的约束 |
|---|---|---|
| `import_archive` / `import_item` | 51 / 533 | 批次列表必须一次渲染全部，不能分页到看不见 |
| `import_item.scan_state` | clean 488 / blocked 45 | 工作台 HTTP 响应默认掩码（只给类别与长度）；静态导出默认含正文（见 D8），两者是不同风险面 |
| `scope` 行 | 1 行（personal-global） | 层级视图必须有空态，不能假设每层都有数据 |
| `memory` | active 2 / candidate 0 | 界面不能假设"有大量记忆"，空态是常态 |
| 批次粒度 | 51 个 batch（每文件一批） | `activeBatchId()` 只返回 1 个，视图必须自己聚合 |
| `outbox_job` | pending 2 | 同步待办要出现在待处理队列 |

可复用面事实：`AppService` 已暴露 `status` / `doctor` / `showMemory` / `search` / `batchStatus` / `batchChunk` / `proposeForBatch` / `approve` / `applyPlan` / `planSummary` / `vaultStatus` / `syncPushCmd` / `syncPullCmd`。`approve()` 当前把 `channel` 硬编码为 `'cli'`，是本变更唯一必须改动的业务侧签名。

## Goals / Non-Goals

**Goals**

1. 一个人能在 30 秒内回答三个问题：库现在什么状态、还欠多少待处理、下一个该签什么。
2. 建议分两层：规则层可复算，AI 层在会话内叠加；两层并列呈现，冲突时由人裁决，界面不制造"AI 已替你决定"的错觉。
3. 浏览器成为与终端同权的审批签发通道，且不新增任何绕过点。
4. 产物零依赖、离线可用；工作台内敏感正文默认掩码，静态导出按用户要求输出完整正文并带明确警示。

**Non-Goals**

- 不是记忆编辑器：正文改动仍走 `cairn update` / `memory_update`。
- 不是第二个权限系统：UI 不引入角色、不做多用户、不做远程访问。
- 不是监控面板：不做时序图表、不做指标存储。
- 不是 LLM 前端：v1 不发任何模型请求。

## Decisions

### D1 双形态共用一套装配层

`cairn ui`（服务）与 `cairn ui --export <file>`（静态）共享 `buildConsoleModel(store)` 输出的同一份只读模型 JSON；差别只在**传输**：服务形态按需调用装配并按请求参数过滤，静态形态一次性装配后嵌入 HTML。

```
src/interfaces/console/
├── model.ts           只读装配：scopes / memories / archives / batches / plans / approvals / outbox / sync
├── rule-suggestions.ts 规则层建议（纯函数，不落盘）
├── review-pack.ts      复核包生成（供当前 Agent 会话读取）
├── review-store.ts     AI 层建议存取（~/.cairn/console/ai-reviews.json）
├── security.ts         令牌、Origin/Host 校验、掩码
├── server.ts           node:http 路由 + 静态资源内联
├── export.ts           单文件 HTML 生成
└── assets/             ui.css / ui.js（构建期作为字符串内联，非运行时文件依赖）
```

理由：静态导出与工作台的差异如果落在渲染层，会出现"两套界面两套 bug"。把差异收敛到传输层，视觉与信息架构只有一份实现。

`--export` 不启动监听（spec 明确要求），因为它要在无端口权限的环境下可用。

### D2 零新增依赖

HTTP 用 `node:http`；模板用字符串拼接 + `JSON.stringify` 注入，不做运行时模板引擎；样式与脚本在构建时内联为字符串常量（`tsc` 前由 `scripts/build-ui-assets.mts` 读取 `assets/` 生成 `assets.generated.ts`）。

放弃 express / react / vite 的理由：当前 `dependencies` 仅 3 项（MCP SDK + 两个 noble 加密库），引入前端栈会把安装体积、审计面和升级负担一次性抬上去，而本界面的交互复杂度（5 个视图、1 个队列、3 个写动作）远低于需要框架的门槛。

代价：没有组件化与热更新；改样式要重新 `npm run build`。接受。

### D3 API 契约（薄映射，不造新语义）

所有端点前缀 `/api`，返回 `{ ok: true, data }` 或 `{ ok: false, error: { code, message, findings? } }`；错误码沿用 `CairnError.code`。

| 方法 | 路径 | 映射 | 写 |
|---|---|---|---|
| GET | `/api/status` | `status()` + `doctor()` 摘要 | 否 |
| GET | `/api/scopes` | `store.scopes` 全量 + 每层 memory 计数 | 否 |
| GET | `/api/memories?scope=&status=&kind=&q=&mode=&limit=` | `search` / `showMemory`；`mode=full` 返回完整 `content`，`mode=brief` 返回 `summary` | 否 |
| GET | `/api/memories/:id` | `showMemory`（含修订与证据） | 否 |
| GET | `/api/archives` | `import_archive` 聚合（含 clean/blocked 拆分） | 否 |
| GET | `/api/archives/:id/items?state=&mode=` | `import_item` 分页 | 否 |
| GET | `/api/batches` | 全批次聚合（51 行） | 否 |
| GET | `/api/batches/:id` | `batchStatus` + `batchChunk` | 否 |
| GET | `/api/plans` | `onboarding_plan` + `approval` 联表 | 否 |
| GET | `/api/plans/:id` | `planSummary` | 否 |
| GET | `/api/reviews?batch=&item=` | 两层建议联查（rule + ai），含分歧标记 | 否 |
| GET | `/api/inbox?limit=` | 待处理队列（跨批次聚合 + 排序） | 否 |
| GET | `/api/sync/status` | `vaultStatus` | 否 |
| POST | `/api/reviews/run` | 重算规则层建议（产出一批 `runId`） | 是 |
| POST | `/api/reviews/pack` | 生成复核包文件，返回路径、条数、字符数 | 是（写文件） |
| POST | `/api/reviews/import` | 回填 AI 层建议（逐条校验，整批拒绝） | 是 |
| POST | `/api/plans` | `proposeForBatch`（body: batchId, scope, items[]） | 是 |
| POST | `/api/plans/:id/approve` | `approve(id, { channel: 'webui' })` | 是 |
| POST | `/api/plans/:id/apply` | `applyPlan` | 是 |
| POST | `/api/sync/push` | `syncPushCmd` | 是 |
| POST | `/api/sync/pull` | `syncPullCmd` | 是 |

不提供 `POST /api/memories`、`DELETE /api/memories/:id`、`POST /api/memories/:id/forget`——这三类动作留在 CLI/MCP，避免"网页上删记忆"这种不可逆操作只差一次误点。

### D4 双层建议：确定性规则打底，AI 判断叠加

建议不是一棵单向管线，而是**两层并列呈现、由人裁决**。

```ts
type Action = 'promote' | 'merge' | 'keep_both' | 'skip' | 'needs_human';

interface ReviewSuggestion {
  itemId: string;
  batchId: string | null;
  layer: 'rule' | 'ai';
  action: Action;
  targetMemoryId: string | null;
  reason: string;              // 人可读的一句话
  basis: BasisEntry[];         // 证据数组，逐项可复算
  ruleId: string | null;       // rule 层：S-DUP-EXACT 等
  model: string | null;        // ai 层：模型/Agent 标识
  producer: string;            // 'engine' 或 agent id
  runId: string;               // 一次批量生成/提交
  createdAt: string;
}
interface BasisEntry { key: string; value: string | number; note?: string }
```

**存储位置**：规则层是纯派生，每次进页面按需重算（533 条规模毫秒级），不落盘、不需要失效逻辑。AI 层不可重算（重算要再烧一次模型），落 `~/.cairn/console/ai-reviews.json`：原子写、整文件带 `runId` 与生成时间、新批次覆盖旧批次的同 `itemId` 条目；同时往既有 `audit_event` 写一条 `category='review'` 的审计。

选文件不选新表，是为了**避免 schema 迁移**：加表要把 `user_version` 推到 3，而旧版 cairn 打开高版本库会按现有保护直接拒绝——回滚就得恢复备份。建议本身是派生数据，不值得为此付出回滚成本。

**规则层（`rule`）**——纯函数、无网络、可复算：

| 规则 | 条件 | 动作 | basis 关键项 |
|---|---|---|---|
| `S-BLOCKED` | `scan_state='blocked'` | `skip` | findings 类别与条数 |
| `S-DUP-EXACT` | `content_hash` 与任一 active 记忆相等 | `merge` | 目标 id、哈希前 12 位 |
| `S-DUP-NEAR` | trigram Jaccard ≥ 0.80 且非完全相等 | `merge` | 目标 id、相似度、公共 trigram 数 |
| `S-FRAGMENT` | 去空白长度 < 40 且非列表项 | `skip` | 实际长度 |
| `S-FRONTMATTER` | 仅有 YAML frontmatter 或标题行 | `skip` | 正文有效长度 |
| `S-CODE-HEAVY` | 代码行占比 > 0.6 | `promote` | 代码行比 |
| `S-NUMERIC-CONFLICT` | 与目标记忆共享 ≥3 关键词但数值集合不相交 | `needs_human` | 矛盾数值对（掩码后） |
| `S-CLEAN-DEFAULT` | clean 且以上均不命中 | `promote` | 长度、kind 推断依据 |

**AI 层（`ai`）**——由当前 Agent 会话内显式请求产生，其职责是补规则够不到的那部分：语义重复、价值判断、kind 归类、跨条目合并顺序。写入路径固定为"复核包 → Agent 判断 → 写回"：

```
cairn review pack --batch <id> [--limit N] --out review.json
        ↓ 用户在 Agent 会话里让 Agent 读该文件并逐条给判断
cairn review submit --input review.json      （MCP: memory_review）
```

复核包含 `itemId` + 正文片段（默认 1200 字符/条，可调）+ 规则层结论 + 动作枚举 + 期望输出 schema。生成时在 stdout 打印条数与字符总量，让用户先知道"要发出去多少"。

写回时确定性校验：`itemId` 必须存在且属于该批次；`action` 必须在枚举内；`reason` 非空；`targetMemoryId` 若给出必须存在；正文里出现的秘密形态按现有 `scanText` 复检，命中即拒绝写入。**任何一项不过整批拒绝**，不做部分写入。

**两层不一致时**：UI 并列显示两个 chip，标出分歧类型（动作不同 / 目标不同 / AI 判 `needs_human`），不做任何自动合并。用户必须点选一个作为"采纳"，该选择才进入计划草稿。默认不预选——预选会诱导盲从。

**为什么把 AI 放在会话里而不是 UI 里**：控制台一旦直连模型，就要在本地存 API key、把记忆正文发到外部、并且用户再也说不清"谁读过我的记忆"。走会话则天然继承既有的授权边界——是用户在某个会话里主动要求的。

排序：`needs_human` 优先，其次按 `merge` > `promote` > `skip`；同层同动作按 batch remaining 降序；两层都有建议时按"采纳后能减少的待处理量"排。

界面上的"采纳"只做一件事：把选择结果组装成 `items[]` 预填计划草稿，然后走 `POST /api/plans` → 审批 → 应用。用户可逐条改动作。

### D5 审批通道参数化与人机边界

改动：`AppService.approve(planId, opts)` 增加 `opts.channel?: 'cli' | 'webui'`，默认 `'cli'`（保持既有调用点行为与审计不变），审计 action 由 `issued_via_cli` 泛化为 `issued_via_<channel>`，同时保留 `channel` 字段。

技术上无法证明"点击的是人还是脚本"——这是本设计的**已知边界**，必须在文档与界面上如实呈现，不做过度承诺。可做的加固：

1. 令牌只在启动时打印到 stdout，不写入文件、不写日志、不出现在页面源码之外的任何地方（页面通过 URL fragment 携带，首次加载后转为 `SameSite=Strict; HttpOnly` Cookie，并 302 抹掉地址栏中的令牌）。
2. 签发要求页内输入计划哈希前 8 位（`plan_hash` 前 8 位在计划详情显眼处展示），把"误点"和"盲签"都挡掉。
3. 一次性审批 TTL 沿用 30 分钟、单次使用；计划哈希变动即失效（现有触发器）。
4. 审计事件记录 `channel=webui` + 计划哈希前缀，事后可区分是谁在哪签的。

### D6 安全边界

| 风险 | 措施 |
|---|---|
| 任意网页跨站请求本地端口 | 全部 `/api/*` 需令牌；非 GET 必须 `Origin: http://127.0.0.1:<port>` 或 `http://localhost:<port>`；`SameSite=Strict` Cookie |
| DNS rebinding | `Host` 头白名单（`127.0.0.1:<port>` / `localhost:<port>`），否则 403 |
| 令牌泄漏到历史/日志 | URL fragment 承载 + 首次交换 Cookie 后 302 清除；`Cache-Control: no-store`；令牌不写 stderr/stdout 日志（仅一次启动提示） |
| 敏感正文外泄 | `sensitive='sensitive'` 与 `scan_state='blocked'` 默认掩码（`•••` + 长度 + 哈希前缀）；揭示为单条显式动作，响应头 `no-store` |
| 静态文件被转发 | **默认含完整正文（记忆含 sensitive、快照含 blocked）**，技术上无法阻止转发，只能三层告知：`-personal` 文件名、文件头警示、导出时 stdout 提示；需要外发时用 `--redact` |
| 端口被其他进程占用 | 默认 7767，占用则换系统分配的端口并打印实际 URL |

所有校验失败一律返回 401/403 且不返回任何记忆字段（不只是空 body，避免长度侧信道）。

### D7 视觉系统（沿用 Archify 的真实 token）

本机已安装 Archify：`~/.workbuddy/skills/archify` 是指向 `D:/DevelopEnvironment/skills/archify` 的符号链接。以下色值与字体取自其 `assets/template.html` 的 `[data-theme]` 块（第 173–257 行），不是凭印象复刻。

沿用它的骨架：单文件自包含、`data-theme` 切换、面板 + 边框分层的扁平卡片、标签胶囊、克制动效、键盘优先。

改造的是语义分配。它的 7 类组件色正好覆盖 cairn 的状态语义，我一一对应，不新造色板：

| Archify 角色 | 暗色 | 亮色 | cairn 语义 |
|---|---|---|---|
| `--cloud-stroke` (amber) | `#fbbf24` | `#d97706` | 待处理、待签批、需注意 |
| `--backend-stroke` (emerald) | `#34d399` | `#059669` | 健康、clean、已同步 |
| `--database-stroke` (violet) | `#a78bfa` | `#7c3aed` | 待晋升、候选、AI 层建议 |
| `--frontend-stroke` (cyan) | `#22d3ee` | `#0891b2` | 作用域与层级标签、信息态 |
| `--security-stroke` (rose) | `#fb7185` | `#e11d48` | 敏感、blocked、两层分歧告警 |
| `--messagebus-stroke` (orange) | `#fb923c` | `#ea580c` | 同步待办、outbox |
| `--external-stroke` (slate) | `#94a3b8` | `#64748b` | 未使用层级、次要元数据 |

底色与文本直接复用：暗色 `--bg #020617`、`--panel rgba(15,23,42,0.5)`、`--panel-border #1e293b`、`--text #ffffff`、`--text-muted #94a3b8`、`--mask #0f172a`；亮色 `--bg #f4f5f7`、`--panel #ffffff`、`--panel-border #e5e7eb`、`--text #111827`、`--mask #ffffff`。

chip 填充沿用它的低透明度做法（暗色 `rgba(245,158,11,0.13)` 这一档），避免大面积高饱和。

字体：正文沿用 Archify 的系统栈 `-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif`。

一处有意偏离：Archify 内嵌了 JetBrains Mono 的 woff2 子集（十余个 `@font-face`），本控制台不内嵌，改用系统等宽栈 `ui-monospace, 'Cascadia Mono', Consolas, Menlo, monospace`。等宽只用于哈希、规则 id、ID 前缀这些短串，把体积让给记忆正文更划算。

布局：左侧视图导航（预览 / 工作台 / 待处理 / 同步）+ 主区。主区上方四张摘要卡（记忆、快照、批次欠账、待签批），下方按视图展开。作用域层级用可折叠 frame（外框 + 层级标签）；记忆用卡片（kind 徽标 + 状态 chip + 摘要或全文 + 修订数）；建议用并列 chip（rule 与 ai 两枚，规则 id 可展开看 basis）。

键盘：`1`–`4` 切视图、`/` 聚焦检索、`P` 待处理、`T` 切主题、`M` 切摘要/全文、`?` 帮助浮层、`Esc` 关闭浮层。所有可交互元素有可见焦点环。

动效：仅两处——待处理队列首次渲染的 stagger fade（≤180ms，逐条间隔 20ms）、状态变更后 chip 高亮脉冲一次。`prefers-reduced-motion: reduce` 时全部退化为无动画。

主题：默认跟随 `prefers-color-scheme`，手动切换写入 `localStorage`；静态导出把当前主题写进 `<html data-theme>` 作为初始值，避免闪白。

### D8 静态导出：默认完整正文

产物：单个 `.html`，内含 CSS、JS、数据（`<script type="application/json" id="cairn-model">`）。不含任何 `http(s)://` 外链。

**默认策略按用户要求改为"完整正文"**：

| 内容类别 | 默认 | 开关 |
|---|---|---|
| `memory`（active / candidate 等）正文 | 完整输出，含 `sensitive='sensitive'` | `--redact` 回到掩码模式 |
| `import_item`（clean）正文 | 完整输出 | 同上 |
| `import_item`（blocked）正文 | 完整输出（按用户要求：完整优先于默认保守） | 同上，`--redact` 时回到掩码 + findings 类别 |
| `source_label` 绝对路径 | 转为 `~` 相对形式 | 无开关（避免泄漏用户名与目录结构） |

这使导出文件成为**含明文本地记忆的产物**，不再是可随手转发的普通报告。因此：

- 默认文件名追加 `-personal` 后缀（`cairn-preview-personal.html`）。
- 文件头放一行显式警示：含明文本地记忆，请勿外传。
- 导出完成时 stdout 打印一句同样的提示，并给出条目数与字符总量。
- `--redact` 是唯一的反向开关：`sensitive` 记忆正文与 `blocked` 条目正文一并换成 `{ masked, length, hashPrefix }`，供确实要发出去的场景使用。不再提供单独的 `--include-blocked`——两个开关同时存在会产生"我打开了 A 却以为也打开了 B"的组合歧义。

体积：memories + 533 条 item 正文约 150 KB，加 HTML/CSS/JS 约 60 KB，产物 ~300 KB 量级。超过 8 MB 时降级为"元数据 + 前 500 条正文"并在文件头标注被截断的条数（不静默截断）。

### D9 并发与只读快照

控制台持有**只读连接**（`readOnly: true`），与 CLI/MCP 的写连接并存。SQLite WAL 下只读连接可并发读已提交快照；`busy_timeout` 仍设置以防 checkpoint 冲突。

已知风险（历史事实）：`~/.cairn` 曾在冷启动并发时出现 `SQLITE_READONLY`。缓解：控制台只在库已初始化后启动（`open.ts` 走既有初始化路径，不新建库）；若启动时读写目录不可写，直接报错退出而不是降级。

### D10 可恢复的视图状态：查询与展示模式

视图状态不是前端私有变量，而是可寻址的状态。三类参数进 URL：

| 参数 | 取值 | 作用 |
|---|---|---|
| `view` | `preview` \| `workbench` \| `inbox` \| `sync` | 当前视图 |
| `q` | 任意字符串 | 检索词 |
| `scope` / `status` / `kind` | 枚举或 `all` | 过滤条件 |
| `mode` | `brief` \| `full` | 摘要 / 完整正文 |
| `batch` / `plan` | id | 展开的详情 |

刷新行为：页面加载时从 `location.search` 解析上述参数，**自动重放查询**（一次请求，不逐项请求），刷新后停在同一视图同一结果同一展开项。任何过滤或检索动作都以 `history.replaceState` 回写 URL，不产生历史栈噪音；切换视图用 `pushState`，让浏览器后退可用。

检索本身：输入 300ms 防抖后调用 `GET /api/memories?q=&...`，走既有 `search()`（FTS5 trigram），**不在前端做过滤**——前端过滤会让"显示 20 条"与"库里有 200 条"混淆。命中数在结果区顶部如实显示。

摘要/全文切换：`mode=brief` 时正文截断到 240 字符 + 首行标题；`mode=full` 显示完整正文（`pre-wrap`，长行软换行，代码块保持等宽）。切换是纯前端渲染分支 + 一次 URL 回写，不重新请求（数据已全量取回时）或重新请求（`brief` 模式下服务端已裁切时）。实现取后者：`/api/memories` 按 `mode` 决定返回完整 `content` 还是 `summary`，避免把全文无谓地送到浏览器。

偏好持久化：`mode` 与 `theme` 写 `localStorage` 作为**默认值**，URL 参数优先于 localStorage——保证分享链接能还原对方的视图，而不会被本机偏好覆盖。

静态导出产物同样支持 URL 参数（`file:///...html?view=inbox&q=xxx`），但默认打开时用导出时刻的视图与 `mode=full`。

## 威胁模型

| 攻击者 | 能力 | 结论 |
|---|---|---|
| 本机其他用户 | 可访问 loopback 端口，不知道令牌 | 被令牌拦截；令牌仅在启动进程的 stdout |
| 本机同用户恶意脚本 | 读得到 stdout/文件系统 | **无法防御**，等价于"Agent 能读你的终端"。如实文档化，不宣称隔离 |
| 恶意网页（CSRF） | 可向 loopback 发请求 | 令牌 + Origin + SameSite 三重拦截 |
| 恶意 DNS 记录 | 可解析到 127.0.0.1 | Host 白名单拦截 |
| 静态文件接收者 | 拿到导出的 HTML | **默认含完整正文（记忆含 sensitive、快照含 blocked）**：靠 `-personal` 文件名后缀、文件头警示、导出时 stdout 提示三层告知；接收方无法被技术阻止，只能被提醒。需要外发时用 `--redact` |

## 迁移与回滚

- 无 schema 迁移，`user_version` 保持 2。这是刻意选择：加表会把版本推到 3，旧版 cairn 打开高版本库会按现有保护直接拒绝，回滚代价从"删目录"变成"恢复备份"。
- 新增数据面只有两处，都是派生物：`~/.cairn/console/ai-reviews.json`（AI 层建议）与临时复核包文件。删掉即回到干净状态，不影响任何记忆。
- 审计侧变化：新增 `action`（`issued_via_webui`、`review.pack`、`review.import`、`review.run`），既有记录不改写、不迁移。
- `approve()` 新增参数有默认值，MCP/CLI 现有调用点行为不变；回归测试需断言默认通道仍为 `cli`。
- 回滚 = 删除 `src/interfaces/console/`、回退 `main.ts` 的 `ui` 与 `review` 分支、回退 `approve` 签名、删除 `~/.cairn/console/`。库内容与 schema 均不受影响。

## 故障注入

| 注入 | 期望 |
|---|---|
| 控制台进程 `kill -9` | 库一致可读，`cairn doctor` 仍 ok，MCP 会话不受影响 |
| 同步时断网 | 返回失败类别，本地库无回滚，界面可重试 |
| 令牌错误 / 缺失 | 401，无字段泄漏 |
| `Origin` 缺失（POST） | 403，状态不变 |
| 审批过期后应用 | 治理拒绝码，界面提示重新签发 |
| 库被写入进程长时间持锁 | 读请求在 `busy_timeout` 内等待或返回可重试错误，不崩 |
| 导出的文件无网络打开 | 全部功能可用（除"打开工作台"按钮隐藏） |

## 可观测性

- 每个 `/api/*` 请求记一行 stderr 访问日志（方法、路径、状态码、耗时、是否写操作），**不记正文与查询值**。
- 写操作额外写 `audit_event`（`category='console'`），含通道、计划哈希前缀、结果。
- `cairn ui` 启动时打印：监听地址、端口（含换端口说明）、库路径、视图数、被跳过的高敏条目数。
- 不引入指标端点与埋点。

## 待决与其他选项

- **实时刷新**：v1 手动刷新 + 进入视图时重取。SSE/WebSocket 推送留作开放项——记忆写入频率低（当前 active 2 条），实时化的收益不足以承担常驻连接与跨标签页一致性的复杂度。
- **端口**（已定）：默认 `7767`，占用则回退操作系统分配的空闲端口，实际 URL 一律打印到 stdout。不做固定端口绑定。
- **是否允许在 UI 里"揭示全部"**：工作台只允许逐条揭示，不做批量揭示。静态导出因为要完整正文，是全量输出的——两者的风险面不同，不能用同一套策略。
- **AI 层建议的重算成本**：一次复核包可能覆盖上百条，Agent 侧会消耗可观 token。v1 只提供 `--limit` 与按批次生成，不做自动全库复核。
