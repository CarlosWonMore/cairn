# Tasks

## 1. Host：会话状态机

- [x] 1.1 `SessionState`（injector / activity / injected / touched）+ `sessionKey()`（`agent.id`）；验证：`injector.test.ts` 会话隔离用例
- [x] 1.2 去重与 lastUsage 随 injector 变成每会话一份；验证：「A 注入过的记忆 B 仍会注入」
- [x] 1.3 活动环按会话分开，条目带 `s` 与 `items`；验证：端点切片断言
- [x] 1.4 最近活跃会话用**单调序号**而不是时间戳（同毫秒分不出先后）；验证：无 session 参数回落到最后跑过的那个

## 2. Host：端点

- [x] 2.1 `/usage?session=<id>` 返回该会话切片 + `sessionInjected`；验证：两条会话各返 1 条记录
- [x] 2.2 不带 `session` 时回落最近活跃会话（curl 自检可用）；验证：同文件断言
- [x] 2.3 `debug=1` 增补 `session: { requested, resolved, known }`；验证：手工 curl

## 3. Client

- [x] 3.1 slot `inject(sessionId)` 把会话 id 传给组件，`useUsage` 带进 URL 与 effect 依赖；验证：`panel-render.test.ts` 渲染
- [x] 3.2 左下改为「本会话注入的记忆」并去重（老宿主回退到 `injected`）；验证：结构断言 + 空态文案
- [x] 3.3 右侧「自动召回」行可点选 → 左侧同 id 高亮，再点取消；验证：点选用例（含 `data-cairn-hit`）
- [x] 3.4 工具调用行保持不可点，避免「点了没反应」的错觉

## 4. 隐私

- [x] 4.1 落盘剥掉 `items`，日志里不出现记忆摘要；验证：既有「正文零出现」用例继续通过
- [x] 4.2 回放不再重建累计集合（落盘没有 items），行为写进 README

## 5. 验证与文档

- [x] 5.1 `npx tsx --test plugin/dsh/tests/*.test.ts` 全绿（74）
- [x] 5.2 `node --check plugin/dsh/src/client.js`
- [x] 5.3 `npm test` 全绿（668 / 667 / 0 / 1）
- [x] 5.4 `plugin/dsh/README.md` 补会话口径与已知边界；`.agents/toCodeBuddy.md` 追加
- [x] 5.5 **手工冒烟**：用户 2026-11-02 实测通过——多会话不再叠加、点选高亮联动、口径改为「本会话注入的记忆」
