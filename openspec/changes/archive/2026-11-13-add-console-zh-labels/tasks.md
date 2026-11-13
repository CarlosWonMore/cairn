## 1. 映射表与单点函数

- [x] 1.1 在 `ui-js.ts` 的既有 `*_LABEL` 旁新增五张表：`KIND_LABEL`（8）、`STATUS_LABEL`（6）、`AUTHORITY_LABEL`（4）、`PRESET_LABEL`、`SYNC_POLICY_LABEL`、`SCAN_STATE_LABEL`、`REDACTION_LABEL`
- [x] 1.2 新增 `label(v, table)`：未知值原样返回，不返回空串或 undefined
- [x] 1.3 `chip(text, tone, title)` 支持可选的 `title`（仅中文模式且被翻译时传原始值）

## 2. 切换按钮与状态

- [x] 2.1 `state.labelLang`（`'zh' | 'raw'`，默认 `'zh'`）+ `LABEL_KEY` localStorage 读写
- [x] 2.2 工具栏加切换按钮，文案在「中文标签」与「原文标签」间反映当前态；与主题、摘要/全文同排
- [x] 2.3 切换只重渲染，不重建查询条件

## 3. 应用映射

- [x] 3.1 记忆卡片：`kind` / `status` / `authority` / 作用域 `preset` 与 `syncPolicy` 走 `label()`，中文模式挂 `title`
- [x] 3.2 记忆详情页 meta 表同名行走 `label()`
- [x] 3.3 作用域层级表与作用域过滤器选项走 `label()`
- [x] 3.4 导入视图：条目 `scanState`、批次/档案 `redactionState` 走 `label()`
- [x] 3.5 原文模式逐字节保持现状（用既有测试兜底，不改断言）

## 4. 测试

- [x] 4.1 `tests/console/render.test.ts`：断言 `MEMORY_KINDS` 每个值在 `KIND_LABEL` 中有中文标签（同理 STATUS / AUTHORITY）
- [x] 4.2 `tests/console/render.test.ts`：源码级断言 `label(` 单点存在，且不存在未包装的 `chip(mem.kind` / `chip(mem.status` / `chip(mem.authority`
- [x] 4.3 `tests/console/render.test.ts`：断言未知值降级（`label('brand-new-kind', KIND_LABEL)` 返回原值）——通过同一函数的沙箱实例化验证
- [x] 4.4 `scripts/e2e-console-ui.mjs`：点切换按钮后，记忆卡片的 kind chip 文本在中文与原文之间变化；再点回中文恢复
- [x] 4.5 `scripts/e2e-console-ui.mjs`：中文模式下 hover 某 chip 的 `title` 等于原始枚举值
- [x] 4.6 `scripts/e2e-console-ui.mjs`：静态导出页切换标签语言不发起网络请求

## 5. 验证

- [x] 5.1 `npm test` 全绿，测试数不低于 837
- [x] 5.2 `npm run typecheck` 0 错误
- [x] 5.3 `npm run test:ui` 全绿，测试数不低于 73
- [x] 5.4 实测：切换标签语言前后 `/api/memories` 请求数不增加；若增加，按 design D5 改为只重绘并在此记录
  - 记录：naive 实现（`toggleLabelLang()` 直接 `render()`）确实会再打一次 `/api/memories`（该视图每次 render 都重查）。
    已按 D5 改为只重绘：最近一次响应留在 `state.memData`，`render(true)` → `renderMemories(host, true)` → `paintMemoriesView`。
    e2e 用 `page.on('request')` 计数实测三次切换（中文→原文→中文）期间 `/api/memories` 为 0 次。
- [x] 5.5 变异对照：删掉 `KIND_LABEL` 中任一条目，4.1 必须变红；把 `label()` 的降级改成返回空串，4.3 必须变红
  - 实测：Z1 删 `instruction` → 4.1 变红（「标签表覆盖全部领域枚举」）；Z2 降级返回 `''` → 4.1 相邻的两条变红（单点性与原样返回）；Z3 把 `render(true)` 改回 `render()` → **单元测试仍全绿**，只有 e2e 抓得到（「切换标签语言全程未重查」从 0 次变 3 次）。结论："切换不重查"这条约束只能由点击级验收钉住，源码断言抓不到，勿在后续改动中删掉 e2e 那条。（派发方验收，本批未执行）
- [x] 5.6 `openspec validate add-console-zh-labels --strict` 通过
- [x] 5.7 真实库冒烟：`cairn ui` 打开记忆列表，中文与原文两态各看一遍
  - 实测（真实库 57 条）：中文态 `决策 / 生效 / 个人全局 / 用户明示`；点一次切原文 `decision / active / personal-global / user_explicit`；再点回中文恢复。两态切换全程 0 次 `/api/memories` 请求。
