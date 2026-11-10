# Tasks: 记忆批注与待处置队列

> 硬边界：批注 MUST NOT 修改记忆；`pending_forget` MUST NOT 执行删除；批注 MUST NOT 进入上行包。

## 1. 批注存储

- [x] 1.1 新增 `src/interfaces/console/annotations.ts`：读写 `console/annotations.json`，原子替换，坏文件按空处理（复用 `review-store.ts` 的容错姿势）。
- [x] 1.2 数据结构：`{ id, memoryId, revisionIdAtWrite, disposition, note, status, createdAt, resolvedAt?, resolvedBy? }`；`disposition` 枚举见 spec。
- [x] 1.3 陈旧判定：对比当前 `revisionId`，不一致标 `stale`（不删批注）。
- [x] 1.4 测试：写→读往返；坏 JSON 不崩；陈旧判定正确。

## 2. AppService 层

- [x] 2.1 `annotateMemory({ memoryId, disposition, note })`：`scanText` 复检 → 拒绝或写入；不改记忆。
- [x] 2.2 `annotateBatch({ memoryIds, disposition, note })`：逐条校验、分别计数、单条失败不中断。
- [x] 2.3 `listAnnotations({ disposition?, status?, limit? })`；`resolveAnnotation({ id, status, by })`。
- [x] 2.4 `listPendingForget()`：从批注里取 `disposition='pending_forget'` 且未处理的记忆。
- [x] 2.5 测试：`annotateMemory` 后记忆状态/正文/修订链完全不变（逐字段断言）。

## 3. CLI：待删清单

- [x] 3.1 `cairn forget --pending`：**先打印全部待删清单**（id + 摘要 + 标注时间），再执行；逐条报告。
- [x] 3.2 `cairn forget --pending --dry-run`：只打印不执行。
- [x] 3.3 删除走既有 `forgetMemory`，复用既有 outbox 入队与同步语义，不新增事件类型。
- [x] 3.4 测试：dry-run 零写入；真执行后记忆为 tombstoned 且有 outbox 任务；待删批注被标为已处理。

## 4. MCP 工具

- [x] 4.1 `memory_annotations_list`：参数 `disposition?` / `status?` / `limit?`；返回**不含记忆正文全文**。
- [x] 4.2 `memory_annotation_resolve`：参数 `id` / `status`（枚举）；记录 `resolvedBy`（Agent 身份）与时间。
- [x] 4.3 测试：返回体不含正文；非法 status 被拒；resolve 后不再出现在待办列表；记忆完全未变。

## 5. 控制台

- [x] 5.1 控制台新增 `POST /api/annotations`（单条与批量）与 `GET /api/annotations`。
- [x] 5.2 记忆详情页增加「写下意见」入口（类别下拉 + 文本域）。
- [x] 5.3 记忆列表增加多选 + 批量标记。
- [x] 5.4 批注列表页：按状态/类别过滤、陈旧灰显、显示处置者与时间。
- [x] 5.5 `pending_forget` 项 MUST 显示「仍为活动状态，尚未删除」。
- [x] 5.6 UI 测试（沿用 `e2e-console-ui.mjs` 的 Playwright 姿势）：点选、批量、陈旧灰显。

## 6. doctor

- [x] 6.1 `cairn doctor` 的 `notes` 增加一行待办批注数（**不进 problems、不改退出码**）。
- [x] 6.2 测试：有批注时计数正确，`ok` 仍为 true。

## 7. 全量验收

- [x] 7.1 `npm run typecheck` 0 错误。
- [x] 7.2 `npm test` 全量通过，报告 tests/pass/fail/skip 并与基线（724/723/0/1）对比。
- [x] 7.3 `openspec validate add-memory-annotations --strict` 通过。
- [x] 7.4 变异对照：把 `scanText` 复检去掉，确认秘密用例变红且只有它变红；还原复绿。
- [x] 7.5 负对照：改一个无关常量，确认零红。
- [x] 7.6 端到端：真实库副本上标注 → `forget --pending --dry-run` → 确认清单正确且未删任何记忆。

## 8. 文档

- [x] 8.1 `docs/cairn-console.md` 补批注与待删清单用法。
- [x] 8.2 `CHANGELOG.md` 的 Unreleased 段。
