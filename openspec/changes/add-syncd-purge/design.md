# Design: syncd 的备份对象删除

## 上下文

`syncd/cairn-syncd.mjs` 是零依赖单文件（179 行），路由只有 PUT/GET `/chunks`、GET/PUT `/manifests`、GET `/list`、GET `/healthz`。

备份对象**复用了 `/chunks/` 分支**：`SyncdRemoteStore.putImmutable(key, …)` → `PUT /chunks/<encodeURIComponent(prefix + key)>`，其中 `key = backups/<deviceId>/<name>`，`prefix = vaults/<vaultId>/`。

所以落盘路径是 `chunks/vaults/<vaultId>/backups/<deviceId>/<name>`。

## 决策

### D1：DELETE 挂在 `/chunks/` 分支内，用内容判别而非新路由

**选择**：在既有 `path.startsWith('/chunks/')` 分支里加 `method === 'DELETE'` 的处理，而不是新开 `/backups/<key>` 路由。

理由：客户端（`SyncdRemoteStore`）已经用 `/chunks/` 寻址备份对象。新开路由意味着路径映射要改两处，且旧客户端行为不一致。挂在原分支里，客户端只需加一个 method。

### D2：白名单判定用 `key.includes('/backups/')`，不能用 `startsWith`

**选择**：`safeKey(path.slice(1))` 返回的是**绝对路径**，判别要基于**解码后的相对 key**。

关键细节：`path.slice(1)` 得到的是 `chunks/vaults/<v>/backups/<d>/<n>`，**开头带 `chunks/`**。所以：

```js
// ❌ 错：相对 key 不以 backups/ 开头
if (!key.startsWith('backups/')) return 403;

// ✅ 对：备份段在中间
if (!key.includes('/backups/')) return 403;
```

这条交接文档专门提醒过，我把它写进规格场景，避免实现者写错后「测试也写错、两边一起错」。

### D3：删除不存在的对象返回成功

**选择**：`rmSync(full, { force: true })`，不存在也返回 200。

理由：与既有 GET 的「404 = 不存在」语义配套——删除是幂等的。若返回 404，保留策略在重试时会因「对象已被删」而报错，反而制造噪音。这与 OBS `deleteObject` 的既有实现（404 视为成功）一致。

### D4：不做批量删除

**选择**：一次请求删一个对象。

理由：批量接口一旦被误用就是「清空整个备份前缀」。保留策略本身是逐对象循环，不需要批量端点。

### D5：服务端白名单，不信任客户端

**选择**：`/backups/` 判定写在 service 端。

理由：客户端可以有很多个（未来第三方实现），服务端限制是唯一可靠的位置。

## 威胁模型

| 威胁 | 后果 | 缓解 |
|---|---|---|
| DELETE 被用来删同步链 | 某设备 seq 段永久缺失，对端拉取卡住 | D2 白名单 + 测试钉住「删 chunk 必须 403 且文件仍在」 |
| 路径穿越删数据目录外的文件 | 灾难性 | 复用 `safeKey()`；测试覆盖 `..` 与非法字符 |
| 误删唯一备份 | 失去容灾 | 单对象 + `--purge-remote` 打印对象名与大小；策略只淘汰最旧 |
| 旧版 syncd 收到 DELETE | 走 404 | 客户端 `deleteObject` 把 404 视为「不支持」并降级为 `pruneWarning`，不报错 |

## 迁移与回滚

- 无 schema 迁移、无客户端协议破坏性变更（新增 method，旧服务端对 DELETE 返回 404）。
- 回滚：从服务端移除 DELETE 分支；客户端 `deleteObject` 会退化为「降级提示」而非报错。
- **ECS 部署**：`syncd/cairn-syncd.mjs` 是零依赖单文件。部署前在 ECS 上 `cp` 备份现文件；`systemctl restart cairn-syncd`；`curl healthz` 验证。

## 可观测性

| 观察点 | 位置 |
|---|---|
| 删除成功 | syncd stdout（可选，当前实现无请求日志） |
| 越界拒绝 | 403 响应 |
| 策略是否生效 | `cairn backup --upload` 输出中的 `pruneWarning` 有无 |
