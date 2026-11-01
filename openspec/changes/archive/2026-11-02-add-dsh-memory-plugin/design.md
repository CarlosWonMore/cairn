# Design

见 `proposal.md`。本文件记录实现形态与取舍。

## Context

- Cairn MCP server 已可用（`dist/src/interfaces/mcp/server.js`），14 个工具。
- DSH 的 `@deepseek-ai/dsh-mcp-client` 可在插件进程内以 SDK 方式挂载 MCP。
- DSH 插件通过 `dsh.bundle.patch` 声明，装到 profile 的 `node_modules` 并写 `cordis.patch.yml`。

## Goals / Non-Goals

**Goals**：DSH 内按问题实时召回；复用 MCP 内核；失败降级不阻塞会话。

**Non-Goals**：不做存储、不做审批、不做会话捕获、不引向量。

## Decisions

### D1：插件只做「召回 + 注入」，检索逻辑不复制

插件调用 Cairn 的检索（通过进程内 MCP client），自己只负责：选取注入时机、同会话去重、预算裁剪、渲染成一条合成消息。

**理由**：一旦插件自己写 SQL 查库，作用域过滤就会出现第二份实现——这正是 `promotedPredicate` 曾经踩过的坑（6 处各写一份，撤销语义漏了一处）。

### D2：注入形态是「一条合成消息」，不改写用户 prompt

与 meow-memory 的做法一致：在真实用户消息前插入一条独立消息，标记为记忆注入。

**理由**：改写用户输入会让会话记录失真，也让用户无法分辨「我说了什么」与「系统塞了什么」。

### D3：去重状态放内存，压缩即失效

同会话去重只需要「本会话已注入过哪些 id」。放内存即可，不需要落库。会话压缩后重置——因为压缩已经清掉了上下文，记忆需要重新可见。

**ponytail: 内存态，进程重启即丢。** 丢失的后果只是「重启后可能重复注入一次」，不值得为此加一张表。

### D4：失败一律降级，不抛错到会话

插件任何一步失败（MCP 连不上、检索超时、宿主事件参数变化）都只记录并跳过本次注入。

**理由**：spec 明确要求「插件不可用时宿主仍可通过 MCP 使用记忆」。让插件故障阻塞会话是反向的。

### D5：仓库形态 = `plugin/dsh/` 独立子包，不进 workspaces

见 proposal 的方案对比。要点：消费方是 DSH profile（`dsh plugin add <path>`），不是 npm 上的 cairn 用户，所以不需要并入根包构建。

**不引入 workspaces 的理由**：那会要求根 `package.json`、锁文件、CI 都改造，而收益只是「一处安装命令」。当前根包 `files: ['dist']` 已保证插件不会被打进 cairn 发布物。

### D6：集成无法自动验证，如实标注

插件与 DSH 的集成（事件是否触发、注入是否真的进入上下文）只能手工冒烟。CI 能覆盖的是纯逻辑：去重、预算裁断、开关状态机。

分级保持 `fixture-only`，文档写明「手工验证过什么、没验证什么」。

## Risks / Trade-offs

- **DSH 改 pre-step 契约** → 只依赖公开事件名；失败降级（D4）。
- **注入把敏感内容带出来** → 检索走 MCP 的同一实现（D1），且插件侧对返回结果再断言一次 `local_only`/`sensitive` 不注入（双保险，不是重复实现逻辑）。
- **重复注入浪费上下文** → D3 去重。
- **无法 CI 验证** → D6 如实标注，不虚标 real-cli-tested。

## Migration Plan

- 纯新增，无数据迁移。
- 回滚：`dsh plugin remove` + 重启，Cairn MCP 不受影响。

## Open Questions

- 插件是否需要自己的设置页（GUI）。可延后；先用配置项。