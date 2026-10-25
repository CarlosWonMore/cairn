# Tasks

## 1. RemoteStore 与 E2EE 基座

- [x] 1.1 扩展 RemoteStore 接口（getObject/putImmutable/listObjects/deleteObject/configured）并接通工厂 `getRemoteStore`（obs/syncd/none）；用接口契约测试锁定三实现语义。验证：契约测试非零断言。
- [x] 1.2 实现 OBS v2 签名客户端（HMAC-SHA1 头签名、URL 编码资源、Content-MD5）；签名单元测试用固定向量锁定；错误不回显签名材料。验证：离线签名测试通过；403/错误信息无 SK。
- [x] 1.3 实现 E2EE 模块（vault 密钥、HKDF 空间密钥、XChaCha20-Poly1305 + AAD 绑定、密文版本号、恢复材料导出）。验证：加解密/AAD 篡改/版本号负向测试。
- [x] 1.4 真实 OBS 往返探针（env 缺失显式跳过）：putImmutable/get/list/delete 往返、大对象（512KB）、列举分页。验证：机器可读结果。

## 2. 同步协议

- [x] 2.1 SyncEvent 模型与事件打包（批次上限、gzip、内容寻址 chunk key）。验证：打包确定性测试（同输入同 key）。
- [x] 2.2 manifest 单写者发布（先 chunk 后 manifest、headSeq 防回退、中断重推复用已传 chunk）。验证：中断重推幂等测试。
- [x] 2.3 `sync push`：worker `sync_upstream` 真实实现 + `cairn sync push` 命令；local_only 物理排除复用 outbox 语义并在打包层二次过滤。验证：local_only 记忆不进入任何 chunk 的测试。
- [x] 2.4 `sync pull`：拉取游标、幂等应用、等待依赖、tombstone 传播、并发修订入冲突队列。验证：复原/遗忘/冲突三类场景测试（本地 fake 远端）。
- [x] 2.5 doctor 集成：remote=not_configured / configured(untested) / verified(provider) 三态；`cairn vault status`。

## 3. ECS syncd

- [x] 3.1 单文件 syncd（零依赖 HTTP：chunk PUT/GET 幂等、manifest PUT 代次 CAS 409、Bearer token、绑定 Tailscale IP）+ 合同测试。验证：本地合同测试通过。
- [x] 3.2 部署到用户 ECS（systemd + SSH 脚本）并从本机以第二 RemoteStore 跑通同一协议探针。验证：真实往返记录。

## 4. 真实双设备验证

- [x] 4.1 OBS 双设备：本机两个合成 HOME 互推互拉，覆盖复原/冲突/遗忘/local_only 排除（远端列举核验）。验证：机器可读结果。
- [x] 4.2 跨平台双设备：ECS（Linux）运行 cairn 客户端与本机经 syncd 完成双向同步。验证：ECS 侧运行记录。
- [x] 4.3 密钥丢失场景：无密钥目录 pull 明确报错。验证：报错记录。
- [x] 4.4 文档：`docs/cairn-sync.md`（配置、双后端、密钥恢复、故障排查、边界）+ README/usage 链接。验证：按文档命令可复制执行。

## 5. 收尾

- [x] 5.1 全量 npm test + 新增用例；真实云端用例跳过逻辑正确（无凭据显式 skip 并注明）。验证：5 连续全绿。
- [x] 5.2 独立验收材料入 `artifacts/cloud-sync-2026-10-25/`（不入库）；handoff 更新。


## 实现验证记录（2026-10-25）

- 1.1–1.4：RemoteStore 三实现契约测试；OBS v2 签名固定向量（对照官方 SDK 规则核实）；E2EE 32 项（线格式字节锚、AAD 四字段绑定、密钥文件/恢复材料往返）；真实 OBS 往返探针通过（selftest 对象已清理）。
- 2.1–2.5：协议 6 场景（复原/幂等重推/并发冲突保留/遗忘传播/local_only 打包排除+远端密文审计/依赖等待）；doctor 三态语义（configured_untested 在缺凭据环境如实降级）。
- 3.1–3.2：syncd 合同（chunk 幂等、manifest 代次 CAS 409、Bearer、防穿越）；已部署用户 ECS（systemd + Tailscale 接口 + Bearer），真实往返通过。
- 4.1–4.4：真实 OBS 双设备 8 步验证 PASSED（机器可读：artifacts/cloud-sync-2026-10-25/real-obs-two-device-verification.json）；跨平台 Windows↔Linux(ECS) 双向同步 PASSED；密钥丢失场景 PASSED；docs/cairn-sync.md 按可复制命令撰写。
- 5.1–5.2：全量 npm test 绿（385→424 项，含 sync 套件 88 项，真实云端用例无凭据显式 skip）；证据与本记录同仓提交（artifacts/ 本地留存不入库）。

### 真实环境暴露并修复的缺陷

- 跨设备记忆身份：本地 id 不可跨设备引用 → 事件以内容哈希血统对齐（insertRemoteRevision + findMemoryIdByRevisionHashes）。
- OBS getManifest 把密文当 JSON 解析 / putManifest 把字节 JSON 化 → 改为原始字节语义；manifest 键补 devices/ 段。
- syncd /list 虚拟键空间（chunks/ manifests/ 物理分目录合并）；syncd 网络错误卫生（syncd_network_error）。
- putImmutable hash 参数语义 = 传输字节哈希；syncPush 失败复位已领取任务为 pending。


## 第三轮独立验证后的修复（2026-10-25，docs/verify-cloud-sync-2026-10-25.md）

| 问题 | 修复 | 回归证据 |
|---|---|---|
| P1 syncd 无 vault 隔离（第二 vault 使 pull 整链 auth_tag_invalid） | 客户端把 vaults/<vaultId>/ 并入 syncd 键空间（与 OBS 布局对齐，list 返回相对键）；pull 对不可解密 manifest/chunk 降级为跳过+审计（skippedReason），不再整链失败 | tests/sync/syncd-multivault.test.ts（真实服务器进程，双 vault 互不可见、pull 不受干扰） |
| P1 local_only 密文审计恒真（gzip 未解压） | 审计脚本与 protocol 测试改为解密后 gunzip 再比对；新增【反向注入对照】：故意打进金丝雀的 chunk 必须被检出 | tests/sync/protocol.test.ts 泄漏审计反向对照用例 |
| P2 syncd 代次 CAS 在真实密文下失效（JSON.parse 恒抛） | 代次落旁路 .gen 文件（服务器端，不依赖 body 可解析；.gen/.tmp 不进 /list） | tests/sync/syncd.test.ts 真实密文二进制 body 的 409 回归 |
| P3 文档/命令面漂移 | --help 补 vault/sync；README/AGENTS 状态行更新；cairn-sync.md 更新 CAS 与多 vault 语义 | 人工核对 |
| P3 OBS 遗留对象 | obs-purge-prefix.mts（带 cairn/ 护栏）清理 12 个遗留对象；verify-real-obs.mts 增加步骤 8 teardown-purge（验证对象跑完即清） | 重跑 9 步全绿，桶 cairn/ 前缀清空 |

- 修复后真实验证：OBS 9 步 PASSED（含修复后审计与收尾清理）；ECS 重新部署（新布局）后跨平台双向 PASSED；**P1 场景现场复现**：同 syncd 上创建第二个 vault 并推送后，vault1 的 ECS pull 照常成功且新事件持续流通（third-round-fix-live-verification.json）。
- 全量测试 388 项（388/0/1 skip），连续 3 轮 exit 0。
- 布局变更说明：syncd 键空间现含 vaults/ 段；旧布局数据已随重新部署清空（验证数据抛弃型）。
