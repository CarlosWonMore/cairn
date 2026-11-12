# Tasks: syncd 的备份对象删除

> 红线：**绝不允许删除同步链对象**（chunk / manifest）。白名单判定必须用 `key.includes('/backups/')`，不是 `startsWith('backups/')`——`safeKey(path.slice(1))` 拿到的相对 key 开头带 `chunks/`。

## 1. syncd 服务端

- [x] 1.1 `syncd/cairn-syncd.mjs` 的 `/chunks/` 分支内增加 `req.method === 'DELETE'` 处理。
- [x] 1.2 白名单：解码后的相对 key 必须 `includes('/backups/')`；否则 `403`，**不执行任何文件操作**。
- [x] 1.3 删除用 `rmSync(full, { force: true })`——对象不存在也返回 200（幂等）。
- [x] 1.4 `/manifests/` 分支不开放 DELETE（落到既有 404）。
- [x] 1.5 更新文件头的协议注释（补 `DELETE /chunks/<key>` 及其限制）。

## 2. 客户端

- [x] 2.1 `src/sync/syncd-store.ts` 实现 `deleteObject(key)`：`DELETE /chunks/<encodeURIComponent(this.k(key))>`。
- [x] 2.2 对 403 / 404 的语义：403 = 不是备份对象 → 抛错（调用方 bug）；**404 = 服务端没有 DELETE 路由（旧版）→ 抛 `syncd_delete_unsupported`，由上层降级为 `pruneWarning`，不得记为已淘汰**。
  - 注：本条曾写「404 视为幂等成功」，与 design D3（新版对不存在的对象返回 200）和 spec「MUST NOT 静默假装已淘汰」冲突，已修正。
- [x] 2.3 `src/sync/backup-store.ts` 的保留策略：远端支持 `deleteObject` 时真正淘汰；不支持时保持既有 `pruneWarning` 降级提示。
- [x] 2.4 测试：syncd 后端下「上传 N+1 份 → 最旧被删 → list 只剩 N」。

## 3. CLI

- [x] 3.1 `cairn backup --purge-remote <name>`：删除单个备份对象。
- [x] 3.2 删除前打印对象名与大小；删除后确认。
- [x] 3.3 远端不支持删除时明确报错（不静默）。
- [x] 3.4 帮助文本。

## 4. 测试（重点：红线）

- [x] 4.1 删除备份对象成功 → 文件消失、list 不含它。
- [x] 4.2 **删除同步链 chunk → 403 且文件仍存在**（这条是红线的守卫，必须有）。
- [x] 4.3 删除 manifest → 被拒绝，文件仍在。
- [x] 4.4 路径穿越（`..` / 非法字符）→ 拒绝，数据目录外无影响。
- [x] 4.5 删除不存在的备份对象 → 200 幂等。
- [x] 4.6 保留策略：syncd 下 N+1 份 → 实际删到 N。
- [x] 4.7 旧版 syncd（无 DELETE）→ 客户端降级提示而非报错（可用 mock 或对 404 的断言）。

## 5. 全量验收

- [x] 5.1 `npm run typecheck` 0 错误。
- [x] 5.2 `npm test` 全量通过，报告四个数字并与基线（797/796/0/1）对比。
- [x] 5.3 `openspec validate add-syncd-purge --strict` 通过。
- [x] 5.4 **变异对照**：把 `key.includes('/backups/')` 改成 `key.startsWith('backups/')` → 确认「删除备份对象成功」用例变红（因为合法请求会被拒）；还原复绿。
- [x] 5.5 **变异对照 2**：去掉白名单判断 → 确认「删除同步链 chunk 必须 403」用例变红；还原复绿。
- [x] 5.6 负对照：改无关文案 → 零红。

## 6. ECS 部署（需用户确认后才执行）

- [x] 6.1 在 ECS 上备份现文件：`cp /opt/cairn-syncd/cairn-syncd.mjs /opt/cairn-syncd/cairn-syncd.mjs.bak-<date>`。
- [x] 6.2 scp 覆盖新文件。
- [x] 6.3 `systemctl restart cairn-syncd`。
- [x] 6.4 `curl -H "Authorization: Bearer <token>" http://100.65.135.122:8471/healthz` 验证。
- [x] 6.5 端到端验证：`cairn backup --upload` 看 `pruneWarning` 是否消失。
- [x] 6.6 **回写 Obsidian `ServerAndPC/CLOUD-aliyun-ecs.md`**（环境手册纪律：持久变更必须回写）。

## 7. 清理误传对象

- [x] 7.1 部署完成后执行 `cairn backup --purge-remote <事故对象名>`。
- [x] 7.2 `cairn backup --list-remote` 确认清零。
- [x] 7.3 在交接文档 §6 事故记录中补「已清理」与清理方式。

## 8. 文档

- [x] 8.1 `docs/cairn-sync.md` 补 DELETE 端点与其白名单限制。
- [x] 8.2 `CHANGELOG.md` Unreleased。