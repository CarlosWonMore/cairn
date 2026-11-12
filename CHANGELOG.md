# Changelog

本文件记录 `@carloswon/cairn-memory` 的显著变更。格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## [Unreleased]

### Added
- **MCP 工具面进程内冻结**：ListTools 结果在单个 server 进程生命周期内字节稳定——onboarding 条件工具在启动时判定一次，运行中库状态翻转（另一进程 import、会话内治理动作）不再增减工具，消除「不升级不重启」前提下唯一的工具 schema 变化向量（该向量曾造成 prompt 前缀缓存整包重算）。判定失败 fail-closed 降级不拒启。
- **检索条目携带作用域边界属性**：`memory_search` / `memory_context` 每条命中带 `scope_preset`（人读作用域名）+ `sensitivity` + `sync_policy`，无需另发详情调用。DSH 插件注入闸由空转变为真实生效（fail-closed：标签缺失＝不可注入，计入面板「已过滤」），面板左右栏为注入条目渲染作用域徽章。
- **两段式检索：列表给预览，全文按需取**：`memory_search` / `memory_context` 条目返回有界预览（300 字符、frontmatter 感知、确定性单行）+ `truncated` + `content_length`，不再返回全文；`memory_get` 支持唯一 id 前缀（≥8 字符，歧义报候选绝不猜测）与批量 `ids`（上限 10，逐条作用域检查，不可读条目只返回标记不带正文）；DSH 注入行携带 16 字符记忆标识，模型可据此下钻。诚实口径：省的是单次检索 token 与长尾，不是端到端倍数。
- **检索可按项目身份过滤**：`memory_search` 增可选 `project` 参数（UUID 或已登记别名），项目作用域记忆可被召回；别名解析**只查不建**，未登记报错并指引 `project_resolve`；携带项目身份不放宽设备/Agent/读允许名单检查。DSH 插件新增 `projectPath` 配置：懒解析一次并缓存，解析失败降级为不带项目召回并在面板如实提示；未配置时行为与从前逐字节一致。
- **`cairn sync push` 推送前提示上行缺口**：推送前做一次只读缺口检查（与 `doctor` / `backfill` 共用 `findUpstreamGap`），有缺口就向 stderr 报条数并说明「这些记忆尚未入队，本次推送不包含它们」、指向 `cairn sync backfill --apply`；推送照常执行、退出码不变、不入队，零缺口时完全静默。此前缺口只出现在 `doctor` 的 `notes` 里，不主动查就不知道。
- **受限的备份对象删除（`DELETE /chunks/<key>`）**：syncd 只放行解码后含 `/backups/` 的对象，同步链的 chunk/manifest 一律 403（只追加语义，删了会让对端拉取永久卡在缺口）；删除复用既有 `safeKey()` 防穿越，对象不存在也返回 200（幂等）。`/manifests/` 不开放删除。
- **`cairn backup --purge-remote <name>`**：显式删除单个远端备份对象，删前打印对象名与大小；远端不支持删除（旧版 syncd）时明确报错，不做假成功。
- **保留策略在 syncd 后端真正生效**：`SyncdRemoteStore.deleteObject` 接通后，超出保留份数的旧备份会被实际淘汰；旧版 syncd 的 404 被识别为「不支持删除」并降级为 `pruneWarning`（不会静默假装已清理）。

## [0.5.0] - 2026-11-12

项目身份与作用域治理、AI 提案卡、设备备份上云。四个 OpenSpec 变更归档，主规格 10/10 严格通过。

### Added
- **设备备份的云端加密容灾（`cairn backup --upload`）**：本地一致性快照用设备专属密钥加密后上传到远端（独立前缀 `backups/<设备>/`，与同步事件链互不干扰）。只有生成它的设备能解开（密钥派生混入 deviceId，其他设备拿到密文也无密钥材料）；保留策略默认保留最近 5 份、只淘汰本设备前缀且删除前列出（syncd 暂无 DELETE 路由，诚实降级为只上传不删除）。`backup --list-remote` 列出本设备备份；`restore --from-remote` 下载 → 解密 → sha256 比对 → 快照校验后还原，**默认到新路径**，覆盖当前库必须 `--force` 且自动先备份当前库。
- **AI 修订提案（方案卡，`cairn revision`）**：Agent 针对批注出具「改什么、为什么改」的结构化提案（MCP `revision_propose` / `revision_list`），人通过 CLI `revision list|show|apply|reject` 或控制台「修订提案」视图确认后才生效。采纳复用既有 `reviseMemory` 修订链（不可变历史 + 秘密复检 + 上行入队），权威记 `user_confirmed`；版本一致性两层校验，记忆已被改过则拒绝并标陈旧；工具面**刻意不含 apply**——Agent 只有提案权，没有写入权。
- **作用域迁移（`cairn rescope`）**：活动记忆可换作用域，不删不重建——id、修订历史、证据链、权威级别全保留，只改 `scope_id`。安全阀：冲突状态拒绝、缺 projectId 拒绝（不静默降级）、`user_explicit` 记忆需 `--force`。迁移与 outbox 重建同事务：作废旧作用域 pending 上行、按新作用域重新入队。批量 `--ids-file` 逐条报告，单条失败不中断；`--pending` 处理控制台「需迁移作用域」批注（先列清单再逐条执行）。退出码合同：用法 2 / 治理拒绝 3 / 冲突 4。
- **`scope_exit` 迁出通知事件**（schema v6）：记忆迁出可同步作用域时，对端把本地副本标为「不再持有」（archived + meta 标记，**无墓碑、不删数据**），检索与投影不再返回；迁回时强制重发修订快照（`reentry` 标记）自动解除标记；迟到修订按幂等跳过；旧版本收到未知事件类型跳过并审计、不阻断整链。云端既有密文不随迁出删除。
- **批注类别 `needs_rescope`**：控制台可标记「需迁移作用域」，与 `pending_forget` 同一哲学——批注只表达意图，执行在终端 `cairn rescope --pending`。
- **稳定的项目身份（UUID + 别名）**：项目主键改为 UUIDv7，路径与 git 地址只作为 `project.aliases` 里的别名。仓库改名（GitHub → Gitee、org 改名）或换设备改路径后，追加一条别名即可让新旧地址解析到同一个项目，既有记忆归属不变。新增 `cairn project resolve|list`、`cairn project alias add <project-id> <path-or-url>`，以及 MCP 工具 `project_resolve` / `project_list`——CLI 与 MCP 共用 `src/store/projects.ts` 同一实现。
- **别名归一化**：`https://Host/o/r.git`、`git@host:o/r.git`、`ssh://git@host/o/r.git` 视为同一项目（去凭据、host 小写、去 `.git`）；路径统一盘符大小写与分隔符并去尾斜杠，但**保留目录名大小写**（Linux 上 `Proj` 与 `proj` 是两个目录）。不做模糊匹配、不校验路径是否存在（跨设备解析必需）、不自动上溯父目录。
- **别名冲突拒绝**：把已属于其他项目的别名追加到当前项目时抛 `E_CONFLICT_STATE`（退出码 4）并报告归属，不改任何数据；别名追加写 `project` 类目审计。

- **记忆批注与待处置队列（WebUI 标注 → Agent 处置）**：控制台新增「批注」视图；记忆列表支持多选批量标记，记忆详情可对单条写下处置意见（需要修改 / 需要合并 / 可以删除 / 存疑待查 / 无需处理 / 标记待删）。批注落在 `<home>/console/annotations.json`，**不建表、不参与云同步、不进入上行包**；记忆正文、状态与修订链完全不动。记忆修订后批注标「意见可能已过时」并灰显（不删）。
- **`cairn forget --pending [--dry-run]`**：WebUI 只能把记忆标为待删；真正删除只在这个终端入口执行，且**先打印全部待删清单（id + 摘要 + 标注时间）再逐条遗忘并逐条报告**。删除复用既有 `forgetMemory`，走同一套 tombstone 与 outbox 上行语义。
- **MCP `memory_annotations_list` / `memory_annotation_resolve`**：Agent 可拉取用户的批注并按 `resolved` / `ignored` 回写；读取不返回记忆正文全文，回写只改批注状态并记录处置者与时间。
- **`cairn doctor` 的待办批注提示**：只进 `notes` 一行，不进 `problems`、不改退出码。
- 批注写入前复用 `scanText`：命中秘密或注入规则即拒绝，不回显原文、不脱敏保存。

### Changed

- 新建项目默认显示名取归一化后的别名（原始 URL 可能带凭据，不落 `project.name`）。已有项目行与其 `id` 一律不动。

## [Plugin 0.4.2] - 2026-11-12

DSH 插件：上下文压缩后重注入。

### Added

- **DSH 插件压缩后重注入**（`@carloswon/cairn-dsh-memory`）：插件在本会话内追踪「涉及过的记忆」——注入过的，以及经 MCP `memory_get` / `memory_add` / `memory_update` 读过写过的；`compaction/end`（无 `error`）时按独立预算（`budgetBytes × reinjectBudgetRatio`，默认一半）重渲染并在下一步 `pre-step` 投递，不依赖下一句是否命中关键词。表头与常规召回措辞不同；重注入的 id 立刻回填去重集合，避免下一步重复注入；追踪集合纯内存、上限 `trackMax`（默认 200，超出按最近使用淘汰）。压缩失败不重注入、不清去重。回滚：`reinjectOnCompaction: false`。

### Changed

- 插件版本与内核不再强绑：内核 0.5.0 与插件 0.4.2 各自独立发版，部署时按各自版本对齐。

## [Plugin 0.4.1] - 2026-11-10

修复 `@carloswon/cairn-dsh-memory@0.4.0` 导致 DSH 启动进入恢复模式的缺陷。

### Fixed

- **插件包 0.4.0 不可用**：`src/client.js` 的 `window.__ModuleLoader__.load({ id })` 仍注册改名前的短名
  `cairn-dsh-memory`，而宿主按 `package.json` 的 `name`（`@carloswon/cairn-dsh-memory`）建立 client 图行。
  两者不一致时 `ClientEntries.arrive()` 查不到该 factory，会退回单包 URL **再执行一次** bundle，
  第二次 `register()` 撞到已存在的 id 并抛出
  `duplicate factory registration for "cairn-dsh-memory"`，整个 client entry 无法激活，
  渲染进程重试耗尽后进入恢复模式。现注册 id 改为与包名完全一致。
- 注册 id 必须等于包名这一点已写入 `client.js` 注释，避免再次改包名时漏改。

> 0.4.0 已在 npm 标记为 deprecated，仅用于留档。

## [0.4.0] - 2026-11-10

上行入队完备性、冷启动对账，以及 DSH 插件召回记录的口径修正。
两个 OpenSpec 变更归档，主规格 10/10 严格通过。

### Added

- **`cairn sync backfill [--apply] [--limit N]`**：补齐「作用域允许上行但从未入队」的活动记忆。默认只读，`--apply` 才写本地 outbox；**只写本地队列，不产生任何网络请求**。判定不限制既有任务状态——只要历史上存在过任意一条 `sync_upstream`（含 done / dead）就不算缺口，否则已推过的记忆会被反复重报。
- **`CAIRN_SYNCD_URL` 环境变量**：`vault init-remote --provider syncd` 的 `--base-url` 现可省略，缺省取该变量。优先级「命令行 > 环境变量 > 报错」。**token 仍只走环境变量、绝不写进 vault.json**；baseUrl 属配置，照旧落在 vault.json。
- **`doctor` 的 `counts.upstreamGap`**：同一口径的上行缺口计数，健康时恒为 0；非零时在 `notes` 给出指向 `sync backfill --apply` 的提示。**不进 `problems`、不改退出码**——缺口是可自愈状态，不是库损坏。

### Fixed

- **治理写入漏上行**：`applyPlan` 的 `add` / `keep_both` / `merge` 三条分支直接调存储层，**绕过了 outbox 入队**。实测真实库 `personal-global` 的 42 条 active 记忆里 23 条完全没有 `sync_upstream` 任务（全部来自 `plan:%`），即自动整理产出的记忆**一条都上不了云**，且 `sync push` 会安静地"成功"。现按目标记忆的实际作用域逐 op 补入队，幂等键与手工写入路径一致。
- **`rejectCandidate` 不上行**：拒绝候选转墓碑时不入队，而 `forgetMemory` 入队——同一语义两种行为。现对齐。
- **`applyDecision` 的 `merge` / `promote_candidate` 分支**不给目标补上行任务，现补齐。
- **DSH 插件把「已去重」记成「注入0」**：同一记忆本会话注入过后，后续每步都返回 `nothing_new` 且 `selected=0`，活动记录因此显示「注入0 (nothing_new)」——与左栏「已注入 25 条」自相矛盾。现区分三态（已注入 / **已去重** / 未命中），措辞里带本会话累计条数。
- **活动记录被空步淹没**：环上限 120，空步每步一条，实测 120 条里只有 3 条带真实注入，面板默认只显示最近 15 条 ⇒ 真实注入永远不可见。现把连续空步折叠为一条并记次数，**带注入条目的记录永不折叠**。
- **去重状态不随上下文压缩重置**：`resetSession()` 此前全仓零调用点，与「直到会话上下文被压缩或重置」的要求不符——长会话越用越注入不出东西。现挂 `session/event` 判 `type === 'compaction/end'`（压缩失败即带 `error` 时不重置）。

入队**刻意不下沉到 `src/store/memories.ts`**：拉取侧 `src/sync/apply.ts` 也走存储层，下沉会让 `sync pull` 给自己制造上行任务，形成回环推流。该边界用回归用例钉住。

## [0.3.0] - 2026-11-04

候选的批准/拒绝出口，以及治理投影「谁进得去」的重要度与使用信号。两个 OpenSpec 变更归档，主规格 10/10 严格通过。

### Added

- **候选晋升与拒绝**（`add-candidate-promote-command`）：候选（`status=candidate`）此前**没有任何合法晋升入口**——唯一路径是用逐字节相同的正文再写一次，撞查重后被动晋升，且无法表达作用域意图。现在：
  - `cairn promote <id> [--scope-preset <preset>]`、`cairn reject <id> "<理由>"`，以及 MCP 工具 `memory_promote` / `memory_reject`。
  - 晋升后权威记为 `user_confirmed`（用户**审阅并批准**），不沿用候选的 `agent_inferred`，也不伪装成 `user_explicit`（用户亲口陈述）。
  - 批准凭据是本地 CLI 进程本身，通道记入审计；**不可被远端或 Agent 代签**。
  - **晋升可同时迁移作用域**，与状态更新同事务，并按新作用域**重建 outbox**（旧作用域任务若照发会把记忆同步到错误的云端空间）。
  - 拒绝转墓碑而非物理删除，可审计、可恢复。
- **记忆重要度 `importance`**（1–5，`add-memory-importance-and-usage-signal`）：与 `confidence`（可信度）正交。`memory_add` / `memory_propose` 可指定；缺省 3（未判断）；`agent_inferred` / `imported_unverified` 来源**上限 3**（不得自封高星挤占预算）；越界报错不静默截断。
- **使用信号双轨**：`last_used_at`（被看到）与 `usage_count`（被主动请求）。自动注入**只写前者**——插件每轮都注入（实测 97% 重复），计入次数会让注入频率取代真实需求，形成正反馈死锁。
- **投影排序与三条地板**：`有效重要度 × 艾宾浩斯衰减`，带 ①`importance≥4` 豁免 ②本轮高度相关豁免 ③绝对地板 0.5。没有地板的话，被注入过的更容易被注入，一年后只剩少数明星记忆可见。
- **过期归档**：`cairn doctor --archive-stale [--apply]`，`importance=1` 且 180 天未用 → `archived`（不删除，留审计）。默认演练；**不挂在写入/检索路径上**。

### Changed

- MCP `memory_search` 新增 `increment_usage` 参数（缺省 `true`）。**宿主插件自动召回必须传 `false`**。
- 检索结果 `summarize` 带出 `importance` 与 `usage_count`，供面板显示「这条为什么被选中」。
- 迁移 005 只做 `ALTER TABLE ADD COLUMN` + 建索引，**不重建表**——与 004 不同，这两列没有硬编码 CHECK 约束，没有理由再付一次「关外键 + DROP 旧表 + 重建 6 索引 3 触发器」的风险。

### Fixed

- `markUsed()` 自 0.1.x 起**从未被任何代码调用**（`last_used_at` 全库 0/45），现在接上检索路径，并区分注入/检索两种增量语义。

## [0.2.0] - 2026-11-02

DSH 实时记忆插件、`lesson` 类型、投影简报、跳过账本与宿主适配器。九个 OpenSpec 能力规格全部通过严格校验。

### Added

- **`lesson` 记忆类型**：表达「曾经判断错了」的纠正性认知，区别于 `fact`（事实）与 `procedure`（做法）。迁移 004 重建 `memory.kind` CHECK 约束并重建全部索引与 FTS 触发器。
- **受管投影简报**：把作用域过滤后的记忆摘要写入宿主的 `AGENTS.md` 受管块。按宿主分级预算——DSH / Claude Code / Cursor / Copilot 各 2 KB，WorkBuddy 8 KB，OpenClaw 不支持。超预算时按 confidence、updated_at、id 裁剪，并在块内写明未显示条数。
- **跳过账本**：`onboarding` 跳过的条目变成持久、可查询的事实（`markItemSkipped` / `listSkippedItems`），不再从待办队列里消失得无影无踪。
- **DSH 宿主适配器**：`cairn agent apply --host dsh` 走 Cordis patch，不写 `mcp.json`。
- **DSH 实时召回插件**：会话每步前按短查询召回、按预算注入、同会话去重。附会话内面板：按会话切片的注入记录、活动日志（所有经 Cairn 的操作留痕）、三态指示（已注入 / 已过滤 / 未命中），栏宽可拖拽并持久化。

### Changed

- 需求「记忆调用对用户可见」收紧到 500 字符以内，场景集合与约束强度不变。
- 投影摘要统一走同一份 `firstLine`（此前注入文本与面板各写一份，导致 frontmatter 记忆显示成 `---`）。

### Fixed

- 插件导出形状：Cordis 把函数导出当作 `apply` 调用并把 ctx 传成第一个参数，导致连续三轮 `cannot get property ... without inject`。改为模块级 `{ name, inject, apply }`。
- 工具调用入口：`ctx.tools.call` 不存在。真实入口是 `tools.get(name, scope)` → `definition.execute(args, exec)`。
- 去重早退覆盖真实状态：`pre-step` 每步都跑召回，去重后早退分支仍写 `lastUsage`，把上一步结果清空，面板因此恒显示「未命中」。
- 注入判定不再靠文本反推：`renderInjection` 直接返回 `includedIds`，避免截断长度不一致导致的假阴性。
- 召回被虚词带偏：`deriveQueries` 取词频最高的二字词，中文里几乎总是「是否 / 一个 / 这个」，会命中互不相干的记忆。新增虚词黑名单与相关性计分。
- 活动记录无独立滚动条：宿主在会话进行中把视图区设为 `min-height: auto`，面板 `overflow: auto` 不触发。

### Tests

- 根套件 668 项 / 667 通过 / 0 失败 / 1 显式 skip。
- DSH 插件 79 项全通过。
- `npm pack` 后安装到临时目录，`cairn doctor` 返回 `ok: true`。
## [0.1.0] - 2026-10-25

首个本地 MVP（OpenSpec 变更 `add-local-first-memory-mvp`）。

### Added

- 本地 SQLite 权威库：作用域（个人/设备/项目/Agent 私有/受约束自定义）、不可变修订链、证据与关系、冲突队列、可审计 tombstone、版本化迁移（并发安全）、一致性备份恢复、设备身份与克隆防护。
- 中文检索：FTS5 trigram + 两字中文有界 LIKE 回退；索引损坏自动降级，绝不返回全库。
- 治理：规范化计划（plan_hash 绑定）、本地一次性审批、幂等应用与续跑、并发冲突保留、秘密与提示注入三层阻断。
- 首次初始化：元数据发现（零正文读取）、不可变快照导入（imported_unverified + local_only）、分批整理与晋升游标。
- 接口：CLI（`cairn`）与 MCP stdio（`cairn-mcp`，8 个 memory 工具 + 4 个按需 onboarding 工具）；stdout 只含协议消息。
- 宿主配置：Claude Code / Cursor / Copilot / OpenClaw / WorkBuddy 的 plan→apply→doctor→uninstall，诚实分级 fixture-only/blocked。
- 后台任务：本地 outbox + `cairn worker run-once`；local_only/设备限定内容在任务生成前物理排除；默认不安装任何 hook。

### 边界（未实现，另立变更）

- 真实 ECS/OBS 云同步（outbox 仅为本地任务边界，`remote=not_configured`）。
- macOS/Linux 平台验证（当前仅 Windows x64 + Node 22/24）。
- 真实宿主 CLI 认证与本地模型抽取。