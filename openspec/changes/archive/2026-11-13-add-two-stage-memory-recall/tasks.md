# Tasks: 两级记忆检索——列表给预览，全文按需取

> 红线：列表工具不得返回全文；注入预算（1536B）与去重语义不变；前缀歧义绝不猜测；批量逐条作用域检查。**实施顺序在 add-memory-scope-visibility 之后**（同改 `summarize()` 与 recall 链路）。

## 1. 服务端（src/）

- [x] 1.1 新增 `src/retrieval/preview.ts`：frontmatter 感知、确定性（同输入同字节、无 `now()`）的单点预览函数，上限 300 字符；以 `usage-state.ts` 的 `firstLine` 逻辑为基底推广。
- [x] 1.2 `server.ts` `summarize()`：`content` → `preview` + `truncated` + `content_length`；`memory_search` / `memory_context` 都生效。
- [x] 1.3 `memory_get`：`id` 支持唯一前缀（≥8 字符）；新增可选 `ids` 数组（上限 10，与 `id` 恰传其一）；逐条 `scopeAllowsRead`，不可读条目返回 `{ id, readable: false }`。
- [x] 1.4 三个工具 description 更新：列表=预览、全文经详情、可批量；移除「不返回全文上下文注入」的旧表述，换成与线协议一致的表述。
- [x] 1.5 单测：preview 上限与确定性（frontmatter 记忆的输出钉住）；长/短记忆的 truncated 标记；前缀唯一命中/歧义报候选/短于 8 字符拒绝；批量上限、逐条过滤、不可读标记；get 路径经 `scopeAllowsRead`。

## 2. 插件（plugin/dsh/src/）

- [x] 2.1 `recall.ts`：注入行携带记忆 id 前 8 字符；注入行改渲染 server preview（本地 `LINE_MAX=160` 截断保留为预算护栏）；`rankHits` 计分输入核对（命中词 vs preview）。
- [x] 2.2 `usage-state.ts`：`firstLine` 退役或降级为面板兜底（server preview 经 usage 链路进来后不再各自截断）；`toSummary` 与 preview 的关系理清，不留两份 frontmatter 感知逻辑。
- [x] 2.3 `index.ts`：`TRACKED_TOOLS` 注释与 `memory_search` 排除理由更新；注入统计口径核对（bytesUsed 含标识前缀开销）。
- [x] 2.4 `npx tsc -p tsconfig.json` 重建 dist。

## 3. 测试与验收

- [x] 3.1 插件单测：注入行格式（`[id8][kind] 摘要`）、预算裁剪含标识、去重仍按完整 id。
- [x] 3.2 迁移既有断言 search 返回 `content` 的测试为 preview 形状；核对 `mcp:smoke` 的形状断言。
- [x] 3.3 `npm test` 全绿（基线之上只增不减）；`npm run typecheck` 0 错；`npm run test:ui` 既有断言全绿（面板只显摘要，不受影响，核对即可）。
- [x] 3.4 `npm run test:e2e`：533 条 fixture 全流程不回归（applied/skipped/failed 口径不变）。
- [x] 3.5 `openspec validate add-two-stage-memory-recall --strict` 通过。
- [x] 3.6 文档：`docs/cairn-usage.md` 补「两段式检索」用法；收益表述遵守 design D6 诚实口径。

## 4. 明确不做（防漂移）

- [x] 4.1 不新增工具、不加 `include_content` 开关、不做 digest 存储列、不引入嵌入——如实施中想加，停下来回到提案审阅。
