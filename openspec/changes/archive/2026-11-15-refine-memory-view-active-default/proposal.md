## Why

2026-11-15 保管模式双设备验证收尾时实测暴露：控制台记忆视图默认状态过滤是「全部状态」，38 条已归档记忆与 6 条生效记忆混在同一列表里，用户把「已归档仍在列表」误判为「同步失败」——活动集与审计集不分，日常使用的第一眼视图被审计内容淹没。

## What Changes

- **记忆视图默认「活动视图」**：未显式选择状态时，列表只呈现 `candidate / active / conflicted`（需要关注的记忆）；`archived / tombstoned / superseded` 是审计状态，退出默认视图但仍可一键选出。
- **状态下拉重排**：首两项为「活动视图（默认）」与「全部状态」，其后是个体状态项；「全部状态」写入 `status=all`，显式个体状态照旧写入对应值。
- **过滤由服务端执行**（既有纪律：MUST NOT 用前端过滤伪造结果集）：`/api/memories` 的 status 语义扩展——缺省/空值 → 活动集；`all` → 全部；逗号列表 → 精确匹配。静态导出页以内嵌模型做同一映射（零请求），两形态行为一致。
- **范围仅记忆视图**：概览计数、批注视图、详情抽屉、`cairn export` 命令语义均不变——概览的按状态计数仍是全库审计口径。
- 兼容：旧地址 `status=archived` 等显式值照旧精确回放；唯一有意变更的是「无 status 参数」从全部改为活动集、`status=`（空值）从全部改为活动集。

## Capabilities

### Modified Capabilities

- `local-console`：「查询与视图状态可恢复」增加默认活动视图要求与场景；既有场景全部保留。

## Impact

- 代码：`src/interfaces/console/server.ts`（/api/memories 的 status 语义）、`src/interfaces/console/assets/ui-js.ts`（状态下拉选项 + 静态页 localFilter 同一映射）、`src/interfaces/console/model.ts`（导出 `LIVE_VIEW_STATUSES` 常量，服务端与静态页同一出处）。
- 测试：server（缺省→活动集 / all→全部 / 列表→精确）、静态页过滤、e2e-ui 受影响断言修正。
- 文档：`docs/cairn-console.md` 补一段默认视图说明。
- 不变：API 无 status 参数的旧消费者（无）之外，`cairn export`、概览计数、批注视图、投影均不受影响。
