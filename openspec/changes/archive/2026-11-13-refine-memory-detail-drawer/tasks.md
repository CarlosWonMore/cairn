## 1. 复现与定性

- [x] 1.1 写一次性脚本复现「返回后顺序变化」：列表打开期间用 CLI `cairn update` 改一条记忆 → 进详情 → 返回 → 比对顺序
- [x] 1.2 把结论（复现到 / 未复现 + 原因）写进本文件末尾的「复现记录」段

## 2. 承载容器切换

- [x] 2.1 抽出 `buildDetailBody(d)`：把现有详情渲染（正文 card、meta 表、写下意见、批注列表、修订史）整体搬进去，返回 `<div>`，**内容逻辑零改动**
- [x] 2.2 `openDetail(id)` 改为：请求详情 → 写 `state.mem` → `openDrawer(title, buildDetailBody(d), onClose)`
- [x] 2.3 `onClose` 只清 `state.mem` 与地址，**不调用 `render()`**
- [x] 2.4 删除原「← 返回列表」按钮（抽屉自带关闭入口）

## 3. 可寻址

- [x] 3.1 `url-state.ts` 的 `KEYS` 与 `URL_STATE_KEYS` 增加 `mem`
- [x] 3.2 `go()` 切视图时清 `state.mem`
- [x] 3.3 页面加载时若地址带 `mem`，自动打开对应详情（静态页跳过网络请求，从内嵌模型取）

## 4. 测试

- [x] 4.1 `tests/console/render.test.ts`：源码级断言 `openDetail` 调用 `openDrawer`，且不再包含 `clear(host)`
- [x] 4.2 `tests/console/url-state.test.ts`：`mem` 键往返一致，缺省不写入
- [x] 4.3 `scripts/e2e-console-ui.mjs`：点开详情后列表卡片仍在（数量不变）
- [x] 4.4 `scripts/e2e-console-ui.mjs`：点开详情前后 `/api/memories`（列表端点）请求数不增加
- [x] 4.5 `scripts/e2e-console-ui.mjs`：滚动到中部 → 开详情 → Esc 关闭 → `scrollY` 与关闭前一致（容差 ≤ 2px）
- [x] 4.6 `scripts/e2e-console-ui.mjs`：三个关闭入口（按钮 / Esc / 遮罩）都能关，且焦点归还到触发按钮
- [x] 4.7 `scripts/e2e-console-ui.mjs`：地址带 `mem` 时刷新直接呈现该详情面板
- [x] 4.8 `scripts/e2e-console-ui.mjs`：切视图时 `mem` 从地址移除、面板关闭

## 5. 验证

- [x] 5.1 `npm test` 全绿，测试数不低于基线（当前 837）
- [x] 5.2 `npm run typecheck` 0 错误
- [x] 5.3 `npm run test:ui` 全绿，测试数不低于基线（当前 73）
- [x] 5.4 变异对照：把 `onClose` 里加回 `render()`，4.4/4.5 必须变红；把 `openDrawer` 换成原整页替换，4.3 必须变红
  - 实测：M1 `onClose` 加回 `render()` → 4.2 变红；M2 `go()` 不清 `mem` → 4.1（mem 可寻址）变红；M3 不调 `openDrawer` → 4.2 变红；M4 `buildDetailBody` 里 `clear(#view)` → 4.3 变红。四条各只打红对应断言。
- [x] 5.5 `openspec validate refine-memory-detail-drawer --strict` 通过
- [x] 5.6 真实库冒烟：`cairn ui` 里滚到中部开详情、Esc 关闭、确认位置与顺序都在
  - 实测（真实库 57 条）：滚到 2600 → 开详情 → Esc 关闭，`scrollY` 2600 → **2600**；列表顺序逐条一致（`ORDER_SAME=true`）；进出详情期间列表端点请求 **0 次**；Esc 后 `[role=dialog]` 计数 0。

## 复现记录

**任务 1.1 / 1.2 —— 复现到（条件明确）。**

一次性脚本 `artifacts/probe-detail-order.mjs`（`artifacts/` 已 gitignore，不入库）：临时 HOME 里加 6 条记忆，列表数据走 `buildModel`（console server 的 `/api/memories` 就是它，不另写一份 SQL），做两组对照——

1. **不写入、只重查**（对应"用户什么都没改就点返回"）：`SAME_ORDER = true`。
2. **重查前用 CLI `cairn update` 改一条**（改原列表末尾那条）：`SAME_ORDER = false`，被改的那条从第 6 位跳到第 1 位。

原始输出：

```
初始顺序: af57df dc0906 a6b4ff edb4f9 d9e52c 1d9b7d
A 无写入重查 → SAME_ORDER = true
改的是: 1d9b7d （原列表末尾）
B 写入后重查 → SAME_ORDER = false
   新顺序: 1d9b7d af57df dc0906 a6b4ff edb4f9 d9e52c
   被改那条现在在第 1 位（原第 6 位）
结论: 复现到：重查会让被写入的那条跳到最前
```

**定性**：顺序变化的直接原因是「返回列表时重查了一次」，触发条件是「这期间库里有写入」——列表 SQL 是 `ORDER BY m.updated_at DESC, m.id`，被写的那条自然冒到最前。没有写入时重查结果逐条一致，所以用户报的「顺序变了」要么期间有 Agent/CLI 写入，要么只是滚动位置丢失造成的"找不到刚才那条"。

**本次改动对两个条件的处置**：`onClose` 不再 `render()`，列表 DOM 从头到尾没被销毁——无论期间有没有写入，看到的都还是进入详情前那份快照，顺序不会变（这也是规格里"关闭后顺序不变"要求的那个行为）。
