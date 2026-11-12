# 会话交接：四提案批量归档（2026-11-11～12）与后续推进路线

> 交接对象：下一个接手的 Agent。本文自足——不需要上一段会话的上下文即可开工。
> 项目约定见 `AGENTS.md`（先读）；长期日志见 `docs/M0-session-handoff.md`（2026-11-11 节是本次工作的浓缩版）。
> 接手前必读：[§5 接手纪律](#5-接手纪律给下一个-agent)与[§6 事故记录](#6-事故记录误触发真实云端上传)。

---

## 1. 本次会话完成了什么

用户要求把 OpenSpec 里全部 4 个未归档提案推进到「实现 → 验证测试 → 归档 → 提交」。**当日全部完成，OpenSpec 全清零**（`openspec list` 无活动变更），主规格 `openspec validate --specs --strict` 10/10 通过。

### 1.1 四个变更与其提交

| 变更 | 归档目录 | 内容 | 提交 |
|---|---|---|---|
| `add-stable-project-identity` | `archive/2026-11-11-add-stable-project-identity` | 项目身份 UUID + 别名（此前已实现，本次独立验证复跑 + 归档） | `af07fca`（实现本体在 `2bace73`） |
| `add-scope-migration` | `archive/2026-11-11-add-scope-migration` | `cairn rescope` 作用域迁移 + `scope_exit` 迁出通知事件 + 批注类别 `needs_rescope`；**schema v6** | `08e2b26` |
| `add-agent-managed-revision` | `archive/2026-11-12-add-agent-managed-revision` | AI 修订提案（方案卡）：MCP 只有 propose/list，采纳是人的动作 | `b18c520` |
| `add-cloud-backup` | `archive/2026-11-12-add-cloud-backup` | 设备快照加密上云：`backup --upload/--list-remote`、`restore --from-remote` | `e698ee0` |

另有两个收尾提交：`45daef1`（测试 typecheck 修复）、`10ee16c`（交接文档 + AGENTS.md 更新）。基点提交 `7c2a003` 是三个提案的原始 proposal。

### 1.2 验证证据（均已独立复跑，非自述）

| 项 | 结果 |
|---|---|
| `npm test` | **797 项 / 796 通过 / 0 失败 / 1 显式 skip**（基线 759 → +38） |
| `npm run test:ui` | **66/66**（原 46，新增修订提案视图点击链路 + 静态页无控件断言） |
| `npm run typecheck` | 0 错误 |
| `openspec validate --specs --strict` | 10/10 |
| 变异对照（每个变更各一次） | 正靶用例变红（`add-scope-migration` 2 条——迁出/迁入两条都直接断言被删语句的效果；其余各 1 条），还原复绿 |
| 负对照（每个变更各一次） | 零红 |
| 真实本地 syncd CLI e2e | backup upload → list → restore 全链路（`tests/sync/backup-remote.test.ts`） |

### 1.3 关键设计事实（改代码前必读，否则会踩同样的坑）

1. **`scope_exit` 是独立事件类型，不是墓碑**。对端「不再持有」= `archived` 状态 + meta 标记 `scope_exit:<memoryId>`（无墓碑、不删数据，检索免费排除）。**迁回靠 `reentry` 标记的强制重发修订快照**——普通 upsert 在修订未变时会被 push 的幂等检查跳过，对端永远收不到「重新持有」信号；迁出/迁回的 outbox 幂等键都**必须带时间戳**（固定键会被已完成历史任务挡住，`enqueue` 去重不分状态）。
2. **未知同步事件 = 跳过 + 审计 + 游标照常推进**。不能 throw——`applyEvents` 会把 throw 转成 waited，卡死该设备整条拉取链。
3. **迁出通知走独立 jobType `sync_scope_exit`**：`sync_upstream` 的入队有物理排除（local_only 作用域直接拒绝），且规格要求「迁移到 local_only 后未产生新的上行任务」。schema v6 为此重建了 `outbox_job` 表（CHECK 加值）。
4. **备份 ≠ 同步**：备份走 `backups/<deviceId>/` 独立前缀 + `deriveBackupKey(vaultKey, deviceId)`（独立 HKDF salt + 设备维度），只有生成它的设备能解开。对象名内嵌明文 sha256（`cairn-backup-<ms>.db-<sha256>.enc`），恢复链 = 解密(Poly1305) → sha256 比对名字内嵌值 → `verifyBackup`。`restore --from-remote` 默认还原到新路径；`--force` 覆盖前**自动先备份当前库**。
5. **`RemoteStore.deleteObject` 是可选方法**（`src/jobs/remote.ts`）：OBS 已实现；**syncd 无 DELETE 路由，保留策略诚实降级为只上传不删**（`pruneWarning` 明示）。这是有意不改 syncd 协议——升级属 §3 任务 B。
6. **采纳修订提案的权威是 `user_confirmed`**：落在 `ReviseOptions.authority`（`src/store/memories.ts`），MCP `memory_update` **不暴露**该参数——只有本地入口能传。版本一致性两层：提案层 `revisionIdAtPropose` + `reviseMemory` 的 `expectedCurrentRevisionId`。
7. **MCP 工具面即权限面**：`revision_propose` / `revision_list` 存在，**不存在任何 apply 类 MCP 工具**（有测试断言）。给 Agent 加新能力时保持这条边界。

### 1.4 文档与记忆已同步

- `docs/M0-session-handoff.md`：追加 2026-11-11 节（本次工作的浓缩版 + 流程教训）。
- `AGENTS.md`：四提案摘要 + 测试基线更新为 797/796/0/1。
- `docs/cairn-usage.md` / `docs/cairn-sync.md` / `docs/cairn-security.md` / `docs/cairn-auto-onboarding.md` / `CHANGELOG.md`：全部补齐（CHANGELOG 在 **Unreleased** 节，未发包）。
- cairn 记忆（跨设备）：episode id `01a1cb89-fa05-702d-9f04-bceebc68582a`；用户 Obsidian 手册 `知识区/AI/MySkillsAndMCP/MyOpenSourceProject.md` 已回写。

---

## 2. 当前状态快照（2026-11-12）

| 项 | 值 |
|---|---|
| 分支 / 工作树 | `main` / 干净（所有工作已提交） |
| OpenSpec | 无活动变更；10 个主规格 strict 全过 |
| 测试基线 | 797/796/0/1；e2e-ui 66/66 |
| schema | v6 |
| npm 版本 | 主包 `@carloswon/cairn-memory@0.4.0`、插件 `@carloswon/cairn-dsh-memory@0.4.1`（今日全部新能力在 Unreleased，**未发包**） |
| 真实库 | `~/.cairn/data/cairn.db`（表内 56 条：55 active + 1 tombstoned，2026-11-12 只读核对）；`doctor` ok、`upstreamGap 0`、remote=verified；`sync_upstream` 待上行 **1** 条、`sync_scope_exit` 0 条、已推送修订 43 条 |
| 真实 vault | provider=syncd，`http://100.65.135.122:8471`（ECS，tailnet-only）；`CAIRN_SYNCD_TOKEN` 在用户级环境变量（已实测会话可继承） |
| 远端备份对象 | 恰 1 份（见 §6 事故），syncd 无 DELETE 暂无法远程删除 |

---

## 3. 接下来如何推进（四个待办，均需用户拍板后才动手）

> 排序建议：B → C → A → D。B 让备份保留策略真正生效并清掉误传对象（A 不依赖 B）；C 独立且零风险；A 动真实云端，放最后并在动手前再向用户确认一次。

### 任务 B：syncd 加 DELETE/purge 路由（含误传对象清理）

**为什么**：备份保留策略在 syncd 后端当前只能「只上传不删」；§6 事故对象也清不掉。

**步骤**：
1. **走 OpenSpec 立项**（协议变更必须过流程）：`openspec new change add-syncd-purge`——提案要点（**以文件头协议注释为准**）：现有路由是 `PUT/GET /chunks/<key>`、`GET/PUT /manifests/<key>`、`GET /list?prefix=`、`GET /healthz`；**备份对象走的是 `/chunks/` 分支**（`SyncdRemoteStore.putImmutable` → `PUT /chunks/<encodeURIComponent(prefix+key)>`，key 形如 `vaults/<vaultId>/backups/<device>/<name>`）。因此加 `DELETE` 应挂在现有 `/chunks/` 分支内（复用 `safeKey()` 的路径穿越防护），并**只允许删解码后 key 含 `/backups/` 的对象**——同步链保持永不删除的追加语义。`SyncdRemoteStore.deleteObject` 实现调用它；`RemoteStore.deleteObject` 已是可选方法无需动。
   - 注意 `safeKey(path.slice(1))` 拿到的相对键还带 `chunks/` 前缀，判断备份前缀时用 `key.includes('/backups/')`，不要用 `startsWith('backups/')`。
2. 实现 + 测试（本地 spawn syncd 的 e2e 已有姿势，见 `tests/sync/syncd.test.ts`；backup 侧 `tests/sync/backup-remote.test.ts`）。
3. `npm run build`；全套验收（test / typecheck / validate --strict / 变异+负对照）。
4. **重部署 ECS syncd**：`syncd/cairn-syncd.mjs` 是零依赖单文件，systemd 服务在用户 ECS（`ssh root@100.65.135.122`，服务名 `cairn-syncd`，数据目录 `/var/lib/cairn-syncd`，仅绑 `100.65.135.122:8471`）。**部署前先在 ECS 上备份现文件**；`systemctl restart cairn-syncd` 后 `curl healthz` 验证。**此步是环境持久变更，动手前向用户确认并回写 Obsidian `ServerAndPC/CLOUD-aliyun-ecs.md`**（环境手册纪律）。
5. 清理 §6 事故对象（二选一）：
   - a. 加一条 `cairn backup --purge-remote <name>`（显式单对象删除，建议顺带进任务 B 的提案）；
   - b. 不加命令，靠保留策略自然淘汰（**前提是任务 B 已让 syncd 支持 DELETE**）：连续上传 5 份新备份（keep=5），最旧的即事故对象会被淘汰——浪费但零新代码。
6. 清理后 `cairn backup --list-remote` 确认清零（或只剩有意保留的）。

### 任务 C：npm 发新版本（0.5.0）

**步骤**：
1. `CHANGELOG.md`：把**整个 `## [Unreleased]` 节**整理为新版本标题 `## [0.5.0] - <发布日>`。注意 Unreleased 不只有本次四提案——它还包括更早未发布的「记忆批注与待处置队列」「`cairn forget --pending`」「MCP 批注工具」「DSH 插件压缩后重注入」等条目（查 `git log` 确认哪些提交晚于 0.4.0 且未发包），不要只搬四提案而漏掉它们。
2. `package.json` 版本 0.4.0 → 0.5.0；`npm pack --dry-run` 核对 `files`（应为 `dist/src`，不含 dist/tests——0.4.0 打包修复后的既定口径）；插件包不动（无变更则不重发）。
3. 发布：`npm publish --access public`。**发布是外发动作，先向用户确认版本号与内容。**
4. 发布后从 registry 真实安装验证：**用临时 npm prefix，不要污染全局**——`npm i --prefix <tmp> @carloswon/cairn-memory@0.5.0`，从 `<tmp>/node_modules/.bin` 运行 `cairn`，并设 `CAIRN_HOME=<tmp-home>`（全局安装不认 HOME，认 npm prefix 与 CAIRN_HOME）。依次验证 `cairn doctor` → `cairn rescope --help` / `cairn revision --help` / `cairn backup --upload`（无 vault 时应诚实报错）→ `cairn backup --list-remote`（未配置远端时应明确拒绝）。
5. 发包后回写 Obsidian `MyOpenSourceProject.md`（版本表 + 变更记录）。

### 任务 A：真实库首次 `sync push` 上云（上云方案 P0 收尾）

**前置**：`cairn backup` 快照已存在（2026-11-12 00:52 那份就是，`verifyBackup` ok）；`upstreamGap=0`（无入队缺口）；vault 已 init（syncd）。

**步骤**（每步动真实云端，**执行前向用户逐项确认**）：
1. `cairn sync push`——`eventCount` 等于本次领取的待上行任务数，**不是记忆总数**（2026-11-12 只读实测：`sync_upstream` 待上行仅 **1** 条，已推送修订 43 条；期间有新写入会相应增加，可能是 0）。判定成功看：命令退出 0、`headSeq` 有值、`jobs` 计数与领取数一致；失败只留可重试状态。
2. `cairn sync pull`——本机拉的应是**其他设备**的链，当前只有本机推送，所以 `totalApplied` 应为 0（2026-10-25 验证残留若属旧 vaultId，会被 `vaults/<vaultId>/` 前缀过滤掉，属正常）；`doctor` 的 remote 应保持 verified。
3. `cairn sync backfill`（只读）→ 确认缺口仍为 0。
4. **第二台设备验证**（用户侧操作，Agent 可准备命令清单）：`vault import-key` + `sync pull`，比对 active 条数与正文抽样。
5. 全程留审计证据；完成后回写 `Cairn-上云同步方案.md` §7（实施记录）。
6. **不要**顺手装 Windows 计划任务做自动同步——用户拍板的是「只在登录时 + 手动」，装定时器需要单独确认。

### 任务 D：macOS CI（用户此前暂缓，重启前先问）

用户 2026-10-28 明确暂缓。若用户重启此项：GitHub Actions `macos-latest` 跑 `npm ci && npm test`，注意 `node:sqlite` 需 Node ≥22.5（macOS runner 的 Node 版本要 pin）。真实云端的口径要分清：`test:real` 是独立脚本（`scripts/test-real-obs.mjs`，**不在** `npm test` 里）；`npm test` 里的真实 OBS 用例是 `tests/sync/obs-store.test.ts` 的门控用例（需 `CAIRN_TEST_REAL_OBS=1` + `OBS_*` 齐全），CI 里会**显式 skip**（基线那 1 个 skip 就是它）——确认它保持「显式 skip 并注明原因」，不要退化成静默跳过。

### 其他候选（未被要求，仅登记）

`project-global` 空间接入同步（上云方案 P2.3）；`@carloswon/cairn-memory` 包名/商标核查（公开发布准备的一部分）；WSL/第三方宿主验证。

---

## 4. 本次新增的产品能力速查（给接手 Agent 的 API 地图）

| 入口 | 位置 |
|---|---|
| `migrateScope` / `revise(…, {authority})` | `src/store/memories.ts` |
| `rescopeMemory` / `applyRevisionProposal` / `rejectRevisionProposal` / `proposeRevisionProposal` / `listRevisionProposals` / `listPendingRescope` | `src/interfaces/app-service.ts` |
| 方案卡存取 | `src/governance/revision-proposal.ts`（照 `console/annotations.ts` 模式，落 `console/revision-proposals.json`） |
| `deriveBackupKey` / AAD `kind:'backup'` | `src/sync/cryptoutil.ts` |
| 备份通道（upload/list/restore/prune） | `src/sync/backup-store.ts` |
| `RemoteStore.deleteObject?` | `src/jobs/remote.ts`（可选方法；OBS 已实现，syncd 待任务 B） |
| `scope_exit` 事件 / reentry 强制重发 | `src/sync/events.ts` / `push.ts` / `apply.ts` |
| `cairn rescope` / `cairn revision` / `cairn backup --upload` / `restore --from-remote` | `src/interfaces/cli/main.ts` |
| 控制台「修订提案」视图 + `/api/revisions*` | `src/interfaces/console/assets/ui-js.ts` / `server.ts` |
| schema v6（outbox CHECK 重建） | `src/store/schema.ts` `MIGRATION_006_OUTBOX_SCOPE_EXIT` |

测试落点：`tests/store/rescope-store.test.ts`、`tests/sync/scope-exit.test.ts`、`tests/interfaces/rescope-cli.test.ts`、`tests/governance/revision-proposal.test.ts`、`tests/interfaces/revision-cli.test.ts`、`tests/interfaces/revision-mcp.test.ts`、`tests/console/revision-server.test.ts`、`tests/sync/backup-remote.test.ts`。

---

## 5. 接手纪律（给下一个 Agent）

1. **验收不采信任何自述**（AGENTS.md 既定纪律）：独立复跑测试、核对磁盘产物与退出码；0 tests / 报告与复跑矛盾均不算通过。
2. **变异对照的还原绝对不能用 `git checkout`**——会把同文件里未提交的实现一起冲掉（本次真实发生过一次，靠 Edit 重写恢复）。一律 Edit 改、Edit 还原，改前 `git status` 确认没有未提交实现。
3. **CLI/子进程测试跑的是 `dist/` 构建产物**：改 `src/` 之后必须 `npm run build` 再跑测试，否则测试打在旧代码上（本次踩两次：CLI 退出码合同、MCP `proposedBy` 通道判定）。
4. **静态导出页内嵌完整 UI 源码**：字符串级断言「页面不含 X 控件」必然误判（源码里必然有该字符串）。守卫是 `data-static="1"` 属性 + `!STATIC` 分支；行为级验证只能真开浏览器（`npm run test:ui`）。
5. **真实环境操作（真实库写、真实云端、ECS 部署、npm publish）必须先向用户逐项确认**；做完回写 Obsidian 环境手册（`知识区/ServerAndPC/`，环境手册纪律见用户原生记忆 obsidian-env-manual-registry）。
6. **OpenSpec 流程**：新变更先 proposal（4/4 制品 + `validate --strict`），经用户审阅后才 apply；不越过审阅。
7. **同一判断不要写两份**：本项目已两次因此出 bug（`promotedPredicate`、投影 `firstLine`）。新逻辑先 grep 既有实现。
8. 跨设备共享的项目记忆一律走 cairn MCP（`mcp__cairn__*`），先 `memory_search` 查重再 `memory_add`；秘密不进记忆。

---

## 6. 事故记录：误触发真实云端上传

**时间**：2026-11-12 00:52（收尾阶段）。**原因**：一条内嵌 Python 的 shell 命令中反引号被 bash 展开，`cairn backup --upload` 被真实执行（会话环境恰继承了用户级 `CAIRN_SYNCD_TOKEN`）。

**后果（已全部核实）**：
- 上传了 1 个对象到用户自己的 ECS syncd：`backups/dev_01a18002-defd-7ba9-acd0-ae3fb1606b4e/cairn-backup-1794415952837.db-ac844002dd3a3c2450e9ea8966d27a81bfbd23b22535013eb8be0b3f9ec4ece9.enc`（3260 KB，端到端加密）。
- 本地对应快照 `~/.cairn/backups/cairn-backup-1794415952837.db` 校验通过（表内 55 行记忆记录，integrity ok）——是一份合法的一致性快照。
- **当前库未被改动**（无任何 restore 执行，db mtime 未变）；远端仅此 1 个对象；无泄露面（自有服务器 + 自有密钥）。

**处置状态**：向用户如实披露（已披露）；对象暂无法远程删除（syncd 无 DELETE 路由），清理路径见 §3 任务 B 第 5 步。**教训已进 §5 第 5 条**：真实环境副作用命令绝不出现在内嵌脚本/字符串拼接里，涉及 `CAIRN_*` 环境变量的命令先 `env | grep CAIRN` 确认凭据在场再执行。
