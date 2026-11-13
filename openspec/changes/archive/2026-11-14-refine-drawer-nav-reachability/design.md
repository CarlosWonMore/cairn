## Context

抽屉是 `openDrawer(title, body, onClose)`（`ui-js.ts:1345`）动态建出来的：`mask = div.drawer-mask` 挂到 `document.body`，面板 `aside.drawer` 靠 flex 排在右侧。

相关 CSS：

```css
main { display: grid; grid-template-columns: 190px 1fr; }   /* nav = 第 1 列 */
nav  { border-right: 1px solid var(--border); ... }          /* 无 position / 无 z-index */
.drawer-mask { position: fixed; inset: 0; z-index: 50; }     /* 铺满视口 */
.drawer      { width: min(720px, 96vw); ... }
```

`nav` 是普通流内元素，`z-index` 不适用于它；遮罩是 `position: fixed` + `z-index: 50`，必然覆盖导航。

实测确认（不是推断）：导航按钮中心点 `elementFromPoint` 返回 `.drawer-mask`；Playwright 点 `[data-view="imports"]` 直接 5s 超时。

## Goals / Non-Goals

**Goals**
- 一次点击完成「关抽屉 + 切视图」。
- 遮罩仍然压暗内容区、点空白仍关抽屉。
- 无障碍声明如实（非模态）。

**Non-Goals**
- **不做焦点陷阱**（focus trap）。这是本提案刻意排除的：如果加陷阱，导航就又不能聚焦了，与目标自相矛盾。既有的 Esc / 焦点归还保持不变。
- 不改抽屉内容、不改 URL 键、不做「抽屉变窄让出导航」的布局改造。
- 不改移动端断点值。

## Decisions

### D1：抬 `nav` 的层级，而不是缩遮罩

```css
nav { position: relative; z-index: 60; }
```

`z-index` 要生效必须先脱离 `static`，所以 `position: relative` 是必需的，不是装饰。层级取 60（遮罩是 50），留 10 级余量给未来元素。

**为什么不缩遮罩**（`inset: 0 0 0 190px`）：那会把「导航宽度」这个视觉常量写进遮罩的几何，移动端导航变成顶部横条后这条 CSS 就得再写一份媒体查询；而抬 nav 一层在两种布局下都成立，且不改遮罩的任何既有语义。

**副作用要如实承认**：导航被抬到遮罩之上后，遮罩不再压暗导航列。视觉上表现为「抽屉盖住内容区，导航仍亮」。这正是要的效果（导航可用），但它确实改变了截图观感。

### D2：点导航为什么自动就对了——因为 `go()` 早就写好了

`go(view, push)`（`ui-js.ts:246`）第一段就是：

```js
if (view !== state.view) {
  state.drawer = ''; state.item = ''; state.mem = '';
  closeDrawer();
}
```

也就是说**逻辑层早已支持「切视图前收抽屉」**，只是鼠标点不到导航所以从没被触发过。D1 抬完层级，这条路径自然生效，**不需要改任何 JS 逻辑**。

这也是本提案最小的原因：一行 CSS + 删一行属性。

### D3：去掉 `aria-modal`，而不是加焦点陷阱

`aria-modal="true"` 的语义是「本对话框之外的内容不可交互」。当前实现：

- 没有焦点陷阱（全仓 `focusTrap` 零命中，Tab 能直接走出抽屉）；
- 导航可达之后，外部**确实可交互**。

所以这个属性现在就是**不实声明**，读屏用户会被误导。去掉它并把语义改成事实描述，是更正而不是降级。`role="dialog"` + `aria-label` 保留——对话框语义本身没错。

> 已知残留：去掉 `aria-modal` 后，Tab 仍可在抽屉内外自由移动（本来如此，本次不修）。要彻底做对需要真正的焦点管理（陷阱 + 可选的 inert），那是独立的一次改动，本提案不夹带。

### D4：既有两条断言必须改，且要在提案里写明理由

- `tests/console/assets.test.ts:113`：`assert.ok(UI_JS.includes("'aria-modal': 'true'"))`
- `scripts/e2e-console-ui.mjs:203`：`check('抽屉以 role=dialog + aria-modal 出现', ...)`

它们断言的正是本条要求推翻的行为。**改断言是规格修正的必然结果，不是为了让测试变绿**——判断标准是：改完之后，把 `aria-modal` 加回去，新断言必须变红（且原断言不再存在）。这一条要写进 tasks 的变异对照里，否则无法区分「修正」与「妥协」。

### D5：一次点击的验收方式

不能只断言「点完之后视图变了」——那两次点击也能通过。必须断言**点击次数恒为 1**：

- Playwright 用 `locator.click()`（默认会等元素可点、可接收事件），**在抽屉打开状态下直接点导航项**，若不可点会超时；
- 断言点完之后：抽屉消失、`aria-current` 移到目标项、地址里不再有 `drawer`/`mem`；
- 对照断言：点击遮罩空白处仍能关闭且视图不变（防止为了导航可达把遮罩点击语义搞坏）。

## Risks / Trade-offs

- **风险**：`nav` 抬高层级后，若未来有别的 fixed 覆盖层（确认弹窗）落在 z-index 50~60 之间，会盖不住导航。→ 在 CSS 注释里写明「覆盖层 > 60」的约定。
- **风险**：移动端 `nav` 变横条后 `position: relative` 是否仍正确。→ 媒体查询里不覆盖 `nav` 的定位，实测确认。
- **取舍**：不做焦点陷阱（见 Non-Goals），因此 Tab 仍能走出抽屉——保持现状并如实声明。

## Migration

无 schema 变更、无 URL 键变更。纯 CSS + 一个属性删除，回滚即还原两行。
