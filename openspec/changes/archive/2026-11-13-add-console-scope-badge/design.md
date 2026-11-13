## Context

控制台的记忆列表由 `paintMemories()` 渲染，数据来自 `buildModel()` 的 `memories` 数组（`MemoryView`）。每条 `MemoryView` 已带 `scopeId`；`ConsoleModel.scopes` 已带每条作用域的 `preset` / `syncPolicy` / `spaceName` / `projectId` / `deviceId` / `agentId` / `counts`。**数据面已经齐备，缺口只在前端渲染。** 实测真实库当前只有 2 条作用域（personal-global / device-local），因此「同 preset 多实例」在未来项目作用域启用后才会出现，但契约必须现在写清。

方案取向（ponytail）：不新增接口、不新增 URL 参数、不新增状态字段，只用已有的 `scopes` 数组做一次 `scopeId → scope` 查表。

## Goals / Non-Goals

**Goals**
- 列表层直接看出每条记忆的作用域，本地限定作用域有可区分的视觉强调。
- 作用域过滤器在同 preset 多实例时可区分。
- 静态导出页与工作台行为一致。

**Non-Goals**
- 不改 `contentView` 的裁切语义（brief 240 / full 不裁）。
- 不改检索通道与 MCP 返回形状（0.6.0 的两段式检索是另一条链路）。
- 不给记忆列表加服务端作用域聚合字段；`scopes` 已有的字段够用。
- 不做作用域排序/分组的新交互。

## Decisions

### D1：徽章数据来源 = 已有的 `scopes` 数组，不新增后端字段

`paintMemories(host, list, total)` 目前拿不到 `scopes`。改动是把 `scopes` 作为第四个参数传进去（调用点两处：静态分支与在线分支），在函数内建一次 `Map<scopeId, ScopeLayerView>`。

**为什么不用后端 join**：`loadMemories` 的 SQL 已经在做子查询计数，再加一个 join 只为拿 preset 是把已经在前端的数组再算一遍。`scopes` 本来就是 `/api/memories` 响应的一部分。

**查不到时怎么办**：`scopeId` 有外键保证必有行；若仍然查不到（库被手工改坏），渲染一个 `scope?` 中性徽章，**MUST NOT** 崩溃也 **MUST NOT** 静默省略——省略会让"没有徽章"与"这是个 bug"无法区分。

### D2：警示色调的判据是 `syncPolicy === 'local_only'`

不是按 preset 硬编码 `device-local`。理由：`project-device` 也是设备绑定、也是 `local_only`；把判据绑在 preset 名上，将来新增设备类 preset 就会漏。`local_only` 是库里实际存储的字段，也是同步链用于物理排除的同一个判据。

### D3：过滤器消歧文案 = preset + 首个可用的限定标识

优先级：`spaceName` → `projectId` 前 8 位 → `deviceId` 前 12 位 → `agentId`。都为空（如 `personal-global`）时只显示 preset，此时本来也不会有歧义。现有选项已带记忆数，保留；同步策略用同一枚徽章的样式并进选项文案。

**为什么不用「换一个更长的 preset 名」**：preset 是库里的枚举值，改名会牵动同步与投影。区分是**展示层**的问题，在展示层解决。

### D4：静态导出页走同一条渲染路径

静态页用 `localFilter(model.memories, { scope: state.scope, ... })` 本地过滤，工作台走服务端 `?scope=`。两条路径都调用同一个 `paintMemories`，所以徽章只写一遍。新增断言保证静态页**不发请求**也能渲染徽章。

### D5：可访问性 —— 徽章是文本，不是纯色块

色觉障碍用户不能靠颜色分辨「会不会跨设备」。本地限定徽章的 `textContent` 必须自解释（如 `device-local · 仅本机`），颜色只是加强。

## Risks / Trade-offs

- **风险**：卡片头部 chip 增多导致视觉拥挤。→ 徽章放在 kind/status 之后、authority 之前，与既有 chip 同尺寸；不新增换行。
- **风险**：`paintMemories` 签名变化影响其它调用点。→ 全仓只有两处调用（静态分支、在线分支），一次改完；用默认参数 `scopes = []` 保持向后兼容。
- **取舍**：不做作用域图例/悬浮解释。徽章文本自解释已经够用，加图例是未被要求的功能。

## Migration

无 schema 变更、无数据迁移。纯展示层改动，回滚 = 还原 `ui-js.ts`。

## Open Questions

无。
