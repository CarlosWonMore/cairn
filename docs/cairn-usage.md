# Cairn 使用文档（CLI / MCP / 审批流程）

本文档描述 Cairn 当前 MVP 的真实命令、真实输出与真实边界。所有命令与 flag 均与 `src/interfaces/cli/main.ts` 的 HELP 文本核对一致；MCP 工具名与 `src/interfaces/mcp/server.ts` 一致。

诚实边界，先读这一段：

- 本版本是**本地单设备权威库**：本地 SQLite 是唯一权威副本。云端同步接口已冻结但未实现（`doctor` 恒报 `remote=not_configured`），MVP 不接任何云端。
- 无模型、无网络时，本地核心功能（增删改查、检索、导出、备份、审批）全部可用；检索不依赖模型嵌入。
- 宿主配置写入未对真实宿主 CLI 复跑验证，能力分级一律为 `fixture-only` 或 `blocked`（见第 5 节），不代表已通过真实宿主认证。

---

## 1. 十分钟上手

前置：Node.js ≥ 22.5.0（`package.json` 的 `engines` 要求）。

```bash
# 在项目根目录
npm install
npm run build          # 产出 dist/
```

**先说一个 Windows 上的重要提醒：不要直接"运行/双击"任何 `.ts` 或 `.js` 文件**（包括 `dist/src/interfaces/cli/main.js`）。它们是代码文件，不是可执行程序——直接运行它们，Windows 会按文件关联弹出"选择打开方式"对话框。Cairn 的正确运行方式永远是下面几种之一（内部都由 Node 执行）：

```bash
npm run cli -- help          # 方式一（推荐）：npm 脚本入口，参数跟在 -- 之后
cairn.cmd help               # 方式二：仓库根目录的 Windows 启动器（先 npm run build）
./cairn.sh help              # 方式三：Git Bash / POSIX 启动器
npm link                     # 方式四：登记全局命令后，任意终端直接 `cairn <command>`（npm 会在 prefix 下生成 cairn.cmd）
```

MCP 服务器入口同理：`npm run mcp`（stdio，供 Agent 配置使用）、`cairn-mcp.cmd`，或构建后 `node dist/src/interfaces/mcp/server.js`（在 Agent 配置里由 node 显式调用，不存在双击问题）。

> **不要直接 `npx cairn`**：npm 注册表上 `cairn` 是别人的包，会误装误运行。`npm link` 之后全局 `cairn` 指向本仓库构建产物，才是安全的全局命令。

> 下文示例统一简写为 `cairn <command>`，它是上述任一形式的代称（例如 `cairn add "…"` 即 `node dist/src/interfaces/cli/main.js add "…"`）。CLI 没有 `--version` 命令，`cairn help` 查看全部命令。默认数据目录为 `~/.cairn`，可用全局选项 `--home <dir>` 或环境变量 `CAIRN_HOME` 改变。第 1 节与第 3 节给出完整可复制形式，其余章节使用简写。

### 1.1 初始化

```bash
npx tsx src/interfaces/cli/main.ts init --json
```

真实输出形态：

```json
{
  "initialized": true,
  "home": "C:/Users/<you>/.cairn",
  "device": "dev_01a16fa9-8dee-7e03-97d6-d92a53d89a8f",
  "schemaVersion": 2,
  "problems": []
}
```

```
[cairn] 数据目录就绪。下一步：cairn add "..." 或 cairn discover 查看可导入来源。
```

（JSON 结果走 stdout，`[cairn]` 诊断走 stderr。数据目录结构：`<home>/data/cairn.db`、`<home>/data/device.json`、`<home>/snapshots/`、`<home>/backups/`。）

### 1.2 新增一条显式记忆

```bash
npx tsx src/interfaces/cli/main.ts add "提交信息偏好使用 Conventional Commits 格式" --kind preference --json
```

```json
{
  "id": "01a16fa9-961b-72eb-8897-d10cbe8b04ab",
  "status": "active",
  "authority": "user_explicit",
  "kind": "preference",
  "scopeId": "01a16fa9-961b-7fe3-9f63-f48c3fa9461e"
}
```

CLI 写入的记忆 `authority` 恒为 `user_explicit`（用户明确内容）。默认作用域 `personal-global`。

### 1.3 检索

```bash
npx tsx src/interfaces/cli/main.ts search "提交"
```

```
[cairn] matchedBy=like 共 1 条
- [01a16fa9] (active,user_explicit) 提交信息偏好使用 Conventional Commits 格式
```

- `matchedBy=fts` 表示命中 FTS5 trigram 索引；`matchedBy=like` 表示走了有界回退（两字中文短查询、索引降级时都会出现，属正常行为，不是故障）。
- 括号内标签依次为：状态、权威级别，可能附加 `imported_unverified`、`expired`、`conflict:<id前缀>`。
- `--json` 输出完整结构（含 `matchedBy`、`degraded`、逐条 `memory` 记录）。

### 1.4 健康检查

```bash
npx tsx src/interfaces/cli/main.ts doctor --json
```

关键字段：`ok`（problems 为空即 true）、`db.integrity`、`fts.ok`、`device.cloned`、`counts`（记忆各状态计数、导入档案数、计划数、outbox 任务数、未解决冲突数）。`remote` 与 `model` 恒为 `not_configured`——这是本版本的诚实声明，不是缺陷：核心功能不依赖二者。

十分钟到此结束。需要从既有 Agent 记忆文件导入历史内容时，继续读第 3 节。

---

## 2. 显式记忆生命周期

CLI 是**user 通道**（数据主权者身份）；MCP 是**agent 通道**（受作用域约束）。本节命令全部属于 user 通道。

### 2.1 add — 新增

```bash
cairn add "内容" [--kind fact] [--scope personal-global] [--project <id>] [--sensitive]
```

| flag | 说明 |
| --- | --- |
| `--kind` | `instruction` / `preference` / `fact` / `decision` / `episode` / `procedure` / `environment`，默认 `fact` |
| `--scope` | 作用域预设，见下表，默认 `personal-global` |
| `--project <id>` | `project-global` / `project-device` 必填（配合 `--scope`） |
| `--project-name <名称>` | 项目展示名（可选，缺省用 id） |
| `--agent <id>` | `agent-private` 必填 |
| `--scope-id <id>` | 直接引用既有作用域（与 `--scope` 二选一） |
| `--sensitive` | 标记敏感。**必须**搭配 `local_only` 类作用域（`device-local` / `project-device` / 自定义 local_only），否则拒绝（退出码 2） |
| `--expires <ISO时间>` | 过期时间 |
| `--ttl-days <N>` | 作用域 TTL（构造作用域时使用） |

作用域预设语义：

| preset | 绑定要求 | syncPolicy | 含义 |
| --- | --- | --- | --- |
| `personal-global` | 无 | `encrypted`（预留） | 个人全设备、全 Agent 共享 |
| `project-global` | `--project` | `encrypted`（预留） | 项目级共享 |
| `device-local` | 无（自动绑定当前设备） | `local_only` | 只属于本设备，永不上行 |
| `project-device` | `--project` | `local_only` | 项目 × 本设备，永不上行 |
| `agent-private` | `--agent` | `local_only` | 单 Agent 私有，读取白名单限该 Agent |
| `session-ephemeral` | 无（默认 7 天 TTL） | `local_only` | 会话级临时记忆 |

`local_only` 与设备限定内容在**任务生成前被物理排除**于上行之外（数据库触发器兜底），详见安全文档第 2 节。

### 2.2 search — 检索

```bash
cairn search "关键词" [--status active] [--scope-id <id>] [--project <id>] [--include-expired] [--limit N]
```

- 默认只返回 `active`；`--status` 可显式指定 `candidate` / `conflicted` 等。`--limit` 默认 20、上限 100。
- 结果按调用方身份（设备 + Agent + 项目）逐行过滤；`agent-private` 作用域只对白名单内 Agent 可见。CLI 默认身份是 `cli`，可用 `--agent-id <id>` 改变。
- `--include-expired` 才会返回已过期条目（并带 `expired` 标签）。

### 2.3 show — 详情

```bash
cairn show <id> --json
```

返回记忆本体、全部修订（含历史正文与作者）、证据、关系（supersedes/contradicts/related_to）、未解决冲突、tombstone、作用域完整策略。

### 2.4 update — 用户更正（新修订，历史保留）

```bash
cairn update <id> "新内容" [--reason "..."] [--expected-revision <当前修订id>]
```

不无痕覆盖：产生新修订，旧修订与更正理由保留。`--expected-revision` 提供乐观并发控制：若当前修订已推进，返回 `E_TARGET_CHANGED`（退出码 4）。

### 2.5 forget — 遗忘（可审计 tombstone）

```bash
cairn forget <id> [--reason "..."]
```

记忆进入 `tombstoned`：不再出现在活动检索与投影中，但删除证据（谁、何时、理由）保留在库内可审计。这是一个**可审计的删除**，不是物理擦除；如需物理移除，见安全文档第 7 节（卸载与数据目录删除）。

### 2.6 archive — 归档

```bash
cairn archive <id>
```

归档内容默认不参与检索与投影；`export --include-archives` 可包含。

### 2.6a promote / reject — 候选的批准与拒绝

候选（`status=candidate`）是模型推断或未验证导入的产物，**必须由用户显式动作**才能变成活动记忆。

```bash
cairn promote <id> [--scope-preset device-local] [--scope-project <id>]
cairn reject <id> "<理由>"
```

- **`promote` 的语义**：晋升后权威记为 `user_confirmed`——用户**审阅并批准**了模型推断的内容，既不是「用户亲口说的」（`user_explicit`），也不是「模型推断」（`agent_inferred`）。这条区分有实际价值：将来能分辨「用户原话」与「用户认可的整理结果」。
- **批准凭据 = 本地 CLI 进程本身**，通道记为 `cli`，审计事件 `promoted_candidate` 可查。**不能被远端或 Agent 代签**。
- **`--scope-preset` 可一并迁移作用域**。这是修正作用域的唯一时机：候选尚未生效，而记忆的 `scope_id` 一旦 active 就不再变（`reviseMemory` 只改正文）。带本机绝对路径的内容应落 `device-local`。
  - 迁移与晋升**在同一事务内**完成，且会**按新作用域重建 outbox**——旧作用域的待同步任务若照发，会把记忆同步到错误的云端空间。
- **`reject` 转墓碑**（`tombstoned`），不是物理删除：内容退出活动检索与投影，理由与动作留审计。恢复需显式重做。

### 2.6b importance — 重要度（与可信度正交）

每条记忆可带一个 1–5 的**重要度**，回答「**值不值得占用注入预算**」。

| 字段 | 回答什么 | 取值 |
|---|---|---|
| `confidence` | 内容**可不可信**（谁说的、有没有被确认） | 0–1 |
| `importance` | 内容**重不重要**（值不值得占名额） | 1–5，NULL = 未判断（按 3 处理） |

**两者不可互相推导。** 一条用户亲口说、可信度拉满的记忆完全可以不重要；一条内容很重要的记忆，来源仍是模型推断时可信度不变。

- **写入时表达**：`memory_add` / `memory_propose` 接受 `importance`；缺省 3（= 没判断，与显式传 3 行为一致）。
- **推断来源上限 3**：`agent_inferred` / `imported_unverified` 来源不得自封 4/5 星——否则模型会倾向于认为「我刚写的很重要」，把注入预算挤爆。越界的值会被**钳制**（不是拒绝）。
- **越界报错，不静默截断**：传 0 / 6 / 3.5 一律 `E_VALIDATION`。

### 2.6c 使用信号：`last_used_at` 与 `usage_count`

两个信号语义**刻意不同**：

| 信号 | 回答 | 何时写 |
|---|---|---|
| `last_used_at` | 最近**被看到**过吗 | 自动注入 + 显式检索都写 |
| `usage_count` | **被主动要过**几次 | **只有显式检索**才加一 |

**原因**：宿主插件每轮都注入（2026-11-02 实测一个会话 202 次注入、去重后仅 6 种内容、97% 重复）。若注入也计次数，「注入频率」会取代「真实需求」决定排序，形成「被注入过 → 更容易被注入」的正反馈死锁。

插件在召回时必须传 `increment_usage: false`；显式检索缺省 `true`。

### 2.6d 投影排序与三条地板

投影预算约 1422 字节（2 KB 减去路由文案与受管标记）。42 条 active 平均 818 字符时**只装得下 6 条**，所以「谁进」比「装多少」更要紧。

```
最终分 = 有效重要度 × 衰减系数，且带地板
有效重要度 = importance（NULL 视为 3）
衰减系数  = 按 (now - COALESCE(last_used_at, created_at)) 天数分桶：
             <1d 1.0 / <2d 0.9 / <4d 0.8 / <7d 0.65 / <15d 0.5
             / <30d 0.35 / <60d 0.25 / <180d 0.15 / ≥180d 0.08
排序      = lesson 优先 → 最终分 DESC → updated_at DESC → id ASC
```

**三条地板**（缺一不可）：

1. **`importance >= 4` 豁免衰减** —— 高重要度的老记忆不沉底。
2. **本轮相关度 >= 0.85 × 最高分 豁免衰减** —— 此刻正好最相关的不因年龄吃亏。
3. **绝对地板 0.5** —— 任何记忆至少保留 50% 基线分。

第 3 条不是装饰：纯衰减会让少数「明星记忆」被反复注入，其余变成**存在于库中但不可见**的僵尸，反而加剧膨胀。地板 0.5 的效果是「5 星老记忆仍高于 3 星新记忆」。

### 2.6e 归档长期无用记忆

```bash
cairn doctor --archive-stale [--apply] [--stale-days 180]
```

- **判据**：`importance = 1` **且** `COALESCE(last_used_at, created_at)` 超过阈值（默认 180 天）。
- **默认演练**（dry-run）：只报告将归档哪些，加 `--apply` 才写库。
- **`importance` 为 NULL 不参与**——「没判断」不等于「不重要」。
- **只归档不删除**：`archived` 的既有语义就是「不活跃但仍保留」，可用 `export --include-archives` 包含。
- 每条归档写审计 `archived_stale`，detail 含理由、重要度、判定所用的时间与阈值。
- **不挂在写入/检索路径上**：自动归档会让「我写的东西怎么不见了」变成无法解释的现象。

### 2.7 export — 导出（可迁移）

```bash
cairn export [--format json|markdown] [--out FILE] [--scope-id <id>] [--project <id>] [--include-archives]
```

- `--format markdown` 生成 `cairn-export v1` 的人类可读文档（含来源、权威级别、修订历史）。
- `--out FILE` 写文件；不带 `--out` 时输出到 stdout。
- 导出走与检索、投影、上行任务相同的 `scopeAllowsUpstream` / `scopeAllowsRead` 判定入口：`local_only` 作用域的内容会被导出（本地文件是权威库的一部分，导出是本地行为），但**永远不会**进入上行任务。作用域之后收窄不会撤回此前已经写出的导出文件——导出文件在 Cairn 管辖之外，请自行保管。

---

## 3. 首次初始化：三层独立授权的完整流程

Cairn 把「记忆导入」「MCP 接入」「原生记忆修改」设计为**三个互相独立的授权动作**，任何一步都可以单独停止，不存在一次性捆绑授权。默认终点是「导入档案可用」，不会自动进入原生记忆接管。

```
第 1 层：discover + import      （你授权读取哪些文件）
第 2 层：onboarding → plan → approve → apply   （你批准哪些候选晋升为活动记忆）
第 3 层：agent plan → agent apply   （你批准写入哪些宿主配置文件）
```

### 3.1 第 1 层 · discover：元数据发现（零正文）

```bash
npx tsx src/interfaces/cli/main.ts discover --home-dir <你的HOME目录> [--project-root <项目根>]
```

真实输出形态：

```json
[
  {
    "agentKind": "claude-code",
    "sourceKind": "memory",
    "path": "C:\\Users\\<you>\\.claude\\projects\\demo-proj\\memory\\MEMORY.md",
    "parser": "markdown-memory-index",
    "capabilityNote": "Claude Code 项目记忆索引（公开路径 ~/.claude/projects/*/memory/MEMORY.md）；正文仅在用户显式勾选后由快照层读取",
    "byteSize": 74,
    "fileCount": 1
  }
]
```

```
[cairn] 发现 N 个来源（仅元数据，未读取任何正文）。
```

硬边界：只 `lstat` / `readdir`，正文读取计数为零；符号链接只判定不跟随；候选来源仅来自公开文档化的固定白名单路径；不递归扫全盘、不访问网络盘（UNC 直接拒绝）；单文件默认上限 10 MiB、总数上限 500。识别范围：Claude Code 项目记忆目录、Cursor `.cursor/rules/*.mdc`、Copilot `.github/copilot-instructions.md` 与 `instructions/*.instructions.md`、`AGENTS.md`、OpenClaw `USER.md`/`MEMORY.md`/`memory/*.md`、WorkBuddy 手动导出文件。

### 3.2 第 1 层 · import：不可变快照导入

```bash
npx tsx src/interfaces/cli/main.ts import <文件...> --agent-kind claude-code --json
```

真实输出形态：

```json
{
  "imported": [
    {
      "source": "C:/Users/<you>/.claude/projects/demo-proj/memory/MEMORY.md",
      "archiveId": "01a16fa9-df1f-7b21-9e09-55c1ad5c9246",
      "reusedArchiveId": null,
      "batchId": "01a16fa9-df1d-7097-b004-a103872ef7bd",
      "created": true,
      "itemCount": 2,
      "skippedItems": 0,
      "sourceHashBefore": "44a9f50a…",
      "sourceHashAfter": "44a9f50a…"
    }
  ],
  "batchId": "01a16fa9-df1d-7097-b004-a103872ef7bd"
}
```

```
[cairn] 已建立本地档案（imported_unverified + local_only，不上行）。后续: cairn onboarding next --batch <batchId>
```

关键语义：

- 导入件经内容哈希快照后保存为**不可变快照**（`<home>/snapshots/`），源文件哈希前后一致（`sourceHashBefore == sourceHashAfter`），源文件不被修改。
- 导入条目默认 `authority=imported_unverified`、`sync_policy=local_only`：可本地检索、可导出，但不进入公共投影、不自动上行、不直接成为高权威指令。
- 重复导入哈希未变化的同一来源会复用已有档案（`reusedArchiveId` 非空），不产生重复记忆或重复任务。
- 含 Cairn 受管投影标记的文件会被拒绝（`E_PROJECTION_LOOP`），防止「导出—回读—再导出」回环。

此时即使你不做任何后续整理，导入档案已经可以 `search` / `export`（检索命中带 `imported_unverified` 标签，不会显示为用户确认事实）。

### 3.3 第 2 层 · onboarding：分批取出待整理条目

```bash
npx tsx src/interfaces/cli/main.ts onboarding status            # 批次进度
npx tsx src/interfaces/cli/main.ts onboarding next [--batch <id>] [--limit 10]
```

`onboarding status` 真实输出形态：

```json
{
  "batchId": "01a16fa9-df1d-7097-b004-a103872ef7bd",
  "total": 2,
  "clean": 2,
  "blocked": 0,
  "promoted": 1,
  "remaining": 1
}
```

`blocked` 是秘密/注入扫描未通过的条目数——它们在任何情况下都不会进入批次（见安全文档第 3 节）。`skip` 掉的条目保留在批次中（skip 只表示不晋升，不删除原始档案），因此 `remaining` 不为 0 属正常现象。

`onboarding next` 真实输出形态：

```json
{
  "batchId": "01a16fa9-…",
  "items": [
    {
      "itemId": "01a16fa9-df22-76be-a4b5-9dbdb57dc823",
      "archiveId": "01a16fa9-df1f-7b21-9e09-55c1ad5c9246",
      "content": "# Claude Memory",
      "sourceRef": "MEMORY.md#item-0",
      "contentHash": "7c8c7a40…"
    }
  ]
}
```

把 `items` 交给当前 Agent（或在对话中对 Agent 说「初始化我的记忆」），由它生成建议。

### 3.4 第 2 层 · plan create：Agent 建议落成计划（零写入记忆）

Agent 输出的建议写成 `items.json`（`ProposedItem` 数组），示例：

```json
[
  {
    "itemId": "01a16fa9-df22-76be-a4b5-9dbdb57dc823",
    "content": "# Claude Memory",
    "kind": "fact",
    "opHint": "skip",
    "reason": "文件标题，不是记忆"
  },
  {
    "itemId": "01a16fa9-df23-711e-a891-b9c38986945c",
    "content": "用户偏好深色主题",
    "kind": "preference",
    "opHint": "add",
    "reason": "来自导入档案的稳定偏好"
  },
  {
    "itemId": "01a16fa9-df23-711e-a891-b9c38986945c",
    "content": "用户常用 TypeScript ESM",
    "kind": "fact",
    "opHint": "add",
    "reason": "来自导入档案的技术事实"
  }
]
```

`ProposedItem` 字段说明（与 `src/governance/propose.ts` 一致）：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `itemId` | 否 | 绑定到既有 `import_item`（外键校验）；建议尽量携带，是证据落库的键 |
| `content` | **是** | 候选正文；≤ 1,000,000 字符；逐项做秘密/注入扫描，不干净整项被拒 |
| `kind` | **是** | 同 `--kind` 枚举；`instruction` 会被直接拒绝（指令只能由用户显式写入，不得经由候选计划入库） |
| `opHint` | 否 | `add` / `merge` / `keep_both` / `skip`；缺省按 `add` 处理 |
| `targetMemoryId` | 否 | `merge` / `keep_both` 的目标记忆 |
| `targetExpectedRevision` | 否 | 目标修订快照；apply 时重检，目标已推进则 `E_TARGET_CHANGED` |
| `reason` | 否 | 建议理由，进入计划 op 供审阅 |
| `evidence` | 否 | 证据数组；CLI `plan create` 不直接落库，证据在 apply 阶段按 `itemId` 附加 |

```bash
npx tsx src/interfaces/cli/main.ts plan create --items-file items.json [--batch <id>] [--proposed-by cli]
```

真实输出形态（节选）：

```json
{
  "plan": {
    "id": "01a16faa-1878-797c-8661-de1b77d72330",
    "planHash": "878f9944…",
    "status": "awaiting_approval",
    "itemCount": 3,
    "proposedBy": "cli"
  },
  "planHash": "878f9944…",
  "accepted": 3,
  "rejected": [],
  "duplicates": []
}
```

```
[cairn] 计划 <plan-id> 已创建（awaiting_approval）。请审阅后执行: cairn approve <plan-id>
```

确定性管线在此时执行：逐项校验 → 秘密/注入扫描（不干净整项 `rejected`，只保留 `kind` + `masked` 摘要）→ 与库内现有记忆精确去重（命中进 `duplicates`，不建操作）→ opHint 映射。全部被拒/去重则 `E_PLAN_INVALID`。**计划只落库，不晋升任何记忆。**

### 3.5 第 2 层 · plan show：审阅差异

```bash
npx tsx src/interfaces/cli/main.ts plan show <plan-id>      # 单计划详情
npx tsx src/interfaces/cli/main.ts plan list                # 最近 20 个计划
```

`plan show` 返回计划元数据、每个 op 的类型/目标/内容哈希/理由/状态，以及操作统计（`counts.add / merge / keep_both / skip`）。**审阅是人的工作**：确认每个 op 都是你愿意让它发生的。

### 3.6 第 2 层 · approve：本地签发一次性审批

```bash
npx tsx src/interfaces/cli/main.ts approve <plan-id> [--ttl <秒>]
```

真实输出形态：

```
[cairn] 计划状态: awaiting_approval，操作统计: {"add":2,"merge":0,"keep_both":0,"skip":1}
[cairn] 批准即签发一次性、30 分钟有效的 approval_id；计划此后任何变化都会使其失效。
{
  "approvalId": "apr_01a16faa-2f66-748e-9f62-14a05cd7e34d",
  "expiresAt": "2026-10-24T21:16:26.662Z",
  "itemCount": 3
}
[cairn] 应用: cairn apply <plan-id> --approval <approvalId>
```

审批合同细节（绑定 `plan_hash`、一次性、重放拒绝、失败不消耗、崩溃恢复）见安全文档第 4 节。审批只能由本地 CLI 签发；MCP 请求中声明的 `user_confirmed` 不构成审批凭证。

### 3.7 第 2 层 · apply：消费审批并幂等应用

```bash
npx tsx src/interfaces/cli/main.ts apply <plan-id> --approval <approvalId> --json
```

真实输出形态：

```json
{
  "report": {
    "planId": "01a16faa-1878-797c-8661-de1b77d72330",
    "alreadyApplied": false,
    "applied": 2,
    "skipped": 1,
    "failed": 0,
    "results": [
      { "opIndex": 0, "opType": "skip", "note": "skipped" },
      { "opIndex": 1, "opType": "add", "memoryId": "01a16faa-42cf-…" },
      { "opIndex": 2, "opType": "add", "memoryId": "01a16faa-42d1-…" }
    ]
  },
  "batchId": "01a16fa9-df1d-7097-b004-a103872ef7bd"
}
```

- 经批准应用的条目以 `authority=user_confirmed` 入库，`createdBy=plan:<plan-id>`，可追溯到来源档案。
- **幂等续跑**：对已 `applied` 的计划重复执行返回 `alreadyApplied: true` 且不产生任何副作用（实测退出码 0）；每个 op 独立事务，op 状态与记忆写入同事务。
- 治理性中止（应用前复检发现秘密 / 目标修订已推进）会就地撤销已消耗的审批并把计划送回 `awaiting_approval`，计划内容不变，可重新批准——但带秘密或目标已推进的 op 会确定性复现失败，正确做法是重新 propose（剔除问题条目）。
- **进程崩溃**（逐 op 中途退出）的恢复路径与上述不同：计划停在 `approved`、审批已消耗，重新 approve 会被拒绝。用户可达的恢复方式是重新 propose 一份相同 items 的新计划（已完成部分被确定性去重），详见安全文档 4.1。

### 3.8 第 3 层 · 投影与宿主配置（agent plan / apply）

第三层授权独立于前两层：只有你显式执行 `agent plan` → 审阅 → `agent apply`，Cairn 才会写任何宿主配置文件。详见第 5 节。`router` 模式写入的受管路由区块即「投影」入口（带 `<!-- cairn:begin -->` 唯一标记、幂等、可精确移除）。

### 3.9 三次授权互不捆绑（速查）

| 步骤 | 授权内容 | 不做的时候 |
| --- | --- | --- |
| `import` | 读取所选文件并快照 | 不写宿主配置、不改原生记忆；导入后即可检索 |
| `approve` + `apply` | 批准一份具体计划晋升 | 不影响导入档案；拒绝则档案保持 `imported_unverified` |
| `agent apply` | 写入计划里列出的宿主文件 | 不写任何未在计划中的路径；`agent plan` 恒零写入 |

---

## 4. MCP 接入

### 4.1 启动与配置

MCP 服务器是 stdio 进程：`node dist/src/interfaces/mcp/server.js`（stdout 只输出 JSON-RPC，日志走 stderr）。数据目录通过 `--home <dir>` 参数或 `CAIRN_HOME` 环境变量指定，缺省 `~/.cairn`。

Claude Code（项目根 `.mcp.json`）：

```json
{
  "mcpServers": {
    "cairn": {
      "command": "node",
      "args": ["dist/src/interfaces/mcp/server.js"]
    }
  }
}
```

Cursor（项目根 `.cursor/mcp.json`，或全局 `~/.cursor/mcp.json`）：

```json
{
  "mcpServers": {
    "cairn": {
      "command": "node",
      "args": ["dist/src/interfaces/mcp/server.js"]
    }
  }
}
```

说明：

- `args` 里的路径相对于宿主启动 MCP 进程时的工作目录；建议用绝对路径指向构建产物与安装位置，例如 `"args": ["D:/path/to/cairn/dist/src/interfaces/mcp/server.js", "--home", "C:/Users/<you>/.cairn"]`。
- 需要先 `npm run build` 生成 `dist/`。
- 不要手写 `user_confirmed` 之类的字段——审批凭证只来自本地 `cairn approve`。
- 也可以用 `cairn agent plan --host <agent> --mcp-command node --mcp-args "dist/src/interfaces/mcp/server.js"` 生成这份配置（零写入），审阅后 `agent apply` 写入。


### 4.1b DSH：不是 JSON，是 Cordis 插件树

DeepSeek Harness **不读 `mcp.json`**。上面对 Claude Code / Cursor 的写法在 DSH 上完全无效——把 `mcpServers` 写进任何文件，DSH 都不会加载。

DSH 的 MCP 接入点是它的 Cordis 插件树 `<dshHome>/profiles/<profile>/cordis.patch.yml`，要写成 `- insert:` 块：

```yaml
- insert:
    - id: mcp-cairn
      name: "@deepseek-ai/dsh-mcp-client"
      config:
        serverName: cairn
        transport: stdio
        command: "D:/Program Files/nodejs/node.exe"
        args:
          - "D:/Project/AI MemoryGLM/dist/src/interfaces/mcp/server.js"
        failOnStartupError: false
```

几个要点：

- **`- insert:` 这一层不能省。** 顶层的裸 `- id: xxx` 行是「覆盖/禁用某个已在某 bundle 层存在的条目」，找不到目标就被**静默丢弃**，日志只留一行 `[warn] patch: entry "xxx" not found`。
- **`command` 用绝对路径。** DSH 从 Electron 起子进程，`PATH` 不可依赖。
- **`failOnStartupError: false`**（默认值，显式写出以表意图）：让 MCP 启动失败只表现为「少几个工具」，而不是 DSH 起不来。
- **工具名前缀由 `serverName` 决定**：注册后是 `mcp__cairn__memory_search` 这种形状，须匹配 `[A-Za-z0-9_-]{1,32}`。
- **修改后要重启 DSH**（或触发配置重载）才加载；编辑配置条目会就地重载连接。

用 `cairn agent plan --host dsh` 生成的计划就是上面这块内容，不需要手写：

```bash
cairn agent plan --host dsh --home-root "$DSH_HOME" \
  --mcp-command "D:/Program Files/nodejs/node.exe" \
  --mcp-args "D:/Project/AI MemoryGLM/dist/src/interfaces/mcp/server.js"
```

### 4.2 memory_* 工具（8 个，常驻工具面）

| 工具 | 参数 | 行为 |
| --- | --- | --- |
| `memory_context` | `query?` `limit?`（默认 10，上限 50） `project_id?` | 返回当前上下文可用的启动/任务记忆（作用域过滤的 active 记忆，含来源与权威级别）；带 `query` 时走检索，无 `query` 时返回 `personal-global` 作用域内最近更新的 active 记忆 |
| `memory_search` | `query`（必填） `status?` `limit?` | 关键词检索记忆预览（不返回全文上下文注入）；`status` 默认 active，candidate/conflicted 需显式指定 |
| `memory_get` | `id`（必填） | 读取一条记忆的完整内容、修订历史与证据（agent 通道受作用域读取检查） |
| `memory_add` | `content`（必填） `kind?` `sensitive?` `scope_preset?`（默认 personal-global） `project_id?` | 显式新增记忆，写入内容成为 `user_explicit` 活动记忆。**只在用户明确要求"记住/更正"时调用** |
| `memory_propose` | `content`（必填） `kind?` | 提交模型推断的候选：进入待审查队列（`agent_inferred` + candidate），不会直接成为活动记忆，不会覆盖用户明确记忆 |
| `memory_update` | `id` `content`（必填） `reason?` | 追加新修订（不无痕覆盖历史）。仅当用户明确更正时调用 |
| `memory_forget` | `id`（必填） `reason?` | 遗忘一条记忆（可审计 tombstone）。仅当用户明确要求遗忘时调用 |
| `memory_status` | 无 | 本地库健康摘要：各状态计数、冲突数、待处理任务、设备状态 |

治理约束由确定性代码执行，不依赖模型自觉：`memory_propose` 的候选永远是候选；`memory_add` 写入前做秘密扫描；agent 通道对 `memory_get` 执行作用域读取检查（跨项目、跨设备、非白名单 Agent 读取一律 `E_SCOPE_MISMATCH`）。

### 4.3 onboarding_* 工具（4 个，按需暴露）

只有当本地存在「已导入、扫描 clean」的条目时（`doctor.counts.importItems.clean > 0`），这 4 个工具才会出现在 `tools/list` 中；没有任何 clean 导入条目的全新库不会暴露它们。诚实说明：按当前实现，批次整理完成后这些工具仍会保留（spec 中"结束后可关闭"的工具面收敛属于后续能力），隐私敏感的宿主可在宿主侧手动禁用这组工具。四个工具如下：

| 工具 | 参数 | 行为 |
| --- | --- | --- |
| `onboarding_status` | 无 | 返回当前批次与待整理条目进度；不自动开始新扫描 |
| `onboarding_next_batch` | `limit?`（默认 10，上限 50） | 取下一批已授权待整理条目（有界），供生成 add/merge/keep_both/skip 建议 |
| `onboarding_propose` | `batch_id?` `items`（必填，每项 `content` 必填 + `kind`/`opHint`/`targetMemoryId`/`reason`） | 把本批建议提交为治理计划。只保存计划，不晋升；等待用户本地审批 |
| `onboarding_apply` | `plan_id` `approval_id`（必填） | 应用**已获本地审批**的计划；`approval_id` 必须由本地 CLI `cairn approve` 签发，调用方声明 `user_confirmed` 无效 |

导入动作本身没有 MCP 工具：MCP 不提供无参数的全盘发现工具，`discover` / `import` 只能由用户在 CLI 完成（第一层授权）。

### 4.4 路由建议（"工具只在需要时调用"）

受管路由区块（`agent plan --mode router` 写入宿主规则文件的文案）遵循构想 A.9 的语义，核心是告诉 Agent **何时**使用 MCP，而不是每次对话都强制检索：

> 跨设备共享的长期记忆统一经 Cairn MCP 读写：需要保存、检索、更正或遗忘共享记忆时，显式调用 Cairn 工具。用户明确要求"记住 / 更正 / 遗忘"某条信息时，先通过 Cairn 工具完成，再按需回复。不要在每次对话开始时无条件检索记忆；仅在与当前任务相关时检索。Agent 私有的原生记忆继续保留：会话草稿与本机偏好留在原生记忆，不承担跨设备共享职责。

工具描述中的调用时机（"仅在……时调用"）是**行为引导，不是强制控制**：实际隔离、审批、作用域和删除由 MCP 服务与本地数据层执行。自然语言路由无法阻止一个不守约定的宿主滥用 `memory_add`；请配合宿主自带的工具调用审批设置（例如 Cursor 的工具审批）使用，并对 `memory_add` / `memory_forget` 这类写入型工具保持警惕。

---

## 5. 宿主配置管理

四个子命令（`<agent>` 取值：`claude-code | cursor | copilot | openclaw | workbuddy | dsh`）：

```bash
cairn agent plan      --host <agent> [--mode observe|router|mcp-primary] [--mcp-command node --mcp-args "..."] [--home-root <dir>] [--project-root <dir>]
cairn agent apply     --plan-file <plan.json>
cairn agent doctor    --host <agent> [--home-root <dir>] [--project-root <dir>]
cairn agent uninstall --host <agent> [--home-root <dir>] [--project-root <dir>]
```

`--mode` 缺省为 `router`。

- **plan 恒零写入**：输出完整计划 JSON（含 `actions[]` 的 before/after/`beforeHash`、`conflicts`、`capability`、`notes`）与 `signature`。把完整 JSON 存为文件交给 `agent apply`。
- **apply 目标哈希校验**：先验 `signature` 与计划内容一致（防篡改/防过期），再逐动作核对目标文件当前哈希是否仍等于计划时的 `beforeHash`——文件在计划之后被任何人改过（包括文件新出现/消失）即 `E_TARGET_CHANGED`（退出码 4），拒绝应用。写入是原子写（临时文件 + rename），目标文件已存在时先备份为 `<path>.cairn-backup`（仅首次）。
- **MCP 合并规则**：只加/更新 `mcpServers.cairn`（或 copilot 项目级的 `servers.cairn`），未知顶层字段与其他 server 原样保留；发现同名外来 `cairn` 条目（无本产品安装记录）视为冲突，拒绝覆盖。
- **doctor 只读**：如实报告配置文件是否存在、cairn 条目是否存在、受管区块是否存在、安装记录数，以及 `fixture-only` / `blocked` 能力分级。
- **uninstall 只移除本产品条目**：文件与上次安装后状态一致时整文件恢复备份字节；用户有后续修改时只移除 cairn 条目/受管区块，其余内容保持不变。


### DSH（DeepSeek Harness）特别说明

DSH 的接入形态与其他五个宿主**根本不同**，参数也多一个：

```bash
cairn agent plan      --host dsh --home-root <dshHome> [--dsh-profile desktop] --mcp-command <node> --mcp-args "<server.js>"
cairn agent apply     --plan-file <plan.json>
cairn agent doctor    --host dsh --home-root <dshHome> [--dsh-profile desktop]
cairn agent uninstall --host dsh --home-root <dshHome> [--dsh-profile desktop]
```

- **DSH 不读 `mcp.json`。** 它的 MCP 配置是 Cordis 插件树：`<dshHome>/profiles/<profile>/cordis.patch.yml`，cairn 以 `- insert:` 块登记 `@deepseek-ai/dsh-mcp-client` 插件。按其他宿主那样去改 `mcp.json`，DSH 完全不看。
- **`- insert:` 不能省。** 不带 `insert` 的裸 `id` 行语义是「覆盖某个已存在的条目」，找不到目标就被**静默丢弃**——日志里只会多一行 `[warn] patch: entry "mcp-cairn" not found`，看起来像「还没生效」，实则从未进过配置树。这正是 cairn 用块编辑器而不是让你手写的原因。
- **`--home-root` 对 dsh 必须给对。** 解析顺序：显式 `--home-root` → `DSH_HOME` 环境变量 → 报错。**不会**回退 `~/.dsh`（该目录在部分机器上是旧安装留下的空壳）。
- **`--dsh-profile`** 默认 `desktop`，仅当 DSH 用了别的 profile 名时才需要。
- **规则入口是用户级 `<dshHome>/AGENTS.md`**，对所有工作区生效；项目级 `AGENTS.md` 追加在其后（两者叠加，后者更具体因此优先）。这是「整个会话都走 cairn」的正确落点，不必逐项目写。
- **不是 YAML 解析器。** cairn 对该文件做行级定向编辑，只碰自己那一个 `insert` 块，不重排、不改注释。结构无法识别时一律 `E_CONFIG_CONFLICT` 硬失败并零写入，绝不猜测性重写。

### 5.1 三种模式

| 模式 | 写入内容 |
| --- | --- |
| `observe` | 零写入。只输出说明与能力分级（默认兼容观察期） |
| `router`（推荐长期模式） | 受管路由区块（5 行文案）+ 可选 MCP 条目。原生记忆保持原样 |
| `mcp-primary` | router 全部内容 + 原生记忆**手动**关闭步骤（`manual_step`，apply 时跳过，需用户自己完成）。除 cursor 外此模式能力分级为 `blocked`（原生接管需用户手动） |

### 5.2 六宿主能力矩阵（`src/agents/adapters.ts` 实录）

| 宿主 | MCP 配置 | 受管区块（路由入口） | mcp-primary 原生记忆关闭 | MCP 顶层键 |
| --- | --- | --- | --- | --- |
| Claude Code | `fixture-only`：项目根 `.mcp.json`（仅 project 作用域；user/local 聚合在 `~/.claude.json`，本产品不写该文件，请用官方 CLI） | `fixture-only`：项目 `CLAUDE.md`；用户级 `~/.claude/CLAUDE.md` | `documented-manual`：`/memory` 开关或环境变量 `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`，用户手动 | `mcpServers` |
| Cursor | `fixture-only`：项目 `.cursor/mcp.json` 或全局 `~/.cursor/mcp.json` | `fixture-only`：项目根 `AGENTS.md`；全局规则只有 User Rules (UI)，无文件路径 → 手动粘贴 | 无原生自动记忆（官方 Rules 文档明确），`none` | `mcpServers` |
| GitHub Copilot | `fixture-only`：项目 `.vscode/mcp.json`（键为 `servers`）或用户 `~/.copilot/mcp-config.json`（键为 `mcpServers`） | `fixture-only`：`.github/copilot-instructions.md`（项目）；无 home 级块文件 | `documented-manual`：GitHub 设置 → Copilot 中手动关闭 Memory | `servers`（项目）/ `mcpServers`（用户） |
| OpenClaw | `blocked`：官方未公开配置文件路径，本产品拒绝写入推测路径，MCP 条目需用户手动添加 | `fixture-only`：`~/.openclaw/workspace/AGENTS.md` | 开关存在但配置路径未公开：只能给出手动步骤，`none` | `mcpServers` |
| WorkBuddy | `blocked`：官方仅描述"自定义连接器"UI 安装，无公开路径 | `blocked`：无公开规则/记忆文件，只提供可复制文案由用户手动粘贴 | 账号级服务端设置，用户手动关闭，`none` | `mcpServers` |
| DeepSeek Harness (DSH) | `fixture-only`：**非 JSON**。`<dshHome>/profiles/<profile>/cordis.patch.yml` 的 `- insert:` 块（Cordis 插件树，不读 `mcp.json`） | `fixture-only`：用户级 `<dshHome>/AGENTS.md`（对所有工作区生效；项目级叠加在后） | 无公开关闭接口，只能给手动步骤，`none` | `—`（插件树，无 JSON 顶层键） |

**blocked 宿主的手动指引**（来自 `agent plan` 输出的 `notes` / `manual_step` 文案）：

- OpenClaw MCP：按官方文档在宿主自身配置中添加（官方 CLI `openclaw mcp add` 不在本机，本产品不猜测路径）；`USER.md`/`MEMORY.md`/`memory/*.md`/`DREAMS.md` 不会被整文件改写。
- WorkBuddy MCP：在自定义连接器 UI 中信任并启用；路由文案手动粘贴到宿主说明位置。
- 写入 JSON 不等于"已经可用"：需要 UI 信任、重启或登录的宿主会在 notes 中明确报告，不会静默跳过。

**分级语义**：`fixture-only` = 契约只对官方形态的 fixture 文件验证过，未对真实宿主 CLI 复跑；`blocked` = 无公开文档路径或需要用户手动 UI 步骤，本产品拒绝写入推测路径。本版本不标 `real-cli-tested`。

---

## 6. 后台任务

```bash
cairn worker run-once [--max N]     # 处理一轮到期任务（默认 max 10）
cairn status                        # 查看 outbox 各状态计数
```

- **默认不安装任何 hook**：worker 只被显式调用，绝不自启、不驻留、不阻塞 Agent 会话。同步、抽取、嵌入、维护全部退出会话关键路径。
- 任务失败不会逃出 `worker run-once`：handler 异常/超时（默认单任务 30 秒）转化为 outbox 的 `retry`（有界重试，默认 5 次）或 `dead` 状态，只留下 sanitize 后的 200 字符内错误摘要，不拼接记忆正文。
- MVP 的诚实行为：`sync_upstream` 任务在未配置云端时以 `remote_not_configured` 失败并进入 retry/dead；`extract` / `embed` 任务（需要模型）同样诚实失败。这是设计行为——不会假装同步或抽取成功。`maintain` 任务负责过期计划清扫与崩溃遗留任务的复位。
- 云端同步属于后续变更；MVP 中 `personal-global` 等作用域产生的上行任务会停在 outbox 里（`cairn status` 可见），属预期现象。

---

## 7. 常见场景

### 7.1 场景 A：记住我的提交偏好，之后在另一台设备检索（本地部分）

MVP 没有云端同步（`remote=not_configured`），跨设备获取副本的方式是备份/恢复（或手动迁移数据目录）。完整本地流程：

```bash
# 设备 1
cairn init
cairn add "提交信息偏好使用 Conventional Commits 格式" --kind preference
cairn backup --out /path/to/cairn-backup.db          # 一致性备份（VACUUM INTO）

# 设备 2（安装并 build 后）
cairn restore /path/to/cairn-backup.db --home ~/.cairn   # 恢复到设备 2 的数据目录
cairn search "提交"                                    # 检索到该偏好
cairn doctor --json                                    # 确认 ok: true
```

要点：

- 恢复的是整个权威库（含审计与任务）。设备 2 首次打开恢复出来的库时，以自己的身份注册；备份里设备 1 的身份行保留在库内。
- 若 `doctor` / `device status` 报告 `cloned: true` 或设备处于 suspended（例如恢复了一份曾在别处执行过 `device re-enroll` 的备份），运行 `cairn device re-enroll` 生成独立身份，详见安全文档第 5 节。
- 若该偏好存在 `personal-global` 作用域（`syncPolicy=encrypted`），写入时会产生上行任务；MVP 中它会停在 outbox 并最终进入 retry/dead（`remote_not_configured`），不影响本地检索。
- `device-local` / `project-device` 作用域的内容在物理上就不参与任何上行，跨设备副本只能靠你主动备份/恢复包含它们。

### 7.2 场景 B：从 Claude Code 记忆文件初始化

```bash
# 1. 元数据发现（零正文读取）
cairn discover --home-dir "C:/Users/<you>" --json

# 2. 确认要导入的来源后，显式导入（快照 + imported_unverified + local_only）
cairn import "C:/Users/<you>/.claude/projects/<proj>/memory/MEMORY.md" --agent-kind claude-code

# 3. 此时已可检索（带 imported_unverified 标签）
cairn search "偏好"

# 4. 在 Claude Code 对话中说"初始化我的记忆"（需先配置 MCP，见第 4 节），
#    或手动取批次并整理：
cairn onboarding next
#    → 把条目交给 Agent 生成 items.json（add/merge/keep_both/skip 建议）
cairn plan create --items-file items.json
cairn plan show <plan-id>          # 人审：确认每个操作
cairn approve <plan-id>            # 签发一次性 approval_id（30 分钟）
cairn apply <plan-id> --approval <approval-id>

# 5.（可选，独立授权）写入 Claude Code 路由区块与 MCP 配置
cairn agent plan --host claude-code --mode router \
  --mcp-command node --mcp-args "dist/src/interfaces/mcp/server.js" \
  > plan.json
#    审阅 plan.json 的 actions 与 conflicts
cairn agent apply --plan-file plan.json
```

任一步停止都不破坏前序成果：导入后即可检索；计划不批准就永远不晋升；`agent plan` 不 apply 就零写入。

---

## 项目身份与别名（add-stable-project-identity）

项目主键是 **UUIDv7**，路径与 git 地址只是别名。这样仓库改名、换机器改路径都不会让旧记忆掉到一个"不存在的项目"下。

```bash
# 首次：未登记过的路径/地址 → 新建项目（UUID）并记下第一条别名
cairn project resolve D:\Neusoft\HDRS6Project\江南大学附属医院 --name 江南大学附属医院

# 仓库改名 / 换设备：把新地址追加为同一项目的别名（旧别名保留）
cairn project alias add <project-id> https://gitee.com/owner/new-name.git

# 之后用任一别名解析都会得到同一个 projectId（created=false）
cairn project resolve git@gitee.com:owner/new-name.git

# 列出全部项目及别名（只读，不会新建）
cairn project list
```

MCP 侧对应 `project_resolve`（参数 `path_or_url`、可选 `name`）与 `project_list`，与 CLI 共用同一实现。

归一化只做**明确等价**的变换，不做模糊匹配：

| 输入 | 归一化结果 |
| --- | --- |
| `https://Host/o/r.git`、`git@host:o/r.git`、`ssh://git@host/o/r.git` | `https://host/o/r`（去凭据、host 小写、去 `.git`） |
| `d:\proj\x\` | `D:/proj/x`（盘符大写、分隔符统一、去尾斜杠） |
| `D:/Proj` vs `D:/proj` | **两个不同项目**（Linux 上就是两个目录，不能合并） |

三条边界：

- **解析不校验路径是否存在**——跨设备解析时对方目录本就不在本机。
- **不做自动上溯**——传子目录就按子目录算，请传项目根。
- **别名冲突必须显式处理**：别名已属于别的项目时 `alias add` 会以退出码 4 拒绝并报告归属，不会静默改绑。

> 当前边界：项目表**不同步**（同步链只覆盖 `personal-global` 的记忆事件）。所以在两台设备上用同一路径解析会各建一个新项目；要让它们成为同一个，需要手工在一端 `project alias add` 另一端的路径。等记忆真正按项目作用域使用、且项目表进入同步协议后，这一步才能自动化。

---

## 作用域迁移（add-scope-migration）

活动记忆可以换作用域（归属），**不删不重建**：id、修订历史、证据链、权威级别全部保留，只改 `scope_id`。与「删了重建」「候选晋升」是三件不同的事。

```bash
# 单条迁移：把私人项目相关记忆从 personal-global 降到 device-local
cairn rescope <id> --scope-preset device-local

# 迁到项目作用域必须给项目标识，缺了直接拒绝（退出码 2），不会静默落到别的作用域
cairn rescope <id> --scope-preset project-device --scope-project <projectId>

# 用户亲口说的记忆（user_explicit）迁移会改变可见范围，需要显式确认
cairn rescope <id> --scope-preset device-local --force

# 批量：每行一个 id，逐条报告成功/失败/跳过，单条失败不中断
cairn rescope --ids-file ids.txt --scope-preset project-device --scope-project <pid> --force

# WebUI 批注联动：控制台把记忆标为「需迁移作用域」，终端一键处理（先列清单再逐条执行）
cairn rescope --pending --scope-preset device-local [--dry-run]
```

**⚠️ 迁移前必读的两条后果**（命令执行前也会打印）：

- **迁到设备类作用域（`device-local` / `project-device`）会失去跨设备同步**。这是定义层的：设备绑定作用域物理不上行，不是实现选择。迁出时其他设备会收到一条「迁出通知」，把它们本地的这条记忆标为「不再持有」（检索不再返回）——**数据不删除、无墓碑记录**，本机仍完整持有。
- **云端既有密文不会自动删除**。对象存储是追加语义，迁出只发通知不清理旧密文；其他设备在收到通知前仍可能拉到旧副本。要清理云端对象需要显式的 purge 能力（暂未提供）。

迁出不是遗忘：本机与其他设备都没有墓碑，遗忘时间线不变。迁回 `personal-global` 后，对端会收到一次强制重发的修订快照（带迁回标记），自动解除「不再持有」，内容按正常修订链继续同步。

安全阀：冲突中的记忆拒绝迁移（状态不明确）；墓碑无作用域可迁移；`user_explicit` 记忆需要 `--force`（减速带，不是禁止）。每次迁移写审计（前后作用域、是否失去同步）。

退出码：成功 0；用法/校验（缺 preset、缺 projectId）2；治理拒绝（user_explicit 无 force）3；状态冲突 4。单条显式指定时失败直接退出对应码；`--ids-file` 批量则逐条软报告，整体退出码 0。

---

## 设备备份的云端容灾（add-cloud-backup）

`cairn backup` 的本地快照只在同一块硬盘上；硬盘坏了 `device-local` 记忆全丢。备份通道把快照**端到端加密后上传**到远端（与同步同一 vault、同一凭据，但独立前缀与独立密钥派生）：

```bash
# 加密上传（先 vault init-remote；无 vault 明确拒绝，不产生弱加密产物）
cairn backup --upload              # 默认保留最近 5 份 [--keep N]

# 列出本设备的远端备份（名称 / 时间 / 密文字节）
cairn backup --list-remote

# 恢复：默认还原到新路径（~/.cairn/restore-<时间戳>/），当前库完全不动
cairn restore --from-remote <name> [--to <dir>]

# 覆盖当前库：必须 --force，且会先把当前库自动备份一份（pre-restore-*.db）
cairn restore --from-remote <name> --force
```

三条后果要记住：

- **只有本机解得开**：备份密钥混入设备身份，其他设备拿到密文也解不开。所以 **`device.json` 丢了 = 旧备份全部解不开**——重装前备份它，或用 `device re-enroll` 恢复同一身份。
- **syncd 暂不支持删除**：保留策略在 OBS 后端自动淘汰；syncd 后端只上传不删除（输出有提示），旧备份手动清理。
- **上传不碰本地库**：`backup --upload` 只读快照 + 写远端，失败不影响任何记忆读写。

---

## 8. 命令与退出码速查

| 命令 | 作用 |
| --- | --- |
| `init` | 初始化数据目录并执行首次体检 |
| `discover` | 元数据发现（不读正文） |
| `import <文件...>` | 不可变快照导入（imported_unverified + local_only） |
| `onboarding status\|next` | 分批进度与待整理条目 |
| `add "内容"` | 显式新增记忆 |
| `search "关键词"` | 作用域约束检索 |
| `show <id>` | 记忆详情（修订/证据/冲突） |
| `update <id> "新内容"` | 用户更正（新修订，历史保留） |
| `forget <id>` | 遗忘（可审计 tombstone） |
| `archive <id>` | 归档 |
| `export` | 导出 json/markdown |
| `plan create\|show\|list` | 治理计划（create 需 `--items-file`，零写入） |
| `approve <plan-id>` | 本地签发一次性审批（绑定 plan_hash，30 分钟有效） |
| `apply <plan-id> --approval X` | 消费审批并幂等应用计划 |
| `backup` / `restore` | 一致性备份与恢复 |
| `doctor [--host <agent>]` | 健康检查（诚实分级） |
| `status` | 库状态摘要 |
| `project resolve\|list\|alias add` | 项目身份：id 为 UUID，路径/URL 只作别名 |
| `worker run-once [--max N]` | 处理一轮后台任务 |
| `device status\|re-enroll` | 设备身份与克隆恢复 |
| `agent plan\|apply\|doctor\|uninstall --host <agent>` | 宿主配置管理（plan 零写入） |
| `uninstall` | 移除所有本产品宿主配置（数据库保留） |

全局选项：`--home <dir>`（数据目录，默认 `~/.cairn`）、`--json`（机器可读输出，stdout 仅结果）、`--agent-id <id>`（调用方 Agent 身份，默认 `cli`）、`--help`。

退出码：`0` 成功；`1` 故障（内部错误、IO 失败、目标不存在）；`2` 用法/校验错误（含作用域校验失败、`E_PLAN_INVALID`）；`3` 被治理拒绝（`E_SECRET_DETECTED`、`E_INJECTION_SUSPECTED`、审批无效/过期/重放、计划篡改、越权读取）；`4` 状态冲突（`E_TARGET_CHANGED`、同名外来条目 `E_CONFIG_CONFLICT`、投影回环）；`5` 环境不可用（数据库被锁、设备克隆/暂停、迁移失败、备份损坏）。

## 投影简报：让宿主会话看得见记忆

`cairn agent apply` 往宿主写的受管区块，不再只有 5 句路由文案，而是**路由文案 + 记忆简报**。

### 按宿主分级

| 宿主 | 形态 | 预算 | 落点 |
| --- | --- | --- | --- |
| DSH | brief | 2 KB | `$DSH_HOME/AGENTS.md`（用户级，对所有工作区生效） |
| Claude Code | brief | 2 KB | 项目 `CLAUDE.md` |
| Cursor | brief | 2 KB | 项目 `AGENTS.md` |
| Copilot | brief | 2 KB | `.github/copilot-instructions.md` |
| WorkBuddy | brief | **8 KB** | `<cwd>/.workbuddy/memory/MEMORY.md` |
| OpenClaw | none | — | 无公开落点，只给可复制文案 |

**WorkBuddy 的 8 KB 依据**：其应用代码 `MemoryCollector.getWorkingMemoryContent()` 读取该文件并以 `<working_memory_content>` 注入，上限 10000 字符。这是**应用代码证据**而非官方文档，且注入受 `localMemoryEnabled` 开关控制——doctor 无法代查开关状态。

### 三条不变量

1. **敏感内容在取数阶段排除**：`local_only` 作用域、`sensitive` 敏感度、`blocked` 状态一律不进入简报。先渲染再过滤会留泄露面，所以排除发生在 `selectProjectionCandidates` 里。
2. **同输入同字节**：排序键是 `confidence → updated_at → id`，全序且不含「当前时间」。任何把 `now()` 写进输出都会破坏缓存，也会让「内容未变则不重写」的幂等判断失效。
3. **预算含全部开销**：区块预算扣掉路由文案、简报标题和受管标记后才给正文，超出时写明「另 N 条未显示」。

### 摘要用什么生成

**确定性规则渲染，不用 LLM**：每条记忆一行 `- [kind] 摘要 (id:xxxxxxxx)`。引入模型会让第 2 条不变量不成立，且多一层依赖与成本。

### 已知边界

- **Copilot 与本产品并存**：GitHub Copilot 自带服务端 Copilot Memory（Repository-level facts + User-level preferences）。投影写入 `.github/copilot-instructions.md` 与它并存，两者可能给出不同说法，doctor 会提示。
- **ZCode 暂不支持投影**：它虽是已接入的 MCP 宿主，但从来不是 `AgentKind` 的受支持项。其 `MEMORY.md` 约定为**索引**（每行一条、不放正文），若将来支持需按 index 模式单独实现。
- **WorkBuddy 用户级文件未处理**：`~/.workbuddy/MEMORY.md`（4 KB 上限）与项目级是两个文件，本次只处理项目级。

## lesson：记录「曾经错了、别再犯」

记忆类型新增 `lesson`，用于记录**被纠正过的认知**。与相邻类型的判据：

| 类型 | 回答什么 | 例子 |
| --- | --- | --- |
| `procedure` | 该怎么做 | 「交付物用 os.makedirs + shutil.copy2 复刻层级」 |
| `fact` | 是什么 | 「本机 `~/.local/bin/env` 不是 env(1)」 |
| **`lesson`** | **曾经这样做是错的，为什么错** | 「曾用 zip 打包交付物，现场打不开——中文名 + 超长 JIRA 概要会被工具处理坏，改用文件夹」 |

判据不清楚时会退化：把一般做法标成 lesson，或把真实教训塞进 procedure，都会让检索和投影失去区分度。

### 投影优先级

`lesson` 在投影简报中**优先占用预算**——它承载「别再犯」，最需要在会话开场被看到。排序为 `lesson → confidence → updated_at → id`。

### 迁移说明

`kind` 是硬编码 CHECK 约束，加值需重建 `memory` 表（迁移 004）。该表被 8 个表外键引用、有 FTS 触发器与 7 个索引，重建有两个坑：

1. **事务内 `PRAGMA foreign_keys=OFF` 无效**（SQLite 明确是 no-op），必须在 `BEGIN` 之前关；
2. **不关外键时 `DROP TABLE` 会静默级联删光子表数据**，而 `foreign_key_check` 仍报干净。

迁移框架因此支持 `preTransactionPragma` / `postTransactionPragma`。回滚只能从备份恢复（`cairn backup`）。

## DSH 记忆插件（实时召回）

投影简报（上一节）只能静态注入且受 2 KB 预算限制。要在会话中**按当前问题**召回，需要 DSH Cordis 插件。

```bash
cd plugin/dsh && npm run build
dsh plugin --profile web add <plugin/dsh 绝对路径>   # 装到 profile
# 重启 DSH 生效
```

**插件以 MCP 为内核**：记忆存储、作用域判定、审批仍由 Cairn MCP server 负责；插件只做召回注入与去重，不拥有数据、不产生写入。

失败时只跳过本次注入，不阻塞会话——模型仍可用 `mcp__cairn__*` 工具。

| 项 | 默认 | 说明 |
| --- | --- | --- |
| `enabled` | `true` | 总开关 |
| `budgetBytes` | `1536` | 单次注入字节预算 |
| `topK` | `5` | 一次召回条数上限 |

**证据边界**：插件纯逻辑有 21 项自动化测试；但**与真实 DSH 的集成未手工冒烟验证**（`agent/pre-step` 是否触发、注入是否进入上下文）。能力分级保持 `fixture-only`，不虚标。

## 操作审计（add-operation-audit）

凡是经 Cairn 的**读取**操作（`search`/`show`、MCP `memory_search`/`memory_get`）都会在本地库留一条摘要审计（类目 `operation`：时间、动作、对象 id、候选数/命中通道/耗时）。**写入与维护**沿用既有 `memory` 类目审计，不重复记录。审计只存摘要——查询原文、调用参数、记忆正文永不入审计。

```bash
# Windows：不要直接运行 .ts/.js，用 npm scripts 或 dist 里的 main.js
npm run cli -- audit list --category operation --limit 20
npm run cli -- audit list --json          # 机器可读
```

MCP 侧等价只读工具：`memory_audit`（支持 `category`/`action`/`since`/`limit`）。

保留期与开关（改完重启生效）：

| 配置 | 环境变量 | `~/.cairn/config.json` | 默认 |
|---|---|---|---|
| 是否留痕读取操作 | `CAIRN_AUDIT_OPERATIONS=false` | `{"audit":{"operations":false}}` | 开 |
| 保留天数 | `CAIRN_AUDIT_RETENTION_DAYS` | `{"audit":{"retentionDays":90}}` | 30 |

治理类目（计划/审批/写入审计）**永不**被保留期自动清理；非法配置值回落默认并在 stderr 告警。
