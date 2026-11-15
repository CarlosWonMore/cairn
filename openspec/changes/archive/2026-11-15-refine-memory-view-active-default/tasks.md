## 1. 服务端

- [x] 1.1 `LIVE_VIEW_STATUSES` 常量导出（console/model.ts）
- [x] 1.2 `/api/memories` status 语义：缺省/空值 → 活动集；`all` → 全部；逗号列表 → 精确（server.ts）
- [x] 1.3 单测：缺省 → 只含 candidate/active/conflicted；`status=all` → 含 archived/tombstoned；显式 `status=archived` → 精确；概览 `/api/status` 计数口径不变

## 2. 前端（两形态同构）

- [x] 2.1 状态下拉：首两项「活动视图（默认）」与「全部状态」，其后个体状态项（ui-js.ts toolbar）
- [x] 2.2 静态页 localFilter 同一映射：`''` → 活动集、`all` → 不过滤、显式值 → 精确
- [x] 2.3 单测：render 源码断言（两新选项、localFilter 映射、LIVE 同一出处）；url-state 往返回归（status=all / 显式值 / 缺省）

## 3. e2e 与文档

- [x] 3.1 e2e-console-ui 受影响断言修正（默认活动视图后的卡片计数、新增「全部状态」切换检查）
- [x] 3.2 `docs/cairn-console.md` 补默认视图说明

## 4. 门禁与收尾

- [x] 4.1 `npm test` 全绿（计数不低于 865 基线）+ typecheck 0 错
- [x] 4.2 `npm run test:ui` 全绿
- [x] 4.3 `openspec validate refine-memory-view-active-default --strict` 通过
- [x] 4.4 归档（2026-11-15-refine-memory-view-active-default）+ 提交 00529f9/85e2aa5/6518ae8 + 推送 + npm 0.6.3 发版（registry npm-view 确认 + tarball 内容核验）
