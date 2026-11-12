# Proposal: 记忆作用域对用户与插件可见

## Why

两个已核实的实际问题：

**① 用户在 DSH 面板看不到每条记忆属于哪个作用域。** 一条注入的记忆是 personal-global、device-local 还是 project-global，面板上没有任何标识——面板只显示 `[kind] + 摘要`。作用域是记忆最重要的边界属性（决定它跨不跨设备、进不进云端），用户要求可见。

**② 插件的「最后一道闸」当前是空转的。** `plugin/dsh/src/recall.ts:59-65` 的 `filterInjectable` 检查 `h.sensitivity !== 'normal'` 与 `h.syncPolicy === 'local_only'`，但 MCP `memory_search` 返回的条目**根本不含这两个字段**（`src/interfaces/mcp/server.ts:714-744` 的 `summarize()` 没有输出它们）——检查恒通过，敏感/`local_only` 过滤完全依赖服务端 `scopeAllowsRead` 单层。防御纵深等于没有第二层。

数据其实已经流到一半：MCP 条目带 `scopeId`（server.ts:733），插件 `RecallHit.scopeId` 也能接到（recall.ts:15），断点在两处——`scopeId` 是 uuidv7 而非人读 preset 名（scopes.ts:121，preset 名只存在 scope 表里）；`buildUsage`（index.ts:128）与面板 `InjectedMemory`（usage-state.ts:12-17）没有把任何作用域字段透传到 UI。

规格 `scoped-retrieval` 的「检索结果来源可解释」本就要求检索结果提供"作用域"——目前只有详情调用（`memory_get`）能给全，列表结果给不出。

## What Changes

- **MCP `memory_search` / `memory_context` 的条目**增加三个字段：`scope_preset`（人读作用域名，JOIN scope 表取得）、`sensitivity`（memory 行自身敏感度）、`sync_policy`（scope 行同步策略）。由 `summarize()` 统一扩展，检索 SQL 补一次 scope JOIN。
- **DSH 插件注入闸真正生效**：`filterInjectable` 基于返回的真实字段判定（敏感度非 normal 或同步策略 local_only → 不注入）；返回缺失这些字段时按 **fail-closed** 处理（宁可漏注不可错注）。
- **面板展示作用域徽章**：左栏「本会话注入」条目与右栏活动记录的注入条目展示 preset 名徽章；MUST NOT 展示 UUID 形式的作用域标识；数据链路 `buildUsage → InjectedMemory → ActivityEntry.items → sessionInjected` 全程透传。
- 与 `add-two-stage-memory-recall` 同改 `summarize()`，建议**先实施本变更再实施两级检索**，一次构建验证两批插件改动。

### 明确不做的事（红线）

- **不改任何读取判定语义**：`scopeAllowsRead`（core/scope.ts:231-245）一行不动；本变更只让既有判定结果变得可见，不放宽任何边界。
- **不在面板展示 `scopeId` UUID**：徽章只显示 preset 名。
- **不解决项目作用域不可见问题**：`memory_search` 无 project 参数导致 project-global/project-device 记忆进不了检索——那是 `add-project-scope-recall` 的范围，本变更不碰。
- **不做作用域迁移/编辑**：rescope 已有独立能力（memory_promote / cairn rescope），面板徽章纯展示。

## Impact

- Affected specs: `scoped-retrieval`（MODIFIED「检索结果来源可解释」）、`agent-interfaces`（MODIFIED「宿主插件的实时召回以 MCP 为内核」「记忆调用对用户可见」）
- Affected code: `src/interfaces/mcp/server.ts`（summarize 扩展）、`src/retrieval/search.ts`（scope JOIN）、`src/interfaces/app-service.ts`（检索结果装配）、`plugin/dsh/src/recall.ts`（filterInjectable）、`plugin/dsh/src/index.ts`（buildUsage/rememberInjected/touchMemory）、`plugin/dsh/src/usage-state.ts`（InjectedMemory）、`plugin/dsh/src/client.js`（徽章渲染）
- 不涉及数据库迁移（scope 表已存在，无需 schema 变更）
- 测试影响：MCP server 测试断言新字段；插件 recall/usage 单测；`npm run test:ui` 面板断言补徽章；`npm run mcp:smoke` 应保持通过

## 风险与回滚

| 风险 | 处置 |
|---|---|
| fail-closed 在新旧版本混搭时静默杀掉全部注入 | 插件与 MCP 同仓库同构建分发（dist 一起 build）；任务里加「缺字段 → 不注入且面板显示过滤」的显式测试，静默不可能——面板计数会如实上升 |
| 面板徽章与「面板不泄露记忆正文」冲突 | 作用域是元数据不是正文；spec 场景里显式区分（敏感记忆依旧不出现，被过滤的只计数） |
| preset 名过长挤爆注入预算 | 徽章只在面板 UI 显示，注入文本行**不加** preset（预算 1536B 不动；作用域进入注入文本属 P2 之后另行评估） |
