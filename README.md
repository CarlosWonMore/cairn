# Cairn

> 内部代号，未完成商标核查。Cairn（石堆路标）——徒步者沿路堆石给后来者指路；对应"跨设备、跨 Agent 留下可解释、可删除、可迁移的记忆标记"，而不是"又一个会记住你一切的云服务"。

个人、多设备、多 Agent 的**本地优先记忆主权层**。

- 本地 SQLite 是每台设备的权威副本，断网时新增、检索、更正、遗忘、导出全部可用；
- 云端只是后续可选的加密中继与备份，不是使用记忆的前提；
- 标准记忆走 MCP，管理走 CLI，低能力 Agent 走受管 Markdown 投影；不逆向任何 Agent 的私有数据库；
- 模型只提出候选；作用域、审批、来源、修订、冲突与删除由确定性代码执行；
- 同步、抽取、嵌入与维护全部退出 Agent 会话关键路径，任何后台失败只留下可重试状态。

## 状态

**本地 MVP 已实现并归档（`add-local-first-memory-mvp`，规格见 `openspec/specs/`）；云同步变更 `add-real-cloud-sync` 已实现、经三轮外部独立验证 + 第四轮归档门禁并**已归档**（2026-10-25，规格见 `openspec/specs/cloud-sync/`；真实环境：华为云 OBS + 阿里云 ECS）。全量测试 390 项 / 389 通过 / 0 失败 / 1 显式 skip（第五轮宿主接入复核，见 `docs/verify-host-mcp-2026-10-28.md`）。**无模型依赖；云端为可选加密中继。

> 测试基线说明：`npm test` 默认**不联网**。唯一涉及真实云端的用例需要显式 `CAIRN_TEST_REAL_OBS=1`，未设置时显式 skip（因此本地与 CI 恒为 389 通过 / 1 skip，不因机器上是否有凭据而变化）。要跑该项用 `npm run test:real`：要求 `OBS_ENDPOINT/OBS_BUCKET/OBS_PREFIX/OBS_ACCESS_KEY_ID/OBS_SECRET_ACCESS_KEY` 齐全，缺任一即 exit 2 并明确报错，不会静默跳过（design D6：不虚报真实验证）。

- 设计契约：`docs/AI-Memory-development-plan.md`（完整方案快照）与 `docs/AI Memory 系统构想.md`（原始构想）。
- 流程事实源：`openspec/`（proposal / 5 份 specs / design / tasks 及实现验证记录）。
- 使用文档：`docs/cairn-usage.md`（十分钟上手 / 三层独立授权初始化 / MCP 接入 / 宿主配置）；云同步：`docs/cairn-sync.md`（OBS/ECS 双后端 / E2EE / 双设备验证）。
- 安全与运维：`docs/cairn-security.md`（信任模型 / 秘密与注入防线 / 备份恢复 / 卸载 / 故障排查）。
- M0 原型证据与审计：`artifacts/m0/`（本地证据，不入库）。

## 快速开始

```bash
npm install
npm run build          # Node.js 22.5+（已验证 Node 22.22.2 / Windows x64 与 Linux/Ubuntu 22.04）
npm run cli -- doctor  # 健康检查（无模型、无云端核心可用）
npm run cli -- add "项目的构建约定是 pnpm"
npm run cli -- search "构建约定"
npm run mcp:smoke      # MCP 接入自检：默认只读真实库（--write --home <临时目录> 才写入）
```

**Windows 提醒：不要直接运行/双击 `.ts` 或 `.js` 文件**（会弹出"选择打开方式"）。始终使用 `npm run cli --`、`cairn.cmd`（仓库根目录启动器）或 `npm link` 后的全局 `cairn` 命令。详见 `docs/cairn-usage.md` 第 1 节。

模块划分（design D1）：`core / store / retrieval / governance / onboarding / interfaces / projection / agents / jobs`。CLI 与 MCP 共用同一应用服务，不各自实现记忆规则。

## 许可证

MIT。见 [LICENSE](./LICENSE)。
