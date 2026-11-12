# Proposal: 检索可按项目身份过滤（项目作用域记忆可召回）

## Why

**项目作用域的记忆目前对检索完全不可见。** 读判定 `scopeAllowsRead`（core/scope.ts:231-245）要求 `scope.projectId != null` 时查询必须携带相同 projectId；而 `memory_search` 没有任何项目参数（server.ts:403-404，ScopeQuery 只传 deviceId/agentId）——project-global / project-device 记忆**永远不会出现在检索结果里**。唯一能带 project_id 的入口是 `memory_context`（server.ts:382）。

后果分两层：

- **显式检索**：模型在 ZCode/WorkBuddy 里检索项目相关记忆，永远查不到项目作用域的内容（哪怕它就存在于本地库）。
- **DSH 自动召回**：插件只调 `memory_search`（index.ts:268），所以在 DSH 会话里，项目记忆同样不可召回。2026-11-11 已落地的「项目身份 UUID + 别名」能力（add-stable-project-identity）因此对检索链路是断头的。

这与「面板加作用域徽章」（add-memory-scope-visibility）直接相关：徽章做出来后，project-global 这一类**永远不会出现在面板上**——不是被过滤，是根本进不了召回。

## What Changes

- **`memory_search` 增加可选 `project` 参数**：接受项目 UUID、路径或 git URL。UUID 直接使用；路径/URL 经既有别名归一化**只查不建**（find-only），未命中返回明确错误（`project_unresolved`）并提示先走 `project_resolve`——检索保持读语义纯度，**登记只发生在 `project_resolve`**（显式动作，与 memory-store「从未见过的路径新建项目」的既有语义一致）。
- **DSH 插件新增可选配置 `projectPath`**（经既有插件配置机制 `apply(ctx, config)` 注入）：配置后插件启动时先调 `project_resolve`（find-or-create，登记语义在此）取得项目 UUID 并缓存，此后每次自动召回检索携带该 UUID；未配置时行为与现状**逐字节一致**（零行为变化）。项目解析失败时降级为不带项目检索并在面板状态如实提示，MUST NOT 静默继续假装带项目。
- **隐私边界不动**：`scopeAllowsRead` 判定语义一行不改——携带项目身份只是让「同项目」这一维度可被满足；device 维度、agent 维度、read allowlist 检查全部照旧。

### 明确不做的事（红线）

- **不做会话归属自动推断**：不猜「这个 DSH 会话属于哪个项目」——项目身份只来自显式配置或显式参数。
- **不做 workspace 自动探测**：不从 cwd/打开的文件推断项目；配置即声明。
- **不放宽其他维度**：携带 projectId 不使 device-local、agent-private、allowlist 受限记忆变得可读。
- **不自动登记**：检索路径的路径/URL 解析 find-only；建项目只能走 `project_resolve` / `cairn project`。

## Impact

- Affected specs: `scoped-retrieval`（MODIFIED「全通道作用域隔离」+ ADDED「检索可按项目身份过滤」）、`agent-interfaces`（ADDED「自动召回可携带显式配置的项目身份」）
- Affected code: `src/interfaces/mcp/server.ts`（memory_search 参数）、`src/interfaces/app-service.ts`（检索查询装配）、`src/store/projects.ts`（暴露 find-only 解析）、`plugin/dsh/src/index.ts`（配置 + 启动解析 + 检索携带）、`plugin/dsh/src/recall.ts`（query 携带 projectId）
- 不涉及数据库迁移（项目身份与别名表已存在，add-stable-project-identity 已落地）
- 测试影响：检索项目过滤单测；插件配置链路单测；`test:e2e` fixture 增加项目作用域样本
- 与其他三个变更无 spec 重叠（本变更唯一 MODIFIED 的「全通道作用域隔离」无人触碰）；实施顺序建议在 add-memory-scope-visibility 之后（面板徽章可直接区分项目命中）

## 风险与回滚

| 风险 | 处置 |
|---|---|
| 携带 projectId 被误解为放宽隔离 | spec 场景钉死：其他维度检查不变；不同项目不可见；不携带时项目记忆依旧不可见 |
| find-only 解析让模型困惑（路径明明有效却报错） | 错误信息明确指向 `project_resolve`；DSH 插件路径在配置加载时就完成 resolve（登记语义），日常检索不受影响 |
| 插件配置了错误的 projectPath | 启动解析失败 → 降级不带项目 + 面板如实提示；记忆照常可召回（personal-global 等不受影响） |
| 一次召回混入其他项目的记忆 | 不可能：查询只携带**一个** projectId，scopeAllowsRead 按相等匹配 |
