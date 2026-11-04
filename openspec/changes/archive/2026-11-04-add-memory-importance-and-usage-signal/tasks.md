# Tasks: 记忆重要度与使用信号

## 1. 数据层（迁移 005）

- [x] 1.1 `src/store/schema.ts`：新增 `MIGRATION_005_MEMORY_IMPORTANCE_USAGE`，用 `ALTER TABLE memory ADD COLUMN importance INTEGER;` + `ADD COLUMN usage_count INTEGER NOT NULL DEFAULT 0;`，**不重建表**；验证：新库与旧库升级后均能 `PRAGMA table_info(memory)` 看到两列
- [x] 1.2 新增索引 `memory_importance_used ON memory(importance DESC, last_used_at DESC)`；验证：`sqlite_master` 中可见该索引
- [x] 1.3 `src/store/migrate.ts` 注册 005；验证：`runMigrations` 的 `applied` 含 5，重复跑返回空（幂等）
- [x] 1.4 迁移后 `foreign_key_check` 为空、`integrity_check` ok、**全部子表行数与迁移前一致**（`memory_revision` / `evidence` / `relation` / `conflict` 逐表比对）；验证：tests/store/migrate-importance.test.ts
- [x] 1.5 负向：迁移中途注入失败 SQL，事务回滚后 `user_version` 仍为 4，两列不存在

## 2. 写入层（B 信号）

- [x] 2.1 `src/core/types.ts`：`MemoryRecord` 增加 `importance: number | null` 与 `usageCount: number`；`mapMemory` 映射新列（NULL 保持 NULL，读取侧按 3 处理）
- [x] 2.2 `src/interfaces/app-service.ts` `addMemory`：接受 `importance?: number`，校验 `1..5` 整数，越界抛 `E_VALIDATION`（不静默截断）；验证：0 / 6 / 3.5 / "3" 全部被拒
- [x] 2.3 推断来源钳制：`authority === 'agent_inferred'` 时 `importance = Math.min(importance ?? 3, 3)`；验证：传 5 落库为 3，返回结果报告 3
- [x] 2.4 `src/store/memories.ts` `add`：把 `importance` 写入 INSERT；`usage_count` 默认 0
- [x] 2.5 `memory_add` / `memory_propose` 的 MCP schema：增加可选 `importance`（integer, 1–5），描述里写明「值不值占用注入预算，与可信度无关」；验证：工具列表含该参数
- [x] 2.6 返回体增加 `importance`（实际生效值）；验证：MCP 返回含该字段

## 3. 使用层（C 信号）

- [x] 3.1 `src/store/memories.ts` `markUsed`：改为 `UPDATE memory SET last_used_at = ?, usage_count = usage_count + ? WHERE id = ?`，参数 `increment: 0 | 1`；验证：increment=0 只改时间，increment=1 两者都改
- [x] 3.2 `src/interfaces/app-service.ts` `search`：拿到 `results` 后**只为实际返回的 id** 调 `markUsed(id, 1)`；验证：limit=3 时只写 3 条
- [x] 3.3 只读身份（`store` 以 readOnly 打开 / caller 标记只读）**跳过写痕迹**；验证：只读路径不产生任何 UPDATE
- [x] 3.4 写痕迹失败**不得影响检索结果**：try/catch 包住回写，失败只 warn；验证：注入写失败后仍返回完整命中
- [x] 3.5 插件自动注入路径：`last_used_at` 由 MCP 侧统一处理（注入走 `memory_search` 时会带 increment=1，需要**区分调用方**）；**实现方式待定** —— 见下方「未决」；验证：注入一次后 `usage_count` 不变
- [x] 3.6 `expires_at` / 无命中等边界：0 命中时不写任何痕迹

## 4. 排序层（投影）

- [x] 4.1 `src/projection/brief.ts` 新增纯函数 `scoreCandidate(importance, lastUsedAt, createdAt, now, opts)`：返回 `{ score, decay, flooredBy }`；验证：单测覆盖 9 个时间桶边界
- [x] 4.2 地板规则实现：`importance >= 4` → decay=1；`recency >= 0.85 * max` → decay=1；最终 `score >= 0.5 * baseline`；验证：三条各一个测试
- [x] 4.3 `selectProjectionCandidates` 改为取回后在 JS 排序：`lesson 优先 → score DESC → updated_at DESC → id ASC`；验证：排序稳定（同分同序）
- [x] 4.4 相关性信号的来源：`selectProjectionCandidates` 目前不接收查询文本；**本轮相关度只用「是否被检索命中」近似**，若拿不到则跳过地板②；验证：无相关性输入时不影响其他地板
- [x] 4.5 字节可复现：同一候选集两次渲染字节相同（现有 `byte reproducibility` 测试必须继续通过）

## 5. 归档层

- [x] 5.1 `src/governance/archive.ts`（或既有合适位置）新增 `archiveStale(store, opts)`：`importance = 1` 且 `COALESCE(last_used_at, created_at) < now - 180d` → `status='archived'`；验证：边界 179/180/181 天
- [x] 5.2 归档写审计事件，detail 含 `reason: 'stale_low_importance'`、`lastUsedAt`、`createdAt`、`days`；验证：`audit_event` 可查
- [x] 5.3 触发时机：**只在显式命令下执行**（`cairn doctor --archive-stale` 或独立命令），**不挂在写入/检索路径上**；验证：普通读写不触发归档
- [x] 5.4 归档后可用既有 `restore`/状态更新恢复；验证：archived → active 往返后内容与 revision 完整
- [x] 5.5 幂等：重复执行不重复记审计、不改动已 archived 的

## 6. 测试

- [x] 6.1 `tests/store/migrate-importance.test.ts`：迁移前后子表行数一致、外键空、幂等、负向回滚
- [x] 6.2 `tests/store/memories.test.ts`：`markUsed` 两种增量行为
- [x] 6.3 `tests/interfaces/app-service.test.ts`：importance 边界（0/6/3.5/字符串）、推断钳制、检索回写条数、只读跳过
- [x] 6.4 `tests/projection/brief.test.ts`：9 个时间桶、三条地板、排序稳定性、字节可复现
- [x] 6.5 `tests/governance/archive.test.ts`：180 天边界、审计、幂等
- [x] 6.6 全量 `npm test` 通过，计数较基线净增，0 失败

## 7. 文档与验收

- [x] 7.1 `docs/cairn-usage.md`：写明 `importance` 与 `confidence` 的区别、1–5 各档判据、`usage_count` 的语义（自动注入不计）
- [x] 7.2 `docs/cairn-usage.md`：写明投影排序规则与三条地板、归档阈值 180 天
- [x] 7.3 `docs/cairn-security.md`：一句话说明 `usage_count` 只在本地累积、不随同步上行（若 outbox payload 不含它）
- [x] 7.4 在库副本上做一次端到端验证：造 10 条不同 importance/使用时间的记忆 → 跑投影 → 断言排序符合预期

## 8. DSH 插件侧调整（`plugin/dsh/`）

> 结论：**需要改，而且是必须改**——不改的话本变更的两个核心信号在真实使用中都不成立。

### 8.1 现状（实测，2026-11-03）

插件的召回入口在 `plugin/dsh/src/index.ts`，有**两条执行路径**，都必须带新参数：

| 路径 | 位置 | 触发条件 |
|---|---|---|
| 主路径 | `def.execute(args, exec)` | `tools.get(RECALL_TOOL, scope)` 拿到的定义有 `execute`（native / ptc 模式下都成立） |
| 兜底 | `tools.execute({ callId, name, arguments, scope, signal })` | 定义上没有 `execute` |

**两条路径的 `args` 是同一个对象**（`{ query, limit: topK }`），所以加参数只需改一处构造点。

### 8.2 必须改的三处

- [x] 8.2.1 **召回调用加 `increment_usage: false`**
  位置：`searchOnce()` 的 `args` 构造（`index.ts:299` 附近的类型签名 + `index.ts:348` 的调用点 `{ query, limit: topK }`）。
  改为 `{ query, limit: topK, increment_usage: false }`，并同步改 `searchOnce` 的 `args` 类型声明。
  **验证**：真机跑一轮召回后查库，`usage_count` 不变、`last_used_at` 已更新。

- [x] 8.2.2 **把「哪些命中真的进了注入文本」回传给 MCP**
  现状：插件在 `createInjector.runOnce` 里算出 `injectedIds`（`index.ts:118` 附近），但**只用于插件自己的 `dedupe` 与面板统计，从未离开进程**。
  本变更要求：`last_used_at` 只应更新**真正被注入的那几条**，而 MCP 侧只知道「检索返回了什么」，不知道「插件最终选了哪几条」。
  两条实现路线：
  - **(i) 检索即写**（简单）：MCP 在检索返回时对**返回集**写 `last_used_at`。代价：检索返回 10 条、插件只注入 3 条，那 7 条也被记了「被看到」。
  - **(ii) 回传确认**（精确）：插件注入后调一个新的轻量接口（如 `memory_touch { ids, increment_usage: false }`）补记真实注入集。代价：多一个 MCP 工具 + 一轮调用。
  **倾向 (i)**：`last_used_at` 本来就是弱信号（只影响衰减分桶，桶宽按天），被多看 7 条不会实质改变排序；而 (ii) 的往返成本与失败处理不值得。**需用户确认。**

- [x] 8.2.3 **面板 `usage` 端点补两个字段**
  位置：`plugin/dsh/src/usage-state.ts` 的 `buildUsage` + `plugin/dsh/src/index.ts` 的 `/plugins/cairn-dsh-memory/usage` payload。
  增加：`importance` 分布（或当前注入集的 `importance` 值）、`usageCount` 汇总。**只出摘要，不出正文**（与既有「正文永不外传」纪律一致）。
  **验证**：`curl /plugins/cairn-dsh-memory/usage` 返回含新字段且不含正文。

### 8.3 明确**不改**的

- [x] 8.3.1 **不改 `deriveQueries`**。现状每条消息最多生成 6 条查询（2 个中文二元组 + 2 个 ASCII 词 + 分句 + 整句前缀），每轮最多 6 次检索调用。本变更不改查询生成逻辑。
- [x] 8.3.2 **不改去重与预算逻辑**（`createDedupeState`、`renderInjection` 的 `budgetBytes`）。
- [x] 8.3.3 **不改注入消息形状**（`makeInjectionMessage` 已带 `id`，2026-11-02 修复过的那个坑不要回退）。

### 8.4 一个必须记录的副作用

**`deriveQueries` 每轮最多发 6 次检索 → 若走 (i) 方案，同一批记忆会被重复写 `last_used_at` 6 次。**
`last_used_at` 是幂等的（写同一个时间戳），所以**无副作用**；但若将来把 `usage_count` 也放进检索路径，就会瞬间放大 6 倍。**这条写在这里，防止后人误改。**

### 8.5 插件侧测试

- [x] 8.5.1 单测：`searchOnce` 的 args 含 `increment_usage: false`（两种执行路径各一条）
- [x] 8.5.2 单测：注入一轮后，插件侧不因新参数而改变去重/预算行为（回归）
- [x] 8.5.3 **真机验证（必须做，不能只靠单测）**：改 `src` → `npx tsc -p tsconfig.json` 重建 `dist` → 触发 HMR 重载或重启 → 跑一轮 → 查库确认 `usage_count` 全 0、`last_used_at` 有值。
  依据 AGENTS.md：**「改 `src/` 不重建 `dist` 等于没改」**，且 2026-11-02 踩过「重建了但没重载」的坑。

## 9. 归档前

- [x] 9.1 用户审阅四个制品
- [x] 9.2 归档时把 delta 合并进 `memory-store` / `scoped-retrieval` / `agent-interfaces` 主规格
- [x] 9.3 **真实库迁移需用户明确指令后再执行**（003 之后一直遵守的纪律）

---

## 未决（实现前必须先定）

**3.5 的「如何区分注入与主动检索」** 有两条路：

- **(a) 参数法**：`memory_search` 增加 `increment_usage?: boolean`，插件自动调用时传 `false`，显式调用缺省 `true`。简单，但把纪律交给了调用方。
- **(b) 来源法**：MCP server 从 `caller.agentId` / 请求上下文判断是否为插件注入。更严，但插件与用户可能用同一个 agentId，**未必可区分**。

倾向 **(a)**，因为简单且可测；风险是插件写错就该记的没记。**需用户拍板。**
