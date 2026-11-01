# Design

见 `proposal.md` 的 Why 与 What Changes；本文件只记录**怎么做**以及为什么这样选。

## Context

- 现有适配器契约（`src/agents/adapters.ts`）只抽象了「MCP 配置文件路径 + 顶层键名（`mcpServers` / `servers`）+ 块文件路径」。合并逻辑 `mergeMcpConfig` 是 JSON 读取 → 注入 named entry → 序列化，卸载是 `delete obj[key]['cairn']`。这套抽象**无法**表达 DSH 的形态。
- DSH 的配置是 Cordis 插件树：`<dshHome>/profiles/<profile>/cordis.patch.yml`，顶层是 YAML 补丁行数组；新增插件必须写成 `- insert:` 包裹的行；不带 `insert` 的裸 `id` 行是「覆盖/禁用既有条目」，找不到目标即静默丢弃。
- 项目当前运行时依赖仅三项，**没有 YAML 库**。该 patch 文件 43 KB / 1277 行，含用户注释、缩进与键序，且 DSH 自己会按需重写它（例如插件页开关会改 bundle list）。
- 本机真实样本：`$DSH_HOME` = `D:\AIAgents_Data\DSH_DATA`（环境变量已设），profile 为 `desktop`。

## Goals / Non-Goals

**Goals:**

- `cairn agent plan|apply|doctor|uninstall --host dsh` 全部可用。
- 在不用 YAML 库的前提下，对 patch 文件做**最小、可逆、幂等**的改动，且绝不重排/重写用户内容。
- 失败可见：结构不符一律显式报错。

**Non-Goals:**

- 不实现通用 YAML 编辑器，不解析整棵 YAML 树。
- 不支持 DSH 的其他 profile 自动发现（profile 名显式给出，默认 `desktop`）。
- 不改 `workbuddy` 的 `blocked` 分级（其官方路径仍未公开，本次不因"我们已知道 `~/.workbuddy/mcp.json` 存在"就翻案——那是用户环境事实，不是官方文档）。

## Decisions

### D1：新增「配置形态」维度，而不是硬塞进 HostAdapter 的路径抽象

`HostAdapter` 增加一个 `mcpConfigKind: 'json' | 'cordis-patch' | 'none'`。选择该方案而非给 `dsh` 单独写一套绕过适配器的分支，原因是：`plan/apply/doctor/uninstall` 四个入口都经由适配器取路径与元数据，若在适配器之外加特例，四处都要各加一个 `if (kind === 'dsh')`，以后再加第三种形态会更糟。

**替代方案**：让 `mergeMcpConfig` 通过接口抽象成策略对象。考虑后放弃——过度抽象，当前只有两种形态，加一个字面量判别已足够，且更容易在测试里断言。

### D2：定向行编辑，不做 YAML 解析

实现核心是一个**块级编辑器**，按行工作：

1. 找到本产品的 insert 块：从某行匹配 `^s*- insert:s*$` 开始，向下收集直到遇到同缩进（或更浅）的下一个 `- ` 行或文件结束，即为该块的文本范围。
2. 在该块内匹配 `^s*- id:s*mcp-cairns*$`，据此判断"是否已安装"。
3. 写：若不存在则**在文件末尾追加**一个新的 `- insert:` 块（保留文件现有结尾换行风格）；若已存在且内容不同则替换该块；若内容相同则不写（幂等，`changed=false`）。
4. 删：只移除该 `- insert:` 块的行范围，其余逐字保留。

**为什么不用 YAML 库**：加一个依赖只为一个宿主不划算；更重要的是，**任何 YAML 反序列化再序列化都会丢失注释与键序**，而该文件是 DSH 与用户共写的共享文件，破坏其格式是真实的回归风险。

**替代方案**：引入 `yaml` 包并保留 comment 元数据。放弃理由：`yaml` 虽有 comment 保留能力，但会把"新增依赖 + 学习其 Document API"的复杂度加到一个只做一件事的路径上，且仍需处理"如何只改自己那一块"。行编辑的失效模式（结构不符）可以显式检测，比隐式寄望序列化器忠实可audit得多。

**代价**：若 DSH 改变该文件的缩进/键序约定，编辑器会失配。因此**失配必须显式失败**，见 D3。

### D3：结构不符是硬错误，不是「尽力而为」

编辑器只接受它认得的形态。遇到以下任一情况即 `E_CONFIG_CONFLICT` 并**零写入**：文件不是顶层数组、找不到可用的追加点、已存在的本产品块内部结构无法确定边界（例如缩进不一致）、同一文件里出现多个本产品 insert 块。

选择硬失败而不是"修复成标准形态"，因为该文件由 DSH 与用户共同维护；猜测性重写会破坏用户内容，而在配置接入这件事上，"没接上"远好于"接歪了还不知道"。

### D4：`dshHome` 取代 `homeRoot` 的语义位置

DSH 的数据根与用户主目录是两个概念。适配器对 `dsh` 解析顺序：显式 `--home-root` → `DSH_HOME` 环境变量 → 报错。**不**回退到 `os.homedir()/.dsh`，因为该目录在本机存在但属于旧安装（实测为空壳），猜它比报错更危险。

### D5：用户级块文件 = `<dshHome>/AGENTS.md`

DSH 的 `@deepseek-ai/dsh-agent-instructions` 在**每个会话首个请求**加载 user-global 层（`$DSH_HOME/AGENTS.md`、`~/.agents/AGENTS.md`），再追加项目层。因此 `blockTargetPath` 对 `dsh` 返回 `<dshHome>/AGENTS.md`，而不是 `<homeRoot>/AGENTS.md`。

**替代方案**：写项目级 `AGENTS.md`。放弃理由：那需要逐项目重复执行，且新项目会漏；用户级才是"整个会话"的落点。

### D6：能力分级保持 `fixture-only`，但把证据来源写进 notes

本次只在本机一份真实 DSH 上验证过形态与加载结果。按既有诚实原则，不标 `real-cli-tested`。`notes` 必须写明：fixture 抄自真实文件形态；真实加载验证另行记录；不表述为"兼容所有 DSH 版本"。

## Risks / Trade-offs

- **DSH 升级改变 patch 文件格式** → D3 的硬失败把影响限制为"接不上但文件未被破坏"；`doctor` 报告失配原因。
- **DSH 自己重写 patch 文件（如插件页开关）** → 行编辑器每次 apply 前重读文件，不缓存；apply 仍走既有的 `beforeHash` 校验，文件在计划后被改会 `E_TARGET_CHANGED`。
- **用户手工删掉了 insert 块但 DSH 仍留有 dangling 警告** → 卸载语义定义为"移除整个 insert 块"，而不是"只删内部行"，避免留下空 `insert:` 行。
- **uninstall 无法恢复原字节**（该文件由 DSH 持续改写，备份很可能已过期）→ 与 JSON 形态一致地采用"能恢复则恢复，否则只移除本产品部分"的既有策略，并在 notes 里说明。
- **能力分级被误读** → notes 里显式声明证据边界（D6）。

## Migration Plan

- 本次不涉及数据库或数据迁移；只有配置文件形态扩展。
- 回滚：`cairn agent uninstall --host dsh` 移除本产品 insert 块；DSH 侧无需其他清理。
- 已在真实环境手工接入的用户（本次开发机）可用 `doctor` 确认系统识别到既有条目而非重复插入。

## Open Questions

- DSH 的 profile 是否需要自动发现（当前显式默认 `desktop`）。可延后，不影响本次规格与任务拆分。
