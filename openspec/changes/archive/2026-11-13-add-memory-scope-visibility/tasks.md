# Tasks: 记忆作用域对用户与插件可见

> 红线：`scopeAllowsRead` 的判定语义一行不动；面板不得出现 `scopeId` UUID；落盘 JSONL 仍不得写 items 或内容。

## 1. MCP 层（src/）

- [x] 1.1 `src/retrieval/search.ts`：结果装配处按 scopeId 批量预取 scope 行（一次 IN 查询或 JOIN），把 `scopePreset`/`syncPolicy` 随命中带出；过滤与排序逻辑不变。
- [x] 1.2 `src/interfaces/app-service.ts`：`memory_context` 路径同样带出 scope 属性（复用同一预取）。
- [x] 1.3 `src/interfaces/mcp/server.ts`：`summarize()` 扩展出 `scope_preset` / `sensitivity`（memory 行）/ `sync_policy` 三字段；`memory_search` 与 `memory_context` 都生效。
- [x] 1.4 单测：检索条目含三字段且值正确；preset 是枚举名而非 UUID；`device-local` 作用域条目 `sync_policy` 为 `local_only`。

## 2. 插件层（plugin/dsh/src/）

- [x] 2.1 `recall.ts`：`filterInjectable` 基于真实 `sensitivity`/`syncPolicy` 判定，字段缺失 → 过滤（fail-closed）；`RecallHit` 字段注释更新为「必带」语义。
- [x] 2.2 `index.ts`：`buildUsage` 的 `injectable` 透传 `scope`/`sensitivity`/`syncPolicy`；`rememberInjected`、`touchMemory`、`ActivityEntry.items` 跟进；落盘 JSONL 不写 items（维持现状）。
- [x] 2.3 `usage-state.ts`：`InjectedMemory` 接口与 `injectableToInjected` 映射加 `scope`；`EMPTY_USAGE` 补默认。
- [x] 2.4 `client.js`：`normalize()` 透传；左栏注入条目与右栏活动记录条目渲染作用域徽章（preset 原文，不出现 UUID）。
- [x] 2.5 `npx tsc -p tsconfig.json` 重建插件 dist（改 src 必 build；不 build 等于没改）。

## 3. 测试与验收

- [x] 3.1 插件单测：闸对 sensitive/local_only 过滤；缺字段 fail-closed；`filteredCount` 正确。
- [x] 3.2 `npm run test:ui`：新增「左栏/右栏条目显示作用域徽章」断言；既有 66 项全绿。
- [x] 3.3 `npm test` 全绿（基线 808/807/0/1 之上只增不减）；`npm run typecheck` 0 错。
- [x] 3.4 `npm run mcp:smoke`（只读真实库）通过，无 schema 断言破裂。
- [ ] 3.5 `openspec validate add-memory-scope-visibility --strict` 通过。
