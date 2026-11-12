# Proposal: syncd 的备份对象删除（purge）与误传清理

## Why

两个已发生的具体问题：

**① 备份保留策略在 syncd 后端形同虚设。** `cairn backup --upload` 默认保留最近 5 份并淘汰最旧，但 `RemoteStore.deleteObject` 是**可选方法**：OBS 已实现，**syncd 没有 DELETE 路由**。所以 syncd 后端只能“只上传不删”——策略代码跑了，实际什么都不删。当前实测 `pruneWarning` 会如实提示，但这意味着用户以为有保留上限，实际无上限。

**② 一个误传对象删不掉。** 2026-11-12 00:52，一条内嵌 Python 的 shell 命令因反引号被 bash 展开，`cairn backup --upload` 被真实执行，在用户自己的 ECS 上传了一个 3.2 MB 的加密备份对象。本地校验确认它是**合法快照**、无泄露面（自有服务器 + 自有密钥），但**无法远程删除**。

两条都指向同一个缺口：**syncd 协议缺一个受严格限制的删除能力**。

## 现状协议（只读核实，`syncd/cairn-syncd.mjs`）

```text
PUT  /chunks/<key>      不可变上传（同 key 同体幂等）
GET  /chunks/<key>      下载（404 = 不存在）
GET  /manifests/<key>   下载 manifest
PUT  /manifests/<key>   发布 manifest（X-Cairn-Generation 代次 CAS，回退 409）
GET  /list?prefix=      列举（合并 chunks/ 与 manifests/ 两个物理目录）
GET  /healthz           健康检查
```

关键事实：**备份对象走的是 `/chunks/` 分支**。`SyncdRemoteStore.putImmutable` → `PUT /chunks/<encodeURIComponent(prefix + key)>`，key 形如 `vaults/<vaultId>/backups/<device>/<name>`，落盘为 `chunks/vaults/<vaultId>/backups/<device>/<name>`。

## What Changes

- **新增 `DELETE /chunks/<key>`**，但**只允许删除解码后 key 含 `/backups/` 的对象**；其他一律 403。
- **`SyncdRemoteStore.deleteObject`** 实现调用它，使备份保留策略在 syncd 后端真正生效。
- **两条清理路径**（用户 2026-11-12 选方案 A）：
  - `cairn backup --purge-remote <name>`：显式删除单个备份对象（带确认输出）；
  - 保留策略自动淘汰（依赖同一个 DELETE）。

### 明确不做的事（红线）

- **绝不删除同步链对象**（chunk / manifest）。同步链是**只追加**的：chunk 内容寻址不可变，manifest 靠代次 CAS 单调递增。一旦能删 chunk，「某设备某 seq 段」就永久缺失，而**没有备份**——对端拉取会卡在那个缺口。
- **不提供通用 DELETE**。路径限制写在服务端，不依赖客户端自觉。
- **不做批量 purge**。一次一个对象，避免一条命令清空备份前缀。
- **不改动同步协议语义**。本次只增加一个受限的删除端点。

## Impact

- Affected specs: `cloud-sync`（备份与同步的删除边界）
- Affected code: `syncd/cairn-syncd.mjs`（新增分支）、`src/sync/syncd-store.ts`（`deleteObject`）、`src/sync/backup-store.ts`（保留策略调用）、`src/interfaces/cli/main.ts`（`--purge-remote`）
- 不涉及数据库迁移
- **需要重部署 ECS syncd**（环境持久变更，需用户确认）

## 风险与回滚

| 风险 | 处置 |
|---|---|
| DELETE 被用于删除同步链 | 服务端白名单：只允许 `/backups/`；越界 403 并有测试钉住 |
| 路径穿越 | 复用既有 `safeKey()`（正则白名单 + 解析后必须在数据目录内） |
| 误删唯一一份备份 | 单对象删除 + 删除前打印对象名与大小；保留策略只淘汰最旧 |
| ECS 部署出错 | 部署前备份现文件；`healthz` 验证；失败可回滚到备份 |
