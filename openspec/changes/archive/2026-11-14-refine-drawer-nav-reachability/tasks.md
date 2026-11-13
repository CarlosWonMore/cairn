## 1. 导航层级

- [x] 1.1 `ui-css.ts` 的 `nav` 规则加 `position: relative; z-index: 60;`，并在注释里写明「任何覆盖层必须 > 60」
- [x] 1.2 确认 `max-width: 720px` 媒体查询里 `nav` 变横条后定位不被覆盖

## 2. 非模态声明

- [x] 2.1 `ui-js.ts` 的 `openDrawer` 删除 `'aria-modal': 'true'`，保留 `role: 'dialog'` 与 `aria-label`
- [x] 2.2 `docs/cairn-console.md` §抽屉：把「模态」改为「非模态」，补一句导航可达

## 3. 调整既有断言（规格修正的必然结果）

- [x] 3.1 `tests/console/assets.test.ts:113`：把「必须声明 aria-modal」改为**反向断言**——源码里 MUST NOT 出现 `aria-modal`
- [x] 3.2 `scripts/e2e-console-ui.mjs:203`：改为断言「有 role=dialog 与 aria-label，且 **无** aria-modal」
- [x] 3.3 在两条断言处各留一行注释说明「为何从正向改为反向」（规格修正，非妥协）

## 4. 新测试

- [x] 4.1 `tests/console/assets.test.ts`：源码级断言 `nav` 规则含 `z-index` 且其值大于遮罩的 50
- [x] 4.2 `scripts/e2e-console-ui.mjs`：**抽屉打开状态下**用 `locator.click()` 点导航项（不可点会超时），断言一次点击后抽屉消失、`aria-current` 移到目标项、地址不含 `drawer`/`mem`
- [x] 4.3 `scripts/e2e-console-ui.mjs`：抽屉打开时点内容区空白处仍关闭抽屉、视图不变
- [x] 4.4 `scripts/e2e-console-ui.mjs`：抽屉打开时导航项可被 Tab 聚焦（`focus()` 后 `document.activeElement` 是该导航项）
- [x] 4.5 `scripts/e2e-console-ui.mjs`：视口收窄到 375px 复验一次点击切视图

## 5. 验证

- [x] 5.1 `npm test` 全绿，测试数 ≥ 845
- [x] 5.2 `npm run typecheck` 0 错误
- [x] 5.3 `npm run test:ui` 全绿，测试数 ≥ 101
- [x] 5.4 变异对照 1：把 `aria-modal` 加回去，3.1 / 3.2 必须变红
- [x] 5.5 变异对照 2：把 `nav` 的 `z-index` 去掉，4.2 / 4.4 必须变红（证明不是「碰巧能点」）
- [x] 5.6 `openspec validate refine-drawer-nav-reachability --strict` 通过
- [x] 5.7 真实库冒烟：抽屉打开时点导航一次切视图；点内容区空白仍关闭
