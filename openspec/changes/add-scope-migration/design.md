# Design: 记忆作用域迁移

## 上下文

已验证的代码事实：

| 事实 | 位置 |
|---|---|
| `UPDATE memory SET scope_id = ?` 已存在 | `src/store/memories.ts:214`（在 `promoteToActive` 内） |
| 但入口要求 `status === 'candidate'` | `src/store/memories.ts:201` |
| outbox 重建的既有做法 | `src/interfaces/app-service.ts:429-442` |
| 同步只发 `personal-global` 链 | `src/sync/push.ts:59`；`apply.ts:139` 对其它 spaceKey 抛错 |
| 阈值校验：设备绑定必须 local_only | `src/core/scope.ts:203` |

最后一条意味着：**迁到 `device-local` / `project-device` 必然失去同步**，这是定义层的，不是实现选择。本设计必须把这个后果显式化。

## 决策

### D1：迁移 ≠ 晋升，走独立方法

**选择**：新增 `memories.migrateScope(memoryId, targetScopeId, actor)`，不复用 `promoteToActive`。

理由：`promoteToActive` 的语义是「候选 → 活动 + 改权威」，它同时改 `status`、`authority`、`scope_id` 三样。迁移只该改 `scope_id`。混用会让「迁移」意外改掉权威级别——正是 `add-candidate-promote-command` 当初反对的那种「写入副作用」。

### D2：同步队列的重建与 promoteCandidate 同构

**选择**：作废旧作用域 pending 任务 → 按新作用域判定 → 允许上行则重新入队。

直接照抄 `app-service.ts:429-442`。理由：那段代码已经过验证，且注释写明「旧作用域下的待同步任务若照发，会把记忆同步到错误的云端空间」。换个写法就可能漏掉这一条。

### D3：迁出用新事件类型 `scope_exit`，而非墓碑

**选择**：新增事件类型，对端收到后标记「不再持有」。

**为什么不复用墓碑**：墓碑语义是「用户遗忘」，会进遗忘时间线、影响 `findDuplicate` 判定（`dedup.ts:12` 明确 tombstoned 不算重复）。迁出不是遗忘——用户在那台设备上仍然拥有这条记忆。混用会让「迁移」永久污染「遗忘」的语义。

**代价**：动同步协议（新事件类型）。所以 spec 里加了一条「旧版本必须跳过并审计，不得阻断整链」——与既有 `undecryptable_chunk` 的降级姿势一致。

### D4：安全阀——拒绝优先于提示

**选择**：冲突状态拒绝、缺 projectId 拒绝；只有「失去同步」是**提示**而非拒绝。

理由：前两者是**状态不明确**，继续执行会产生难以解释的结果；后者是**用户明确的意图**（他就是要把私人项目隔离出去），拦下来反而违背目的。

高权威（`user_explicit`）需要 `--force`：因为迁移会改变可见范围，而用户亲口说的记忆通常是重要的。这是「减速带」不是「禁止」。

### D5：批注只表达意图，执行留在终端

**选择**：批注新增 `needs_rescope` 类别，WebUI 可标记；执行走 `cairn rescope --pending`。

理由：与 `pending_forget` 完全同一套哲学——WebUI 的误触成本必须低，破坏性动作要有完整上下文。两个功能共用同一种交互模式，用户不用学两套。

### D6：不删除云端既有密文

**选择**：迁出只发事件，不删对象。

理由：`RemoteStore` 接口**没有 delete 方法**（`src/jobs/remote.ts:6` 注释：「delete 只供显式 purge 使用，因此不出现在常规同步接口里」）。给迁出开这个口子会破坏追加语义与幂等性。清理旧密文应作为独立的 purge 能力，不在本变更。

## 威胁模型

| 威胁 | 后果 | 缓解 |
|---|---|---|
| 用户误迁导致记忆「消失」 | 其他设备看不到，以为丢了 | 迁移前打印可见范围变化；审计可追溯；可迁回 |
| 迁出事件被旧版本忽略 | 对端保留过期副本 | spec 要求跳过并审计；不阻断整链是更重要的属性 |
| 迁移与同步并发 | 部分任务发到错误空间 | 迁移与队列重建同事务 |
| 批量迁移把冲突记忆也改了 | 状态更乱 | D4 冲突拒绝 |

## 迁移与回滚

- 无 schema 迁移（`scope_id` 列已存在）；新事件类型不需要表结构变更。
- 回滚代码：已迁移的记忆可用同一命令迁回；已发出的 `scope_exit` 对旧代码是未知类型，按「跳过并审计」处理。

## 可观测性

| 观察点 | 位置 |
|---|---|
| 迁移事件 | 审计 `memory` 类目 `scope_migrated`（前后作用域） |
| 迁出事件 | 审计 `sync` 类目 `scope_exit_sent` / `scope_exit_applied` |
| 待迁移清单 | `cairn rescope --pending --dry-run` |
