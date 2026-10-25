# Design

## Context

本地 MVP 已交付：outbox 有物理排除触发器、`sync_upstream` 诚实失败、`NotConfiguredRemote` 占位。本变更在真实环境验证同步链路。已核验的环境事实（来自用户环境手册，2026-10-25）：

- 华为云 OBS：桶 `carloswon`（`cn-east-3`，私有，S3 兼容）；AK/SK 为主账号密钥，OBS v2 头签名已被用户的 Python 探针验证可用；桶内既有 `obsidian/`、`famboard/` 前缀（本变更只使用 `cairn/`）。
- 阿里云 ECS：Linux，Tailscale `100.65.135.122`（SSH 免密可达），公网安全组全闭（仅 ICMP）——syncd 绑定 Tailscale 接口即天然私有；带宽 126Mbps。
- 多设备：笔记本（本机，Windows）与 ECS（Linux）可组成真实双设备验证，同时覆盖 Linux 平台。

凭据纪律：OBS AK/SK 经用户级环境变量 `OBS_ACCESS_KEY_ID` / `OBS_SECRET_ACCESS_KEY` 注入（与本机 `GITHUB_TOKEN` 同模式）；仓库、测试、日志、错误信息一律不落凭据。真实云端测试在环境变量缺失时显式跳过（CI 安全）。

## Goals / Non-Goals

**Goals:** 真实 OBS 与 ECS syncd 上的双设备双向同步；E2EE 密文上云；重复/乱序/旧代次/中断恢复的负向保证；local_only 物理排除的远端可验证性。

**Non-Goals:** 团队共享、密钥托管、自动常驻同步、通用 CRDT、多租户 syncd、桶内既有前缀的任何读写。

## Decisions

### D1 RemoteStore 接口落地与两个实现

沿用占位接口（`src/jobs/remote.ts`）扩展为完整 RemoteStore：

- `ObsRemoteStore`：OBS v2 头签名（`OBS ak:sig`，HMAC-SHA1，CanonicalizedResource 用 URL 编码路径——用户探针已验证该坑）；虚拟主机风格 endpoint；`GetObject/PutObject(不可变)/ListObjectsV2(GET ?list-type=2&prefix=)/DeleteObject`；PUT 携带 Content-MD5。
- `SyncdRemoteStore`：HTTP + Bearer token；PUT/GET chunk、GET/PUT manifest（带 If-Match 代次 CAS，服务端保证不回退）；仅本变更实现的参照服务端。
- 工厂 `getRemoteStore(config)`：`provider: 'obs' | 'syncd' | 'none'`，配置来自 `dataDir/vault.json` + 环境变量。均实现 `configured` 标志；`none` 保持现有 NotConfiguredRemote 语义。

### D2 chunk/manifest 协议（构想 §10.1/§10.3 收敛到首版）

- 事件：`SyncEvent = { deviceId, seq, type: 'memory_upsert'|'memory_tombstone', memoryId, revisionId?, payload }`；payload 含修订全文（content、scope 快照、authority、evidence 引用、时间戳）——保守合并所需字段齐备，云端只见密文。
- chunk：一批事件（≤200 条或 ≤512KB）序列化 → 加密 → 内容寻址 key `cairn/vaults/<vaultId>/spaces/<spaceId>/devices/<deviceId>/chunks/<seq>-<sha256>.bin`。
- manifest：`cairn/vaults/<vaultId>/spaces/<spaceId>/devices/<deviceId>/manifest.json`（加密），记录 `{ generation, headSeq, chunks: [{key, seqFrom, seqTo, hash}] }`；单写者（每设备只写自己的 manifest），发布前先 GET 自身 manifest，仅当新 headSeq > 旧 headSeq 才 PUT（自防回退）；OBS 无条件写 CAS，syncd 用 If-Match。
- 拉取游标：本地 `sync_cursor`（复用已归档 schema 语义）记录每远端设备的已应用 headSeq；断点续拉。

### D3 E2EE

- `@noble/ciphers`（纯 JS、可审计、MIT）XChaCha20-Poly1305；vault 密钥 32B 随机，space 数据密钥 = HKDF(vaultKey, spaceId)（@noble/hashes）；AAD = `v1|vaultId|spaceId|kind|objectId`，防密文搬运。
- 密钥文件 `dataDir/keys.json`（0600）：vaultKey 明文存本地（与 SQLite 同等信任边界，文档如实说明）+ `cairn vault export-key` 导出恢复材料（含提示：丢失即远端不可恢复）。
- 禁止自造算法；密文格式带版本号，未来轮换走 keyId。

### D4 拉取合并（复用既有治理设施）

按事件序应用：revisionId 已知 → 跳过；父修订未知 → 记入待依赖（下次 pull 重试）；父子齐备 → 快进或经 `MemoryRepository.revise`；同一父的并发修订 → `ConflictRepository.record`（保留双方，状态 conflicted）；tombstone → `MemoryRepository.forget(by='sync')`。 Pull 在单事务内逐事件应用并推进游标，中断可重入（幂等键 = revisionId）。

### D5 ECS syncd 最小实现

单文件 Node HTTP 服务（零依赖）：`PUT /chunks/<key>`（不可变，重复 PUT 同 key 同体幂等）、`GET /chunks/<key>`、`GET/PUT /manifests/<key>`（PUT 带 `X-Cairn-Generation` CAS：服务器保存 generation，回退拒绝 409）、Bearer token（环境变量注入）、仅监听 Tailscale IP。systemd 单元 + 部署脚本（SSH 执行）；数据落本地目录（可用性优先于持久性承诺，文档如实）。

### D6 验证矩阵（真实环境）

| 项 | 环境 |
|---|---|
| RemoteStore 往返/列举/删除 | 真实 OBS（cairn/ 前缀） |
| push→拉取复原、tombstone 传播、并发冲突 | OBS + 本机双"设备"（两个 CAIRN_HOME） |
| local_only 物理排除 | push 后列举并解密检查远端全部对象 |
| syncd 协议 | ECS 上部署 syncd，本机作为第二设备走同一套用例 |
| Linux 平台 | ECS 上运行 cairn 客户端（init/add/sync） |
| 密钥丢失 | 无密钥新目录 pull → 明确报错 |

真实云端用例以环境变量存在为前提，缺失时显式跳过并注明（不虚报）。

## Risks / Trade-offs

- [OBS v2 签名细节（URL 编码资源、日期头）] → 以用户已验证的 Python 探针为对照基准，签名单元测试锁定；403 错误不回显签名材料。
- [主账号 AK/SK 暴露面大] → 仅环境变量注入；不落盘；文档提醒换 IAM 子用户（用户已知情）。
- [ECS syncd 单点/持久性弱] → 定位为验证载体与自建选项，官方推荐路径仍是 OBS；文档写明数据目录备份责任。
- [密文体积膨胀] → chunk 压缩（gzip）后再加密；性能门槛实测记录，不做无限规模宣称。

## Migration Plan

1. 新代码全部在 `src/sync` 与 worker/CLI 的新分支路径之后；未配置远端时行为与本地 MVP 完全一致。
2. 远端配置写入 `dataDir/vault.json`；删除该文件即回到纯本地（云端对象可保留或整体删除 `cairn/` 前缀）。
3. 真实验证使用专用 CAIRN_HOME 与专用远端前缀，不触碰用户既有数据。

## Verification Evidence

实现阶段至少保留：真实 OBS 往返记录、双设备复原/冲突/遗忘传播记录、local_only 远端列举核验记录、syncd 部署与 Linux 客户端运行记录、密钥丢失报错记录。全部机器可读结果入 `artifacts/cloud-sync-2026-10-25/`（不入库）。
