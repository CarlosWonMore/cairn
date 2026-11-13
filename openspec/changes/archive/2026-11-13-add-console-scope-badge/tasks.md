## 1. 记忆卡片作用域徽章

- [x] 1.1 `paintMemories(host, list, total, scopes)` 增加第四个参数（默认 `[]`），函数内建 `Map<scopeId, ScopeLayerView>`
- [x] 1.2 卡片头部在 kind/status 之后插入作用域徽章：文本为 `preset`，`syncPolicy === 'local_only'` 时追加 `· 仅本机` 并使用警示色调
- [x] 1.3 `scopeId` 查不到时渲染中性 `scope?` 徽章，不抛错、不静默省略
- [x] 1.4 两处调用点（静态分支 `model.scopes`、在线分支 `data.scopes`）传入 `scopes`

## 2. 作用域过滤器消歧

- [x] 2.1 `toolbar()` 的 `scopeSelect` 选项文案改为 `preset` + 首个可用限定标识（`spaceName` → `projectId` 前 8 → `deviceId` 前 12 → `agentId`）
- [x] 2.2 选项文案附带同步策略标记与记忆数（既有记忆数保留）
- [x] 2.3 同 preset 多实例时选项文案互不相同（用消歧标识区分）

## 3. 测试

- [x] 3.1 `tests/console/render.test.ts`：源码级断言 `UI_JS` 含作用域徽章渲染路径，且徽章文本包含 `preset` 与本地限定标记
- [x] 3.2 `tests/console/render.test.ts`：断言 `paintMemories` 接受 `scopes` 参数且两处调用点都传了
- [x] 3.3 `tests/console/model.test.ts`：`buildModel` 的 `memories[].scopeId` 与 `scopes[].id` 能对上（数据面契约）
- [x] 3.4 `scripts/e2e-console-ui.mjs`：点进记忆视图，断言每张卡片含作用域徽章文本；device-local 那条带「仅本机」
- [x] 3.5 `scripts/e2e-console-ui.mjs`：静态导出页断言徽章照常渲染且无网络请求

## 4. 验证

- [x] 4.1 `npm test` 全绿，测试数从 833 起只增不减
- [x] 4.2 `npm run typecheck` 0 错误
- [x] 4.3 `npm run test:ui` 66 项起只增不减
- [x] 4.4 变异对照：把 `syncPolicy === 'local_only'` 改成 `false`，断言 3.1/3.4 变红；还原复绿
  - 实测：最初 3.1 的断言写成「全文含 `syncPolicy === 'local_only'`」，被「作用域层级表」里同名字面量满足，改坏判据仍全绿（假通过）。已收紧为断言 `scopeLocalOnly` 定义行本身；收紧后变异 C 使 3.1 变红。另补一条断言钉住「卡片徽章自己拼上『仅本机』」，变异 B（删掉徽章上的「仅本机」）由绿转红。
- [x] 4.5 `openspec validate add-console-scope-badge --strict` 通过
- [x] 4.6 真实库冒烟：`cairn ui` 打开记忆列表，肉眼确认两类徽章可区分
  - 实测（真实库 57 条 / 2 个作用域）：未过滤列表里 `personal-global` 为中性灰、`device-local · 仅本机` 为警示黄，两者一眼可分；过滤器选项为 `device-local · dev_01a18002 · 仅本机 · 11` 与 `personal-global · 46`，文案互不相同。切换过滤 ~1.4s 完成，命中 11 条与作用域计数一致。
