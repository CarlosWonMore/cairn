# Proposal: DSH 记忆插件（以 MCP 为内核的体验层）

## Why

投影简报（`add-memory-projection-brief`）解决了「会话开始时看得见记忆」，但它有两个硬边界：

1. **只能静态注入**：写在 `AGENTS.md` 里的内容在整个会话期间不变，无法按当前问题召回。
2. **受预算挤压**：DSH 的投影预算 2 KB，装不下太多记忆。

外部方案 `dsh-prime-memory` / `dsh-meow-memory` 能挂 `agent/pre-step` 做每步召回，因为它们是 **Cordis 插件**。Cairn 是 **MCP server**（独立进程），订阅不到 `session/event`——这是架构事实，不是实现疏漏。

用户选择 Q1-B：**做一个 DSH Cordis 插件，但以 MCP 为内核**。插件不重复实现存储、审批、作用域判定，只补 DSH 专属的体验层。这既拿到实时召回，又不分叉 Cairn 的单一内核。

## What Changes

新增一个 DSH Cordis 插件包，它：

- **通过 `@deepseek-ai/dsh-mcp-client` 在进程内挂载同一个 Cairn MCP server**（不复制记忆逻辑）
- 在 `agent/pre-step` 按当前用户消息做**召回注入**：调 Cairn 的检索能力，把命中记忆作为一条合成消息放在用户消息之前
- 同会话去重：已注入的记忆不重复注入；会话压缩后重置
- 注入可关闭：`记忆·关` / `跟随全局` 两态，按会话持久化
- **失败隔离**：插件不可用时，Cairn MCP 仍可被模型直接调用（降级为 pull 模式）

### 不做什么

- **不做记忆存储**：数据仍在 Cairn 本地库，仍走 `plan_hash + approval_id` 审批。
- **不做会话捕获（L0）**：那等于把用户对话落盘，与 Cairn 的隐私边界冲突。需要用户另行明确授权才会考虑。
- **不做自动写入**：插件只读 Cairn，不产生候选、不写库。
- **不引入向量**：复用 Cairn 现有的 FTS + 触发的检索实现。

## 仓库形态的技术选择

项目当前**没有 workspaces，也没有 `packages/` 目录**。引入 monorepo 是一次真实的结构变更。按「能不改就不改」的原则，权衡了三档：

| 方案 | 成本 | 问题 |
| --- | --- | --- |
| A. 根 `package.json` 加 workspaces + `packages/dsh-plugin` | 中 | 需要 pnpm/npm workspaces、独立 tsconfig、独立构建；与现有 `dist/` 单包发布流程冲突 |
| B. 普通子目录 `plugin/dsh/`，独立 package.json，不纳入 workspaces | **低** | 用 `npm i` 时根 `files` 不打包它；但插件本来就不该随 cairn 主包发布 |
| C. 插件只作为文档 + 模板，不落代码 | 最低 | 用户要手抄，违背「这是个可用的插件」 |

**选 B**：`plugin/dsh/` 作为独立子包（自己的 `package.json` / `tsconfig`），**不加入根 workspaces**——因为它的消费方是 DSH profile（用 `dsh plugin add <path>` 安装），不是 npm 生态里的 cairn 用户。根包 `files` 已限定 `dist`，天然不会把插件打进去。

这不是偷懒，是让两件事各自独立发布：Cairn 主包给宿主用 MCP；插件给 DSH 用 profile 安装。

## Capabilities

### New Capabilities

无。插件是既有能力的宿主侧适配，不引入新的系统行为契约。

### Modified Capabilities

- `agent-interfaces`：新增「插件形态的实时召回必须复用 MCP 内核，且失败时降级为纯 MCP」的约束。

## Impact

- 新增：`plugin/dsh/`（package.json、cordis.patch.yml、src/index.ts、src/recall.ts、tsconfig.json、README.md）。
- 修改：`agent-interfaces` 主规格；`docs/cairn-usage.md` 增补插件安装与降级说明。
- 测试：插件侧的纯逻辑（去重、预算、开关）用 node:test 覆盖；**插件与 DSH 的集成无法在 CI 中断言**，只能手工验证并如实标注。
- 风险：
  - **插件与宿主版本耦合**：DSH 升级可能改 `agent/pre-step` 契约。缓解：只依赖公开事件名，失败降级。
  - **注入内容泄露**：复用 Cairn 的作用域过滤，但插件侧必须再断言 `local_only` 不进入注入。
  - **无法自动验证**：集成部分只能手工冒烟，分级保持 `fixture-only`，不虚标。