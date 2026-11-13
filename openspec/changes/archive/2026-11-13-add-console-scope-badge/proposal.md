## Why

控制台的记忆列表能显示 kind、status、authority、sensitive、冲突数，**唯独不显示作用域**——而作用域恰恰是「这条会不会跨设备」的唯一答案。当前要看作用域只能逐条点进详情页的 meta 表，等于把一个筛选级别的信息藏在了详情里。

同时作用域过滤器本身也有歧义：下拉框只渲染 `preset`（`project-global` / `device-local` / `agent-private`），而同一 preset 在库中可以有多条记录（每个项目一个 project-global、每台设备一个 device-local）。用户看到两个「project-global」无法区分，选中哪条全凭猜。

0.6.0 已经给 DSH 插件补了作用域徽章（面板左右栏、device 类警示色调），控制台是唯一还没跟上的面向人的界面。

## What Changes

- 记忆卡片头部新增**作用域徽章**：展示作用域 preset 名，`local_only` 同步策略用警示色调，一眼分清「这条会跨设备」还是「只在本机」。
- 作用域过滤器选项文案带上**消歧限定信息**：同 preset 的多条作用域用项目名 / 设备 / Agent 区分，并附同步策略与记忆数。
- 作用域徽章与过滤器选择**都可寻址**：过滤结果写回地址栏，静态导出页同样按选择过滤（沿用既有 URL 状态机制，不新增参数名）。
- 冻结边界：不新增后端接口，不改摘要/全文裁切语义，不改检索通道，不改 MCP 返回形状。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `local-console`：只读预览视图必须把作用域边界属性呈现到列表层；查询与视图状态可恢复要求作用域过滤选项在同一 preset 多实例时仍可区分。

## Impact

- 代码：`src/interfaces/console/assets/ui-js.ts`（卡片徽章 + 过滤器文案 + 把 `scopes` 传进 `paintMemories`）、`src/interfaces/console/model.ts`（若 `ScopeLayerView` 缺消歧字段则补只读字段）。
- 数据：无 schema 变更。`MemoryView.scopeId` 与 `ConsoleModel.scopes` 已提供全部所需信息。
- 测试：`tests/console/render.test.ts`（源码级断言）、`scripts/e2e-console-ui.mjs`（点击级断言）。
- 不影响：CLI、MCP、检索、同步、治理链路。
