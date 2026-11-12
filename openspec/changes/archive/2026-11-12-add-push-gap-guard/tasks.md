# Tasks: push 前自动检查上行缺口

> 硬边界：提示不阻断、不自动补；复用 `findUpstreamGap`，不另写查询；缺口为零时完全静默。

## 1. 实现

- [x] 1.1 `src/interfaces/app-service.ts` 的 `syncPushCmd` 在 `syncPush` 之前调 `findUpstreamGap(this.store)`。
- [x] 1.2 候选 > 0 时打印警告（走 `stderr`，不污染 `--json` 的 stdout）：条数 + 「这些记忆尚未入队，本次推送不包含它们」+ 指向 `cairn sync backfill --apply`。
- [x] 1.3 候选为 0 时**不打任何额外输出**。
- [x] 1.4 推送照常执行，退出码不变。
- [x] 1.5 **必须** import `findUpstreamGap`（`src/sync/backfill.ts`），不得另写 SQL。

## 2. 测试

- [x] 2.1 有缺口时：push 打印警告、推送仍成功、退出码 0。
- [x] 2.2 无缺口时：输出中不含缺口相关内容。
- [x] 2.3 提示不改变任务：push 前后的待办数量符合既有语义。
- [x] 2.4 **三处口径一致**：构造一处缺口，分别跑 `doctor` / `backfill` 只读 / `sync push`，三者报告的条数相同。

## 3. 验收

- [x] 3.1 `npm run typecheck` 0 错误。
- [x] 3.2 `npm test` 全量通过，报告四个数字并与基线（808/807/0/1）对比。
- [x] 3.3 `openspec validate add-push-gap-guard --strict` 通过。
- [x] 3.4 变异对照：把缺口检查短路（恒返回空）→ 确认 2.1 / 2.4 变红；还原复绿。
- [x] 3.5 负对照：改无关文案 → 零红。

## 4. 文档

- [x] 4.1 `docs/cairn-sync.md` 补「push 会提示未入队的记忆」一句。
- [x] 4.2 `CHANGELOG.md` Unreleased。
