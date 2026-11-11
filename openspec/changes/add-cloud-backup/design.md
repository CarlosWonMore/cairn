# Design: 设备限定记忆的云端加密备份

## 上下文

用户想要「设备记忆也同步到云端，但只跟本设备同步」。

这个措辞在项目定义层是矛盾的：

```
core/scope.ts:203  设备绑定作用域（deviceId ≠ 'all'）的 syncPolicy 必须是 local_only
core/scope.ts:207  encrypted 同步要求 deviceId 为 all
```

而且「同步」的语义是让对端持有等价副本；只有一方能读的通道，正确的名字是**备份**。

现状：`cairn backup` 已有（`src/store/backup.ts`，VACUUM INTO + sha256），但**只存本地**。硬盘坏了 device-local 全丢。

## 决策

### D1：走独立备份通道，不放开 local_only

**选择**：新增备份对象前缀（如 `<prefix>backups/<deviceId>/<name>.bin`），与 `vaults/<id>/personal-global/devices/...` 互不干扰。

理由：放开 `local_only` 会让设备限定的隐私保证失效；而备份通道解决的是**容灾**，不是**多端一致**，两件事不该共用一条链。

### D2：备份用设备专属派生路径

**选择**：`deriveBackupKey(vaultKey, deviceId)`，与同步的 `deriveSpaceKey(vaultKey, spaceKey)` 平行但不同域。

理由：

- 复用 vault 密钥 → 用户不用多抄一份恢复材料（这点很重要，多一份材料就多一个丢失点）；
- 但派生路径必须不同 → 两类对象的密文不可互换（spec 有对应场景）；
- 混入 `deviceId` → 天然实现「只有本设备能解」，不需要额外密钥。

**代价要说清**：设备重装后如果 `deviceId` 变了（`~/.cairn/data/device.json` 丢失），旧备份就解不开了。这与现有同步的 `deviceId` 语义一致——所以文档里必须写「重装前备份 device.json，或用 device re-enroll 恢复身份」。

### D3：复用现有加密原语，不新造

**选择**：`src/sync/cryptoutil.ts` 的 `encryptObject` / `decryptObject`（XChaCha20-Poly1305，AAD 绑定标识）。

理由：已验证、AAD 绑定能防对象互换、无需新依赖。AAD 里用 `kind: 'backup'` 与 `kind: 'chunk'` 区分。

### D4：保留策略只在显式上传时执行

**选择**：不在后台定时清理；上传时顺手按策略淘汰，且淘汰前列出。

理由：删除是不可逆动作。挂在定时器上等于让用户失去对「删了什么」的感知。

### D5：恢复默认到新路径

**选择**：`restore --from-remote <id>` 默认还原到 `~/.cairn/restore-<timestamp>/`；覆盖当前库需 `--force` 且自动先备份当前库。

理由：恢复是灾难场景下的操作，人在慌乱中最容易选错覆盖目标。默认不覆盖，是把最坏后果（当前库被旧备份顶掉）从默认路径上移开。

## 威胁模型

| 威胁 | 后果 | 缓解 |
|---|---|---|
| 备份密文被别的设备拿到 | 若密钥派生不含设备维度，对方能解密全库 | D2 混入 deviceId |
| 设备身份丢失 | 旧备份永久解不开 | 文档要求备份 `device.json`；`device re-enroll` 已有 |
| 保留策略误删别人的备份 | 其他设备失去容灾 | 清理只列举本设备前缀 + 删除前列出 |
| 恢复覆盖了较新的库 | 数据倒退 | D5 默认不覆盖 + 覆盖前自动备份 |
| 备份对象被当成同步对象处理 | 同步列举出错或浪费 | D1 独立前缀，spec 双向隔离场景 |

## 迁移与回滚

- 无数据库迁移。
- 回滚：停止上传即回到现状；已上传对象不影响任何现有功能。

## 可观测性

| 观察点 | 位置 |
|---|---|
| 远端备份列表 | `cairn backup --list-remote`（含大小与时间） |
| 上传结果 | 命令输出（对象路径、密文字节、sha256） |
| 保留淘汰 | 输出中逐条列出被删对象 |
