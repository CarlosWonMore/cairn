# Proposal: 记忆投影简报（按宿主语义分级）

## Why

Cairn 已有受管投影通道（`generateProjection`），但它**只写死 5 句路由文案**（`ROUTER_BLOCK_CONTENT`），从不投影记忆正文。结果是：27 条 active 记忆躺在库里，宿主会话**完全看不到它们**，只能靠模型主动调 `mcp__cairn__*`——而模型经常想不到调。

2026-11-01 对 6 个宿主做了官方文档与应用代码核实，得到四个决定性事实：

1. **WorkBuddy 的 `blocked` 判断是过时的。** 其应用代码 `MemoryCollector.getWorkingMemoryContent()` 明确读取 `<cwd>/.workbuddy/memory/MEMORY.md`，包成 `<working_memory_content>` 注入，**上限 10,000 字符**（`Hs=1e4`）；用户级 `~/.workbuddy/MEMORY.md` 另以 `<user_instructions>` 注入，上限 4,000 字符。
2. **ZCode 的 `MEMORY.md` 是索引，不是正文。** 其内置文档明写「never put memory content there」，每行约 200 字符、无 frontmatter。
3. **`AGENTS.md` 是 DSH / Claude Code / Cursor 三个宿主的公共落点**，可一份文件服务三家。

补充事实：ZCode 虽然已接入 cairn MCP，但**它从来不是 `AgentKind` 的受支持宿主**（适配器里没有 zcode 条目）。因此本次不处理 ZCode 的投影；若将来要支持，应作为独立变更（需先定义其适配器与落点）。上面关于 ZCode `MEMORY.md` 是索引的调研结论保留在文档里，作为将来实现的依据。
4. **Copilot 自带服务端 Copilot Memory**（Repository-level facts + User-level preferences），与投影并存，存在内容竞争。

因此投影不能一刀切。**写进一个没人读的文件、或违反宿主设计约定地塞正文，都是假成功。**

## What Changes

- `HostAdapter` 新增 `projectionMode`（`'brief' | 'index' | 'none'`）与 `projectionBudgetBytes`，表达「这个宿主能吃多少、什么形态」。
- 投影内容从写死文案升级为**记忆简报**：按作用域过滤后的高价值记忆，每条一行，带 id 便于追溯。
- **物理排除**：`local_only` 作用域、`sensitive` 敏感度、`blocked` 状态一律不进入投影。
- 预算按宿主分级（见下），超出按 importance + 时效截断并明示条数。
- 投影内容变化等同配置变更，仍走 `plan → approve → apply`，不静默改写用户文件。
- **缓存友好**：同记忆集必然产出同字节（排序稳定、不含时间戳）。
- `doctor` 报告：投影模式、预算、实际占用、最近一次投影时间，以及 Copilot 的并存警告。

### 按宿主的分级（本项目核定）

| 宿主 | 模式 | 预算 | 落点 |
|---|---|---|---|
| DSH | brief | 2 KB | `$DSH_HOME/AGENTS.md`（用户级） |
| Claude Code | brief | 2 KB | 项目 `AGENTS.md`（三宿主共享） |
| Cursor | brief | 2 KB | 项目 `AGENTS.md`（同一份） |
| WorkBuddy | brief | **8 KB** | `<cwd>/.workbuddy/memory/MEMORY.md` |
| Copilot | brief | 2 KB | `.github/copilot-instructions.md` |
| OpenClaw | none | — | 维持现状（无公开路径） |

### 不改什么

- 不改变 `item_promoted` / `item_skipped` 语义。
- 不引入新依赖，不做向量嵌入。
- 不自动写入记忆：投影只读，不产生候选。
- 不改变 `mcp-primary` 的手动关闭流程。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `agent-interfaces`：受管投影 MUST 支持按宿主语义分级（简报 / 索引 / 不支持），并 MUST 在预算内截断且如实报告。
- `agent-onboarding`：router 模式的受管入口 MUST 携带按作用域过滤的记忆简报，而非固定文案。

## Impact

- 修改：`src/agents/adapters.ts`（projectionMode/budget）、`src/agents/config.ts`（投影内容生成与预算）、`src/projection/markdown.ts`（可能的截断辅助）、`src/interfaces/cli/main.ts`（doctor 输出）、`src/interfaces/console/model.ts`（展示投影状态）。
- 新增：`src/projection/brief.ts`（记忆简报渲染：筛选、排序、预算、稳定化）。
- 测试：`tests/projection/brief.test.ts`（筛选与排除、预算截断、字节稳定性、index 模式）、扩展 `tests/agents/adapters.test.ts` 与 `tests/agents/config.test.ts`。
- 风险：
  - **投影泄露敏感内容** → 物理排除规则必须先于任何渲染，且用负向测试锁定。
  - **字节不稳定破坏缓存** → 排序键必须全序且不含时间；测试断言「同输入同输出」。
  - **Copilot 与 Copilot Memory 冲突** → 只在 notes/doctor 警告，不擅自删除宿主已有记忆。

## 后续变更（不在本次范围）

- `add-lesson-kind`：新增 `lesson` 记忆类型（需 SQLite 表重建迁移）。
- `add-dsh-memory-plugin`：DSH Cordis 插件，以 MCP 为内核做实时召回。
