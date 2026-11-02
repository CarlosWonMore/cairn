# Tasks

## 1. 布局骨架

- [x] 1.1 `plugin/dsh/src/client.js` 根容器改为 `height:100% + display:flex + flexWrap:wrap + gap`，子栏 `flex: 1 1 320px / 360px`、`minWidth:0`、`minHeight:0`；验证：`node --check`
- [x] 1.2 左栏拆成「状态卡（上）」+「本轮注入（下，`flex:1`）」；验证：窄窗口/宽窗口各看一次（手工）

## 2. 右栏活动记录

- [x] 2.1 标题 + 筛选条独立成 `flex:none` 区块，chip 容器 `flexWrap: wrap`；验证：窄宽度下按钮换行不横向溢出（手工）
- [x] 2.2 移除「15 条 / 30 条 / 120 条」chip，记录列表改为 `flex:1 + minHeight:0 + overflow:auto`；验证：代码内不再有 `条` 字样的 chip；`grep "条'" src/client.js`
- [x] 2.3 记录行参考轨迹排版：时间（tabular-nums）+ 类型 + 摘要，行间细分隔线，`overflowWrap:anywhere`；验证：手工

## 3. 回退与边界

- [x] 3.1 所有 hook 仍在 `if (!data) return` 之前；验证：`grep -n "useEffect\|useState" src/client.js` 行号全部小于 `if (!data)`
- [x] 3.2 无注入时左下方显示占位文案（不是空白）；验证：手工或结构断言
- [x] 3.3 宿主容器无确定高度时不出现内容被裁：根容器 `overflow:hidden` 只裁滚动溢出；验证：手工

## 4. 验证与文档

- [x] 4.1 `node --check plugin/dsh/src/client.js` 通过
- [x] 4.2 `npx tsx --test plugin/dsh/tests/*.test.ts` 全绿（65+）
- [x] 4.3 `npm test` 全绿（668 / 667 / 0 / 1）
- [x] 4.4 `plugin/dsh/README.md` 补面板布局说明；`.agents/toCodeBuddy.md` 追加本轮记录
- [x] 4.5 **手工冒烟**：用户 2026-11-02 实测通过——两栏并排、右栏独立滚动、窄窗口堆叠、筛选按钮换行，均正常

## 5. 栏宽拖拽与布局持久化（2026-11-02 追加）

- [x] 5.1 两栏之间加手柄：`data-cairn-split`、`role="separator"`、`cursor: col-resize`、`touch-action: none`；验证：`panel-render.test.ts` 断言根节点三段、中间是手柄
- [x] 5.2 拖动用 pointer capture，占比夹紧 25%–75%；验证：结构测试覆盖占比作用，手感待手工
- [x] 5.3 松手写 `localStorage['cairn-memory-tab-layout'] = {leftPct}`；无拖动不写；验证：`loadLayout` 的越界/脏数据回落用例
- [x] 5.4 右栏底部「重置布局」清键并回到自适应；验证：结构测试断言按钮存在
- [x] 5.5 `node --check src/client.js`、插件测试、`npm test` 全绿
- [x] 5.6 **手工冒烟**：用户 2026-11-02 实测通过——拖拽跟手、刷新后占比保留、「重置布局」回到自适应
