# 演化设计：投影记忆简报 + 时效召回 + lesson + DSH 适配插件

> 状态：**待你签核（Brainstorming 阶段）**。签核后才进 OpenSpec 四件套与实施。
> 日期：2026-11-01 ｜ 依据：对 7 个外部方案的文档核实 + 本项目代码核实

## 一、为什么是这套方案（不是照搬竞品）

调研中确认了一个决定性事实：`dsh-prime-memory`、`dsh-meow-memory` 都是 **Cordis 插件**（`dsh.bundle.patch`），因此能挂 `agent/pre-step` 做实时注入。Cairn 是 **MCP server**，独立进程，订阅不到 `session/event`。

所以 Cairn **不能**照搬实时注入。但 Cairn 有自己的推送通道：**受管投影**（`generateProjection`），把内容写进宿主 `AGENTS.md` 的受管块。目前它只写死 5 句路由文案，从不投影记忆正文——这是可立即利用的既有能力。

你的选择 Q1-B 让这条路完整了：**DSH 侧做一个 Cordis 插件，用 `@deepseek-ai/dsh-mcp-client` 以 SDK 方式在进程内挂载同一个 MCP server**。插件提供 DSH 专属的实时能力，内核仍是 Cairn 的 MCP 与本地库，与「守住单一内核」不冲突。

---

## 二、四件事，各自的边界

### 1. 投影记忆简报（Q2-B）

把投影从「只放路由文案」升级为「放筛选后的记忆简报」。

- **内容**：按作用域过滤后的高价值记忆，每条一行摘要，带 id 便于追溯
- **预算**：硬上限 4 KB，超出按 importance + 时效截断，并明示截断条数
- **走审批**：投影内容变化等同配置变更，需 `plan → approve → apply`，不静默改写用户文件
- **缓存友好**：同内容必然产出同字节，不因时间抖动（这是 meow 踩过的坑）
- **不投影**：`local_only` 作用域、`sensitive` 敏感度、`blocked` 状态一律物理排除

### 2. 时效召回（吸收 prime-memory 公式）

Cairn 的 `memory` 表**已有** `last_used_at`，`touch()` 已在维护，只是检索没用它。

- FTS 路径现为 `ORDER BY bm25(...)`，改为 `bm25 分 × 时效权重` 复合排序
- 权重：`max(0.5, 0.5^(距上次使用天数/30))`——相关度相近时新鲜的优先，地板 0.5 保证长期事实不沉底
- 半衰期可配（0 = 关闭），默认 30 天

### 3. `lesson` kind（Q3-A）

`kind` 是**硬编码 CHECK 约束**，加值必须做 SQLite 表重建迁移（`memory` 表有 FK 与触发器，需按官方 12 步流程）。

- 新增 `migration 004_memory_kind_lesson`：重建 `memory` 表并扩展 CHECK，保留全部既有数据与索引
- `lesson` 语义：**被纠正过的认知**（不是普通 fact）。你的 470 条里 `feedback_*` 那批正是此类
- 必须写清 `lesson` 与 `fact` / `procedure` 的判据边界，否则分类会退化

### 4. DSH 适配插件（Q1-B 的落地）

**新增一个独立包**，不并入 Cairn 核心仓。

| 项 | 决定 |
|---|---|
| 形态 | Cordis 插件（`dsh.bundle.patch`），进 DSH 的 profile |
| 内核 | 通过 `@deepseek-ai/dsh-mcp-client` 在进程内挂载 Cairn MCP server |
| 只做什么 | DSH 专属：`agent/pre-step` 按当前问题做实时召回注入、回合可见性 UI |
| 不做什么 | 不做记忆存储、不做审批、不做作用域判定——这些仍由 MCP 内核负责 |
| 失败隔离 | 插件不可用时，Cairn MCP 仍可被模型直接调用（降级为 pull 模式） |

---

## 三、分期（每期独立可验收）

| 期 | 内容 | 依赖 |
|---|---|---|
| P1 | 投影记忆简报 + 时效召回 | 无（都是既有能力扩展） |
| P2 | `lesson` kind + 迁移 | P1 无关，可并行 |
| P3 | DSH 适配插件 | P1 完成后（插件复用召回的排序算法） |

---

## 四、明确不做

- **不做自动会话捕获（L0）**：MCP 拿不到对话；插件侧若做，等于把用户对话落盘，与 Cairn 的隐私边界冲突。**需你另行明确授权**才会考虑。
- **不做自动写入**：L2/L3 蒸馏、自动抽取一律不自动落库，仍走候选 + 审批。
- **不引入向量嵌入**：AGENTS.md 明确不考虑本地模型。
- **不做定时后台整理**（meow 的 dream）：Cairn 的后台任务必须退出会话关键路径。

---

## 五、需要你在签核时确认的三个细节

1. **投影预算 4 KB 是否合适？** 参考淋雨家的「≤4KB 交接」，但那是交接块；简报可能更小更合理（如 2 KB）。
2. **`lesson` 是否与现有 `procedure` 冲突？** 我的划分：`procedure` = 该怎么做；`lesson` = 过去做错了什么以及为什么。若你觉得界限模糊，可以不加这个 kind。
3. **P3 插件的仓库形态**：独立仓库，还是 monorepo 里的 `packages/dsh-plugin`？
