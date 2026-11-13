## Context

`openDetail(id)`（`ui-js.ts:774`）现在的做法是：`api(/api/memories/:id)` → `clear(host)` → 把整个 `#view` 换成详情 → 返回时 `render()` 重建列表并重新请求。

而 `openDrawer(title, body, onClose)`（`ui-js.ts:1209`）已经是一个完整的覆盖面板实现：`role="dialog"` / `aria-modal="true"` / 焦点移入并归还 / Esc·遮罩·按钮三关闭入口 / 关闭回调。导入视图的 `openRow(r)` 就是用它，并把 `state.drawer` 写进地址。

**所以这不是"新建一个抽屉"，而是把记忆详情接到已有的抽屉上。** 详情内容本身（正文、meta 表、批注表单、批注列表、修订史）不需要重写，只是换一个承载容器。

## Goals / Non-Goals

**Goals**
- 详情在覆盖面板中打开，列表 DOM 不销毁、不重查、不滚回顶部。
- 详情可寻址，刷新/分享可复现。
- 与导入视图的抽屉行为一致（同一套关闭入口与焦点归还）。

**Non-Goals**
- 不改详情接口或修订史结构。
- 不做「上一条/下一条」在抽屉内翻页（未被要求）。
- 不修滚动位置保存的通用机制（列表根本不重建，就不需要恢复逻辑）。

## Decisions

### D1：复用 `openDrawer`，不新写一套面板

`openDrawer` 已经把「三个关闭入口共用同一段逻辑」「焦点归还到打开前的元素」做对了。重写一份只会让两处行为漂移——这类双实现是本项目反复踩过的坑（投影 `firstLine`、`promotedPredicate` 都是同一类）。

### D2：`openDetail` 只换承载容器，内容构建抽成 `buildDetailBody(d)`

把现在 `openDetail` 里从 `clear(host)` 到渲染修订史的那一段整体搬进 `buildDetailBody(d)`，返回一个 `<div>`。然后：

```js
openDetail(id) {
  api('/api/memories/'+id+'?mode='+state.mode+'&redact=0').then(function (d) {
    state.mem = id; writeUrl(false);
    openDrawer(short(previewOf(d), 40), buildDetailBody(d), function () {
      state.mem = ''; writeUrl(false);
    });
  });
}
```

这样内容构建逻辑**一处未改**，改动面只是容器与状态。

> 注意：详情请求本身仍会发（要拿正文与修订史），它不包含列表查询——规格里说的「不重新请求列表数据」指的是 `/api/memories` 列表端点。

### D3：新增 URL 键 `mem`，不复用 `drawer`

`drawer` 已经用于导入视图的档案/批次，语义是「哪个导入行展开了」。混用会让 `go()` 的清理逻辑（切视图时清 `drawer` 与 `item`）把两种语义搅在一起。新增一个键，`KEYS` 表加一项，`go()` 里一并清掉。

`url-state.ts` 的注释写明「唯一键表：加键只改这一处」——正好按它做。

### D4：关闭面板不触发 `render()`

现在的返回按钮调用 `render()`，那才会重查列表。改成只在 `onClose` 里清状态与地址，**不动 `#view`**。列表 DOM 从头到尾没被销毁，所以滚动位置天然保持——不需要写任何「保存/恢复 scrollY」的代码。

这是本设计最省事的一点：**不恢复，而是不破坏。**

### D5：静态导出页同路径

静态页没有 `api`，详情数据来自内嵌模型。`buildDetailBody` 接受同样的 `d` 结构即可复用；`state.mem` 在静态页不写地址（`writeUrl` 在 `STATIC` 下直接 return，既有行为）。

### D6：关于「展示顺序变动」——先复现再定性

实测未观察到顺序变化（同一批 57 条，返回后逐条一致）。两种可能：(a) 用户看到的是滚动位置丢失造成的「找不到刚才那条」；(b) 特定条件下（并发写入、筛选叠加）顺序确实会变——列表 SQL 是 `ORDER BY m.updated_at DESC, m.id`，若有写入就会重排。

tasks 里要求**先写一条复现脚本**：在列表打开期间用 CLI 改一条记忆，再进详情返回，观察顺序。复现到就补断言并修；复现不到就在归档记录里写明「以滚动位置丢失解释，未复现顺序变化」。

## Risks / Trade-offs

- **风险**：抽屉里嵌表单（写下意见）可能触发布局问题。→ 抽屉已有 `.drawer-body` 滚动容器；实测确认。
- **风险**：`state.mem` 与 `state.drawer` 同时存在时 `go()` 清理不彻底。→ 两者在 `go()` 里一并清，并加断言。
- **取舍**：不做「详情开着时切筛选自动关闭」。切筛选会 `render()`，列表 DOM 重建，此时抽屉还盖在上面会指向已消失的行——但抽屉是独立挂到 `body` 的，不会崩。留作已知边界，不写进规格。

## Migration

无 schema 变更。旧地址没有 `mem` 键 = 没有详情打开，与现状一致。
