# Design: 上行入队完备性与冷启动对账

## 上下文

`cloud-sync` 的协议层（chunk / manifest / 加密 / 冲突）在 `add-real-cloud-sync` 里已经定型并验证过。本变更只动**入队侧**：决定"谁该进 outbox"，不改"outbox 里的东西怎么上云"。

现状的三层结构，以及入队点为什么只能在最外层：

```text
接口层   CLI / MCP / 控制台 / 自动整理
           ↓
编排层   AppService（addMemory / reviseMemory / forgetMemory / promoteCandidate /
         rejectCandidate / applyDecision / applyPlan）      ← 唯一该入队的地方
           ↓
治理层   governance/apply.ts（applyPlan 的 add/keep_both/merge 分支）  ← 现在漏在这
           ↓
存储层   store/memories.ts（add / revise / forget / promoteToActive）
           ↑
拉取侧   sync/apply.ts 也直接调存储层                     ← 绝不能在这里入队
```

把入队下沉到存储层是最省事的做法（一处改动覆盖所有入口），但它会让 `sync pull` 在应用远端事件时给本地制造上行任务：拉来的东西再推回去，形成**回环推流**，且会在两台设备之间制造无意义的 chunk 增长。所以入队必须留在编排层与治理层，拉取侧保持零入队——这条不是风格偏好，是本设计的**结构性约束**。

## 决策

### D1：入队判定单点化，不新增第二个判断函数

现有单点是 `src/core/scope.ts` 的 `scopeAllowsUpstream(scope)`，它读 `syncPolicy === 'encrypted'`；`outbox.enqueue()` 内部另有一道物理排除（`sync_policy` + `device_id === 'all'`），并写 `scope_exclusion` 审计。

**决策：两处都保留，且不新增第三个判断。**

- `scopeAllowsUpstream` 是**调用方的准入判断**，决定"要不要调 enqueue"；
- `outbox.enqueue` 内的排除是**防线**，负责执行与审计，即使调用方判断失误也不会真的把设备限定内容放上去。

理由：合并成一处会让 `enqueue` 变成"要么入队要么静默什么都不做"，调用方就失去了"我知道这个不该上行"的语义；反过来只在调用方判断，则任何新入口漏写就是安全事故。两层各司其职，且**语义不同**（决策 vs 执行），合并反而降低可观测性。

### D2：治理层入队放在 `applyPlan` 的逐 op 分支内，而不是打包后统一扫

备选方案：`applyPlan` 结束后统一遍历 `report.results` 补入队。

不采用的理由：`report.results` 只含成功落库的 op，看起来够用，但它**丢失了 op 类型**——无法区分"这是新增"与"这是合并到既有记忆"。而合并必须**先读回目标记忆的实际作用域**（`merge` 的目标可能和计划的作用域不同，见 `memory-governance`「晋升时可修正作用域」），逐 op 分支内才拿得到目标记忆的 `scopeId`。

替代方案的第二个问题：统一扫描会把"写入成功但入队失败"的情形变成整批失败，而 `enqueue` 因作用域被排除是**正常结果**，不该中断计划。放在分支内，排除就只是分支里的一次正常返回。

### D3：`backfill` 的 SQL 判定与幂等键

候选条件（一条 SQL）：

```sql
SELECT m.id, m.scope_id
FROM memory m
JOIN scope s ON s.id = m.scope_id
WHERE m.status = 'active'
  AND s.sync_policy = 'encrypted'
  AND s.device_id = 'all'
  AND NOT EXISTS (
    SELECT 1 FROM outbox_job j
    WHERE j.job_type = 'sync_upstream' AND j.entity_id = m.id
  )
ORDER BY m.created_at, m.id
```

要点：

- **不限制 job 状态**。只要历史上存在过任何一条 `sync_upstream`（哪怕 done / dead），就认为"这条记忆的上行已经有人管过"。若只看 `pending`，会把已成功推送但任务被 markDone 的记忆算成缺口，每次 backfill 都报同一批。
- **幂等键沿用写入路径的格式** `memory:<id>`，与 `addMemory` 一致；跨修订复用同一键会与 `reviseMemory` 的 `memory:<id>:rev:<revId>` 并存，两者都不冲突。
- **`payload`** 取 `{ op: 'memory_upsert', memoryId: <id> }`，与 `addMemory` 一致，`push.buildEvents` 只读 `entityId` 和 `payload.op`，不依赖其它字段。

为什么不直接复用"把 outbox 清空后重推全量"：那会把已推过的修订再推一次（`push` 虽然幂等跳过，但会生成新的 chunk 与 manifest 代次），且对端 `pull` 时要再走一遍 apply。按记忆维度补，粒度正好。

### D4：`doctor` 的报告位

`doctor` 的返回结构已经稳定（`cloud-sync` 与 `agent-interfaces` 都依赖它）。新增字段放在 `counts` 下，名为 `upstreamGap`，与既有 `outboxByStatus` / `openConflicts` 同级。

**不放进 `problems`**：缺口不是"库坏了"，而是"有东西还没上去"，属于可自愈状态，进 `problems` 会让 `doctor` 以非零退出码结束，破坏已有的"健康即 0"语义。改为：非零时在 `notes` 里给一行可执行提示（指向 `cairn sync backfill`）。

**代价要说清**：一个只读 `doctor` 因此多了一次跨 `memory` × `outbox_job` 的 `NOT EXISTS` 查询。当前库 53 条记忆、25 条 outbox，实测可忽略；若将来记忆上到十万级，应把它降级为 `cairn sync status` 的按需查询。这条写进 tasks 的验收项里，避免"以后再说"。

### D5：不引入自动同步

用户已明确触发方式为「登录时 + 手动」。本变更**不加**任何 hook、定时器或登录触发脚本——那属于部署层决策（见评估文档 P1），不应混进代码变更。本变更只保证"该入队的都入了"，至于什么时候 push，是运维配置。

## 威胁模型

| 威胁 | 后果 | 缓解 |
|---|---|---|
| 新写入入口忘记入队 | 该入口写入的记忆永不上云 | `doctor` 的 `upstreamGap` 计数 + `backfill` 对账，两者任一发现即暴露 |
| `backfill` 被误当"上传" | 用户以为执行了就同步了 | 命令只写本地队列，输出明确报告"未与云端交互"；帮助文本标注 |
| 回环推流 | chunk 无限增长、两设备互推 | 拉取侧零入队，用测试断言 `sync pull` 前后 outbox 不变 |
| 设备限定内容被误判可上行 | 隐私泄漏到云端 | `outbox.enqueue` 内的物理排除为最后防线，`backfill` 的 SQL 也带同样条件；两侧都测 |
| `backfill` 在超大库上锁库 | 阻塞其它写入 | 单事务、分批上限（默认 500 条/次，`--limit` 可调），`BEGIN IMMEDIATE` + 5s busy_timeout 已在 `db.ts` 就位 |

## 迁移与回滚

- 无 schema 迁移。`outbox_job` 与 `idempotency_key` 唯一约束已存在。
- 回滚代码即可；`--apply` 写入的行是 `pending` 状态，未上传时对任何已有数据无影响，可用 `DELETE FROM outbox_job WHERE id IN (<报告给出的 id>)` 精确清除（命令输出机器可读的 id 列表，便于脚本反向操作）。

## 可观测性

| 观察点 | 位置 | 何时有意义 |
|---|---|---|
| `counts.upstreamGap` | `cairn doctor` | 应恒为 0；非零即执行 backfill |
| `cairn sync backfill` 报告 | 命令输出 | 首次启用、版本升级后、怀疑漏数时 |
| `scope_exclusion` 审计 | `cairn audit list --category scope_exclusion` | 确认被排除的内容是按作用域正常排除，而不是漏判 |
| `sync_upstream` 的 `pending` 积压 | `cairn status` | 积压长期不降说明没有消费者（部署问题，不是本变更的问题） |

## 未决与延后

- **换后端游标不重置**（`pullCursorKey` 不含 provider）：独立缺陷，另立变更。
- **`project-global` 空间接入同步**：`push` 侧硬编码 `PERSONAL_SPACE_KEY`，属 `cloud-sync` 的既有边界，本变更不扩大。
- **`doctor` 缺口查询的规模上限**：如上述，十万级记忆时应改为按需查询。
