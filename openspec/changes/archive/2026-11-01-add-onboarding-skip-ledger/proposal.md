# Proposal: 让「已跳过」成为可审计事实并退出待处理队列

## Why

真实的首次初始化留下了一个界面说不清的残留：51 个快照档案、533 条导入条目，其中 488 条 `clean`、45 条 `blocked`。完成一轮语义判断后，**18 条晋升成功**，其余 470 条判为跳过或并入，但控制台的「待晋升」计数**降不下来**。

根因是一处语义缺口，而不是渲染错误：`remaining` 的唯一判据是

```
clean AND NOT EXISTS(audit_event: category='onboarding' AND action='item_promoted' AND detail.itemId = i.id)
```

而系统**只有 `item_promoted` 一种动作**。判 skip 时，结论只记在当次运行的 summary 里，不落任何持久事实。于是：

- 跳过是**真实做出的决定**，却不是**可查的事实**；
- 条目永远算"待处理"，计数只增不减；
- 用户看到一个永远清不掉的队列，逐渐不再相信这个数字。

这条路径此前没有被真实走过——历史上没有出现过"大批判断后希望它们出队"的场景，缺陷因此一直潜伏。2026-11-01 首次全量整理把它暴露出来。

**为什么不能只靠复核建议解决**：`review submit` 写的是 AI 建议（供人审阅的中间产物），不是治理事实。用建议充当状态会让"这条到底处理完没有"依赖复核文件是否存在，而复核文件是可被覆盖、可被丢弃的。

**为什么不直接把 skip 记成 `item_promoted`**：那会让"已晋升"这个唯一谓词说谎，日后无法分辨哪些条目真的变成了记忆、哪些只是被判过。审计只增不改，一旦污染就不可逆。

## What Changes

- 新增一种持久事实：**「条目已跳过」审计**（`category='onboarding'`、`action='item_skipped'`，`detail` 含 `itemId` 与判定的依据类别）。
- **「这条还需要处理吗」的判定扩展为「既未晋升、也未跳过」**，并且仍然只有**一处出处**（现有 `promotedPredicate()` 扩展为同时给出两个谓词），不在多个文件里各写一份。
- **跳过是粘的**：与现有"撤销是粘的"保持一致——判过 skip 的条目不会被普通重跑重新拉回队列；要重新处理必须显式 `--redo`。
- 控制台与 CLI 增加**「已跳过」可查视图**：跳过的条目及其理由必须能被查看，而不是从界面上消失。`remaining` 只统计真正待处理的条目，`skipped` 单独成列。
- 判 skip 的入口（AI 复核判定、规则层 skip、`memory_decide`）统一写这条审计，不允许某个入口漏写。

### 不改什么

- **不改 `item_promoted` 的语义与历史**：已写入的 18 条审计原样保留，不重写、不重算。
- **不把复核建议当作治理状态**：复核记录仍是中间产物，只用于呈现建议。
- **不放松 `blocked` 的隔离**：45 条秘密/注入命中条目永远不进批次，本次也不为它们写跳过事实。
- **不改变撤销语义**：`policy revoke` 把记忆转墓碑的行为不变；本次只是让"跳过"也有粘性。

## Capabilities

### New Capabilities

无新增能力。

### Modified Capabilities

- `auto-onboarding`：自动整理与人工判断的"处理完毕"状态必须包含跳过，并保证跳过可查询、可审计、具粘性。
- `local-console`：导入视图必须区分「待处理」与「已跳过」，两者都可查，不得让跳过的条目从界面上消失。

## Impact

- 修改：`src/onboarding/batches.ts`（谓词扩展、`markItemSkipped`）、`src/onboarding/auto.ts`（skip 分支落审计）、`src/interfaces/app-service.ts`（`memory_decide` 的 skip 分支）、`src/interfaces/console/model.ts` 与 `assets/`（跳过列与筛选）、`src/interfaces/cli/main.ts`（`onboarding status` 增 `skipped` 字段、`--include-skipped` 查询）。
- 新增测试：`tests/onboarding/skip-ledger.test.ts`（跳过写审计、幂等、粘性、redo 才回队、blocked 不被记）。
- 规格：`openspec/specs/auto-onboarding/spec.md`、`openspec/specs/local-console/spec.md` 各加/改一条需求。
- 风险：
  - **谓词散落回归**：这个谓词历史上曾在 6 个文件里各写一份并因此出过撤销漏判。必须只改 `batches.ts` 一处，其他调用点改引用。验收要检查没有新增手写 `EXISTS (... item_promoted ...)`。
  - **历史数据不回填**：本次不替历史条目补写 skip 审计（无法判断当时意图）。现有 470 条的出队通过显式重跑本次判定产生，而不是伪造历史。
  - **回滚**：删除新增审计动作即可回退；`item_promoted` 语义未变，回滚不影响已晋升条目。
