# Design

## Context

见 proposal.md「Why」。理解本设计只需四条当前事实（均为 2026-11-16 只读实测，见 `docs/verify-cloud-reconcile-2026-11-16.md`）：

1. 同步链是**每设备每空间单写者的追加链**，链空间键只有两种：`personal-global` 与 `preserve/<deviceId>`。`syncableChains()` 返回「个人链 + 本设备保管链」，他人 `preserve/` 前缀**完全不列举**（`tests/sync/preserve-mode.test.ts` 已固化断言）。
2. 事件载荷已带作用域描述符 `SyncScopeDescriptor{preset, projectId?, spaceName?, deviceId?}`；`apply.ts` 的 `materializeScope()` 已能按描述符 find-or-create 项目与空间行（含 `project-global`）。
3. `scope_exit` 已有「不再持有」标记机制：`meta` 键 `scope_exit:<memoryId>`；标记存在时个人链的普通 upsert 被 `upsert_shadowed_by_scope_exit` 挡住；保管链 upsert 走 `preserve_reheld` 分支解除标记。**这是本变更最容易踩空的一处。**
4. `outbox_reject_local_upstream` 触发器只拒绝「非 encrypted 或 device_id<>all」的 `sync_upstream`；`project-global` 是 encrypted + device_id=all，**触发器本就放行**，因此复用 `sync_upstream` 不需要 schema 变更。

## Goals / Non-Goals

**Goals**

- 项目作用域内容按项目分链跨设备同步，落点在接收端是**项目作用域**而不是个人全局。
- 设备限定内容仍不复制，但接收端的本地留存副本能展示**终态作用域与归属设备**。
- 零 schema 变更（必要时只加 `meta` 键），旧版本设备不受影响、不卡链。
- 存量 26 条项目记忆可通过既有 `sync backfill --apply` 一次性进入项目链。

**Non-Goals**

- 不做项目订阅/成员/权限模型（proposal 已列）。
- 不引入新的密钥派生路径、不复用备份密钥域。
- 不改 syncd 服务端路由。
- 不回收 `preserve/` 下的历史对象（云端只追加）。

## Decisions

### D1：项目链键 = `project/<projectId>`，而不是「项目内容并入个人链再按描述符物化」

选分链。理由：作用域是**读取与展示**的一等概念，把项目内容塞进个人链会让「个人链上的事件物化成什么作用域」变成一条隐式规则，且迁出/迁回语义无法表达（一条记忆可以在项目 A 与项目 B 之间迁移）。备选方案（并入个人链 + 描述符决定物化）被否决，因为它要求个人链事件在接收端可能物化成非 personal-global，破坏了「个人链事件 → 物化为 personal-global」这条现有不变量（`apply.ts` 注释与规格都锚定了它）。

### D2：任务类型复用 `sync_upstream`，不新增 jobType

触发器 `outbox_reject_local_upstream` 的判定是 `sync_policy='encrypted' AND device_id='all'`，`project-global` 天然满足。新增 jobType 需要重建 `outbox_job` 表（v6 的既有成本），收益为零。**链的选择在 push 期由作用域决定**，与 `sync_upstream` 既有「按记忆当前作用域路由」的语义一致（`routeJob` 已经这么做了，只需多一个分支）。

### D3：接收端发现项目链用 `remote.list('project/')` 前缀列举，本地已知项目不作为唯一来源

理由：新设备冷启动时本地没有任何项目行，靠本地登记发现不了链（这正是 2026-11-15「pull 自发现排除自己」踩过的同类问题——**发现范围不能由本地状态单方面决定**）。代价是每次 pull 多一次前缀列举；可接受（个人链本就要列举 `personal-global/devices/`）。列举结果与本地已知项目链取并集。

### D4：解除「不再持有」标记必须按链角色分流，不能统一解除

现状：`role === 'personal' && !reentry && marked` → 挡住；`role === 'preserve' && marked` → 解除（`preserve_reheld`）。新增 `project` 角色必须走**解除**分支。若图省事把"有标记就解除"统一，个人链的迟到修订也会解除标记，破坏「迁出后不再被个人链拉回」这条已实测的安全语义（38 次 `upsert_shadowed_by_scope_exit` 就是它在工作）。

### D5：迁出通知的终态作用域是**新增可选字段**，不是新事件类型

理由：新事件类型会让旧版本设备走「未知事件类型 → 跳过并审计」，但跳过意味着旧对端**连"不再持有"都不会标**——语义退化。加可选字段则旧对端行为完全不变（它本来就忽略未知字段）。字段名 `terminalScope`，形状复用 `SyncScopeDescriptor`。

### D6：终态作用域落在 `meta`，不加 `memory` 列

理由：它是「副本的展示补充信息」，不是记忆状态机的一部分；加列意味着 schema v8、迁移、以及「目标作用域」与「本地作用域」两列并存带来的语义混淆。`meta` 键已有 `scope_exit:` 先例。键名 `terminal_scope:<memoryId>`，值为 canonical JSON。**风险**：`meta` 是既有键空间，需确认无前缀冲突（现有键：`sync_pulled`/`sync_pushed`/`sync_pull:`/`sync_seq:`/`sync_last_ok`/`scope_exit:`，无 `terminal_scope:`）。

### D7：项目链缺口的判定口径与既有两条链一致

`findUpstreamGap` 现有口径：`active` + 作用域允许上行 + **历史上从未有过任何同类型 outbox 任务**（不论状态）。项目链沿用同一口径（`sync_upstream` 且作用域是 `project-global`）。不复用「保管链」口径的原因：项目链与保管链的任务类型相同（`sync_upstream`），必须在查询里按作用域前缀区分，否则一条 project 记忆的旧 `sync_preserve` 任务会被误判为「已处理」。

**2026-11-16 修正：项目链判据改为「本链推送证据 + 无在途任务」。** 上面「沿用从未有过任何同类型 outbox 任务」在真机失效：本机真实库 27 条 `project-global` 活动记忆，旧口径候选 0 条，修正口径 27 条（个人 6 条 active、设备限定 21 条 active，两种口径都是 0）。根因：这些记忆原本是 `personal-global`，早已有 `done` 的 `sync_upstream`；其中 3 条还带着 scope 为 `project-global` 的 `sync_upstream`——它们是项目链尚不存在时的**不可路由完成**（push 记 `sync_job_unroutable` 后 markDone），从未发布到任何链。因此判据改为两条同时成立：① `meta` 中不存在 `sync_pushed:project/<projectId>:<memoryId>`；② 不存在 `sync_upstream` 且 `entity_id` 为本记忆、`status IN ('pending','running','retry')` 的任务。① 与 `findScopeExitGap` 用 `sync_pushed:personal-global:<id>` 判「曾推个人链」是同一套证据口径，不新造概念；② 保证 `--apply` 后再 dry-run 归 0。个人链与保管链判据不动（它们的上行任务就是上行证据本身，实测候选数正确）。

**同一处的第二个陷阱：幂等键。** 这些记忆的 `memory:<id>` 已被当年个人链任务永久占用（唯一约束在 done 之后仍然生效），项目链补齐若复用同键会被幂等去重挡成 `existing`，任务根本入不了队——只改判据等于白改（回归用例先红在这里）。因此项目链补齐使用本链独立键 `memory:<id>:project:<projectId>`。

## Risks / Trade-offs

- **标记解除遗漏** → 26 条推送成功但对端看不到。缓解：`tests/sync/project-chain.test.ts` 必须有"先红后绿"用例；变异对照把 `apply` 里的解除分支去掉，确认该用例变红。
- **可见范围扩大** → 项目内容进入跨设备可见。缓解：只对 `project-global` 生效；`project-device`/`device-local` 不变；规格与文档明确写出。
- **前缀列举成本** → 每次 pull 多一次 `list('project/')`。缓解：仅当 vault 存在时执行；失败降级为「本链跳过 + 审计」，不阻断个人链。
- **旧对端长期看不到项目内容** → 用户侧需升级。缓解：doctor 输出对端版本相关信息已在掌握之外，改为在 `docs/cairn-sync.md` 明确"对端需 ≥ 本版本"。
- **`meta` 键空间增长** → 每条不再持有的副本多一行。缓解：与 `scope_exit:` 同量级（本次 38 条），可接受；遗忘时一并清理。

## Migration Plan

1. 无 schema 变更；`npm run build` 后既有库直接可用。
2. 存量迁移：`cairn sync backfill`（只读）→ 确认项目链候选 26 条 → `--apply` → `cairn sync push`。
3. 本机自拉取回归：`sync pull` 应 totalApplied 0（内容已在本地，按内容哈希跳过）。
4. **回滚**：把 `route.ts` 与 `push.ts` 的项目分支去掉即可回到「项目内容仅本机保管链」；已上云的项目链对象留存但不再被列举拉取；本地库无需回滚。
5. 对端：升级后 `sync pull`；旧版本不报错、不卡链。

## Open Questions

无（四个规格级决策已定：分链键、jobType 复用、列举发现、标记解除分流）。
