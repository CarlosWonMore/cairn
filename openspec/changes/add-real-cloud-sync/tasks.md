# Tasks

## 1. RemoteStore 与 E2EE 基座

- [ ] 1.1 扩展 RemoteStore 接口（getObject/putImmutable/listObjects/deleteObject/configured）并接通工厂 `getRemoteStore`（obs/syncd/none）；用接口契约测试锁定三实现语义。验证：契约测试非零断言。
- [ ] 1.2 实现 OBS v2 签名客户端（HMAC-SHA1 头签名、URL 编码资源、Content-MD5）；签名单元测试用固定向量锁定；错误不回显签名材料。验证：离线签名测试通过；403/错误信息无 SK。
- [ ] 1.3 实现 E2EE 模块（vault 密钥、HKDF 空间密钥、XChaCha20-Poly1305 + AAD 绑定、密文版本号、恢复材料导出）。验证：加解密/AAD 篡改/版本号负向测试。
- [ ] 1.4 真实 OBS 往返探针（env 缺失显式跳过）：putImmutable/get/list/delete 往返、大对象（512KB）、列举分页。验证：机器可读结果。

## 2. 同步协议

- [ ] 2.1 SyncEvent 模型与事件打包（批次上限、gzip、内容寻址 chunk key）。验证：打包确定性测试（同输入同 key）。
- [ ] 2.2 manifest 单写者发布（先 chunk 后 manifest、headSeq 防回退、中断重推复用已传 chunk）。验证：中断重推幂等测试。
- [ ] 2.3 `sync push`：worker `sync_upstream` 真实实现 + `cairn sync push` 命令；local_only 物理排除复用 outbox 语义并在打包层二次过滤。验证：local_only 记忆不进入任何 chunk 的测试。
- [ ] 2.4 `sync pull`：拉取游标、幂等应用、等待依赖、tombstone 传播、并发修订入冲突队列。验证：复原/遗忘/冲突三类场景测试（本地 fake 远端）。
- [ ] 2.5 doctor 集成：remote=not_configured / configured(untested) / verified(provider) 三态；`cairn vault status`。

## 3. ECS syncd

- [ ] 3.1 单文件 syncd（零依赖 HTTP：chunk PUT/GET 幂等、manifest PUT 代次 CAS 409、Bearer token、绑定 Tailscale IP）+ 合同测试。验证：本地合同测试通过。
- [ ] 3.2 部署到用户 ECS（systemd + SSH 脚本）并从本机以第二 RemoteStore 跑通同一协议探针。验证：真实往返记录。

## 4. 真实双设备验证

- [ ] 4.1 OBS 双设备：本机两个合成 HOME 互推互拉，覆盖复原/冲突/遗忘/local_only 排除（远端列举核验）。验证：机器可读结果。
- [ ] 4.2 跨平台双设备：ECS（Linux）运行 cairn 客户端与本机经 syncd 完成双向同步。验证：ECS 侧运行记录。
- [ ] 4.3 密钥丢失场景：无密钥目录 pull 明确报错。验证：报错记录。
- [ ] 4.4 文档：`docs/cairn-sync.md`（配置、双后端、密钥恢复、故障排查、边界）+ README/usage 链接。验证：按文档命令可复制执行。

## 5. 收尾

- [ ] 5.1 全量 npm test + 新增用例；真实云端用例跳过逻辑正确（无凭据显式 skip 并注明）。验证：5 连续全绿。
- [ ] 5.2 独立验收材料入 `artifacts/cloud-sync-2026-10-25/`（不入库）；handoff 更新。
