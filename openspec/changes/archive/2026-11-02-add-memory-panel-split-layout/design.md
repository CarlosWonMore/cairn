# Design

## 布局选择：flex + wrap，而不是媒体查询

客户端插件是通过 `window.__ModuleLoader__.load` 注入的一段代码，**没有样式表注入通道**，所有样式都是内联对象。媒体查询只能在样式表里写，所以自适应只能靠 flex 自身：

- 两栏都是 `flex: 1 1 <基准>` + `min-width: 0`；
- 容器 `flex-wrap: wrap`：可用宽度小于两个基准宽度之和时自动折行，变成上下堆叠。

基准值取 `320px`（左）/ `360px`（右）——小于这个宽度时并排会让摘要只剩半句。

## 滚动归属：三层，各管一段

```
根容器  height:100%  overflow:hidden  display:flex/flex-wrap
├─ 左栏  min-width:0  min-height:0  display:flex column
│   ├─ 状态卡（不滚动，内容固定 5 行）
│   └─ 本轮注入  flex:1  min-height:0  overflow:auto
└─ 右栏  min-width:0  min-height:0  display:flex column
    ├─ 标题 + 筛选条（flex:none，可换行）
    └─ 记录列表  flex:1  min-height:0  overflow:auto
```

`min-height: 0` 是关键：flex 子项默认 `min-height:auto`，不加这一条，内部 `overflow:auto` 永远不会触发，整块会把父容器撑高。

若宿主容器没有确定高度，`height:100%` 失效 → 退化成内容高度，根容器仍可整体滚动（`overflow:hidden` 不裁内容高度），不会出现「内容消失」。

## 参考「轨迹」的地方

只参考排版，不引入其组件：

| 轨迹 | 本面板 |
|---|---|
| 等宽数字时间戳 | `fontVariantNumeric: 'tabular-nums'` |
| 类型/阶段小标签 + 正文 | `kind` 标签 + 摘要，三段 flex |
| 行间细分隔线 | `border-bottom: 1px solid rgba(127,127,127,.12)` |
| 长文本按词断行 | `overflowWrap: 'anywhere'` |

## 移除条数 chip 后的取数上限

`filters.limit` 仍保留在 localStorage（默认 30），只是不再提供 UI。理由：老用户的 `localStorage` 里可能存着 15 / 120，直接删字段会让 `loadFilters` 与 `saveFilters` 的兼容路径变形；保留一个不可见的上限比"改数据结构"便宜。

## 不做的事

- 不做栏宽拖拽（YAGNI：两栏内容都短，拖拽的收益不足以抵消状态持久化成本）。
- 不做折叠/展开（状态区只有 5 行）。
- 不改 payload：布局是纯展示层改写，Host 侧零改动。

## 增量：拖拽分栏的实现选择

| 选择 | 方案 | 为什么 |
|---|---|---|
| 存什么 | **左栏占比（%）**，不是像素 | 存像素换窗口大小就失真；占比天然跟着容器缩放 |
| 什么时候落盘 | **松手时** | 拖动中每帧写 localStorage 没有意义，还会让「撤销」变得不可能 |
| 手感 | 25%–75% 硬夹紧 | 允许拖到 5% 等于把一栏弄丢，用户还得靠记忆找回来 |
| 事件 | pointer + `setPointerCapture` | move/up 都回到手柄上，不必挂 window 监听，组件卸载也不用摘 |
| 没拖过 | 不写 localStorage，走 `flex: 1 1 320px` | 保留原有的自适应堆叠行为；「默认」就是没有占比 |
| 恢复默认 | 删键（不是写一个默认占比） | 写死一个数会让「默认」变成另一个可漂移的值 |

**已知不精确处**：`startLeft` 用「手柄相对容器的偏移」近似左栏宽度，而百分比是按容器 content box 解析的，两者差一个左右 padding（32px）。首次按下时有几像素的跳变，肉眼不可见，不值得为此去读 computed style。

**未测**：拖拽手感与 pointer capture 的真实行为无法在 stub React 里断言；单测只覆盖「占比如何作用到样式」。
