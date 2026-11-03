# Tasks: add-operation-audit

## 1. 准备与基准

- [x] 1.1 基准：现有 `npm test` 全绿基线记录（当前 667/666/0/1 量级，以实跑为准）；无审计时连续 1000 次 `service.search` 耗时基线（临时脚本，结果落 `artifacts/`，不入库）
- [x] 1.2 核对 `audit_event` 在真实库的现有类目分布（只读查询），确认 `operation` 类目名无冲突

## 2. store 层

- [x] 2.1 `AuditLog` 增加操作事件写入入口（复用 `record()`，detail 走白名单提取器）与过滤查询 `list({category?, action?, since?, limit?})`（limit 默认 50、上限 200，只读）
- [x] 2.2 幂等创建复合索引 `audit_category_at ON audit_event(category, at)`（迁移框架内 `IF NOT EXISTS`，schemaVersion 不变）
- [x] 2.3 保留期清理：`pruneOperations(retentionDays)` — 显式白名单 `['operation']`，返回删除行数；治理类目豁免有测试锁定
- [x] 2.4 配置解析：env `CAIRN_AUDIT_OPERATIONS`/`CAIRN_AUDIT_RETENTION_DAYS` → `CAIRN_HOME/config.json` `audit.{operations,retentionDays}` → 默认 true/30；非法值回落默认并 stderr 告警
- [x] 2.5 清理节流：openStore 后惰性触发，进程内每小时至多一次
- [x] 2.6 store 层测试：记录/过滤/清理/豁免/非法配置回落；清理行数断言

## 3. service 层

- [x] 3.1 实现注记：侦查发现写入操作已有 `memory` 类目审计且内部调用不经过 AppService.search——`operation` 只记读取，opKind 参数省去（更小更对）
- [x] 3.2 摘要提取器：每操作一个纯函数，只取返回值白名单字段（D3 表）；`audit.operations=false` 时整体短路
- [x] 3.3 FAIL-OPEN：审计写入 try/catch，失败仅 stderr；单测模拟审计表只读，断言检索结果不受影响且 stdout 无污染
- [x] 3.4 service 层测试：留痕字段断言、`opKind=system` 不留痕、敏感记忆正文与查询原文在审计行零出现、开关生效
- [x] 3.5 写放大基准：1000 次 search 含审计 vs 基线，退化 <5% 通过；结果落 `artifacts/`

## 4. MCP 与 CLI

- [x] 4.1 MCP 工具 `memory_audit`：注册 + dispatch case（入参 `{category?, action?, since?, limit?}`，出参 `{items, truncated}`，只读）
- [x] 4.2 MCP 测试：过滤、limit 上限、`npm run mcp:smoke` 通过（stdout 纯净）
- [x] 4.3 CLI `cairn audit list`：`--category/--action/--since/--limit/--json`，只读
- [x] 4.4 CLI 测试：表格与 json 输出、参数校验（复用 VALUE_FLAGS 既有约定）

## 5. DSH 插件（延后：面板已有独立「落盘」开关且可用；审计史已可经 `memory_audit`/`cairn audit list` 查询，面板接入等用户提出再做——ponytail: 不做没人要的重复入口）

- [ ] 5.1

- [ ] 5.1 host：持久历史拉取（`memory_audit`，tab 激活或 60s 节流），合并进 usage payload（`history` 数组，audit 条目 kind 映射 `'tool'`）
- [ ] （延后）5.2 client：活动区合并展示（ring + audit 按时间倒序、次级排序键防跳动）、「含历史」开关并入既有筛选器并持久化
- [ ] （延后）5.3 降级：`memory_audit` 不可用时只显实时环并提示升级；无 crash（normalize 兜底）
- [ ] （延后）5.4 插件测试：合并去重排序、降级路径、筛选器状态持久化（42/42 基线不回归）

## 6. 验收与文档

- [x] 6.1 全量回归：`npm test`（0 fail）+ 插件单测 + `npm run test:e2e`（基线数字不回退）
- [x] 6.2 真实库只读验证：真实库上 `cairn audit list` 与 MCP 冒烟（不写真实库）
- [x] 6.3 文档：`docs/cairn-usage.md` 增 `cairn audit list` 用法与配置键；`docs/cairn-security.md` 增「操作审计只存摘要」一节
- [x] 6.4 `openspec validate --strict` 通过；4/4 制品状态齐备
