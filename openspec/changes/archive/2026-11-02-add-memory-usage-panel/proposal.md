# Proposal: 记忆调用可视化面板

## Why

`add-dsh-memory-plugin` 只做了 Host 侧（召回 + 注入），**没有任何可见性**。后果是用户在会话里完全看不出：

- 这一轮到底召回了几条记忆
- 注入了哪几条、为什么是它们
- 预算用了多少
- **是「没找到」还是「找到了但被敏感规则挡掉」**

最后一点最要紧。两者在用户眼里都是「什么都没发生」，但原因完全不同：前者可能说明记忆库没内容，后者说明安全规则在正常工作。分不清就会误判成坏了。

外部方案佐证：`dsh-mnemon` 的「turn memory bar」（每个回复下列出本轮读写）、`dsh-prime-memory` 的「上下文注入 · memory」行，都在解决同一个信任问题——**看不见就等于不信**。

## What Changes

在会话顶部「对话 / 轨迹」这组视图旁边，加一个记忆调用面板，显示五个字段：

| 字段 | 内容 |
|---|---|
| 召回条数 | 本轮命中的候选数 |
| 注入条目 | id + kind + 摘要（可展开） |
| 命中原因 | 检索通道（fts / like / mixed） |
| 预算占用 | 已用字节 / 上限 |
| 状态区分 | 未命中 / 已过滤 / 已注入 |

落点是 DSH 的 UI 插件 slot `conversation.session.header.views.actions`。

### 数据从哪来

Host 侧在召回后把本轮结果写进一个**会话内可见的状态**，Client 侧读它渲染。不回传正文全文，只传 id / kind / 摘要 / 通道 / 字节数。

### 不改什么

- 不改召回算法、不改预算、不改敏感过滤规则。
- 不新增第二套记忆存储或检索。
- 不展示记忆正文全文（面板只给摘要，正文仍走 MCP 工具）。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `agent-interfaces`：实时召回 MUST 对用户可见，且 MUST 区分「未命中」与「已过滤」。
- `local-console`：**不改**（控制台是事后视图，本变更是会话内视图）。

## Impact

- 修改：`plugin/dsh/src/index.ts`（召回后写状态）、`plugin/dsh/package.json`（增加 `dsh.client` 段与 `./client` 导出）。
- 新增：`plugin/dsh/src/client.js`（UI 插件，注册到 slot）、`plugin/dsh/src/usage-state.ts`（状态形状与裁剪）。
- 测试：`plugin/dsh/tests/usage-state.test.ts`（状态形状、五种状态判定、摘要裁剪）。UI 渲染本身无法在 CI 断言，只能手工看。
- 风险：
  - **slot 名称与 props 可能随 DSH 版本变化** → 只依赖公开 slot 名；渲染失败不影响宿主（UI 插件隔离）。
  - **面板显示正文会泄露** → 只传摘要，且敏感记忆在过滤阶段就已被剔除，状态里只记「被过滤的条数」，不记内容。
  - **UI 无法自动验证** → 分级保持 `fixture-only`，手工冒烟后如实记录。
