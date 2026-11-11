# Proposal: 稳定的项目身份（UUID + 别名）

## Why

用户 2026-11-11 提出要按项目组织记忆，并给出了 projectId 的构造方式：

- 项目根有 git → `git:<remote url>`（如 `git:https://github.com/CarlosWonMore/cairn.git`）
- 项目根无 git → 绝对路径（如 `D:\Neusoft\HDRS6Project\江南大学附属医院`）

这条路在实现层走得通，但**直接用字符串当主键有两个会真实发生的断链**：

| 场景 | 后果 |
|---|---|
| 仓库改名 / 迁移（GitHub → Gitee，或 org 改名） | remote URL 变 → projectId 变 → **旧记忆全部归到一个不存在的项目** |
| 换一台电脑，项目路径变了（`D:\Neusoft\...` → `E:\Project\...`） | **同一个项目在两台设备上是两个 projectId** |

两者都违反「本地权威副本跨设备一致」这个前提：同一个逻辑项目应当有**同一个身份**。

**现有代码已经预留了答案**：`src/store/schema.ts:18` 的 `project` 表有 `aliases TEXT NOT NULL DEFAULT '[]'` 字段——但**全仓零引用**，设计时留了位置，实现时没接上。

本变更把它接上：**projectId 是稳定的 UUID，路径/URL 只是别名**。

## What Changes

- **项目解析（resolve）**：给定一个「路径或 git URL」，解析出对应的 projectId。
  - 命中别名 → 返回该项目的稳定 id；
  - 未命中 → 新建项目，生成 UUID 作为 id，把该字符串记为第一条别名；
  - 同一字符串在**不同设备**上解析必须得到**同一个 id**——通过把解析结果参与同步实现（见设计 D3）。
- **别名归一化**：git remote URL 做规范化（去 `.git`、统一 ssh/https、去凭据、小写化 host），路径做规范化（统一盘符大小写、去掉尾部斜杠、`\` 与 `/` 统一）。
- **别名追加**：项目迁移或换机器时，可以把新路径**追加**为别名，旧别名保留（历史可追溯）。
- **MCP / CLI 入口**：新增 `cairn project resolve <path-or-url>` 与对应 MCP 工具，返回 `{ projectId, name, matchedBy }`。

### 明确不做的事

- **不改已有 projectId**：已存在的项目行不动，只对新建的项目启用 UUID 策略；旧数据通过别名回溯。
- **不做路径存在性校验**：用户可能在一台没有该目录的设备上解析同一项目（这正是别名的用途），因此解析**不要求路径真实存在**。
- **不自动扫描文件系统找项目**：解析是显式调用，不猜测。
- **不做作用域迁移**：本变更只解决「项目身份稳定」，迁移是另一个变更。

## Impact

- Affected specs: `memory-store`（项目身份与别名）、`agent-interfaces`（解析入口）
- Affected code: `src/store/scopes.ts`（`ensureProject` 语义调整）、新增 `src/store/projects.ts`、`src/interfaces/cli/main.ts`、`src/interfaces/mcp/server.ts`
- **不涉及数据库迁移**：`aliases` 列已存在，不需要 `ALTER TABLE`
- 回滚：新解析逻辑只影响新建项目；回滚代码后已建项目仍可用（id 是普通字符串）

## 风险与回滚

| 风险 | 处置 |
|---|---|
| 同一路径在两条设备上各自新建了项目（别名未同步） | 本项目不引入同步，采用「**首次解析后由使用者显式确认**」；跨设备一致性依赖于同步处置见设计 D3 的边界声明 |
| 归一化把两个不同项目误判为一个 | 归一化只做**明确等价**的变换（大小写、尾斜杠、协议、`.git` 后缀），不做模糊匹配；测试覆盖 |
| 用户传入的是子目录而非项目根 | 不自动向上查找（不做魔法）；文档说明「传项目根」 |
