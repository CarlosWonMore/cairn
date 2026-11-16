# 云端记忆对账与跨设备作用域治理 · 计划 v2（2026-11-16）

> v1 的结论是「云端无需任何写入」，按你的答复**已推翻并重写**。v1 只回答了"谁覆盖了谁"，没有回答"36 条怎么让对端也拿到治理结果"。
> 本文是**待你确认的计划**，确认前我不改任何 `src/`、不动云端、不动本机库。

## 0. 你答复后的目标语义（本计划的验收标准）

| 你的要求 | 落点 |
|---|---|
| personal-global 必须跨设备：拉取、作用、展示 | 现状**已实现**（个人链跨设备 pull + 按内容哈希物化 + 投影），但**从未在 0.6.2 以上的对端用新代码实测过**，本轮补验证 |
| 剩余 36 条参考本机治理结果同步到云端 | 云端已持有这 36 条内容，但都在 `preserve/<本机>`（**只有本机拉**）。要"参照治理结果"就得让它们进入**按项目分链、各设备都拉**的通道 |
| 对端也要收到这部分的作用域治理结果，而不是都归为 personal-global | 对端必须把这 26 条落在 **project-global（hdrs6 / cairn / fsmp）**，把 10 条落成**不持有**（不是个人全局）；不能退回 personal-global |

## 1. 现状：36 条的准确拆分（已实测，非推断）

| 类别 | 条数 | 本机作用域 | 对端应有的治理结果 |
|---|---|---|---|
| A | 26 | project-global：hdrs6 **22** / cairn **3** / fsmp **1** | 应落在**同名项目作用域**（跨设备可见） |
| B | 10 | device-local（本机限定） | 应**不持有**（不复制到对端，也不变成个人全局） |
| C | 7 | personal-global | 保持跨设备持有（6 active + 1 已遗忘） |

佐证（本机库只读核对）：`sync_pushed:personal-global:` 元数据覆盖 **38** 条（27 project + 11 device-local），与个人链上我发出的 **38 条 `scope_exit`** 数量吻合——即"离开个人链的记忆恰好都发过迁出通知，没有漏的"。

## 2. 机制差距（要改的到底是什么）

现在的问题不是数据错，是**能力缺失**：项目作用域内容只有"本机保管链"这一条通路，别人永远拉不到。

| 环节 | 现状 | 差距 |
|---|---|---|
| `src/sync/route.ts` | `project-global` 命中 `isPreserveScopePreset` → 入 `sync_preserve` → 本机保管链 | 项目内容没有"跨设备链"的去处 |
| `src/sync/vault.ts` | `syncableChains()` = 个人链 + **本机**保管链 | 缺"项目链"这一维 |
| `src/sync/pull.ts` | 他人保管链前缀完全不列举 | 项目链需要被所有设备列举与拉取 |
| `src/sync/apply.ts` | `chainRole` 只有 `personal`/`preserve`；`preserve_reheld` 负责解除"不再持有"标记 | 新增 project 角色，且必须**同样解除迁出标记**（否则 26 条会被 `upsert_shadowed_by_scope_exit` 挡掉——这是最容易踩的坑） |
| `src/sync/backfill.ts` | 项目内容只查保管链缺口 | 项目链缺口要单列 |
| `src/store/schema.ts` 触发器 | 只拦"非 encrypted 或绑定设备"的 `sync_upstream` | **project-global 是 encrypted + device_id=all，触发器本来就放行** → 无需 schema 变更，这是好消息 |

## 3. 方案（推荐：按项目分链）

新增链空间 `project/<projectId>`（projectId 是跨设备稳定 UUID，已有 `add-stable-project-identity` 兜底）：

- 上行：`project-global` → `project/<projectId>`（jobType 复用 `sync_upstream`，触发器无需改）。
- 下行：`syncableChains()` 增加"本地已知的全部项目链"；新设备冷启动时用 `remote.list('project/')` 发现链前缀。
- 物化：事件带 `scope: {preset:'project-global', projectId, spaceName}`，按 projectId find-or-create（`materializeScope` 已有这段逻辑，可直接复用）。
- `project-device` 保持走本机保管链（它本来就绑定设备）。
- `device-local` 保持不变：不上他人（B 类 10 条即此）。
- 兼容：旧对端只拉个人链，不受影响；新对端之间才看得见项目链。

## 4. 任务计划

### 阶段 0｜证据固化（只读，现在就能做）
- **T0.1** 写 `docs/verify-cloud-reconcile-2026-11-16.md`：本文第 1 节的对账数据、方法、可复现命令。
- **T0.2** 探针脚本已落在 `artifacts/*.cjs`（`cloud-align*`、`coverage-final`、`scope-forensics` 等），形态保留、内容不含明文记忆。

### 阶段 1｜立项（必须以 OpenSpec 变更走，不能直接改）
- **T1.1** `/opsx:propose add-cross-device-project-sync`：提案要点 = 第 2/3 节的差距与方案；改 `cloud-sync` 主规格的「上行入队完备性」「保管链与物化过滤」两处 Requirement，新增"项目链"概念与场景。
- **T1.2** 你审阅 proposal / specs delta / design 后才进 apply（AGENTS.md 的 Step 1.5 闸门）。

### 阶段 2｜实现（每步带测试）
- **T2.1** `vault.ts`：`projectSpaceKey()` / `isProjectSpaceKey()`；`syncableChains` 收项目链列表。
- **T2.2** `route.ts`：`project-global` 优先落项目链（在 preserve 判定之前），`project-device` 仍走保管链。
- **T2.3** `push.ts` `routeJob`：`sync_upstream` + 作用域是 project-global → 链 = `project/<projectId>`。
- **T2.4** `apply.ts`：新增 `project` 角色；**照抄 `preserve_reheld` 的分支**（清除 `scope_exit:` 标记 + archived→active + 按描述符迁移），否则 26 条会被当作迟到修订挡掉。
- **T2.5** `pull.ts`：列举 `project/` 前缀发现链；空项目的新设备也能自动发现。
- **T2.6** `backfill.ts`：项目链缺口单列（与个人链、保管链并列报告）。
- **T2.7** `doctor` / `status` / 控制台：如实显示项目链的 localSeq / 游标 / 待办 / 缺口。
- **T2.8** 测试：新增 `tests/sync/project-chain.test.ts`（三段：入队路由、跨设备物化、迁出标记解除）+ 扩展 `preserve-mode.test.ts` 的"他人保管链不拉取"（确认项目链是**拉**的，保管链仍**不拉**）。基线从 869/868/0/1 起算。

### 阶段 3｜真机迁移（写云端，动手前再确认一次）
- **T3.1** 先跑 `sync backfill`（只读）确认 26 条项目记忆成为项目链候选，且**不改道**已有 48 条保管链任务。
- **T3.2** `sync backfill --apply` → `sync push`：把 26 条推到 `project/<id>` 三条链。验收：每条链 headSeq 增长、云端对象数从 15 增至 ~21、明文扫描仍 0 命中。
- **T3.3** 本机自拉取（找回路径回归）：`sync pull` 应 totalApplied 0，不能把 26 条重复建一份。
- **T3.4** 核对 `preserve/<本机>` 的旧副本：保留不动（追加语义，服务端不可删），仅在文档注明"历史副本"。

### 阶段 4｜对端收敛（你在对端执行，我不直连对端）
- **T4.1** 对端升级到含本变更的版本 → `vault import-key` 不需要（同 vault）→ `sync pull`。
- **T4.2** 预期结果：26 条以 **project-global（hdrs6/cairn/fsmp）** 落地并 active；10 条 device-local 保持"不持有"；personal-global 仍 6 条；**不允许**出现 26 条变成 personal-global 的情况（这是硬断言）。
- **T4.3** 对端 `doctor` 应报告三条项目链的游标已推进；`scope_exit` 标记对 26 条已被解除（审计可见 `scope_reheld`/新审计项）。
- **T4.4** 对端那条 pending `sync_upstream`（`01a1df7e-2273-…`，它自己的 0.6.2 升级样本）用 `worker run-once` 推掉——那是对端段新增一条 upsert，不是覆盖。

### 阶段 5｜收尾
- **T5.1** 更新 `docs/cairn-sync.md`（项目链章节）、`docs/M0-session-handoff.md`（本轮状态与下一入口）。
- **T5.2** 归档 OpenSpec 变更（需全部验收证据齐）。

## 5. 风险与边界（诚实声明）

1. **这是协议层扩展，不是数据修补。** 改的是"哪些内容跨设备"，会影响今后所有项目记忆的可见范围——请确认这确实是你想要的产品语义（我理解是的，但它的影响面远超这 36 条）。
2. **迁出标记与项目链的时序**是最危险的一处：26 条在对端同时有"不再持有"标记和"即将到来"的项目链事件，若 `apply` 忘了解除标记，表现为"推了但对端看不到"——T2.4 的测试必须先红后绿。
3. **10 条 device-local 我按"不跨设备"处理**（治理结果就是"本机限定"）。若你要它们也到对端，那它们就不该是 device-local，需要先 `rescope` 到项目作用域——这是数据决策，请明确。
4. **旧对端（≤0.6.3）看不到项目链**，它们会一直显示"不持有"。对端必须升级。
5. 云端只追加、无删除；旧 `preserve` 副本与该链的历史 `scope_exit` 永久留存（服务端只在 `/backups/` 放行 DELETE）。3 个历史探针对象 `probe300k-*.bin` 同理清不掉，需 `add-syncd-purge`（已在 handoff 待办）。
6. 我**不会**直连对端、不会在对端执行命令；阶段 4 全部由你执行并回报。

## 6. 需要你确认的四件事

1. 是否同意**按项目分链**（`project/<projectId>`）这个方案？（备选：把 26 条 `rescope` 回 personal-global——但那正是你说的"不要都归为 personal-global"，我不推荐）
2. 10 条 device-local：保持不跨设备（推荐）／你要它们也到对端（那需要先 rescope）？
3. 是否现在就走 `/opsx:propose add-cross-device-project-sync`（阶段 1），proposal 出来你审？
4. 阶段 3 的真实 push 是否也要再确认一次（我默认要）？
