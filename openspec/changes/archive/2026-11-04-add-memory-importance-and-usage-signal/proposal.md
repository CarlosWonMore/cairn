# Proposal: 记忆重要度与使用信号（治投影名额之争）

## Why

投影预算是 2 KB（DSH / Claude Code / Cursor / Copilot 各 2048 字节，扣掉路由文案与标记后留给正文约 1422 字节）。2026-11-03 实测真实库：**42 条 active，平均 818 字符，按体积从小到大只能装 6 条**。

也就是说，投影通道现在的取舍规则是「**谁短谁上**」，不是「谁重要谁上」：

```
memory 表排序（现状）
ORDER BY CASE WHEN kind='lesson' THEN 0 ELSE 1 END, confidence DESC, updated_at DESC, id ASC
```

`confidence` 是**可信度**（用户明确 1.0 / 导入 0.9 / 推断 0.5），不是**重要度**。实测分布：1.0 × 19 条、0.9 × 23 条、0.5 × 3 条——**23 条并列，排不出序**，最终退化成按 `updated_at` 与 `id` 排，实际效果接近随机。

与此同时，两个本可用于排序的信号**完全空转**：

| 字段 | 现状 |
|---|---|
| `last_used_at` | 非空 **0 / 45**。`markUsed()` 在 `src/store/memories.ts:425` 定义，**全仓零调用方** |
| `expires_at` | 非空 **0 / 45**，无人设置 TTL |
| `usage_count` | **列不存在** |

后果有三层：

1. **投影失真**：真实重要的长记忆（实测最长 3788 字符）永远进不了 2 KB 预算，反而被短碎片挤占。
2. **无法收敛**：没有使用信号，就没有任何机制能区分「这条被需要」和「这条是孤儿」。
3. **膨胀不可治**：库只增不减，`archived` / `tombstoned` 状态有语义但无入口，42 条 active 里没有一条被归档过。

本变更建立**最小可用的重要度与使用信号闭环**：写入时给出重要度（B 信号）、使用时记录行为（C 信号）、投影按两者排序，并给长期无用的记忆一个归档归宿。

## What Changes

### 数据层（迁移 005，仅加列）

- `memory.importance INTEGER`（1–5，`NULL` 视为 3）：**与 `confidence` 正交**——`confidence` 管「可不可信」，`importance` 管「重不重要」。
- `memory.usage_count INTEGER NOT NULL DEFAULT 0`：**被显式请求**的次数。
- 新索引 `memory_importance_used`：`(importance DESC, last_used_at DESC)`，支撑投影排序。
- **采用 `ALTER TABLE ADD COLUMN`，不重建表。** 理由：`importance` / `usage_count` 是 memory 层级属性，`memory_revision` 不存 `confidence` 也不该存 `importance`（修订表达内容，重要度是顶层判断）；004 已因 `kind` 的 CHECK 约束重建过一次整表，没有理由为两个可空列再付一次重建代价（重建需 `foreign_keys=OFF` + `legacy_alter_table=ON`，是丢数据风险最高的操作）。

### 写入层（B 信号）

- MCP `memory_add` 与 `memory_propose` 新增可选 `importance`（1–5），缺省 3。
- **`agent_inferred` 来源的候选，`importance` 上限为 3**——模型不得给自主推断的内容打 4/5 星，防止 AI 自我拔高挤占预算。
- `importance` 不写入 `memory_revision`：修订历史只记录内容与作用域。

### 使用层（C 信号）

- `memory_search` 返回命中时，对**实际返回的那几条**写 `last_used_at` 并 `usage_count += 1`。
- **插件自动注入不计 `usage_count`，只写 `last_used_at`。** 实测依据：插件每轮都注入，2026-11-02 的会话里 202 次注入去重后只有 6 种内容（97% 重复）。若自动注入计入频次，少数条目会因注入频率而霸榜，形成正反馈死锁。
- 两个信号分开的语义：`last_used_at` 回答「最近被看到过吗」，`usage_count` 回答「被主动要过几次」。

### 排序层（投影）

```
最终分 = 基线分 × 衰减系数，且不低于地板
基线分   = importance
衰减系数 = 按 (now - last_used_at) 的天数分桶（1.0 → 0.08，照抄艾宾浩斯分桶）
地板     = ① importance ≥ 4 豁免衰减
           ② 本轮相关度 ≥ 0.85 × 最高分 豁免衰减
           ③ 绝对地板 0.5（任何记忆至少保留 50% 分）
排序     = lesson 优先 → 最终分 → updated_at DESC → id ASC
```

**地板是必需的，不是可选的**：纯衰减排序会让老记忆永久沉底，一年后库里只剩几条「明星记忆」被反复注入，其余成为不可见的僵尸——那反而加剧了库膨胀（条目还在，可见性归零）。

### 归档层（给无用记忆一个归宿）

- `importance = 1` 且 `last_used_at`（或从未使用时的 `created_at`）超过 180 天 → 自动转 `archived`。
- **只归档，不删除。** `archived` 在现有语义里就是「不活跃但仍保留」，可恢复。
- 归档必须留审计事件（含归档理由与判据值），否则「这条为什么不见了」无从追查。

## 明确不做

- **不调用任何 LLM**：不做内容蒸馏、不做语义合并、不重写正文。本条为硬约束（项目边界：MVP 不引入本地模型与推理运行时）。
- **不引入向量 / 嵌入**：检索仍走 FTS5 trigram + 有界 LIKE。
- **不做内容层面的有损压缩**：本变更只调整**排序与归档**，一个字都不改用户记忆的正文。
- **不改 `confidence` 的含义**：它是可信度，不是重要度。
- **不新建表**：`importance` 与 `usage_count` 都是 memory 顶层列。

## Impact

- Affected specs: `memory-store`（新增列与迁移要求）、`memory-governance`（重要度判定边界与归档）、`scoped-retrieval`（检索写使用信号）、`agent-interfaces`（MCP 参数）
- Affected code: `src/store/schema.ts`（005 迁移）、`src/store/memories.ts`（`markUsed` 补 `usage_count`）、`src/interfaces/mcp/server.ts`（参数 + 命中回写）、`src/retrieval/search.ts`（返回时带出 id 供上层回写）、`src/projection/brief.ts`（排序）
- Affected tests: `tests/store`（迁移幂等与外键）、`tests/retrieval`（回写时机）、`tests/projection`（排序与地板）、`tests/interfaces/mcp`（参数边界）
- 面向用户：投影从「谁短谁上」变成「谁重要谁上」；长期无用的记忆会被归档而不是永远占位

## DSH 插件侧：需要改，且不改则本变更失效

Cairn 的 DSH 插件（`plugin/dsh/`）是记忆注入的实际执行者。**如果插件不跟着改，本变更的两个核心信号在真实使用中都不成立。**

### 为什么必须改

| 问题 | 现状（实测 2026-11-03） | 不改的后果 |
|---|---|---|
| 自动注入会被记成「被主动请求」 | 插件召回走 `mcp__cairn__memory_search`，与用户显式检索**走同一个工具、同一个参数形状** | `usage_count` 被注入频率污染。2026-11-02 实测：一个会话 202 次注入、去重后只有 6 种内容（**97% 重复**）。少数条目会因「恰好被注入」而分数飙升，形成正反馈死锁 |
| `last_used_at` 的写入范围过大 | MCP 只知道检索**返回**了什么，不知道插件最终**注入了**哪几条（`injectedIds` 从未离开插件进程） | 检索返回 10 条、实际注入 3 条，另外 7 条也被记成「被看到」 |

### 要改什么（三处，均在 `plugin/dsh/src/`）

1. **召回调用追加 `increment_usage: false`**
   两条执行路径（`def.execute` 主路径 / `tools.execute` 兜底）共用同一个 `args` 对象，只需改一处构造点：`{ query, limit: topK }` → `{ query, limit: topK, increment_usage: false }`。

2. **明确 `last_used_at` 的写入范围**（二选一，需拍板）
   - **(i) 检索即写**：MCP 对返回集写 `last_used_at`。简单，但会多记几条。
   - **(ii) 回传确认**：插件注入后调新接口补记真实注入集。精确，但多一次往返。
   倾向 **(i)**：`last_used_at` 是弱信号（只影响按天的衰减分桶），多记几条不改变排序结论。

3. **面板 `usage` 端点补摘要字段**
   增加 `importance` 分布与 `usageCount` 汇总，**只出摘要不出正文**（沿用既有纪律）。

### 明确不改的

- `deriveQueries`（每轮最多 6 条查询）不动
- 去重状态与预算逻辑（`createDedupeState` / `budgetBytes`）不动
- 注入消息形状（`makeInjectionMessage` 已带 `id`，2026-11-02 修过的坑不回退）

### 一条必须记录的副作用

`deriveQueries` 每轮最多发 **6 次**检索。走方案 (i) 时同一批记忆会被重复写 `last_used_at` 6 次——**幂等，无副作用**。但若将来把 `usage_count` 也塞进检索路径，会被**瞬间放大 6 倍**。此条写进 tasks，防后人误改。

### 验收要求

插件改动**必须走完**：`npx tsc -p tsconfig.json` 重建 `dist` → HMR 重载或重启宿主 → **真机跑一轮 → 查库确认 `usage_count` 全 0、`last_used_at` 有值**。

依据 AGENTS.md 两条已踩过的坑：改 `src/` 不重建 `dist` 等于没改；重建了不重载也不生效。**单测通过不算验收。**
