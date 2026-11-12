# cloud-sync Specification

## Purpose
为个人多设备提供以云端为加密中继的可靠同步：本地库永远是权威副本，云端只见密文；同步退出会话关键路径；多设备合并沿用修订链保守合并并保留冲突。

## Requirements

### Requirement: 加密中继与密钥主权

系统 SHALL 在上行前对 chunk 与 manifest 执行端到端加密（认证加密，AAD 绑定协议版本、vault、space、对象标识），云端 MUST NOT 能读到明文；vault 密钥 SHALL 由用户本地持有并 SHALL 提供恢复材料导出，MUST NOT 上传密钥明文。

#### Scenario: 云端对象不可读

- **GIVEN** 已配置真实 OBS 远端并执行 `sync push`
- **WHEN** 直接读取桶内 `cairn/` 前缀下的任意对象字节
- **THEN** 内容为密文，不含任何记忆明文、路径或设备标识明文

#### Scenario: 密钥丢失

- **WHEN** 用户在新设备缺少 vault 密钥时执行 `sync pull`
- **THEN** 系统明确报错并提示导出过的恢复材料，不创建半还原状态

### Requirement: 追加事件链与 manifest 单写者

同步单位 SHALL 为每设备每空间的追加事件链（device_seq 单调递增）；chunk SHALL 内容寻址且上传不可变；manifest SHALL 由该设备单独写者发布，且代次（generation/head_seq）MUST NOT 回退；重复、乱序、旧代次上传 MUST NOT 破坏本地或远端已接受状态。

#### Scenario: 重复推送幂等

- **WHEN** 同一批事件被 push 两次（含进程中断后重推）
- **THEN** 远端对象集合一致（内容寻址复用），manifest 代次不回退，本地不产生重复记忆

#### Scenario: 先 chunk 后 manifest

- **WHEN** 上传中断于 chunk 已传、manifest 未发布
- **THEN** 下次 push 复用已传 chunk 并完成 manifest 发布，无数据丢失也无孤儿危害

### Requirement: 拉取合并与冲突保留

`sync pull` SHALL 按事件链将其他设备的修订幂等应用到本地：已知修订跳过；父修订未知进入等待依赖状态；基于同一祖先的并发修改 SHALL 保留双方并进入冲突队列（复用 memory-governance 的冲突语义）；tombstone SHALL 传播；MUST NOT 以最后写入时间决定正文归属。

#### Scenario: 双设备离线修改后合并

- **GIVEN** 设备 A、B 同步过同一记忆后各自离线修改
- **WHEN** 两设备先后 `sync pull`
- **THEN** 双方修订都存在于两台设备，记忆进入 conflicted 并保留双方来源，后续由既有冲突解决流程处理

#### Scenario: 跨设备 tombstone

- **WHEN** 设备 A 遗忘一条已同步记忆并 push，设备 B pull
- **THEN** 设备 B 上该记忆变为 tombstoned 且不再出现在活动检索

### Requirement: local_only 物理排除不变

经云端同步路径生成上行包时，`local_only` 与设备限定内容 MUST 在打包前被物理排除（延续 outbox 触发器语义）；该行为 MUST 可通过列举真实远端对象独立验证。

#### Scenario: 远端对象无本地内容

- **WHEN** 含 local_only 记忆的设备 push 后列举远端前缀全部对象并解密检查
- **THEN** 不存在包含 local_only 记忆内容的任何 chunk

### Requirement: 双后端同协议与配置健康

OBS/S3 兼容远端与 ECS syncd SHALL 实现同一 RemoteStore 接口与同一 chunk/manifest 协议；凭据 SHALL 仅从环境变量或本机密钥文件读取，MUST NOT 出现在仓库、日志或导出物；doctor SHALL 如实报告 remote=not_configured / configured(untested) / verified 及后端类型。

#### Scenario: doctor 诚实分级

- **WHEN** 已配置远端但从未成功往返
- **THEN** doctor 报 configured(untested)，不得宣称 verified

#### Scenario: 凭据不入日志

- **WHEN** 同步发生任何错误（含签名失败、403）
- **THEN** 错误与日志不包含 SK、签名串或完整 Authorization 头

### Requirement: 上行入队完备性

对任何一条作用域允许上行（`syncPolicy = encrypted` 且未绑定具体设备）的记忆，系统 SHALL 在其**被创建、正文被修改、或被遗忘**时产生一条 `sync_upstream` 待办任务；该要求 SHALL 对**所有**写入入口一致成立，包括 CLI / MCP / 本地控制台 / 治理计划应用（`applyPlan`）与自动整理。

系统 MUST NOT 因写入入口不同而产生上行覆盖差异；系统 MUST NOT 在拉取路径（`sync pull` 应用远端事件）上产生上行任务。

作用域不允许上行的内容 MUST 在入队前被物理排除，且 MUST NOT 因本次变更产生任何 `outbox_job` 行。

#### Scenario: 治理计划应用后记忆进入上行队列

- **GIVEN** 一条作用域为 `personal-global` 的待应用计划，其操作包含新增记忆
- **WHEN** 用户消费审批并应用该计划
- **THEN** 该新增记忆存在一条 `sync_upstream` 待办任务，且任务的实体标识等于该记忆标识

#### Scenario: 自动整理产出的记忆与手工写入等价

- **GIVEN** 自动整理（策略预授权）被触发
- **WHEN** 该轮整理新增记忆若干条
- **THEN** 每条作用域允许上行的新增记忆都各自存在一条 `sync_upstream` 待办任务，其数量与新增记忆数量相等

#### Scenario: 拒绝候选与遗忘产生同形上行

- **GIVEN** 一条作用域允许上行的候选记忆与一条同作用域的活动记忆
- **WHEN** 用户拒绝该候选，并另行遗忘那条活动记忆
- **THEN** 两条记忆各自存在一条墓碑语义的 `sync_upstream` 待办任务，任务语义与既有遗忘路径一致

#### Scenario: 拉取不产生上行

- **GIVEN** 本地库为一个可读写的权威副本
- **WHEN** 执行 `cairn sync pull` 并应用了远端设备的事件（含新增与修订）
- **THEN** 本次拉取前后 `outbox_job` 中 `sync_upstream` 的待办数量不变，系统不产生任何新的上行任务

#### Scenario: 设备限定内容不产生上行任务

- **GIVEN** 一条作用域为 `device-local` 或 `sensitive` 的内容经由治理计划写入
- **WHEN** 计划应用完成
- **THEN** 该记忆存在且写入成功，但 `outbox_job` 中不存在以该记忆为实体的任何行

### Requirement: 冷启动对账

系统 SHALL 提供本地对账入口 `cairn sync backfill`，用于发现并补齐「作用域允许上行、但当前不存在 `sync_upstream` 待办任务」的活动记忆。

该命令 MUST 默认只读（dry-run），仅在显式指定应用参数时才写入；MUST 幂等（重复执行不产生重复任务）；MUST 只写本地待办队列，MUST NOT 与云端发生任何网络交互；MUST 以机器可读形式报告候选数、新增数、已存在数与被排除数，并以稳定退出码区分成功、用法错误与故障。

#### Scenario: 只读预演不改变库

- **GIVEN** 库中存在若干应上行但未入队的记忆
- **WHEN** 执行 `cairn sync backfill` 且未指定应用参数
- **THEN** 先后的 `outbox_job` 行数与内容完全相同，输出报告候选条数，并以成功退出码结束

#### Scenario: 应用后缺口归零

- **GIVEN** 库中存在 N 条应上行但未入队的记忆
- **WHEN** 执行 `cairn sync backfill --apply`
- **THEN** 输出报告新增 N 条，且再次执行 dry-run 时候选数为 0

#### Scenario: 重复应用幂等

- **WHEN** 连续两次执行 `cairn sync backfill --apply`
- **THEN** 第二次的新增数为 0，`outbox_job` 中不存在重复的待办任务

#### Scenario: 对账不触碰云端

- **GIVEN** 本地已配置远端但网络不可达
- **WHEN** 执行 `cairn sync backfill --apply`
- **THEN** 命令仍以成功退出码结束，且不产生任何网络请求

#### Scenario: 被排除内容不计入缺口

- **GIVEN** 库中存在作用域为 `device-local` 的活动记忆
- **WHEN** 执行 `cairn sync backfill` 
- **THEN** 该记忆不出现在候选列表中，也不产生任何 `outbox_job` 行

### Requirement: 上行缺口可观测

健康检查 SHALL 报告「作用域允许上行但未入队」的活动记忆条数；库处于健康状态时该计数 MUST 为 0。当该计数大于 0 时，健康检查 MUST 给出明确的、可执行的处置提示。

#### Scenario: 健康库的计数为零

- **GIVEN** 所有应上行的记忆都已有对应的待办任务
- **WHEN** 执行健康检查
- **THEN** 上行缺口计数为 0，且不因此产生任何告警条目

#### Scenario: 存在缺口时如实报告

- **GIVEN** 库中存在应上行但未入队的记忆
- **WHEN** 执行健康检查
- **THEN** 输出中该计数等于实际缺口条数，并给出指向对账命令的处置提示

### Requirement: 迁出事件的通知语义

当一条已同步的记忆从其可同步作用域迁出时，系统 SHALL 向上行一条「迁出」事件。

其他设备收到该事件后 MUST 把对应记忆标记为「本设备不再持有」，MUST NOT 物理删除它，MUST NOT 继续把它的新修订当作活动内容呈现。

该标记 MUST 可被审计；MUST 与「遗忘（tombstone）」区分——迁出不是删除，用户在迁出设备上仍有该记忆。

#### Scenario: 另一台设备收到迁出事件
- **GIVEN** 设备 A、B 同步过同一记忆
- **WHEN** A 把该记忆迁出可同步作用域并 push
- **THEN** B 收到迁出事件后把该记忆标为不再持有，不删除数据，检索不再返回它

#### Scenario: 迁出不等于遗忘
- **WHEN** 一台设备收到迁出事件
- **THEN** 该记忆不产生墓碑记录，遗忘时间线不被改动

#### Scenario: 迁出后重新迁回
- **GIVEN** 记忆已被迁出并通知过对端
- **WHEN** 在该设备上把记忆迁回可同步作用域并 push
- **THEN** 对端重新视为持有者，内容按正常修订链同步

### Requirement: 迁出事件不得破坏既有协议

引入迁出事件 MUST NOT 改变既有 upsert 与墓碑事件的语义。

对不支持该事件的旧版本设备，接收方 MUST 以「跳过并审计」降级处理，MUST NOT 因未知事件类型中断整条链。

信令顺序 MUST 保持：迁出事件 SHALL 排在同一记忆的后续修订之前。

#### Scenario: 未知事件降级
- **WHEN** 设备收到无法识别的事件类型
- **THEN** 该事件被跳过并写审计，游标行为与既有「不可解密 chunk」一致，不阻断整链

#### Scenario: 重复推送幂等
- **WHEN** 同一迁出事件被推送两次
- **THEN** 对端状态一致，不产生重复记录、不报错

### Requirement: 备份通道与同步通道互不干扰

备份对象 SHALL 使用独立的对象前缀存放，MUST NOT 出现在同步事件链的列举范围内。

同步操作 MUST NOT 列举、读取或删除备份对象；备份操作 MUST NOT 触碰 chunk / manifest。

两套通道 SHALL 共用同一远端配置与凭据，但 MUST 各自独立地报告可用性——一方不可用 MUST NOT 使另一方失败。

#### Scenario: 同步不扫备份
- **GIVEN** 远端同时存在同步对象与备份对象
- **WHEN** 执行同步拉取
- **THEN** 拉取只列举事件链前缀，备份对象不在其视野内

#### Scenario: 备份不碰事件链
- **WHEN** 执行备份上传或保留清理
- **THEN** 任何 chunk 与 manifest 对象均未被读取、修改或删除

#### Scenario: 一方失败不影响另一方
- **GIVEN** 备份前缀因权限问题写入失败
- **WHEN** 执行同步推送
- **THEN** 同步按自身状态正常报告，不被备份失败牵连

### Requirement: 备份密钥与同步密钥的关系可解释

备份的加密 MUST 复用 vault 的密钥体系，MUST NOT 引入需要用户额外抄写的新恢复材料。

备份的密钥派生 MUST 与同步对象使用不同的派生路径，使同一条记忆在两类对象中的密文不可互相替换。

密钥材料的缺失 MUST 以明确错误报告，MUST NOT 静默产生「看起来成功」的备份。

#### Scenario: 无 vault 时备份
- **GIVEN** 本地尚未配置 vault 密钥
- **WHEN** 尝试加密上传备份
- **THEN** 系统明确拒绝并提示先初始化 vault，不上传任何明文或弱加密内容

#### Scenario: 同一条记忆在两类对象中的密文不同
- **WHEN** 同一条记忆既进入过同步对象，也存在于备份快照中
- **THEN** 两处密文不相等，且任一密文无法被当作另一类对象解开

### Requirement: 受限的备份对象删除

syncd SHALL 支持删除**备份对象**，且 MUST 只允许删除解码后 key 中含备份段（`/backups/`）的对象。

删除 MUST 复用既有的路径安全校验（正则白名单 + 解析后必须位于数据目录内），MUST NOT 引入绕过该校验的新路径。

对不含备份段的对象，服务端 MUST 以拒绝状态码响应，MUST NOT 执行任何文件删除。

删除不存在的对象 MUST 幂等成功（新版服务端对不存在的备份对象返回成功，不返回错误）。

因此「响应 404」SHALL 唯一表示**服务端没有该删除能力**（旧版），MUST NOT 与「对象不存在」混淆——客户端 MUST 把 404 解释为不支持并降级，MUST NOT 记为已删除。

#### Scenario: 删除备份对象成功
- **GIVEN** 数据目录中存在 `chunks/vaults/<v>/backups/<dev>/<name>`
- **WHEN** 发送删除请求
- **THEN** 该文件被删除，响应成功，再次列举不再包含它

#### Scenario: 删除同步链对象被拒绝
- **GIVEN** 数据目录中存在 `chunks/vaults/<v>/personal-global/devices/<dev>/chunks/1-abc.bin`
- **WHEN** 对该 key 发送删除请求
- **THEN** 服务端以拒绝状态码响应，文件**仍然存在**，无任何副作用

#### Scenario: 删除 manifest 被拒绝
- **WHEN** 对 `manifests/...` 路径发送删除请求
- **THEN** 被拒绝，文件仍存在

#### Scenario: 路径穿越被拒绝
- **WHEN** 删除请求的 key 含 `..` 或非法字符
- **THEN** 被拒绝，数据目录外无任何影响

#### Scenario: 删除不存在的备份对象
- **WHEN** 删除一个不存在的备份对象
- **THEN** 响应成功（幂等），不报错

### Requirement: 保留策略在 syncd 后端真正生效

远端支持删除时，备份保留策略 SHALL 实际淘汰超出保留份数的对象；不支持时 MUST 如实报告降级（只上传不删），MUST NOT 静默假装已淘汰。

淘汰 MUST 只作用于本设备自己的备份对象，MUST NOT 触碰其他设备或其他前缀的对象。

#### Scenario: syncd 支持删除后策略生效
- **GIVEN** 保留份数为 N，远端已有 N 份本设备备份
- **WHEN** 上传第 N+1 份
- **THEN** 最旧的一份被真正删除，列举可见份数为 N

#### Scenario: 不支持删除时诚实降级
- **GIVEN** 远端不支持删除（旧版 syncd）
- **WHEN** 上传并尝试淘汰
- **THEN** 上传成功，输出明确提示「保留策略未生效：远端不支持删除」，MUST NOT 声称已清理

### Requirement: 删除目标必须是普通文件

删除请求指向的目标若**不是普通文件**（目录、符号链接等），服务端 MUST 拒绝该请求且 MUST NOT 崩溃或终止进程。

拒绝后服务端 MUST 继续正常响应后续请求（进程存活、健康检查仍通过）。

#### Scenario: 目录形 key 被拒绝且服务不崩
- **GIVEN** 数据目录中存在一个目录 `chunks/vaults/<v>/backups/<dev>`（无文件名部分）
- **WHEN** 对该路径发送删除请求
- **THEN** 请求被拒绝，目录仍在，且紧接着的 `/healthz` 仍返回成功

#### Scenario: 崩溃不算通过
- **WHEN** 任何形式的删除请求触发文件系统错误（EISDIR / EACCES / EBUSY 等）
- **THEN** 服务端 MUST 返回错误状态码而非让进程退出

### Requirement: 推送前暴露上行缺口

同步推送命令 SHALL 在执行推送前进行一次**只读**的上行缺口检查。

发现缺口时 MUST 向用户打印：缺口条数、以及「这些记忆尚未入队，本次推送不会包含它们」的明确说明。

该检查 MUST NOT 改变任何待办任务；MUST NOT 因此阻止推送——推送 SHALL 照常执行已有任务。

缺口为零时 MUST 完全静默（不打印任何额外内容）。

#### Scenario: 有缺口时提示但照常推送
- **GIVEN** 库中存在 1 条作用域允许上行但没有待办任务的记忆，另有 2 条正常待办
- **WHEN** 执行同步推送
- **THEN** 先打印「1 条记忆未入队，本次推送不包含它们」类提示，随后推送 2 条待办，退出码为成功

#### Scenario: 无缺口时静默
- **GIVEN** 所有应上行的记忆都已有待办任务
- **WHEN** 执行同步推送
- **THEN** 输出中不出现任何缺口相关内容

#### Scenario: 提示不改变任务
- **WHEN** 执行同步推送并出现缺口提示
- **THEN** 待办任务数量与内容在推送前后符合既有语义，不因该检查而新增或删除任务

### Requirement: 缺口检查复用既有口径

推送前的缺口检查 MUST 与健康检查、对账命令使用**同一个**缺口判定实现。

MUST NOT 另写一份「应上行但无任务」的查询（本项目已因「同一判断写两份」出过两次 bug）。

#### Scenario: 三处口径一致
- **GIVEN** 库中存在一处上行缺口
- **WHEN** 分别执行健康检查、对账命令的只读预演、同步推送
- **THEN** 三者报告的缺口条数完全相同
