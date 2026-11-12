# Proposal: MCP 工具面在进程生命周期内冻结

## Why

MCP server 的工具清单不是恒定的：`onboardingActive()`（server.ts:69-77，判定依据 `doctor().counts.importItems.clean > 0`）控制 4 个 onboarding 工具 + `memory_review` 是否出现在 ListTools 结果里（server.ts:237-307）。判定在**每次 ListTools 请求时实时执行**，所以另一个进程跑 `cairn import`、或会话内调用 `onboarding_apply` / `memory_decide auto` 导致待整理条目数 0↔>0 翻转时，**同一进程的下一份工具清单就会不同**。

这是「不升级、不重启」前提下唯一的工具 schema 变化向量。三家供应商的前缀缓存机制（DeepSeek 完整前缀匹配、GLM/ZAI 隐式缓存、Anthropic 层级失效）都指向同一结论：**tools 层变更 = 该层及其后全部失效 = 整包按未命中价重算**。本项目 2026-11-12 的缓存审计（M0-session-handoff §41）实测：4,048 次大请求中，prompt 变过的 13 次中位命中仅 1.9%，未变的 4,035 次中位命中 99.8%——一次 690k surface 的整包重算就是 41.47 积分（DSH 会话实测账单）。

工具声明变更已有一条治理纪律（「升级挪到会话边界」），但那条纪律管不住**运行中自身翻转**。修复很小：把判定从「每次 ListTools」移到「进程启动时一次」。

## What Changes

- MCP server 启动时对条件工具集合（4 个 onboarding 工具 + `memory_review`）**判定一次并在整个进程生命周期内冻结**；运行中库状态变化不再改变 ListTools 结果。
- 常驻工具（静态 17 个 + `memory_decide`）不受影响。
- 判定失败（doctor 抛错）时按「不暴露 onboarding 工具」降级并写 stderr 日志——fail-closed，不暴露可能不可用的工具面。
- **如实声明的取舍**：会话中途 import 到达后，需要重启 server（对 stdio 每会话一进程的形态即新会话）才能见到 onboarding 工具。这符合既有纪律「自动整理不在会话关键路径上运行」（auto-onboarding）——import 后本就该开整理会话。

### 明确不做的事（红线）

- **不引入动态工具通知**（`notifications/tools/list_changed`）：宿主支持参差，且动态性本身就是要消灭的东西。
- **不改变判定条件本身**：`onboardingActive()` 的语义原样保留，只移动调用时机。
- **不改任何工具的 name/description/schema 内容**：本变更只冻结集合的成员资格。
- **不碰 CLI 通道**：`cairn onboarding` 等命令入口与 auto-onboarding 的策略边界全部不动。

## Impact

- Affected specs: `agent-interfaces`（ADDED「MCP 工具面在进程生命周期内稳定」）
- Affected code: `src/interfaces/mcp/server.ts`（ListTools 处的实时判定移到启动时一次）
- 不涉及数据库迁移
- 测试影响：新增「启动冻结 / 运行中翻转不变 / 重启重估」单测；`mcp:smoke` 通过

## 风险与回滚

| 风险 | 处置 |
|---|---|
| import 到达后旧会话没有 onboarding 工具，用户以为功能丢了 | proposal 与使用文档如实声明取舍；CLI 通道始终可用；重启即恢复 |
| doctor 启动失败误伤 | fail-closed 降级为不暴露条件工具 + stderr 日志；常驻工具不受影响，会话仍可用 |
| 与 auto-onboarding 规格冲突 | 无冲突：auto-onboarding 管「判定与应用语义」，本变更管「工具面何时可见」；「不在会话关键路径」的要求反而被加固 |
