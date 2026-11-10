# Tasks: 压缩后重注入

> 硬边界：只改 `plugin/dsh/`；纯内存，不写盘；不改内核与 MCP。构建后必须重启 DSH 才生效。

## 1. 会话追踪

- [ ] 1.1 `plugin/dsh/src/index.ts` 的 SessionState 增加 `touchedMemories: Map<string, {id, kind, summary, content, at}>`。
- [ ] 1.2 注入时（`runOnce` 成功后）把 `injectedIds` 对应内容写入追踪。注意：`runOnce` 目前只返回 id，需扩展返回或另行取正文。
- [ ] 1.3 `tools/post-execute` 里对 `mcp__cairn__memory_get|memory_add|memory_update|memory_forget` 提取 id 并追踪。
- [ ] 1.4 LRU 上限 200，超出淘汰最旧。

## 2. 重注入

- [ ] 2.1 压缩成功（`type==='compaction/end' && !evt.data?.error`）时：清去重 + 清本会话累计（既有行为）**＋ 触发重注入**。
- [ ] 2.2 `plugin/dsh/src/recall.ts` 新增 `renderReinjection(entries, { budgetBytes })`：独立表头措辞、独立预算、超预算裁剪并写省略条数。
- [ ] 2.3 重注入后把这些 id 加回去重集合（避免下一步常规召回重复）。
- [ ] 2.4 通过 `agent.inject(makeInjectionMessage(text))` 写入上下文。

## 3. 配置

- [ ] 3.1 `reinjectOnCompaction`（默认 true）、`reinjectBudgetRatio`（默认 0.5）、`trackMax`（默认 200）。
- [ ] 3.2 写进 `cordis.patch.yml` 注释说明。

## 4. 测试（`plugin/dsh/tests/`）

- [ ] 4.1 压缩成功后：涉及过的记忆被重注入，文本含「压缩后恢复」类措辞（区别于常规召回）。
- [ ] 4.2 压缩失败（带 error）不重注入、不清去重。
- [ ] 4.3 超预算时裁剪并写明省略条数，不抛错。
- [ ] 4.4 重注入后常规召回不重复。
- [ ] 4.5 会话隔离：A 压缩不影响 B 的追踪集合。
- [ ] 4.6 LRU 上限：超过 200 后最旧的被淘汰。

## 5. 可观测性

- [ ] 5.1 `/usage?debug=1` 的 diag 增加 `lastReinject: { count, bytes, at }` 与 `trackedCount`。

## 6. 全量验收

- [ ] 6.1 `cd plugin/dsh && npx tsc -p tsconfig.json` 成功（**必须重建 dist，否则改了不生效**）。
- [ ] 6.2 `cd plugin/dsh && npx tsx --test tests/*.test.ts` 全部通过，报告数字（基线 94/94）。
- [ ] 6.3 `npm run typecheck` 0 错误；`npm test` 主仓不受影响。
- [ ] 6.4 `openspec validate add-compaction-reinject --strict` 通过。
- [ ] 6.5 变异对照：把 `!evt.data?.error` 守卫去掉，确认「压缩失败不重注入」用例变红且只有它红。
- [ ] 6.6 重启 DSH 后：`/plugins/cairn-dsh-memory/usage?debug=1` 出现 `lastReinject` / `trackedCount` 字段。

## 7. 文档

- [ ] 7.1 `plugin/dsh/README.md` 补「压缩后重注入」小节。
- [ ] 7.2 `CHANGELOG.md` Unreleased 段。
