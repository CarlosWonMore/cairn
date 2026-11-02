# Changelog

本文件记录 `@carloswon/cairn-memory` 的显著变更。格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## [0.2.0] - 2026-11-02

DSH 实时记忆插件、`lesson` 类型、投影简报、跳过账本与宿主适配器。九个 OpenSpec 能力规格全部通过严格校验。

### Added

- **`lesson` 记忆类型**：表达「曾经判断错了」的纠正性认知，区别于 `fact`（事实）与 `procedure`（做法）。迁移 004 重建 `memory.kind` CHECK 约束并重建全部索引与 FTS 触发器。
- **受管投影简报**：把作用域过滤后的记忆摘要写入宿主的 `AGENTS.md` 受管块。按宿主分级预算——DSH / Claude Code / Cursor / Copilot 各 2 KB，WorkBuddy 8 KB，OpenClaw 不支持。超预算时按 confidence、updated_at、id 裁剪，并在块内写明未显示条数。
- **跳过账本**：`onboarding` 跳过的条目变成持久、可查询的事实（`markItemSkipped` / `listSkippedItems`），不再从待办队列里消失得无影无踪。
- **DSH 宿主适配器**：`cairn agent apply --host dsh` 走 Cordis patch，不写 `mcp.json`。
- **DSH 实时召回插件**：会话每步前按短查询召回、按预算注入、同会话去重。附会话内面板：按会话切片的注入记录、活动日志（所有经 Cairn 的操作留痕）、三态指示（已注入 / 已过滤 / 未命中），栏宽可拖拽并持久化。

### Changed

- 需求「记忆调用对用户可见」收紧到 500 字符以内，场景集合与约束强度不变。
- 投影摘要统一走同一份 `firstLine`（此前注入文本与面板各写一份，导致 frontmatter 记忆显示成 `---`）。

### Fixed

- 插件导出形状：Cordis 把函数导出当作 `apply` 调用并把 ctx 传成第一个参数，导致连续三轮 `cannot get property ... without inject`。改为模块级 `{ name, inject, apply }`。
- 工具调用入口：`ctx.tools.call` 不存在。真实入口是 `tools.get(name, scope)` → `definition.execute(args, exec)`。
- 去重早退覆盖真实状态：`pre-step` 每步都跑召回，去重后早退分支仍写 `lastUsage`，把上一步结果清空，面板因此恒显示「未命中」。
- 注入判定不再靠文本反推：`renderInjection` 直接返回 `includedIds`，避免截断长度不一致导致的假阴性。
- 召回被虚词带偏：`deriveQueries` 取词频最高的二字词，中文里几乎总是「是否 / 一个 / 这个」，会命中互不相干的记忆。新增虚词黑名单与相关性计分。
- 活动记录无独立滚动条：宿主在会话进行中把视图区设为 `min-height: auto`，面板 `overflow: auto` 不触发。

### Tests

- 根套件 668 项 / 667 通过 / 0 失败 / 1 显式 skip。
- DSH 插件 79 项全通过。
- `npm pack` 后安装到临时目录，`cairn doctor` 返回 `ok: true`。
## [0.1.0] - 2026-10-25

首个本地 MVP（OpenSpec 变更 `add-local-first-memory-mvp`）。

### Added

- 本地 SQLite 权威库：作用域（个人/设备/项目/Agent 私有/受约束自定义）、不可变修订链、证据与关系、冲突队列、可审计 tombstone、版本化迁移（并发安全）、一致性备份恢复、设备身份与克隆防护。
- 中文检索：FTS5 trigram + 两字中文有界 LIKE 回退；索引损坏自动降级，绝不返回全库。
- 治理：规范化计划（plan_hash 绑定）、本地一次性审批、幂等应用与续跑、并发冲突保留、秘密与提示注入三层阻断。
- 首次初始化：元数据发现（零正文读取）、不可变快照导入（imported_unverified + local_only）、分批整理与晋升游标。
- 接口：CLI（`cairn`）与 MCP stdio（`cairn-mcp`，8 个 memory 工具 + 4 个按需 onboarding 工具）；stdout 只含协议消息。
- 宿主配置：Claude Code / Cursor / Copilot / OpenClaw / WorkBuddy 的 plan→apply→doctor→uninstall，诚实分级 fixture-only/blocked。
- 后台任务：本地 outbox + `cairn worker run-once`；local_only/设备限定内容在任务生成前物理排除；默认不安装任何 hook。

### 边界（未实现，另立变更）

- 真实 ECS/OBS 云同步（outbox 仅为本地任务边界，`remote=not_configured`）。
- macOS/Linux 平台验证（当前仅 Windows x64 + Node 22/24）。
- 真实宿主 CLI 认证与本地模型抽取。
