# Cairn 云同步（OBS / ECS syncd）

> 对应 OpenSpec 变更 `add-real-cloud-sync`（capability: cloud-sync）。状态：已实现并在真实环境完成双设备验证（2026-10-25，见 `artifacts/cloud-sync-2026-10-25/`）。

## 模型

- 本地 SQLite 永远是权威副本；云端只是【加密中继】——云端只见密文（XChaCha20-Poly1305，AAD 绑定 vault/space/对象标识），不存密钥。
- 同步单位是每设备每空间的追加事件链：chunk 内容寻址不可变，manifest 单写者发布、headSeq 防回退（syncd 侧另有服务器端代次 CAS）；先传 chunk 后发布 manifest。
- local_only 与设备限定内容在打包前被物理排除（outbox 触发器 + 打包层双保险），可用"列举远端全部对象解密核查"独立验证。
- 合并沿用修订链保守合并：已知修订幂等跳过；父哈希未知等待依赖；并发修改保留双方进入冲突队列；遗忘跨设备传播。
- 同步退出会话关键路径：由显式命令 / `worker run-once` 触发，失败只留下可重试状态。

## 快速开始（两个设备）

```bash
# 设备 A（首次）
npm run cli -- vault init-remote --provider obs --endpoint https://obs.cn-east-3.myhuaweicloud.com --bucket <桶> --prefix cairn/
# 输出 recovery 恢复材料 —— 抄写到安全位置；密钥丢失 = 云端数据不可恢复
npm run cli -- add "跨设备记忆"
npm run cli -- sync push

# 设备 B（加入同一 vault）：先拿到 A 的恢复材料
npm run cli -- vault import-key --recovery-file recovery.txt
npm run cli -- vault init-remote --provider obs --endpoint ... --bucket ... --prefix cairn/
npm run cli -- sync pull        # 拉到 A 的记忆
npm run cli -- add "B 的记忆"
npm run cli -- sync push        # A 端 sync pull 后可见
```

环境变量（凭据只经环境变量注入，不落盘不入库）：

| 变量 | 用途 |
|---|---|
| `OBS_ACCESS_KEY_ID` / `OBS_SECRET_ACCESS_KEY` | 华为云 OBS（建议换 IAM 子用户最小权限密钥） |
| `OBS_ENDPOINT` / `OBS_BUCKET` / `OBS_PREFIX` | OBS 连接信息（非密） |
| `CAIRN_SYNCD_TOKEN` | 自建 syncd 的 Bearer token |

## 自建 syncd（ECS 中继）

```bash
# 服务器（Linux）：零依赖，仅监听内网/Tailscale 接口
CAIRN_SYNCD_HOST=<内网IP> CAIRN_SYNCD_PORT=8471 CAIRN_SYNCD_TOKEN=<随机token> \
CAIRN_SYNCD_DATA=/var/lib/cairn-syncd node syncd/cairn-syncd.mjs
# 客户端
npm run cli -- vault init-remote --provider syncd --base-url http://<内网IP>:8471
```

- 单用户多 vault：每个 vault 的键空间互相隔离（`vaults/<vaultId>/` 前缀，与 OBS 布局对齐）；外来/不可解密的 manifest 在 pull 时降级为跳过 + 审计，不影响本 vault。
- chunk 幂等上传；manifest 代次 CAS 经旁路 `.gen` 元数据执行（对真实密文同样生效，回退 409）；Bearer 鉴权；防路径穿越。
- **删除只有一个受限入口**：`DELETE /chunks/<key>` 且解码后 key 必须含 `/backups/`，其余一律 403（同步链是只追加的，chunk/manifest 永不删除）；对象不存在也返回 200（幂等）。`/manifests/` 不开放 DELETE。旧版 syncd 没有该路由，客户端会诚实降级为「保留策略未生效」提示。
- 数据目录备份由运维负责；云端（OBS/syncd）损坏可从本地权威库全量重推。
- 提示：syncd 所在主机上的客户端建议配置独立监听或使用回环地址——自连 Tailscale IP 每次请求有秒级开销（实测）。

## 冷启动对账（`sync backfill`）

上行队列是写入时逐条产生的。历史上任何一次写入漏了入队（例如 0.3.0 及更早版本里治理计划应用的写入不产生任务），那条记忆就永远不会上云，而且**没有任何地方会报错**。

补齐方式：

```bash
cairn sync backfill            # 只读预演，报告候选条数与 id 列表，不改库
cairn sync backfill --apply    # 真正补入本地队列（默认每次至多 500 条，--limit 可调）
cairn sync push                # 补完仍需显式上传；backfill 从不联网
```

判定口径：作用域为 `encrypted` 且不绑定具体设备、状态 active、且**历史上从未有过任何** `sync_upstream` 任务（不论状态）的记忆。只看 pending 会把已推送过的记忆重报为缺口，因此刻意不限制任务状态。

`cairn doctor` 的 `counts.upstreamGap` 报告同一口径的缺口数，健康时恒为 0；非零时在 `notes` 里给出一条指向本命令的提示，但**不进 `problems`、不改退出码**——缺口是可自愈状态，不是库损坏。

`cairn sync push` 也会在推送前做一次只读缺口检查（与 `doctor` / `backfill` 同一 `findUpstreamGap` 实现）：发现缺口就向 stderr 打印条数与「这些记忆尚未入队，本次推送不包含它们」，然后**照常推送已有任务**。它不入队、不阻断、不改退出码；缺口为零时完全静默。要补缺口仍需显式 `cairn sync backfill --apply`。

## scope_exit：迁出通知事件

一条记忆从可同步作用域迁出（例如 `personal-global` → `device-local`）时，同步链上会多一种**控制事件** `scope_exit`（独立任务类型 `sync_scope_exit`，不属于上行内容任务）。它不是修订、不是墓碑，对端语义是「发出端不再在本空间持有这条记忆」：

- 对端收到后把本地副本标为**不再持有**（archived + meta 标记）：检索不再返回、投影不再出现；**不删除数据、无墓碑记录**，遗忘时间线不变。
- 迁回 `personal-global` 时推送的修订快照带迁回标记（`reentry`），对端解除标记并恢复活动，内容按正常修订链同步。
- 迁出后的**迟到修订**（对端还没收到通知时的并发编辑）按幂等跳过处理，不把已迁出的记忆变回活动内容。
- 旧版本设备收到无法识别的事件类型：**跳过并审计，游标照常推进**，不会因新类型事件卡死整条链。
- 云端既有密文不随迁出删除（对象存储追加语义）；清理需要显式 purge 能力（暂未提供）。

## 命令与诊断

| 命令 | 说明 |
|---|---|
| `vault init-remote` | 初始化远端（生成密钥；已存在 keys.json 则复用） |
| `vault import-key --recovery-file` | 用恢复材料在新设备加入同一 vault |
| `vault status` / `vault export-key` | 状态 / 导出恢复材料 |
| `sync push` / `sync pull` | 上行 / 下行（幂等，可中断重试） |
| `sync backfill` | 冷启动对账：补齐「作用域允许上行但未入队」的记忆 `[--apply] [--limit N]`，**默认只读** |
| `doctor` | remote 三态：not_configured / configured_untested / verified |

doctor 的 remote 状态反映【当前环境】的可用性：远端已配置但缺少凭据环境变量时，如实降级为 configured_untested 并在 notes 说明。

## 安全边界（诚实声明）

- 密钥文件与恢复材料是本地明文（与 SQLite 库文件同等信任边界）；Windows 文件权限不构成加密，建议配合全盘加密。
- 秘密/注入扫描不覆盖上行包内容之外的全部形态；正则防线非完备。
- syncd 无多租户、无 TLS（设计上只绑内网/Tailscale 接口）；公网暴露面由云安全组收敛。
- `sync backfill` 只写本地 outbox，**不产生任何网络请求**；它不改变云端内容，补齐后仍需显式 `sync push`。
- 已验证环境：Windows x64 ↔ Linux x64 双设备、真实 OBS 与真实 ECS syncd；macOS 未验证。
- Obsidian 等既有桶内前缀（`obsidian/`、`famboard/`）与本产品前缀（`cairn/`）互不干涉；本产品从不读写其他前缀。

## 备份通道：设备快照的云端容灾（与同步是两回事）

同步的语义是「让对端持有等价副本」；备份的语义是「只有本机能读的容灾快照」。两条通道共用同一远端配置与 vault 密钥体系，但**互不干扰**：

| | 同步链 | 备份通道 |
|---|---|---|
| 对象前缀 | `<space>/devices/...` | `backups/<设备>/...` |
| 密钥 | `deriveSpaceKey(vaultKey, space)` | `deriveBackupKey(vaultKey, deviceId)`（不同 HKDF 域，混入设备维度） |
| 内容 | 逐条事件（chunk/manifest） | 整库快照（VACUUM INTO + sha256） |
| 删除 | 永不（追加语义） | 保留策略按份淘汰 |

关键语义：

- **只有生成它的设备能解开**：备份密钥混入 `deviceId`，其他设备拿到密文也没有对应密钥材料——这是特性不是缺陷。
- **设备身份丢失会导致旧备份解不开**：`~/.cairn/data/device.json` 决定 deviceId；重装系统前备份它，或用 `device re-enroll` 恢复同一身份。密钥材料本身来自 vault（`keys.json` / 恢复材料），不需要额外抄写。
- **前缀严格隔离**：同步 list 扫不到备份对象、备份清理碰不到 chunk/manifest；一方不可用不影响另一方。
- **删除边界**：保留策略（默认保留最近 5 份）在 OBS 与新版 syncd 后端都会真正淘汰最旧的备份对象；旧版 syncd（无 DELETE 路由）诚实降级为只上传不删除（输出里有提示），旧备份需手动清理。显式清理单个对象用 `cairn backup --purge-remote <name>`（删前打印对象名与大小；服务端只放行备份段，同步链对象一律拒绝）。恢复链路（下载 → 解密 → sha256 比对 → 快照校验）两个后端一致。
- 上传不改本地库状态；恢复默认还原到新路径，覆盖当前库必须 `--force` 且会先自动备份当前库。