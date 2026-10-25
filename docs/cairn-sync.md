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
- 数据目录备份由运维负责；云端（OBS/syncd）损坏可从本地权威库全量重推。
- 提示：syncd 所在主机上的客户端建议配置独立监听或使用回环地址——自连 Tailscale IP 每次请求有秒级开销（实测）。

## 命令与诊断

| 命令 | 说明 |
|---|---|
| `vault init-remote` | 初始化远端（生成密钥；已存在 keys.json 则复用） |
| `vault import-key --recovery-file` | 用恢复材料在新设备加入同一 vault |
| `vault status` / `vault export-key` | 状态 / 导出恢复材料 |
| `sync push` / `sync pull` | 上行 / 下行（幂等，可中断重试） |
| `doctor` | remote 三态：not_configured / configured_untested / verified |

doctor 的 remote 状态反映【当前环境】的可用性：远端已配置但缺少凭据环境变量时，如实降级为 configured_untested 并在 notes 说明。

## 安全边界（诚实声明）

- 密钥文件与恢复材料是本地明文（与 SQLite 库文件同等信任边界）；Windows 文件权限不构成加密，建议配合全盘加密。
- 秘密/注入扫描不覆盖上行包内容之外的全部形态；正则防线非完备。
- syncd 无多租户、无 TLS（设计上只绑内网/Tailscale 接口）；公网暴露面由云安全组收敛。
- 已验证环境：Windows x64 ↔ Linux x64 双设备、真实 OBS 与真实 ECS syncd；macOS 未验证。
- Obsidian 等既有桶内前缀（`obsidian/`、`famboard/`）与本产品前缀（`cairn/`）互不干涉；本产品从不读写其他前缀。
