# Proposal

## Why

本地 MVP（已归档的 add-local-first-memory-mvp）验证了单机记忆主权：本地 SQLite 是权威副本、outbox 只有本地任务边界、`remote=not_configured`。但产品定义的核心价值之一是"多设备按需同步、云端只是加密中继"（构想 §10–§12）：用户已授权使用其真实环境进行验证——华为云 OBS 桶 `carloswon`（S3 兼容，已核验可用）与阿里云 ECS（Tailscale 可达的 Linux 主机，可部署自建 syncd）。

M0 证据止步于 fake backend。真实云端验证是 M3 里程碑的门槛：chunk/manifest 协议、E2EE、设备间合并/冲突、local_only 物理排除，都必须在真实远端与真实多设备上证明，不能用模拟替代。

## What Changes

- 实现 OBS/S3 兼容 RemoteStore（OBS v2 头签名，node:crypto HMAC-SHA1；getObject/putImmutable/list/delete；凭据只从环境变量读取）。
- 实现 chunk/manifest 追加事件链协议（构想 §10.1）：每设备每空间独立序列；chunk 内容寻址不可变；先传 chunk 后发布 manifest；manifest 单写者 + 代次防回退。
- 实现端到端加密：vault 密钥 + 每空间数据密钥，XChaCha20-Poly1305（@noble/ciphers，禁止自造算法），AAD 绑定协议版本/vault/space/chunk；密钥本地保存并可导出恢复材料；密钥丢失 = 远端数据不可恢复（如实文档化）。
- worker 的 `sync_upstream` 从"诚实失败"变为真实上传（local_only/设备限定仍被物理排除）；新增 `cairn sync pull`：拉取其他设备 manifest 与 chunk，按修订链幂等应用，祖先未知进入等待，并发修改进入既有冲突队列。
- 实现最小 ECS syncd（单用户 HTTP 中继，同一 chunk/manifest 协议，Bearer token，仅绑定 Tailscale 接口），并部署到用户 ECS 验证。
- 新增 CLI：`cairn vault init-remote / status / export-key`、`cairn sync push/pull`；doctor 上报真实 remote 状态。
- 真实验证：本机（Windows/笔记本）↔ ECS（Linux）双设备经 OBS 与 ECS syncd 各完成一轮双向同步；local_only 内容经远端对象列举确认物理未上行；并发修改保留双方并进入冲突队列。

## Capabilities

### New Capabilities

- `cloud-sync`：加密 chunk/manifest 云中继、多设备拉取合并、真实 OBS 与 ECS syncd 双后端。

### Modified Capabilities

无（agent-interfaces 的 doctor/worker 语义扩展在 cloud-sync 场景内描述）。

## Impact

- 影响 `src/jobs`（worker 真实 handler）、`src/store`（outbox 载荷细节）、`src/interfaces`（新 CLI 命令、doctor）、新增 `src/sync`（协议与两个 RemoteStore）；不改变本地权威模型与治理规则。
- 真实凭据（OBS AK/SK、ECS）只经环境变量与用户本机使用；不进入仓库、日志、测试快照或文档。仓库将开源，任何凭据落盘即事故。
- OBS 桶内使用独立前缀 `cairn/`，与既有 `obsidian/`、`famboard/` 隔离；任何验证不得读写其他前缀。
- 每设备身份/密钥文件位于数据目录（不入库）。

## 非目标与当前决策

- 不做团队共享、托管服务运营、密钥托管服务或 Web 界面。
- 不实现通用 CRDT；合并策略沿用修订链保守合并（构想 §10.2）。
- 不做自动后台常驻同步进程；同步仍由显式命令 / worker run-once / 计划任务触发。
- ECS syncd 首版为单用户单 vault 的最小中继（无多租户、无管理面），作为协议第二实现与 Linux 验证载体。
- 不删除/改写 OBS 桶内既有对象（obsidian/、famboard/ 前缀只读规避）。

## 风险与回滚

- 数据风险：E2EE 密钥丢失则远端不可恢复——init-remote 时提示导出恢复材料；本地库永远是权威副本，云端损坏可全量重推（manifest 代次推进）。
- 安全风险：主账号 AK/SK 权限最大——本变更不落盘凭据、错误信息不回显签名材料；建议用户后续换 IAM 子用户（用户已知情并接受，见其环境手册 §5）。
- 协议风险：旧 manifest/乱序/重复上传按 §10.3 处理（不降级、幂等、等待依赖），负向测试覆盖。
- 回滚：新代码路径全部在 `sync_upstream` handler 与显式 `sync` 命令之后，关闭配置即回到本地 MVP 行为；云端对象可整体删除（cairn/ 前缀）重建。
