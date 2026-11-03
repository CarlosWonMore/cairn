# Design: add-operation-audit

## D1 表与索引：复用 audit_event，零迁移

`audit_event`（id/at/category/action/subject_type/subject_id/detail）完全容纳操作事件，**不加新表、不动 schemaVersion**。新类目 `operation`。现有 `audit_at` 索引已覆盖按时间查询；补一个类目复合索引 `CREATE INDEX IF NOT EXISTS audit_category_at ON audit_event(category, at)`，放在既有迁移框架里以幂等语句执行（对旧库无害，schemaVersion 不变时由 open 路径的惰性 ensure 保证存在）。

## D2 写入点：service 公共入口层，不逐工具埋点

埋点放 **service 层公共入口**（`search`/`addMemory`/`updateMemory`/`forget`/判断与治理入口），而不是 MCP dispatch——这样 CLI、MCP、未来宿主全部自动留痕，与「凡是经 Cairn 的操作」的意图一致。

- service 入口增加可选调用方语境 `opKind: 'user' | 'system'`（默认 `'user'`）。**系统内部调用显式传 `'system'` 不留痕**：查重（`findDuplicate`）、onboarding 计划生成、投影生成等内部检索不是用户操作，留痕只会刷屏。
- 每次调用写一条 `operation` 事件：action = 操作名；detail = 摘要提取器的输出（每操作一个纯函数，见 D3）。
- 写入与业务结果在同一调用内顺序执行但**异常隔离**：审计 INSERT 包 try/catch，失败仅 `console.error`（stderr），绝不向调用方抛出（规格「失败不阻断」）。

## D3 摘要提取器：每操作一个纯函数，白名单字段

| 操作 | detail 字段 |
|---|---|
| search | `candidates`（命中条数）、`matchedBy`、`degraded`、`ms` |
| get | `found` |
| add | `memoryId`、`action`（written/merged/skipped）、`kind` |
| update | `memoryId`、`revision` |
| forget | `memoryId` |
| 治理判断类 | 沿用既有治理审计，不在本能力重复记录 |

提取器只从**返回值**取白名单字段，绝不接触入参文本与记忆正文——「摘要纪律」由构造方式保证，不靠事后过滤。

## D4 配置与保留期

配置解析顺序（既有约定优先）：env `CAIRN_AUDIT_OPERATIONS` / `CAIRN_AUDIT_RETENTION_DAYS` → `CAIRN_HOME/config.json`（新文件，字段 `audit.operations`、`audit.retentionDays`）→ 默认（`true` / `30`）。非法值（负数、非数值）一律回落默认并告警，不抛错。

清理实现：单条 SQL `DELETE FROM audit_event WHERE category IN ('operation') AND at < :cutoff`——**可清理类目是显式白名单 `['operation']`**，未来新类目默认豁免（安全默认）。执行时机：openStore 完成后惰性触发，进程内至多每小时一次；每次清理删除行数写入维护日志（stderr 或 `operation` 自记录，不写正文）。治理类目从机制上不可能被清理（不在白名单）。

## D5 查询入口

- **MCP 工具 `memory_audit`**（只读）：入参 `{ category?, action?, since?, limit? }`，limit 默认 50、上限 200；出参 `{ items: [{ at, category, action, subjectType, subjectId, detail }], truncated }`。工具面清单与 dispatch 各加一项；**不提供任何写入口**。
- **CLI `cairn audit list`**：同参数，表格输出 + `--json`。复用 store 的 `AuditLog.recent` 扩展版（加过滤参数）。

## D6 DSH 插件消费：两层合并

- 实时环（现状，120 条内存）继续承担会话内低延迟展示；`tools/post-execute` 环节不变。
- 新增持久层加载：tab 激活或每 60s 通过 `tools.call('mcp__cairn__memory_audit', { category:'operation', limit:120 })` 拉取，条目 kind 统一映射为 `'tool'`（审计里天然含插件自身召回产生的 memory_search 调用；插件的注入计数仍以实时环为准，两视角并存）。
- 合并展示：ring 条目与 audit 条目按时间倒序混排，ring 内自增序号 + audit 内 `at` 作次级排序键，避免时钟抖动导致跳动。筛选器沿用（类型/程度/条数），新增「含历史」开关（关闭则只看会话内环）。
- 面板升级路径：`memory_audit` 不可用（旧版核心）时诚实降级——只显示实时环并提示「持久历史需升级 Cairn 核心」。

## D7 与既有约束的对齐

- **stdout 纪律**：审计失败只进 stderr；`memory_audit` 是标准 JSON-RPC 返回，不走日志通道。
- **会话关键路径**：清理与审计写入均为本地微秒级操作且异常隔离；清理节流（每小时至多一次）避免后台扰动。
- **秘密纪律**：D3 构造式白名单 + 回归测试断言（敏感记忆正文与查询原文不出现在任何审计行）。
- **治理审计不变**：`record()` 既有签名与治理类目语义零改动；开关与保留期只作用于 `operation`。

## D8 测试矩阵

| 层 | 用例 |
|---|---|
| store | operation 记录/读取/过滤；清理删过期且豁免治理；非法配置回落 |
| service | search/add 留痕；opKind=system 不留痕；fail-open（审计表只读时业务照常）；敏感正文与查询原文零出现 |
| MCP | memory_audit 过滤与 limit 上限；无写入口（工具面快照断言） |
| CLI | audit list 表格与 --json |
| 插件（DSH） | audit 历史拉取合并、降级路径、筛选器含历史开关 |
| 性能 | 1000 次连续 search 的审计写放大基准（相对无审计 <5% 退化即通过） |
