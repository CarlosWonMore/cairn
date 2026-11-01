# Design

见 `proposal.md` 的 Why / What Changes。本文件只记录怎么做。

## Context

- `src/onboarding/batches.ts` 导出的 `promotedPredicate()` 是"这条还需不需要处理"的唯一出处（AGENTS.md 明确记录：它曾在 6 个文件里各写一份，撤销语义就是在其中一处漏掉的）。
- 当前只有 `category='onboarding'` + `action='item_promoted'` 一种事实，`detail` 形如 `{"itemId": "...", "memoryId": "..."}`。
- `batchProgress()`、`nextBatchChunk()`、控制台 `model.ts`（含 `NOT_PROMOTED_SQL` 占位符替换）、`app-service.ts` 都引用同一谓词。
- 真实库现状：488 clean、其中 18 已晋升、470 待处理、45 blocked。

## Goals / Non-Goals

**Goals:**

- 跳过成为可审计、可查询、具粘性的持久事实。
- `remaining` 只统计真正待处理的条目。
- 谓词仍然只有一处出处。

**Non-Goals:**

- 不回填历史条目的跳过事实（无法还原当时意图，伪造历史比留着更糟）。
- 不改变 `blocked` 的语义。
- 不把复核建议升级为治理状态。

## Decisions

### D1：新增 `item_skipped` 动作，而不是复用 `item_promoted`

复用会让"已晋升"这个谓词不再表示"生成了记忆"，而审计只增不改、一旦污染不可逆。两种事实语义不同，必须分开：一个说"变成了记忆"，一个说"判定不采用"。

**替代方案**：给 `item_promoted` 的 `detail` 加 `kind: 'skipped'` 字段。放弃——那会让所有既有消费方（含外部按 action 过滤的场景）都需要重新理解一个动作的两种含义。

### D2：谓词扩展为三个，仍只有一处出处

`promotedPredicate()` 改为同时导出：

- `exists` / `notExists`：晋升事实（**语义不变**，历史调用点不动）
- `skippedExists` / `skippedNotExists`：跳过事实
- `handledExists` / `handledNotExists`：`promoted OR skipped`，供"还需不需要处理"使用

`remaining` 改用 `handledNotExists`；`promoted` 统计仍用 `exists`。这样"待处理"与"已晋升"两个语义各自准确，且不会有人再手写子句。

**替代方案**：直接让 `notExists` 也排除 skipped。放弃——那会让 `promoted` 的计数口径被悄悄改变，且函数名说谎。

### D3：跳过依据只记类别，不记正文

`detail` 形如 `{"itemId": "...", "basis": "rule" | "judgement" | "decision", "reasonCode": "<短码>"}`。不写条目正文（正文可能含敏感内容，审计不是内容存储）。理由原文已在复核记录里，需要时按 itemId 关联。

### D4：粘性由谓词天然提供

条目一旦有跳过事实就不再进 `nextBatchChunk`。`--redo` 的做法是显式忽略该谓词（与既有 `onboarding auto --redo` 放宽选择层的做法一致），而不是删除审计——审计只增不改。

### D5：控制台用两列而非一个筛选器

`remaining`（待处理）与 `skipped`（已跳过）分别成列。跳过的条目另给查看入口（抽屉内分区），而不是从界面移除。这样"数字降下来了"和"我还能查到判过什么"同时成立。

## Risks / Trade-offs

- **谓词再次散落** → 只改 `batches.ts`，其他调用点改为引用导出常量；验收断言代码中没有新增手写 `action = 'item_promoted'` 子句（用 grep 计数做机器检查）。
- **历史 470 条不会自动出队** → 这是有意的：它们需要一次显式重跑以产生真实判定，而不是回填。文档与验收都要写清这一点，避免用户误以为修复后数字会自己变。
- **跳过后想反悔** → 依赖 `--redo`；不提供"删除跳过事实"的入口，与撤销粘性保持一致。
- **计数口径变化的兼容性** → `remaining` 的定义变严（不再含已跳过），任何依赖旧口径的展示需要同步；验收覆盖 total = promoted + skipped + remaining + (blocked) 的平衡关系。

## Migration Plan

- 无数据库结构变更（复用既有 `audit_event` 表）。
- 已有库升级后：历史条目无跳过事实，行为与本变更前一致；用户显式重跑后逐步产生跳过事实。
- 回滚：停止写入 `item_skipped` 即可；`promoted` 语义未变，回滚不影响已晋升条目。

## Open Questions

- 是否需要在控制台给「已跳过」提供批量"恢复待处理"按钮（等价于对该批条目 `--redo`）。可延后，不影响本次规格与任务拆分。
