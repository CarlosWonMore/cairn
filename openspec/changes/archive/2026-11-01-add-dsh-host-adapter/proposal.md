# Proposal: 为 DSH 宿主增加 agent 配置适配器

## Why

本产品当前支持五个宿主（`claude-code`、`cursor`、`copilot`、`openclaw`、`workbuddy`），但不包含 **DeepSeek Harness（下称 DSH）**。`cairn agent plan --host dsh` 会直接以 `E_VALIDATION` 拒绝，用户无法用现成命令把 cairn 接入 DSH。

2026-11-01 我手工把 cairn 接进了 DSH，过程中证实了三件事，它们不是产品假设：

1. **DSH 的 MCP 配置形态与其他宿主完全不同。** 其余宿主的接入点是「JSON 里的 `mcpServers`（或 copilot 的 `servers`）映射，加一个 named entry」，而 DSH 用的是 Cordis 插件树：配置位于 `<dshHome>/profiles/<profile>/cordis.patch.yml`，MCP 服务器通过自带插件 `@deepseek-ai/dsh-mcp-client` 以 **`- insert:` 补丁行**登记。DSH **不读 `mcp.json`**——我全盘扫过 `$DSH_HOME`，没有任何文件含 `mcpServers` 字样；`~/.workbuddy/mcp.json` 与 `~/.zcode/cli/config.json` 那种写法在这里无效。
2. **写错形态不会报错，只会静默失效。** 我第一版把条目写成 `- id: mcp-cairn`（模仿该文件中既有条目），DSH 日志每启动一次多一行 `[warn] patch: entry "mcp-cairn" not found`，条目从未进入配置树。这正是不该让用户手工做这件事的理由：失败是静默的，且其报错文本（"not found"）暗示的是"还没生效"，而不是"形态错了"。
3. **DSH 的规则文件是双层叠加的。** 用户级 `<dshHome>/AGENTS.md` 对所有工作区生效，项目级 `AGENTS.md` 追加在其后。要"整个会话都走 cairn"，落点是用户级，而非逐项目改。

因此这不是"再加一个枚举值"，而是**一类新的配置形态**：非 JSON、插件树、需要 insert 语义、且必须幂等与可精确卸载。

## What Changes

- 新增宿主类型 `dsh`，纳入 `AGENT_KINDS`、`HOST_ADAPTERS`、CLI 校验与 `cairn uninstall` 的遍历范围。
- 为 `dsh` 增加一种新的**配置形态**：`cordis-patch`。它不能复用现有 `write_mcp_config`（那是 JSON 合并），需要一个独立的读取/合并/移除实现，且必须：
  - 只在 `- insert:` 层新增条目，或更新本产品自己插入的那一条，绝不改动其他条目；
  - 保留文件里既有的注释、键序与不属于本产品的行；
  - 幂等：重复应用不产生第二个 `mcp-cairn`；
  - 卸载只移除本产品那一行，用户其他 patch 行逐字保留；
  - 同名外来条目（已存在非本产品安装的 `serverName: cairn`）视为冲突并拒绝写入。
- 用户级规则文件的落点：`dsh` 的 `blockTargetPath` 返回 `<dshHome>/AGENTS.md`（**而非** `<homeRoot>/AGENTS.md`），因为该文件才是对全工作区生效的那一层。
- `homeRoot` 的语义对 `dsh` 变更：DSH 把"配置根"与"用户主目录"分开，数据在 `$DSH_HOME`（本机为 `D:\AIAgents_Data\DSH_DATA`）。适配器接受显式 `dshHome`（经 `--home-root` 传入，或从 `DSH_HOME` 环境变量解析），**不猜测** `~/.dsh` 之外的路径。
- `doctor` 增加对 `cordis-patch` 形态的检查：报告 patch 文件是否存在、本产品条目是否已插入、插件行是否指向存在的 `dist/src/interfaces/mcp/server.js`。
- 文档：`docs/cairn-usage.md` 增补 DSH 一节；`docs/M0-session-handoff.md` 记录形态差异。

### 不改什么

- **不引入 YAML 解析依赖。** 项目当前依赖只有 `@modelcontextprotocol/sdk`、`@noble/ciphers`、`@noble/hashes`；为一个宿主的接入再引一个 YAML 库并不划算，而全量重写该文件会破坏用户的注释与格式。实现采用**行级定向编辑**（定位本产品那一个 `insert` 块并只改它），并把"文件结构不符合预期"作为显式失败而不是猜测性修复。
- **不写 DSH 的插件依赖。** `@deepseek-ai/dsh-mcp-client` 随 DSH 自带（位于其 app.asar），本产品只登记 insert 条目。
- **不改 `workbuddy` 的既有结论。** 它被标为 `blocked` 是因为官方未公开 `~/.workbuddy/mcp.json`，本次不动它的能力分级。
- 不接管 DSH 的原生记忆；不新增 `mcp-primary` 的原生关闭通道（DSH 无公开关闭接口，维持 `none`）。

## Capabilities

### New Capabilities

无新增能力。本次是既有能力 `agent-interfaces` 与 `agent-onboarding` 的扩展。

### Modified Capabilities

- `agent-interfaces`：新增"适配器支持的配置形态不止 JSON"这一要求——MCP 接入 MUST 覆盖非 JSON 的插件树形态，并保证在该形态下同样满足"只合并本产品条目、保留未知内容、同名外来条目为冲突"的不变量。
- `agent-onboarding`：router 模式的受管入口 MUST 支持"用户级全局文件"这一落点（当前只描述了项目级块文件），并 MUST 说明用户级与项目级是叠加关系。

## Impact

- 修改：`src/agents/adapters.ts`（新增 `dsh` kind、`cordis-patch` 形态标记、用户级块路径）、`src/agents/config.ts`（新形态的 plan/apply/doctor/uninstall 分支）、`src/interfaces/cli/main.ts`（`--host dsh` 可达、帮助文本）、`src/interfaces/app-service.ts`（若 `uninstall` 需传 `dshHome`）。
- 新增测试：`tests/agents/cordis-patch.test.ts`（定向编辑、幂等、外来同名片、注释保留、卸载还原），并扩展 `tests/agents/adapters.test.ts`、`tests/agents/config.test.ts`。
- 规格：`openspec/specs/agent-interfaces/spec.md`、`openspec/specs/agent-onboarding/spec.md` 各加一条需求。
- 风险：
  - **定向编辑的脆弱性。** 行级编辑依赖 DSH 该文件的缩进与键序。DSH 升级若改变 patch 文件格式，定向编辑可能失配。缓解：结构不符一律显式报错（`E_CONFIG_CONFLICT`/`E_VALIDATION`），绝不"尽力而为"地重写；`doctor` 报告失配。
  - **能力分级不能虚标。** 本次实现只在本机一份真实 DSH 安装上验证过形态与加载结果，没有跨 DSH 版本矩阵。因此分级为 `fixture-only` 的**证据来源要写清**：fixture 抄自真实文件的形态，真实加载验证另行记录，不得表述为"已兼容所有 DSH 版本"。
  - **回滚**：DSH 侧只需删除该 `insert` 块（`cairn agent uninstall --host dsh` 可精确做到）；DSH 会把缺失 `mcp-cairn` 插件的残留行记为 dangling patch row 警告，因此卸载必须连带清掉整块，而不是只删内部行。
