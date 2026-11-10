# Tasks: 修正记忆面板的注入计数与活动记录漂移

> 全部改动限于 `plugin/dsh/`。**不得改 `src/`（内核）与 `src/interfaces/mcp/`**。
> 硬边界：带注入条目的活动记录永不被折叠；落盘日志仍不得含记忆正文与摘要。

## 1. 先做回归护栏（先写先跑）

- [x] 1.1 `plugin/dsh/tests/injector.test.ts` 增加用例：同一记忆第二次被召回时，`runOnce` 返回 `reason === 'all_seen'` 且 `deduped >= 1`、`includedIds` 为空。
- [x] 1.2 增加用例：候选为空时返回 `reason === 'miss'`，MUST NOT 返回 `all_seen`。
- [x] 1.3 增加用例：真实注入时 `reason === 'ok'` 且 `sessionTotal` 等于去重集合大小。

## 2. 拆分召回结果语义（`plugin/dsh/src/index.ts` + `recall.ts`）

- [x] 2.1 `InjectionOutcome` 增加 `candidates`、`deduped`、`sessionTotal` 字段（只增不改）。
- [x] 2.2 `createInjector.runOnce` 按 design D1 的顺序判定三种结果；`nothing_new` 由 `all_seen` 与 `miss` 取代。
- [x] 2.3 保留旧 reason 字符串的兼容读取（面板/日志里已存在 `nothing_new` 的历史行，渲染时按「已去重」一类展示）。

## 3. 活动记录措辞（`pushActivity` 调用点）

- [x] 3.1 `ok` → `自动召回 候选N 注入M`（M>0）。
- [x] 3.2 `all_seen` → **`自动召回 已去重 N 条（本会话已注入 K 条）`**；断言字符串**不含** `注入0`。
- [x] 3.3 `miss` → `自动召回 未命中`。
- [x] 3.4 其他 reason 保持原样。

## 4. 空步折叠（`pushActivity`）

- [x] 4.1 连续同类「未产出生效注入」条目合并：`count` 累加、`firstT` 保留首次、`t` 刷新为最近一次。
- [x] 4.2 带 `items` 的条目**永不参与合并**。
- [x] 4.3 读取历史行时缺 `count` 按 1 处理（向后兼容）。
- [x] 4.4 测试：连续 20 次 `all_seen` → ring 里只有 1 条且 `count === 20`；中间夹一次真实注入 → 该注入仍独立成条。
- [x] 4.5 测试：折叠条目的 `t` 与 `firstT` 正确，可用于计算时间跨度。

## 5. 去重重置（依赖 asar 查证结论）

- [x] 5.1 **在 `app.asar` 中查证**是否存在可供插件 `hooks.on` 监听的压缩/重置事件名。把查证命令与原始输出写进报告。
- [x] 5.2 若存在：挂上监听并在事件里调用 `st.injector.resetSession()` 且清空 `st.injected`。
- [x] 5.3 若不存在：**不发明事件名**，改为在 `plugin/dsh/README.md` 写明「仅在会话 id 变化时重置」的边界，并在报告里明确说明这一降级。
- [x] 5.4 测试：会话 id 变化 → 新会话状态为空、同一记忆可再次注入。

## 6. 左栏口径行（`plugin/dsh/src/client.js`）

- [x] 6.1 左栏条目列表下方追加一行：累计条数 + 「右栏记录每一步，本栏按去重累计」。
- [x] 6.2 `panel-render.test.ts` 断言该行存在且包含条数。

## 7. 全量验收

- [x] 7.1 `npm run typecheck` 通过。
- [x] 7.2 `node --test plugin/dsh/tests/*.test.ts`（或仓库既有的插件测试命令）全部通过，报告 tests/pass/fail/skip 四个数字。
- [x] 7.3 `npm test` 主仓全量通过，数字与基线对比（基线 721/720/0/1）。
- [x] 7.4 `npm run build` 且插件 `dist` 重建成功（插件从 dist 加载，不重建等于没改）。
- [x] 7.5 变异对照：把 `all_seen` 判定改回恒 `miss`，确认 3.2 的用例变红，还原后复绿。