# Changelog

本文件记录 `@cairn/memory` 的显著变更。格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

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
