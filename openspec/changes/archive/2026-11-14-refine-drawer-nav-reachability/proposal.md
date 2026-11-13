## Why

抽屉打开时，**左侧主导航点不动**。实测（真实库、Chrome、1400×950）：

| 观测 | 结果 |
|---|---|
| 导航按钮中心点的 `document.elementFromPoint()` | 返回 `.drawer-mask`（`hitIsNav: false`） |
| 用 Playwright 点 `[data-view="imports"]` | **5s 超时被拦**（被遮罩挡住，点不到） |
| 第一下点击的实际效果 | 命中遮罩 → 关闭抽屉，**视图不变**，地址仍是 `?view=memories&mem=…` |
| 要真正切视图 | 必须**再点第二下** |

根因是 CSS：`.drawer-mask { position: fixed; inset: 0; z-index: 50 }` 铺满整个视口，而 `main` 的导航列（190px）没有任何定位或 `z-index`，被压在遮罩下面。

**这同时是一处规格与实现的冲突**：主规格已写明「切换视图时收起详情面板 —— 用户点击左侧导航切到另一个视图 ⇒ 面板关闭、新视图正常呈现」。按现在的实现，一次点击只满足前半句，后半句要两下才成立。

还有一处**既有的语义不实**：抽屉声明 `aria-modal="true"`（告诉读屏「外面不可交互」），但代码里**从来没有焦点陷阱**（全仓 `focusTrap` 零命中）。也就是说这个声明在当前实现下就已经不准确了；导航可交互之后会更不准确。

## What Changes

- 主导航 SHALL 浮在覆盖层之上且可点击；点任一导航项时**一次点击**完成「关闭抽屉 + 切到该视图」（复用 `go()` 已有的「切视图先收抽屉」逻辑）。
- 抽屉**不再声明** `aria-modal="true"`，改为如实声明非模态：保留 `role="dialog"` + `aria-label`；三个关闭入口（Esc / 点遮罩 / 「关闭」按钮）与焦点归还全部不变。
- 遮罩仍覆盖内容区并压暗它；点击遮罩空白处仍然关闭抽屉。
- 移动端（`max-width: 720px`，导航变成顶部横条）同样要可点。
- 同步更新 `docs/cairn-console.md` 的抽屉小节，把「模态」改为「非模态」并说明导航可达。
- 冻结边界：不改抽屉内容、不改 URL 状态键、不动记忆与导入两条详情的数据链路。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `local-console`：抽屉的存在性要求新增「不得遮挡主导航」与「不声明模态」两条约束，并补对应的可点击性场景。

## Impact

- 代码：`src/interfaces/console/assets/ui-css.ts`（导航层级）、`src/interfaces/console/assets/ui-js.ts`（去掉 `aria-modal` 一行）。
- 测试：`tests/console/assets.test.ts` 与 `scripts/e2e-console-ui.mjs` 里**既有断言必须改**——它们现在断言的正是「必须声明 aria-modal」（`assets.test.ts:113`、`e2e-console-ui.mjs:203`）。这是规格层面的语义修正，不是为了变绿而改断言。
- 文档：`docs/cairn-console.md` §抽屉。
- 不影响：CLI / MCP / 检索 / 同步 / 治理链路；抽屉内容与数据链路零改动。
