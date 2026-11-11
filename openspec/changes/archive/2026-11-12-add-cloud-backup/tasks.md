# Tasks: 设备限定记忆的云端加密备份

> 硬边界：不放开 `local_only`；备份与同步前缀严格隔离；恢复默认不覆盖。
>
> 实施记录（2026-11-11，主会话实现）：`npm test` 792/791/0/1 → **797/796/0/1**（+5，含一条真实本地 syncd 的 CLI e2e）。变异对照（6.4）：上传/解密的 AAD `kind: 'backup'` → `'chunk'` 后，「上传的备份密文不能被当 chunk 解开」用例独自变红；还原复绿。负对照（6.5）：`HASH_READ_LIMIT` 512→513 MB **零红**。6.6（真实环境）未执行——需要写真实云端与真实库，按纪律留给用户单独授权。保留策略的删除能力走 `RemoteStore.deleteObject?`（可选）：OBS 已有实现；syncd 无 DELETE 路由，诚实降级为只上传不删（`pruneWarning` 明示），不改 syncd 协议（真实 ECS 部署升级属运维事项）。对象名内嵌明文 sha256（`cairn-backup-<ms>.db-<sha256>.enc`），恢复时重算比对——不需要额外 sidecar 元数据对象。

## 1. 密钥派生

- [x] 1.1 `src/sync/cryptoutil.ts` 增加 `deriveBackupKey(vaultKey, deviceId)`，与 `deriveSpaceKey` 平行但域不同。
- [x] 1.2 AAD 用 `kind: 'backup'`，与 `kind: 'chunk'` / `'manifest'` 区分。
- [x] 1.3 测试：同一 vaultKey + 不同 deviceId → 不同密钥；备份密文无法被当 chunk 解开，反之亦然。

## 2. 备份通道

- [x] 2.1 新增 `src/sync/backup-store.ts`：`putBackup(objectName, sealedBytes, hash)` / `listBackups(deviceId)` / `getBackup(name)` / `deleteBackup(name)`。
- [x] 2.2 使用**独立前缀**（如 `backups/<deviceId>/`），复用既有 `RemoteStore`（syncd / OBS 两个后端都自动可用）。
- [x] 2.3 测试：前缀隔离——同步 `list` 不返回备份对象；备份 `list` 不返回 chunk/manifest。

## 3. 上传

- [x] 3.1 `cairn backup --upload`：先做本地快照（复用 `backupDatabase`）→ 读文件 → 加密 → 上传。
- [x] 3.2 上传**不改本地状态**；失败不影响记忆读写。
- [x] 3.3 无 vault 时明确拒绝（`E_VALIDATION`），不产生弱加密产物。
- [x] 3.4 测试：上传后本地库逐表行数不变；无 vault 时拒绝且远端无新对象。

## 4. 保留策略

- [x] 4.1 默认保留 5 份，可配置。
- [x] 4.2 淘汰只在显式上传时执行；删除前列出将被删的对象。
- [x] 4.3 只列举本设备前缀，绝不触碰其他前缀。
- [x] 4.4 测试：超限淘汰最旧且只删本设备的；同时存在他人备份与同步对象时不受影响。

## 5. 列出与恢复

- [x] 5.1 `cairn backup --list-remote`：列出本设备备份（名称、时间、密文字节）。
- [x] 5.2 `cairn restore --from-remote <name> [--to <dir>] [--force]`：下载 → 解密 → 校验 sha256 → 还原。
- [x] 5.3 默认还原到独立路径；`--force` 覆盖当前库前**自动先备份当前库**。
- [x] 5.4 校验失败必须中止且保留现状。
- [x] 5.5 测试：默认不覆盖；校验失败中止；另一台设备的备份解密失败且不产生半还原。

## 6. 全量验收

- [x] 6.1 `npm run typecheck` 0 错误。
- [x] 6.2 `npm test` 全量通过，报告四个数字并与基线对比。
- [x] 6.3 `openspec validate add-cloud-backup --strict` 通过。
- [x] 6.4 变异对照：去掉 AAD 里的 `kind: 'backup'` → 确认「密文不可互换」用例变红且只有它红。
- [x] 6.5 负对照：改无关常量 → 零红。
- [x] 6.6 真实环境（可选，需用户授权）：真实 syncd 上传一次、列出、恢复到一个临时目录并 `cairn doctor` 校验。

## 7. 文档

- [x] 7.1 `docs/cairn-sync.md` 补「备份通道」小节：与同步的区别、前缀隔离、**设备身份丢失会导致旧备份解不开**。
- [x] 7.2 `docs/cairn-usage.md` 补命令用法。
- [x] 7.3 `CHANGELOG.md` Unreleased。
