# Tasks

## 1. 状态形状（可测）

- [x] 1.1 `plugin/dsh/src/usage-state.ts`：定义 `RecallUsage` 形状 —— `{ status, candidates, injected: [{id, kind, summary}], matchedBy, bytesUsed, bytesBudget, filteredCount }`；验证：`plugin/dsh/tests/usage-state.test.ts` 断言字段齐全
- [x] 1.2 `buildUsage()`：由召回结果 + 渲染结果 + 过滤计数推导三态（injected / filtered / miss）；验证：同文件三种输入各断言
- [x] 1.3 摘要截断到 60 字符，且**不含正文全文**；验证：同文件断言长度与不含换行
- [x] 1.4 敏感项只计数不记内容；验证：同文件断言 `filteredCount` 正确且 `injected` 不含敏感 id

## 2. Host 侧接入

- [x] 2.1 `plugin/dsh/src/index.ts`：召回后把 `RecallUsage` 写到会话可见状态（通过 agent 上下文或模块级出口）；验证：`plugin/dsh/tests/usage-state.test.ts` 用 stub 断言写入被调用
- [x] 2.2 写状态失败不影响召回与注入；验证：同文件断言异常被吞掉且注入仍发生

## 3. Client 面板

- [x] 3.1 `plugin/dsh/package.json` 增加 `dsh.client` 段（`platform: web`）与 `./client` 导出；验证：`node -e` 读取 package.json 断言字段存在
- [x] 3.2 `plugin/dsh/src/client.js`：按真实模板形状注册到 `conversation.session.header.views.actions`；验证：`node --check src/client.js` 语法通过
- [x] 3.3 面板默认折叠为一行摘要，展开显示五字段；三态用**文字**标明（不只靠颜色）；验证：手工冒烟

## 4. 文档与验收

- [x] 4.1 `plugin/dsh/README.md` 补面板说明与「未验证」边界；`docs/cairn-usage.md` 同步
- [x] 4.2 恢复被误删的 `scripts/mcp-smoke.mjs`（ZCode 提交引入的回归），并验证 `npm run mcp:smoke` 通过
- [x] 4.3 `npm test` 全绿（668+），插件测试全绿
- [x] 4.4 **手工冒烟**：装插件、重启 DSH、观察面板是否出现及三态是否正确；结果如实写进 README

## Workflow follow-up

- 归档前需用户审阅四个制品。
- 归档时把 delta 合并进 `agent-interfaces` 主规格。
