# Design: MCP 工具面在进程生命周期内冻结

## 上下文

- 工具清单构成：17 个静态 `TOOL_NAMES`（server.ts:26-44，字面量定义）+ 常驻 `memory_decide`（server.ts:309-338）+ 条件暴露的 4 个 onboarding 工具 + `memory_review`（server.ts:237-307），条件开关是 `onboardingActive()`（server.ts:69-77）＝ `service.doctor().counts.importItems.clean > 0`。
- `onboardingActive()` 目前在 ListTools 处理路径里实时调用——同一进程内库状态翻转即翻转工具面。
- MCP 形态是 stdio，宿主每会话拉起一个进程；进程生命周期与会话边界天然对齐，「启动时判定」等价于「每会话判定」。
- 缓存机制依据（M0-session-handoff §41 + 官方文档）：tools 层是缓存前缀的最早节点，任何成员变化使该层及其后全部失效。

## 决策

### D1：判定移到进程启动时一次，冻结为常量

**选择**：server 构造/启动路径调用一次 `onboardingActive()`，结果存为模块级常量；ListTools 处理读常量。

**放弃的备选**：保留实时判定但加「会话内不翻转」缓存——被否，状态机复杂且仍可能翻转；「启动时一次」语义最简单、最可测。

### D2：判定失败 fail-closed 降级

**选择**：启动判定包 try/catch，失败按 `false` 处理（不暴露条件工具）+ stderr 日志（MCP stdio 纪律：日志只去 stderr/文件）。

**理由**：doctor 失败说明库状态不可知，暴露依赖该状态的服务（整理批次读取）风险更大；常驻工具不受影响，server 不因启动判定失败拒启——工具面问题不该放大成会话不可用。

### D3：与 auto-onboarding 边界的关系

auto-onboarding 规格约束的是「策略判定/应用/撤销」语义与「不在会话关键路径」；本变更只影响条件工具**何时可见**。import 后的推荐工作流不变：CLI import → 新会话（或 CLI）处理。取舍在 proposal 已如实声明。

### D4：四个变更中的定位

本变更独立于 add-memory-scope-visibility / add-two-stage-memory-recall（那两个动工具**返回形状**，本变更动工具**集合的稳定性**）；delta 是纯 ADDED，任意归档顺序安全。若与两者同批实施，建议先做本变更（改动面最小，独立验证）。
