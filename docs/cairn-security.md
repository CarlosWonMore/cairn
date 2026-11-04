# Cairn 安全文档：边界、备份恢复、卸载与故障排查

本文档描述 Cairn 当前 MVP 的安全设计与真实边界。语义依据 `openspec/changes/add-local-first-memory-mvp/specs/` 的 5 份 spec（RFC 2119），行为依据 `src/` 实现与 `tests/` 证据核对；所有命令均与 `docs/cairn-usage.md` 一致。

本文刻意避免安全承诺式措辞。每一节区分：**由确定性代码强制执行的部分**（有测试证据）与**依赖约定或存在局限的部分**（如实标注）。

---

## 1. 信任模型

### 1.1 权威与角色

- **本地 SQLite（`<home>/data/cairn.db`）是唯一权威副本。** 写入、读取、修改、导出不依赖模型或云端可用性（spec memory-store「本地权威与离线可用」）。MVP 没有云端：远端接口恒为 `NotConfiguredRemote`（`configured=false`），`doctor` 如实报告 `remote=not_configured`。
- **模型只产候选，不执行决策。** Agent 通过 MCP 提交的推断永远进入待审查队列（`memory_propose` → `authority=agent_inferred` + `status=candidate`）；对话式整理的输出只能成为 `awaiting_approval` 计划。语义合并、晋升、覆盖都不由模型完成。
- **确定性代码执行作用域、审批与删除。** 作用域判定（`scopeAllowsRead` / `scopeAllowsUpstream`）、审批消费（一次性凭证校验）、遗忘（tombstone）都是 `src/core` / `src/store` / `src/governance` 里的纯代码逻辑，模型无法绕过；数据库层另有触发器兜底（见第 2、3 节）。
- **MCP 请求中的 `user_confirmed` 不可信。** spec memory-governance 明文规定：调用方声明"用户已同意" MUST NOT 构成审批凭证。实测：仅凭 `user_confirmed=true` 的工具调用无法应用任何计划——`onboarding_apply` / `cairn apply` 都要求本地 CLI `cairn approve` 签发的、绑定该计划哈希的一次性 `approval_id`。

### 1.2 通道区分

| 通道 | 身份 | 权限 |
| --- | --- | --- |
| CLI（user） | `agentId=cli`（可 `--agent-id` 覆盖） | 数据主权者通道：管理记忆全生命周期、签发审批、导入 |
| MCP（agent） | 宿主传入的 `--agent-id` 或默认 | 受作用域约束：`memory_get` 等读取入口执行 `scopeAllowsRead` 检查，跨项目/跨设备/非白名单读取返回 `E_SCOPE_MISMATCH` |

### 1.3 诚实声明：约定不是强制

`memory_add` / `memory_update` / `memory_forget` 的工具描述写着"仅在用户明确要求时调用"——这是**行为引导（路由约定），不是技术强制**。MCP 服务无法验证对话里用户是否真的说过"记住"。缓解手段：宿主的工具调用审批设置、路由区块文案（`agent plan --mode router`）、以及事后用 `cairn show <id>` 审计 `createdBy` / `sourceAgent` 并 `cairn forget` 纠正。这一层是约定与审计，不是隔离。

### 1.4 日志纪律

- 审计事件表 `audit_event` 不记录记忆正文与秘密，只记类别、动作、对象 id 与计数类 detail。
- 错误报告只含秘密的 **masked 摘要**（首尾各 2 字符 + `***`）与规则名，绝不回显原文。
- worker 的 `last_error` 经 sanitize：截断 200 字符，不拼接 payload 或记忆正文。
- MCP stdout 只有 JSON-RPC；诊断走 stderr 或文件。

---

## 2. 作用域物理边界

### 2.1 上行排除：两层执行

`local_only` 与设备限定内容（`device-local` / `project-device` / `agent-private` / `session-ephemeral` / 自定义 local_only 空间）被排除在上行任务之外，执行在两层：

1. **应用层入口**：写入、更正、遗忘时统一调用 `scopeAllowsUpstream`（只有 `syncPolicy=encrypted` 的作用域才会生成 `sync_upstream` 任务）。检索、详情、导出、投影走同一个 `scopeAllowsRead` / 同一组判定入口，禁止各入口自行解释作用域（spec scoped-retrieval「全通道作用域隔离」）。
2. **数据库触发器兜底**：`outbox_reject_local_upstream` 在 `outbox_job` 插入前检查——`sync_policy <> 'encrypted'` 或 `device_id <> 'all'` 的作用域直接 `RAISE(ABORT, 'scope_not_upstreamable')`。即使未来某条代码路径遗漏了入口检查，SQLite 层也会物理拒绝该任务落库，并留下可审计的失败。

作用域校验（`validateScopeSpec`）另有硬规则：设备绑定作用域必须是 `local_only`；`sensitive` 内容必须 `local_only`；`encrypted` 同步要求设备为 all。这些规则无法通过 CLI/MCP 参数绕过。

### 2.2 导出与投影

导出（`cairn export`）与受管投影（`agent plan/apply` 写入的区块内容）走同一判定入口：`local_only` 作用域的内容可以出现在本地导出文件中（本地导出是权威库的本地行为，不是上行），但对应的投影与上行生成仍然只使用其作用域允许的内容；受管投影文件带唯一标记（`<!-- cairn:begin block="cairn-memory" -->`），导入含该标记的文件会被拒绝（`E_PROJECTION_LOOP`），防止导出—回读—再导出回环。

### 2.3 诚实说明：收窄不等于撤回

- **作用域收窄不撤回历史导出。** 导出文件一旦写出就在 Cairn 管辖之外；之后把某条记忆改为 `local_only` 或遗忘，不会回收你之前已经复制到别处的导出副本。
- **克隆恢复同样不撤回历史。** `device re-enroll` 恢复的是"身份唯一性"；旧身份在此之前的导出与外部副本不受影响（当前 MVP 无云端，因此也没有"已上行到远端"的内容需要撤回；未来接入云端后，撤回语义属于该变更的范围）。
- 被遗忘（tombstoned）的内容不出现在活动检索、导出与投影中，但**删除证据保留在库内可审计**；这不是物理擦除（物理移除见第 7 节）。

---

## 3. 秘密与提示注入防线

### 3.1 扫描器

`src/core/secrets.ts` 的 `scanText`：9 类秘密规则（私钥、AWS key/secret、GitHub token、JWT、Bearer、通用 api_key 赋值、password 赋值、连接串）+ 5 类注入启发（忽略指令、导出记忆、扩大作用域、角色覆盖、伪造用户确认）。已知占位符（`<placeholder>`、`${...}`、`your_*`、`changeme` 等）不误报。扫描结论只有 `kind` / 规则名 / 位置 / masked 摘要。

### 3.2 扫描点与处理语义

| 扫描点 | 命中后的行为 |
| --- | --- |
| 显式写入 / 更正 / 候选（`add` / `update` / MCP `memory_add` / `memory_propose`） | 整次写入拒绝：秘密 → `E_SECRET_DETECTED`（退出码 3），仅注入 → `E_INJECTION_SUSPECTED`（退出码 3）；错误只含 masked 摘要 |
| 导入（`cairn import`） | 命中条目 `scan_state='blocked'`：DB 里该条目 content 以占位符 `[blocked:<kind,...>]` **入库**（不含任何原文片段），`scan_findings` 只存 kind+masked；blocked 条目**永远不进入**整理批次与计划（批次查询硬性过滤 `scan_state='clean'`） |
| 计划创建（`plan create` / `onboarding_propose`） | 逐项扫描，不干净**整项 rejected**（不建 op），其余项正常；全被拒则 `E_PLAN_INVALID` |
| 计划应用（`apply`） | 每个 op 应用前对内容**复检**；命中 → 该 op 标记 failed、撤销已消耗审批、计划退回 `awaiting_approval`、抛 `E_SECRET_DETECTED` |
| 数据库触发器 | `memory_reject_blocked_insert` / `memory_reject_blocked_update`：任何代码路径试图把 `sensitivity='blocked'` 的行写进 memory 表都会被 SQLite 拒绝（防绕过扫描直写） |
| 日志 / 投影 / 上行 | 任何进入批次、计划、投影或 outbox 的不可信文本都必须先过 `scanText`；审计与错误不落正文 |

**blocked 占位符入库语义**要读准：DB 中的 import 条目只有占位符；**不可变快照文件（`<home>/snapshots/`）是唯一保留原文的位置**——这是"导入即可审计、正文不进库"的设计代价。如果你导入了含秘密的来源，原文仍在本机快照文件里；清除方式是删除对应数据目录（见第 7 节），或者一开始就不要导入含秘密的来源。

### 3.3 诚实声明：正则漏检局限

正则扫描是**已知形态的黑名单**，不是完备检测：自定义格式的密钥、不含关键字的随机串、Base64/Hex 编码后的凭据、语义层面的提示注入（不匹配 5 类启发式的措辞）都可能漏检。反向也有误报（正常文本含触发措辞会被拦截，见第 8 节）。因此：

- 不要把 Cairn 当作秘密保险库；导入前自行清理来源文件。
- 秘密进入活动的现实主路径是**用户自己 `cairn add` 一段含密钥的文本且扫描漏检**——请像对待聊天记录一样对待记忆内容。

---

## 4. 审批合同

治理计划（plan）与审批（approval）由确定性代码执行，规则如下：

| 属性 | 行为 |
| --- | --- |
| `plan_hash` 绑定 | 哈希基于**规范化**计划（操作列表 + 目标修订快照 + 作用域 + 来源档案；正文以内容哈希参与）。字段顺序、空白、来源数组顺序不影响哈希；任何内容变化必然改变哈希 |
| 签发通道 | 仅本地 CLI `cairn approve`。同计划同时最多一个在途审批（数据库唯一索引兜底） |
| 一次性 | `max_uses=1`；重放得到 `E_APPROVAL_REPLAY`（退出码 3） |
| 有效期 | 默认 30 分钟（`--ttl <秒>` 可调）；过期 `E_APPROVAL_EXPIRED`。计划本身另有 24 小时默认有效期，过期被清扫为 `expired` |
| 批准后计划被修改 | 数据库触发器 `plan_hash_change_revokes_approval` 自动撤销在途审批；apply 侧先做篡改预检，哈希不一致 → `E_PLAN_TAMPERED`（退出码 3）。预检刻意先于状态检查，避免篡改被 `E_APPROVAL_INVALID` 掩盖 |
| 目标在批准后变化 | merge/keep_both 携带目标修订快照，apply 时重检；目标已推进 → `E_TARGET_CHANGED`（退出码 4），拒绝基于过期目标应用 |
| 失败不消耗 | `consumeApproval` 的所有拒绝路径（计划不匹配 / 篡改 / 已撤销 / 已过期 / 重放）都不消耗使用次数；只有全部校验通过才 `uses+1` |
| 幂等应用 | 对已 `applied` 的计划重复 `apply` 返回 `alreadyApplied: true`、无副作用（实测退出码 0）；每个 op 独立事务，op 状态与记忆写入同事务 |

### 4.1 失败与崩溃恢复路径（实测）

- **治理性中止**（应用前复检发现秘密 / 目标修订推进）：apply 就地撤销已消耗的审批并把计划送回 `awaiting_approval`，计划内容（哈希）不变——直接 `cairn approve` 同一计划再 `apply` 即可。但 failed 的 op 会确定性复现同一失败，正确做法是**重新 propose**（剔除带秘密或目标已推进的条目），而不是反复重试。
- **进程崩溃**（逐 op 中途退出，来不及执行清理）：计划停在 `approved`、审批已消耗（`uses=1`）。此时重放旧审批会得到 `E_APPROVAL_REPLAY`；对该计划重新 `cairn approve` 会被拒绝（实测：`E_APPROVAL_INVALID 计划状态为 approved，只有 awaiting_approval 可批准`）。**当前版本用户可达的恢复路径是重新 propose 一份相同 items 的新计划**：已完成 op 的内容会被确定性去重（实测命中 `duplicates`，全去重时 `E_PLAN_INVALID`），只有未完成部分会进入新计划、重新走 approve → apply。这条路径的代价是丢失原计划的 plan_id 关联；对已应用结果的最终状态与单次成功执行一致。
- **`agent apply` 的宿主配置计划**是另一套独立校验：签名不匹配 → `E_TARGET_CHANGED`；目标文件在计划后被任何人改动 → `E_TARGET_CHANGED` 拒绝应用；重新 `agent plan` 生成新计划即可（plan 零写入，重生成无代价）。

---

## 4a. 使用信号不外发

`usage_count`（被主动请求次数）与 `last_used_at`（最近被看到时间）是**本地行为信号**，用来决定投影排序。

- `outbox_job` 的 `sync_upstream` payload 只有 `{ op: 'memory_upsert', memoryId }`——**不含** `usage_count`、`last_used_at`、`importance` 的任何取值。
- 因此这两个信号**只在本地累积**：每台设备各算各的，不会因为同步而互相污染（否则「在我的机器上被查了 50 次」会抬高你在另一台机器上的排序）。
- `importance` 属于记忆属性（随 `memory_upsert` 一并上行），但它是**内容判断**而非行为统计，不影响这条隔离。
- `cairn doctor --archive-stale` 的归档动作写本地审计 `archived_stale`，与检索历史的 `operation` 类目分开保留。

## 5. 设备身份与克隆

### 5.1 机制

- 身份文件 `<home>/data/device.json`：`deviceId`（`dev_<uuidv7>`）+ `instanceNonce`（16 字节随机），与数据库分离存放；数据库 `device` 行登记同一 `instanceNonce`。
- 每次打开库时比对：**库中该 `deviceId` 行的 nonce 与身份文件不一致 → 判定克隆**（`cloned: true`）。
- 克隆状态下：**写入暂停**（`E_DEVICE_CLONED`，退出码 5），读取不受影响；`doctor` 在 `problems` 中明确报告；`device status` 显示 `cloned: true`。设备行处于 `suspended` / `revoked` 时同样拒绝写入（`E_DEVICE_SUSPENDED`）。

### 5.2 什么情况会触发（诚实说明）

nonce 分叉只在"同一 `deviceId` 的库行与身份文件各走各路"时出现——例如把整目录复制到第二台设备后，在其中一份副本上 `re-enroll`，之后又把另一份副本的库或身份文件交错覆盖回来。测试证据（`tests/store/backup-device.test.ts`）通过直接构造 nonce 分叉验证：检测命中 → 旧身份写入被暂停 → re-enroll 恢复。

相应地，以下场景**不会**触发克隆检测（是特性边界，不是故障）：

- `cairn restore` 恢复他人备份到本机新目录：本机身份不在备份的 `device` 表中，按新设备正常注册。
- 只复制 `cairn.db` 不带 `device.json`：会以全新身份打开成独立库。
- 两份从未分叉的整目录副本：各自 nonce 一直一致，检测不触发。

它是"同一身份不得两处并发写入"的**库级不变量护栏 + 恢复路径**，不是"检测任何目录复制"的机制，更不是数据防泄露机制。

### 5.3 恢复步骤

```bash
cairn device status        # 确认 cloned: true 或 suspended
cairn device re-enroll     # 为当前副本生成全新身份并注册
cairn device status        # 确认 ok: true, cloned: false
```

`re-enroll` 的语义：

- 旧身份在库中标记为 `suspended`（`suspended_reason='re-enrolled: identity cloned or re-registered'`），**保留为证据**，不是删除。
- 旧 `device.json` 改名备份为 `device.json.backup-<时间戳>`，写入新身份。
- 之后该副本以新身份独立写入。
- 克隆恢复不撤回历史导出与外部副本（见 2.3）。

---

## 6. 备份与恢复演练

### 6.1 机制

- `cairn backup [--out FILE]`：`VACUUM INTO` 产出**事务一致**快照，不中断并发读写；返回文件字节数、sha256 与关键表行数（memory / memory_revision / import_archive / outbox_job / audit_event）。默认写入 `<home>/backups/cairn-backup-<时间戳>.db`。
- `cairn restore <backup.db> [--home <dir>]`：恢复前**只读打开备份做 `integrity_check` 与行数记录，校验不通过拒绝恢复**（`E_BACKUP_CORRUPT`，退出码 5）；校验通过才覆盖目标库，覆盖后**再次校验**行数一致。CLI 在恢复前会先关闭目标连接。

### 6.2 可复制的演练命令序列

```bash
# 0. 准备：确认当前库状态
cairn doctor --json
cairn status

# 1. 备份（记录输出中的 path / bytes / sha256 / counts）
cairn backup --out ./drill-backup.db

# 2. 破坏性变更后验证恢复（示例：遗忘一条记忆）
cairn search "提交"                 # 记下某条记忆 id
cairn forget <id> --reason "演练"

# 3. 恢复（restore 前确认没有其他 cairn / MCP 进程占用该数据目录）
cairn restore ./drill-backup.db --home ~/.cairn

# 4. 验证
cairn search "提交"                 # 该记忆回到 active
cairn doctor --json                 # ok: true，counts 与备份时一致
```

注意：

- 恢复的是**整个权威库**（含审计与 outbox），不只是记忆；恢复点之后的写入会被回退到备份时刻。
- 备份文件是明文 SQLite（见第 9 节），请与数据目录同等保管。
- 备份超过 512 MiB 时哈希计算会被拒绝（实现上限），大库请自行分卷。

---

## 7. 卸载

### 7.1 宿主配置卸载（agent uninstall）

```bash
cairn agent uninstall --host claude-code [--home-root <dir>] [--project-root <dir>]
cairn uninstall        # 遍历五个宿主，移除所有本产品配置
```

行为（`src/agents/config.ts`）：

- **只处理本产品安装记录**（`device_installation` 表）覆盖的路径。没有安装记录时不修改任何文件。
- 文件当前哈希 == 本产品上次安装后的 `targetHash` → **整文件恢复备份字节**（`restoredOriginal: true`），随后删除备份文件。
- 文件哈希不一致（用户后来改过）或备份缺失 → **只移除本产品部分**：从 MCP 配置删除 `cairn` 条目（其他 server 与未知字段保持不变）、从规则文件移除受管区块（其余内容保持不变），并如实输出 notes。
- 受管区块按唯一标记（`<!-- cairn:begin block="cairn-memory" -->`）定位，重复写入幂等、移除精确；宿主是 blocked 级别（WorkBuddy）时本来就没有写入，卸载自然无事可做。

### 7.2 数据库保留语义

全局 `cairn uninstall` **只移除宿主配置，数据库保留**。命令输出明示：

> `database: 已保留；如需删除请手动移除数据目录（可先 cairn export 备份）`

记忆是你的资产，卸载工具不等于删除记忆；是否删除、何时删除由你决定。

### 7.3 手动删除数据目录

数据目录（默认 `~/.cairn`，或 `--home` / `CAIRN_HOME` 指向处）包含全部本地产物：

| 路径 | 内容 |
| --- | --- |
| `data/cairn.db` | 权威库：全部记忆、修订、导入档案索引、计划、审批、审计事件 |
| `data/device.json` | 设备身份 |
| `snapshots/` | 导入来源的**不可变快照原文**（含被 blocked 条目的原文，见 3.2） |
| `backups/` | 备份数据库 |

彻底移除本产品数据 = 删除整个数据目录。删除前建议 `cairn export --out <file>` 留一份可迁移导出。删除后 `cairn init` 会以全新身份从零开始。

---

## 8. 故障排查表

| 症状 | doctor / 诊断检查点 | 处置 |
| --- | --- | --- |
| 命令报 `E_DB_LOCKED`（退出码 5），或 worker 报存储层故障 | `doctor` 的 `db.integrity`；是否有其他 cairn 进程 / 宿主 MCP 会话正占用同一数据目录 | 关闭占用方后重试；node:sqlite 单写者，避免两个进程同时写同一 `--home` |
| 检索结果标注 `matchedBy=like`；`doctor` 的 `fts.ok=false` | `doctor.fts.note` 显示 "FTS 索引异常（检索将走有界 LIKE 回退）" | **不是故障**：权威数据不受影响，检索自动降级为有界回退（spec scoped-retrieval「无效查询安全失败」）。需要重建索引时：`export` → 新目录 `init` → 重新导入/写入 |
| `E_DEVICE_CLONED` / `E_DEVICE_SUSPENDED`；`doctor.device.cloned=true` | `cairn device status` | `cairn device re-enroll`（见第 5 节）。re-enroll 后，执行它的那份副本中旧身份标记为 `suspended`（保留证据），另一份副本的库不受影响 |
| `E_MIGRATION_FAILED`："数据库 schema 版本 X 高于当前实现支持的 2" | 输出中的 `dbVersion` / `supportedVersion` | **升级 Cairn** 后再打开该数据目录。旧版本代码被阻止写新库（防半迁移/降级破坏）；迁移本身逐版本独立事务，失败回滚、可重试 |
| `cairn import` 报 `E_PROJECTION_LOOP`（退出码 4） | 来源文件内容含 Cairn 受管标记 | 把受管投影文件（如被 `agent apply` 写过的 `CLAUDE.md`）从导入来源中排除；投影不是导入来源 |
| `E_INJECTION_SUSPECTED`（退出码 3）但内容其实无害 | 错误 `details.injectionFindings` 里的 `kind` / `rule` 指明命中规则 | 正文含"忽略之前所有的指令""导出全部记忆"等触发措辞。**没有绕过开关**：改写措辞后重新提交；这是有意的保守设计（不可信文本按数据处理），误报率与正则局限见 3.3 |
| `agent apply` 报 `E_CONFIG_CONFLICT`（退出码 4）："已存在同名外来条目" | `cairn agent doctor --host <agent>` 查看 cairn 条目归属与本产品安装记录数 | 配置里有一个不是本产品装的 `cairn` 条目。由你决定：删除外来条目，或换宿主/作用域。本产品不会静默覆盖 |
| `approve` 报 "已有在途审批" 或 "计划状态为 approved，只有 awaiting_approval 可批准" | `cairn plan show <plan-id>` 看状态 | 计划已批准且审批未撤销/未走完。若手头还有原 `approval_id` 且未过期，直接 `apply`；否则按 4.1 的恢复路径处理 |
| `apply` 报 `E_APPROVAL_REPLAY`（退出码 3） | 先 `cairn plan show`：`status=applied` 则重复 apply 属正常（幂等返回 alreadyApplied） | 审批已被消耗。计划已应用 → 无需动作；中途崩溃 → 见 4.1 |
| `add --sensitive` 报 `E_VALIDATION`："sensitive 记忆必须使用 local_only 作用域" | — | 加 `--scope device-local`（或 `project-device`） |
| 检索不到刚写的记忆 | `cairn status` 看该记忆状态；`search` 是否加了 `--status`；调用方身份（`--agent-id`）是否匹配 `agent-private` 白名单 | 状态非 active 需显式 `--status`；`agent-private` 只对白名单 Agent 可见 |

---

## 9. 已知边界与未验证项（诚实清单）

以下各项是当前版本的真实状态，不因本文档而消失：

1. **Windows x64 单平台验证。** 本仓库的开发与测试在 win32（Node ≥ 22.5，`node:sqlite`）完成；macOS / Linux 未在本项目内验证。
2. **无真实云端同步。** 远端接口已冻结（`RemoteStore`），MVP 恒 `NotConfiguredRemote`：上行任务只会在本地失败并留下 retry/dead 状态。不存在"已同步到云端"的状态，也不存在云端撤回。
3. **宿主适配均为 fixture-only / blocked。** 未对任何真实宿主 CLI 复跑验证（M0 阶段 Copilot CLI 曾做过 real-cli-tested，本实现未复跑，按 fixture-only 如实降级标注）。`agent apply` 写出的配置是否被宿主正确加载，需要你在自己的宿主里用 `cairn agent doctor --host <agent>` 与宿主自身行为确认。
4. **秘密扫描非完备。** 正则黑名单存在漏检与误报（3.3）；无自定义规则、无熵检测、无模型辅助审查。
5. **本地明文存储。** `cairn.db`、快照、导出、备份全部是明文文件。建议开启操作系统级全盘加密（如 BitLocker / FileVault）；不要把数据目录放进云盘同步文件夹——云盘会产生整目录副本（触发克隆检测），也会把明文库散播到云盘服务商处。威胁模型是"防模型、云端与注入内容越过作用域与审批"，**不是**防本机恶意软件：任何能读你用户目录的本地进程都能读这份数据。
6. **`memory_add` 的调用时机靠约定。** 见 1.3；配合宿主工具审批使用。
7. **审批崩溃恢复有操作代价。** 见 4.1：中途崩溃后需重新 propose（已完成部分被去重），当前 CLI 未提供审批撤销命令。
8. **fixture 不等于真实云端，fake backend 不等于真实认证。** 本文档描述的行为均有 `tests/`（28 个测试文件，含 `security/`、`governance/`、`store/` 等）作为本地证据；其中涉及外部系统（真实宿主 CLI、真实云端）的部分不在证据范围内。

## 10. 操作审计只存摘要（add-operation-audit）

读取类操作审计（`operation` 类目）由**构造方式**保证零内容泄露：审计写入点只从操作返回值提取白名单计数字段（候选数、命中通道、耗时、对象 id），代码路径上接触不到查询原文与记忆正文。回归测试断言敏感正文与查询原文在审计全表中零出现。保留期清理按类目白名单执行（只清 `operation`），治理审计（计划/审批/写入）永不自动删除；审计入口全部只读，不存在修改/删除审计的命令或工具。
