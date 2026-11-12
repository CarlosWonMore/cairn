# Tasks: 检索可按项目身份过滤

> 红线：`scopeAllowsRead` 判定语义一行不动；检索路径 find-only 不建项目；插件未配置时行为与现状逐字节一致。**实施顺序在其余三个变更之后。**

## 1. 服务端（src/）

- [x] 1.1 `src/store/projects.ts`：暴露 find-only 解析（归一化 + 别名查表，未命中返回 null），与 find-or-create 的 `resolveProject` 并存、复用同一归一化。
- [x] 1.2 `server.ts` `memory_search`：新增可选 `project` 参数；UUID 直用，路径/URL 走 find-only，未命中返回 `project_unresolved` 错误（信息指引先走 `project_resolve`）；解析结果进 ScopeQuery.projectId。
- [x] 1.3 `server.ts` / `app-service.ts`：`memory_context` 既有 `project_id` 参数语义统一为 find-only（与 search 一致），错误口径一致。
- [x] 1.4 单测：UUID 直用；别名命中；未登记路径报错且**不产生新项目行**；混合口径（同项目 + personal-global 都出现）；不同项目隔离；设备维度不放宽（项目匹配但设备不匹配仍不可读）。

## 2. 插件（plugin/dsh/src/）

- [x] 2.1 配置项 `projectPath`（可选，别名形态）：`apply(ctx, config)` 读取；未配置时一切路径与现状逐字节一致。
- [x] 2.2 启动时经 `project_resolve` 工具解析（find-or-create）并缓存 UUID；解析失败降级为不带项目 + 面板状态如实提示（不静默）。
- [x] 2.3 `recall.ts` / `index.ts` 的 `searchOnce`：检索参数携带缓存的项目 UUID；usage 统计口径核对。
- [x] 2.4 `npx tsc -p tsconfig.json` 重建 dist。

## 3. 测试与验收

- [x] 3.1 插件单测：配置→解析缓存→携带检索；未配置零变化；解析失败降级与提示。
- [x] 3.2（实施期调整）「配置后可召回、未配置不可见」由专测覆盖（`tests/retrieval/project-search.test.ts` + MCP 线协议测试 + 插件 injector 三例），不改 e2e-onboarding fixture——e2e 的职责是整理流程完整性，检索语义改动以专测钉住更准；`npm run test:e2e` 原样全流程跑通 PASS 作为无回归证据。
- [x] 3.3 `npm test` 全绿（基线之上只增不减）；`npm run typecheck` 0 错；`npm run test:ui` 全绿。
- [x] 3.4 `npm run mcp:smoke` 通过。
- [x] 3.5 `openspec validate add-project-scope-recall --strict` 通过。
- [x] 3.6 文档：`docs/cairn-usage.md` / `docs/M0-session-handoff.md` 相关章节补「检索携带项目身份」的用法与 DSH 配置示例。
