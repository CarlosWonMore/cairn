# Design: 候选晋升命令（cairn promote）

## Context

`memory.status='candidate'` 是治理层的**有意设计**：模型推断与未验证导入只能成为待审查候选，不得静默变成高权威活动记忆（`openspec/specs/memory-governance/spec.md`「候选与活动记忆分离」）。设计上，候选需要一条**由用户显式动作**驱动的晋升路径。

现状是这条路径**不存在**。`promoteToActive()` 只有一个调用点（`app-service.applyDecision`），且只能被写入路径的查重副作用间接触发。

### 实测证据（2026-11-03）

| 入口 | 实测结果 |
|---|---|
| `mcp__cairn__memory_decide action=next` | 返回「没有待整理的批次」——该通道服务 onboarding 批次 |
| `cairn review pack/submit` | `reviewSubmit` 只查 `import_item` 表，拒绝非导入条目 |
| 控制台 `GET /api/memories` | 只读，无晋升写入口 |
| `cairn update <id> "内容"` | 只改正文，不动 `scope_id`（`app-service.ts:312-330`） |
| 全库检索 `UPDATE memory SET scope_id` | 无任何代码路径 |

### 真实库现状（2026-11-03 16:00 快照）

- `memory` 42 active + 3 candidate，0 conflicted
- 3 条 candidate 均为 `authority='agent_inferred'`、`created_by='mcp:cli'`，写入于 2026-11-02 17:51（video-plan 任务产出）
- 其中 2 条正文写死本机绝对路径（`D:\用户\Documents\...\video-plan\render\`、`C:\Users\Carlos\.zcode\skills\...`），换设备即失效

## Goals / Non-Goals

**Goals**

1. 用户有一条明确、可审计、可重复执行的候选晋升路径。
2. 晋升时可选地调整作用域（有路径的机机专属内容应落 `device-local`），且作用域变更与晋升原子完成。
3. 「不批准」也有确定终态（拒绝），候选不永远悬空。
4. 晋升后 `authority` 反映**真实来源**（用户批准 → `user_confirmed`），不伪装成「用户明确陈述」。

**Non-Goals**

- 不改 `memory_add` 的权威推导（晋升是独立动作，不复用写入副作用）。
- 不做批量晋升（一次一条，避免混入未逐条核对的条目）。
- 不做自动晋升 / 定时晋升。
- 不新增数据库表或迁移（`memory.scope_id` 已存在）。

## Decisions

### D1：晋升是 CLI 动作，CLI 本身即批准凭据

**决策**：`cairn promote <id>` 直接完成晋升，`approved_by='local_cli'`、`channel='cli'` 记入审计事件。

**理由**：现有 `approval` 表是为**批量计划**设计的（`plan_id` + `plan_hash` + 一次性消费）。单条候选的晋升没有「计划哈希」可绑，若为此造一个一次性计划再签发审批，会把「批准一条记忆」变成「建计划 → 签审批 → 应用计划」三步，与用户「我批准了这条」的心智模型严重不匹配。

同时，**批准凭据不能是调用方声明**。`memory-governance` 要求「调用方声明 user_confirmed MUST NOT 构成审批凭证」。本设计的凭据是**签发通道本身**（本地 CLI 进程），与 `add-auto-onboarding` 中策略复用 `approved_by='local_cli'` 的做法一致：谁签发、哪条通道，在审计里可查。

**取舍**：不与批量计划共用 `approval` 表，因此晋升**不可被远端或 Agent 代签**——这正是我们要的。

### D2：作用域可迁移，但必须显式且原子

**决策**：`cairn promote <id> --scope-preset device-local` 在**同一事务**内完成 `status` 与 `scope_id` 的更新。

**理由**：记忆的作用域在写入时固化、之后不可变，是 `memory-store` 的既有语义。但这条语义在「候选待审」阶段过严——候选尚未生效，正是修正作用域的时机。晋升是它唯一的出口。

**必须一起处理的事**：
- `memory.scope_id` 变更后，**外键完整性**必须复查（`scope_id` 被 `memory_revision` 等子表间接引用）。
- **outbox 必须失效重建**：旧作用域下的待同步任务引用了旧 `scope_id`，作用域变了以后，旧任务若发出会把记忆同步到错误的云端空间。晋升时必须删除该记忆在旧作用域下的 pending outbox 任务，并按新作用域重新入队。
- **审计必须记录变更前后的作用域**，否则事后无法解释一条记忆为何换了位置。

**不做的**：不提供「纯改作用域、不改状态」的独立命令。改作用域的意义只在于让记忆在正确的地方生效，与晋升是同一件事。

### D3：`authority` 升为 `user_confirmed` 而非 `user_explicit`

**决策**：晋升后 `authority` 取 `user_confirmed`。

**理由**：四种权威的语义是——
- `user_explicit`：用户**亲口陈述**的内容
- `user_confirmed`：用户**看过并批准**的内容
- `agent_inferred`：模型推断
- `imported_unverified`：未验证导入

候选是模型推断产生的，用户**看过**它并批准 → 语义上就是 `user_confirmed`，不是 `user_explicit`。现有 `promoteToActive(id, authority, by)` 把 authority 作为参数传入，本设计传入 `user_confirmed`。

这条区分有实际价值：将来若要区分「用户原话」与「用户认可的整理结果」，`user_explicit` / `user_confirmed` 就是天然的分野。把它混为一谈会丢掉这个信息。

**注意**：`promoteToActive()` 现有的 `E_FORBIDDEN` 守卫（拒绝 `agent_inferred` / `imported_unverified` 作为晋升后的权威）**必须保留**——那两条是「来源权威」，不是「晋升后权威」。

### D4：拒绝 = 转墓碑，不是删除

**决策**：`cairn reject <id>` 把候选转为 `tombstoned`，并记审计。

**理由**：`memory-store` 的生命周期语义里，`tombstoned` 是「明确退出活动集但保留可审计痕迹」的状态。候选被拒绝后既不是「没写过」（它进过库、影响过投影候选），也不该是 `active`（用户没批准）。墓碑是唯一符合的终态。

**注意**：这与 `add-auto-onboarding` 的「撤销是粘的」是同一族语义——墓碑之后普通重跑不会把它写回来。要恢复必须显式 `--redo`。

### D5：只允许晋升 candidate，其他状态明确报错

**决策**：`promote` 只接受 `status='candidate'`；对 `active` / `archived` / `tombstoned` 一律 `E_CONFLICT_STATE`。

**理由**：与现有 `promoteToActive()` 的守卫一致。`active` 记忆要改作用域应另走 D2 的入口（且晋升入口对 active 无意义）。

## Risks / Trade-offs

- **作用域迁移使旧审计链断裂** → 缓解：审计事件记录 `fromScope` / `toScope`，且迁移只发生在「晋升」这一原子动作内，事后可完整解释。
- **作用域变更漏掉 outbox 重建会导致错空间同步** → 缓解：实现时把「删除旧 pending 任务 + 新作用域重新入队」放进同一事务；测试断言事务后旧任务不存在、新任务存在且 `scope_id` 正确。
- **CLI 即批准可能被误当作「无需校验」** → 缓解：晋升仍走 `store.assertWritable()`、秘密扫描、状态守卫；CLI 只是**签发通道**，不是**跳过校验**的通行证。
- **批量批准的需求迟早出现** → 本变更明确不做。届时用 `onboarding_plan` 那套（计划 + 哈希 + 一次性审批）承载，而不是给本命令加 `--all`。

## Migration Plan

- 无数据库迁移。
- 新增 CLI 分支与 app-service 方法，向后兼容：现有命令行为不变。

## Open Questions

- 是否需要给控制台（浏览器）也开一条晋升入口？本变更只做 CLI。控制台已有 `GET /api/memories`，加写入口会扩大攻击面（浏览器侧的「用户批准」更难证明是本人）。**建议延后**。
- 候选是否需要一个「批量审阅视图」（列出所有 candidate 供逐条判断）？CLI 可以用 `cairn search --status candidate` 组合代替，暂不单列命令。

## 变更清单（实现时对照）

| 位置 | 改动 |
|---|---|
| `src/interfaces/cli/main.ts` | 新增 `promote` / `reject` 分支；`promote` 支持 `--scope-preset` |
| `src/interfaces/app-service.ts` | 新增 `promoteCandidate(id, opts)` / `rejectCandidate(id, reason)` |
| `src/store/memories.ts` | 新增 `migrateScope(id, newScopeId)`：更新 `memory.scope_id` 并复查外键 |
| `src/store/outbox.ts` | 复用既有 enqueue；晋升时按作用域重建 pending 任务 |
| `src/store/audit.ts` | 复用 `record()`，新增 `memory_promoted` / `memory_rejected` / `memory_scope_changed` 三个 action |
| `tests/` | CLI 退出码与 JSON 输出、作用域迁移的外键完整性、outbox 重建、幂等与拒绝路径 |
