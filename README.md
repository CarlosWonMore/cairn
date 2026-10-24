# Cairn

> 内部代号，未完成商标核查。Cairn（石堆路标）——徒步者沿路堆石给后来者指路；对应"跨设备、跨 Agent 留下可解释、可删除、可迁移的记忆标记"，而不是"又一个会记住你一切的云服务"。

个人、多设备、多 Agent 的**本地优先记忆主权层**。

- 本地 SQLite 是每台设备的权威副本，断网时新增、检索、更正、遗忘、导出全部可用；
- 云端只是后续可选的加密中继与备份，不是使用记忆的前提；
- 标准记忆走 MCP，管理走 CLI，低能力 Agent 走受管 Markdown 投影；不逆向任何 Agent 的私有数据库；
- 模型只提出候选；作用域、审批、来源、修订、冲突与删除由确定性代码执行；
- 同步、抽取、嵌入与维护全部退出 Agent 会话关键路径，任何后台失败只留下可重试状态。

## 状态

当前处于首个 OpenSpec 变更 `add-local-first-memory-mvp` 的实现阶段（本地 MVP，无模型、无云端、单机）。

- 设计契约：`docs/AI-Memory-development-plan.md`（完整方案快照）与 `docs/AI Memory 系统构想.md`（原始构想）。
- 流程事实源：`openspec/`（proposal / 5 份 specs / design / tasks）。
- M0 原型证据与审计：`artifacts/m0/`（本地证据，不入库）。

## 开发

```bash
npm install
npm run build && npm test   # Node.js 22.5+（当前验证环境 Node 24）
```

模块划分（design D1）：`core / store / retrieval / governance / onboarding / interfaces / projection / agents / jobs`。CLI 与 MCP 共用同一应用服务，不各自实现记忆规则。

## 许可证

MIT。见 [LICENSE](./LICENSE)。
