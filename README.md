# Cairn

> 内部代号，未完成商标核查。Cairn（石堆路标）——徒步者沿路堆石给后来者指路；对应「跨设备、跨 Agent 留下可解释、可删除、可迁移的记忆标记」，而不是「又一个会记住你一切的云服务」。

**个人、多设备、多 Agent 的本地优先记忆主权层。**

**Local-first memory sovereignty for individuals across devices and agents.**

Your memory lives in a local SQLite file you own. Every device holds the authoritative copy, so search, add, correct, forget and export all work offline. The cloud is an optional encrypted relay, never a precondition. Models only ever propose candidates — scope, approval, provenance, revision, conflict and deletion are executed by deterministic code.

---

## 这个项目不是什么

同类项目里已经有好几个名字带 "cairn" 或 "dsh" 的记忆插件，先说清区别，免得装错：

| | Cairn（本项目） | DSH 专用记忆插件 |
|---|---|---|
| **适用范围** | **跨 Agent、跨设备**：WorkBuddy / CodeBuddy / Cursor / Copilot / ZCode / DSH 共用一个库 | 只服务 DSH 一个宿主 |
| **权威副本** | 本机 SQLite；换 Agent 不换记忆 | 通常绑定该宿主的运行时 |
| **DSH 插件角色** | **只是一个壳子**（`@carloswon/cairn-dsh-memory`），通过 MCP 调用内核 | 插件本身就是全部实现 |
| **没装 DSH 时** | 内核照常工作：CLI、MCP、其他宿主都能用 | 不可用 |
| **云端** | 可选加密中继，本地永远可用 | 视各自实现 |

一句话：**DSH 插件是 Cairn 的众多入口之一，不是 Cairn 本身。** 只装插件不装内核，召回的永远是空。

---

## 为什么需要它

每个 Agent 都在自己攒记忆：WorkBuddy 有一份、ZCode 有一份、DSH 又有一份。你换一台机器、换一个 Agent，记忆就断了；你无法解释某条记忆从哪来，也无法确认它真的被删掉。

Cairn 把记忆从「Agent 的私有财产」变成「你名下的资产」：

- **本地权威**：SQLite 是每台设备的权威副本；断网时新增、检索、更正、遗忘、导出全部可用。
- **云端可选**：仅作加密中继与备份，不参与日常读写，不是使用记忆的前提。
- **确定性治理**：模型只提出候选；作用域、审批、来源、修订、冲突与删除由代码执行并可审计。
- **不入侵**：标准记忆走 MCP，管理走 CLI，低能力 Agent 走受管 Markdown 投影；不逆向任何 Agent 的私有数据库。
- **诚实分级**：每个宿主接入都标注 `fixture-only` / `blocked`，不把「写了配置」当成「验证过」。

---

## 能力

### 记忆存储与检索

| 能力 | 说明 |
|---|---|
| 作用域 | 个人全局 / 设备限定 / 项目 / Agent 私有 / 受约束自定义 |
| 不可变修订链 | 每次修改追加修订，历史上任何一版都可查 |
| 中文检索 | FTS5 trigram + 两字中文有界 LIKE 回退；索引损坏自动降级，绝不返回全库 |
| 冲突队列 | 并发写入保留冲突而非覆盖，交由人决定 |
| 可审计删除 | tombstone 而非物理抹除，删除可追溯 |
| 备份恢复 | 一致性备份、版本化迁移（并发安全）、设备身份与克隆防护 |

### 治理

- **规范化计划**：`plan_hash` 绑定内容，审批绑定哈希，改一字即失效。
- **本地一次性审批**：`approval_id` 一次性有效，模型无法自行签发。
- **秘密与注入三层阻断**：敏感内容、提示注入、越权外泄在写入与检索两侧拦截。
- **幂等应用**：中断可续跑，并发冲突保留。

### 自动整理（首次初始化）

`cairn onboarding` 把历史快照整理成可用记忆：元数据发现（零正文读取）→ 不可变快照导入 → 分批判定 → 晋升或跳过。判定只影响「值不值得记」，不能改敏感度、不能扩作用域、不能当审批。

### 接口

| 入口 | 形态 |
|---|---|
| MCP server | stdio，14 个工具（10 记忆 + 4 整理），stdout 只含 JSON-RPC |
| CLI | 27 个入口：`add` / `search` / `show` / `update` / `forget` / `export` / `import` / `plan` / `approve` / `policy` / `onboarding` / `doctor` / `backup` / `restore` / `sync` / `device` / `worker` / `agent` / `discover` / `archive` / `review` / `vault` / `status` / `init` / `uninstall` / `apply` |
| 本地控制台 | `cairn ui`：回环 + 一次性令牌，工作台 / 双层建议 / AI 复核 / 静态导出 |
| 受管投影 | 写入宿主的 `AGENTS.md` 受管块，供不支持 MCP 的 Agent 读取 |

### 已接入宿主

| 宿主 | 配置写入 | MCP 分级 | 投影 |
|---|---|---|---|
| Claude Code | `mcp.json` | fixture-only | brief |
| Cursor | `mcp.json` | fixture-only | brief |
| Copilot | `mcp.json` | fixture-only | brief |
| WorkBuddy | 手工 `mcp.json` | blocked（Cairn 不代写） | brief |
| DSH | Cordis `cordis.patch.yml` | fixture-only | brief |
| OpenClaw | 无 | blocked | none |

DSH 额外提供**实时召回插件**：会话每步前按短查询召回，按预算注入，并在会话顶部显示三态面板（已注入 / 已过滤 / 未命中）与活动记录。

---

## 快速开始

```bash
npm install
npm run build          # Node.js 22.5+（已验证 Node 22.22.2 / 24.21.0，Windows x64 与 Linux/Ubuntu 22.04）
npm run cli -- doctor  # 健康检查（无模型、无云端即可用）

npm run cli -- add "项目的构建约定是 pnpm"
npm run cli -- search "构建约定"
npm run cli -- ui      # 本地控制台：回环 + 一次性令牌
```

### MCP 接入

```json
{
  "mcpServers": {
    "cairn": {
      "command": "node",
      "args": ["<path-to>/dist/src/interfaces/mcp/server.js"]
    }
  }
}
```

DSH 走 Cordis，不用 `mcp.json`：在 `cordis.patch.yml` 里用 `- insert:` 嵌套一条 `@deepseek-ai/dsh-mcp-client` 的 stdio 条目（见 `docs/M0-session-handoff.md` §9）。

### 自检与验收

```bash
npm run mcp:smoke      # MCP 接入自检：默认只读真实库
npm run test:e2e       # 合成 HOME 端到端：533 条同构 fixture，不碰真实库
npm run test:ui        # 浏览器点击级验收（需一次性 npm i --no-save playwright）
npm run test:real      # 真实 OBS 云同步往返（需五个 OBS_* 变量齐全，缺任一即 exit 2）
```

**Windows 提醒：不要直接运行或双击 `.ts` / `.js` 文件**（会弹出「选择打开方式」）。始终使用 `npm run cli --`、`cairn.cmd` 或 `npm link` 后的全局 `cairn`。

---

## 状态

仓库当前**没有活动变更**。九个 OpenSpec 能力规格全部通过严格校验（9/9）。

| 能力 | 说明 |
|---|---|
| `memory-store` | 存储、修订链、迁移、备份 |
| `scoped-retrieval` | 作用域与检索 |
| `memory-governance` | 计划、审批、幂等应用 |
| `memory-review` | 冲突与复核 |
| `agent-interfaces` | 宿主接入、投影、会话内面板 |
| `agent-onboarding` | 首次初始化 |
| `auto-onboarding` | 策略预授权的自动整理 |
| `cloud-sync` | OBS/ECS 加密同步 |
| `local-console` | 本地控制台 |

测试基线：`npm test` **不联网**，恒 668 项 / 667 通过 / 0 失败 / 1 显式 skip。真实云端往返单独用 `npm run test:real`。

### 已知边界

- 仅验证 Windows x64 与 Linux/Ubuntu 22.04；macOS 未验证。
- Claude Code / Cursor / Copilot 的宿主接入为 `fixture-only`，未在真实 CLI 认证下跑过。
- 云端需要自备 OBS + ECS；默认不安装任何同步 hook。
- 无本地模型依赖；不做抽取推理。

---

## 文档

| 文档 | 内容 |
|---|---|
| `docs/cairn-usage.md` | 十分钟上手 / 三层独立授权初始化 / MCP 接入 / 宿主配置 |
| `docs/cairn-security.md` | 信任模型 / 秘密与注入防线 / 备份恢复 / 卸载 / 故障排查 |
| `docs/cairn-sync.md` | OBS/ECS 双后端 / E2EE / 双设备验证 |
| `docs/cairn-console.md` | `cairn ui` 预览页与工作台 / 双层建议 / 导出明文风险 |
| `docs/cairn-auto-onboarding.md` | 策略字段 / 条件顺序 / 撤销路径 / `judgement` 权力边界 |
| `openspec/` | 流程事实源：proposal / specs / design / tasks 及验证记录 |

模块划分：`core / store / retrieval / governance / onboarding / interfaces / projection / agents / jobs`。CLI 与 MCP 共用同一应用服务，不各自实现记忆规则。

---

## 许可证

MIT。见 [LICENSE](./LICENSE)。