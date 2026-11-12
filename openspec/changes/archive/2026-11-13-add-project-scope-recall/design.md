# Design: 检索可按项目身份过滤

## 上下文

- 读判定 `scopeAllowsRead`（core/scope.ts:231-245）：`scope.projectId != null && (query.projectId ?? null) !== scope.projectId → false`。**判定本身已经支持项目维度**——缺的只是把 projectId 递进来的通路。
- `memory_search` 处理器（server.ts:400-413）的 ScopeQuery 只有 `{deviceId, agentId}`；`memory_context` 已接受 `project_id`（server.ts:87, 382）——两条工具的项目口径先统一（参数名与解析行为一致），避免一工具一制。
- 项目身份与别名（add-stable-project-identity 已归档）：`resolveProject`（projects.ts:41-60）＝归一化 + 别名表 find-or-create；`normalizeAlias`（project-alias.ts:24-46）处理盘符/分隔符/git URL 形态。
- DSH 插件配置机制：`apply(ctx, config)` → `createInjector({recall, config})` 合并 `DEFAULTS`（index.ts:73-76）——新增配置项走既有通道。
- 面板徽章（add-memory-scope-visibility）按 preset 渲染，project-global/project-device 记忆一旦可召回即自动获得徽章，无需面板改动。

## 决策

### D1：参数名 `project`，值接受 UUID | 路径 | git URL

**选择**：`memory_search` 增加可选 `project`（string）；UUID 直接用；路径/URL 归一化后 find-only。`memory_context` 既有 `project_id` 参数保留并统一语义（同样 find-only）。

**放弃的备选**：只收 UUID——模型手查时需先 `project_resolve` 再 search，多一跳且容易忘；收路径/URL 让模型可以直接用已知信息。**登记不在检索路径发生**（find-only + 明确错误指引），保持读语义纯度：检索是无副作用的，「查询顺便建项目」会让只读审计面变脏。

### D2：插件配置 `projectPath`，启动时 resolve（登记语义在此）

**选择**：插件配置新增可选 `projectPath`（别名形态）；插件启动时调 `project_resolve`（find-or-create——登记语义在显式配置加载这一步，与「从未见过的路径新建项目」的既有规格一致）取得 UUID 缓存；每次 `searchOnce` 检索携带该 UUID。

**降级语义**：resolve 失败（如配置笔误）→ 不带项目检索 + 面板状态如实提示。选 fail-open 而非 fail-closed 的理由：配置错误的代价是「项目记忆召回不到」（与现状相同），personal-global 记忆照常可用——比让整个召回瘫痪更符合「插件不可用退化纯 MCP」的既有精神。

### D3：判定语义零改动，通路零绕过

`scopeAllowsRead` 一行不动。检索装配处把 `project` 解析结果放进 ScopeQuery.projectId（与 `memory_context` 现有路径同构）。**不存在**「带 project 参数绕过设备/Agent 检查」的路径——同一函数同一顺序全部检查。spec 场景「携带项目身份不放宽其他维度」钉死这一点。

### D4：检索结果的混合口径

携带 projectId 的结果 = 同项目记忆 + 无项目绑定记忆（personal-global / device-local / agent-private 等，它们 `scope.projectId == null` 恒通过项目维度检查）。这是期望行为：项目会话里「项目上下文 + 个人通用上下文」本就该同时可见；跨项目记忆天然被相等匹配排除。

### D5：测试策略

- 服务端单测：UUID 直用 / 别名命中 / 未登记报 `project_unresolved` 不建项目 / 混合口径 / 不同项目隔离 / 其他维度不放宽。
- 插件单测：配置→resolve 缓存→检索携带；未配置逐字节现状；resolve 失败降级 + 提示。
- `test:e2e` fixture 加少量 project-global 样本，断言配置项目后可召回、未配置不可见。

## 与其他变更的关系

唯一 MODIFIED 的「全通道作用域隔离」无其他变更触碰；agent-interfaces delta 是 ADDED。任意归档顺序安全。实施顺序建议：fix-onboarding-tool-surface-flip → add-memory-scope-visibility → add-two-stage-memory-recall → 本变更（后者依赖前者的召回链路稳定，且徽章让项目命中可见）。
