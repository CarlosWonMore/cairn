# Proposal: 上行入队完备性与冷启动对账（cairn sync backfill）

## Why

Cairn 的加密同步协议（`add-real-cloud-sync`，已归档）在协议层是完整的：chunk/manifest、端到端加密、冲突保留、双后端都实现并验证过。但**上行入队这一层是漏的**，2026-11-10 在真实库上实测确认：

```text
personal-global 42 条 active 记忆，只有 19 条有 sync_upstream 任务
  {"created_by 类别":"other","withjob":19,"n":19}   ← 走 AppService，有 enqueue
  {"created_by 类别":"plan", "withjob":0, "n":23}   ← 走 governance/apply，没有 enqueue
```

也就是说 **23/42 条（55%）应当上云的记忆根本不在上行队列里**，而且没有任何地方会报错：`sync push` 会安静地"成功"，`doctor` 会显示 `verified`，直到用户换设备拉取时才发现少了半个库。

根因：`src/governance/apply.ts` 的 `add` / `keep_both` / `merge` 三条分支直接调 `store.memories.add()` / `store.memories.revise()`，绕过了 `AppService` 里的 `store.outbox.enqueue()`。自动整理（`onboarding/auto.ts`）走的正是 `applyPlan`，所以**自动整理产出的记忆全部不在同步链上**——而自动整理恰恰是产出最多的写入路径。

同一张网还有三处漏点，会在不同时机以同样"安静"的方式丢上行：

1. `rejectCandidate()`（`app-service.ts:455`）把候选转墓碑时不入队，`forgetMemory()` 入队——**同一个语义，两种行为**；
2. `applyDecision()` 的 `merge` 与 `promote` 分支只改目标记忆，不给目标补上行任务；
3. 已有记忆若因任何原因错过入队（例如本变更之前写入的历史数据、或事务在 enqueue 之前中断），**没有任何对账手段**把它补回来。

第三条是最要命的：它意味着"漏了就一直漏"。所以本变更除了补落点，还必须提供一个**可反复执行、幂等、只补不发**的对账命令。

### 为什么现在做

用户 2026-11-10 决定启用 `syncd` 后端做主力同步，并把触发方式定为「登录时 + 手动」。一旦启用，上面 23 条就会被**永久地排除在云端之外**，且此后每次自动整理都在继续制造新的漏点。**必须在首次 `sync push` 之前关掉这个口子。**

## What Changes

- **新增 CLI 命令 `cairn sync backfill`**：列举「作用域允许上行、但当前不存在 `sync_upstream` 任务」的活动记忆，为其补一条幂等入队任务；默认 dry-run，`--apply` 才真正写入；输出机器可读的候选数 / 已入队数 / 已存在数 / 被排除数。
- **补齐治理层的三个上行落点**：`applyPlan` 的 `add` / `keep_both` / `merge` 分支在写入成功后，按目标记忆的**实际作用域**决定是否入队（沿用既有 `scopeAllowsUpstream` 判定与 `outbox.enqueue` 的物理排除语义）。
- **补齐 `rejectCandidate` 的墓碑上行**，与 `forgetMemory` 对齐。
- **补齐 `applyDecision` 的 `merge` / `promote` 分支**：目标记忆内容或状态变更后补一条上行任务。
- **新增对账可观测性**：`doctor` 报告「应上行但未入队」的条数（健康时恒为 0），让这类漏点**不可能再安静**。

### 明确不做的事

- **不改同步协议**。chunk / manifest / 加密 / 冲突语义一行不动。
- **不把入队下沉到 `src/store/memories.ts`**。拉取侧 `src/sync/apply.ts` 也调 `memories.add/revise`，若在存储层入队，**`sync pull` 会给自己制造上行任务，形成回环推流**。入队只能留在编排层（`AppService` / `governance/apply.ts`），拉取侧永不入队。这条是硬边界，不只是风格。
- **不做自动定时同步**。触发方式由用户定为「登录时 + 手动」，本变更只保证"该入队的都入了"，不引入任何 hook 或定时器。
- **不接 `project-global` 空间**。当前同步只覆盖 `personal-global`（`PERSONAL_SPACE_KEY`），补落点时对其它空间照旧由 `scopeAllowsUpstream` 决定入队与否，但 `push` 侧仍只发布 `personal-global` 链——这是 `cloud-sync` 的既有边界，本变更不扩大。
- **不修换后端时游标不重置的问题**（`pullCursorKey` 不含 provider）。那是独立缺陷，另立变更，不混进来。
- **不与云端交互**。`backfill` 只写本地 outbox，**不 push**；上传由用户显式 `cairn sync push` 执行。

## Impact

- Affected specs: `cloud-sync`（新增「上行入队完备性」与「冷启动对账」要求）、`memory-governance`（新增「治理写入必须保持上行完备」要求）、`agent-interfaces`（新增 `sync backfill` 命令入口与 doctor 计数）
- Affected code: `src/governance/apply.ts`、`src/interfaces/app-service.ts`（`rejectCandidate` / `applyDecision` / `doctor` / 新增 `syncBackfillCmd`）、`src/sync/`（新增 `backfill.ts`）、`src/interfaces/cli/main.ts`、`src/interfaces/console/server.ts`（只读展示，可选）
- Affected tests: `tests/governance/`（apply 后必有 outbox）、`tests/sync/`（backfill 幂等与排除语义）、`tests/interfaces/`（doctor 计数、CLI 退出码）
- 不涉及数据库迁移：`outbox_job` 表结构与 `idempotency_key` 唯一约束已存在，本变更只增加写入点与查询。
- 数据影响：`--apply` 会在本地 outbox 写入至多「应上行未入队」条数的记录；不触碰记忆表、不触碰云端。回滚方式是 `DELETE FROM outbox_job WHERE created_at >= <执行时刻> AND status='pending'`。

## 风险与回滚

| 风险 | 处置 |
|---|---|
| 补落点后 `sync pull` 造成回环推流 | 入队**不下沉**到存储层；拉取侧 `apply.ts` 保持零入队，并在 tests 里用断言钉住 |
| `backfill` 误把 `local_only` / 设备限定内容入队 | 复用 `outbox.enqueue` 内已有的物理排除（`scope.sync_policy` + `device_id`），并有对应用例：排除项不得产生任何 `outbox_job` 行 |
| `backfill` 重复执行产生重复任务 | `idempotency_key` 唯一约束 + `enqueue` 返回 `duplicate`；重复执行结果恒为「新增 0」 |
| 补落点改变既有测试期望 | 凡涉及 `applyPlan` / `rejectCandidate` 的既有用例，若原本断言"无 outbox 行"，属**被本变更契约推翻的占位断言**，须更新并在报告中逐条列出 |
| 回滚 | 代码回滚即可；`--apply` 产生的任务行可用上述 DELETE 清除，未上传的任务不影响任何已存数据 |
