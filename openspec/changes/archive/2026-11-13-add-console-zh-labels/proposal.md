## Why

控制台的界面文案几乎全是中文，**唯独枚举值以英文原样呈现**：记忆卡片的 `kind` / `status` / `authority` 是 `decision` / `active` / `user_explicit`，作用域是 `device-local` / `sync_policy`，导入条目的 `scanState` 是 `clean` / `blocked`，审批通道是 `local_cli`。同一块界面上「作用域层级」「批量标记」这些是中文，紧挨着的 chip 却是英文单词——人读起来要在两套词表之间来回切换。

而且这些英文不是"原样数据"：它们本来就是产品自己的领域枚举（`MEMORY_KINDS` 8 个、`MEMORY_STATUSES` 6 个、`AUTHORITIES` 4 个），不是外部输入。产品对它们的中文表达在别处已经存在（`ACTION_LABEL` / `DISPOSITION_LABEL` / `ANN_STATUS_LABEL`），只有记忆本体这一组没做。

同时**不能只改成中文了事**：审阅记忆内容时，工程师需要看到库里的真实枚举值才能和 CLI / 日志 / SQL 对上。所以要做的是**可切换**，不是替换。

## What Changes

- 新增**标签语言模式**：`中文` / `原文` 两态，工具栏上有切换按钮，与主题、摘要/全文同级。
- 中文模式下，记忆卡片的 `kind` / `status` / `authority`、作用域 chip 的 `preset` 与 `syncPolicy`、详情页 meta 表的同名行、导入条目与批次的 `scanState` / `redactionState` 一律显示中文标签。
- 原文模式下**逐字节保持现状**，不许因为引入映射表就改变任何既有输出。
- **双语提示**：中文模式下，hover 的 `title` 属性仍是原始枚举值；这样切换只是改变默认阅读面，不销毁原值。
- 选择持久化：与主题、展示模式同一套机制（localStorage + 可寻址状态），刷新与复制地址都能复现。
- 映射表**单点定义**：在 `ui-js.ts` 与既有 `ACTION_LABEL` 并列，不散落在各处模板字符串里。
- 冻结边界：不改服务端任何返回值的形状，不改数据库，不改 MCP / CLI 输出。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `local-console`：只读预览视图的呈现契约要覆盖"标签语言可切换"，并明确中文模式不得损失原始枚举值（hover 可见）与不得改变数据面。

## Impact

- 代码：`src/interfaces/console/assets/ui-js.ts`（新增映射表 + `label()` 单点 + 工具栏按钮 + 各处 chip 调用点）、`src/interfaces/console/assets/url-state.ts`（若把语言并入可寻址状态）、`src/interfaces/console/assets/page.ts`（若需预置初始值）。
- 数据：无。所有枚举值服务端已返回，无需新增字段。
- 测试：`tests/console/render.test.ts`（映射表完整性与单点性）、`tests/console/url-state.test.ts`（往返）、`scripts/e2e-console-ui.mjs`（点击切换后 chip 文本变化）。
- 不影响：CLI / MCP / 检索 / 同步 / 治理链路。
