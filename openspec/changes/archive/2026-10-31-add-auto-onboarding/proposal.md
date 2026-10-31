# Proposal: 策略预授权的自动整理与导入工作台

## Why

2026-10-29 对真实库（`~/.cairn`，51 个快照档案 / 533 条条目 / 140 KB 正文）做了一次只读实测，得到三个必须处理的结论。

**一、待处理队列的量与规则层的能力严重错配。** 规则引擎跑完 533 条只用了 74 ms，结果是 191 条 `skip`、342 条 `promote`、**0 条 `needs_human`**。看起来规则很强，实际不是：342 条 `promote` 全部落在兜底规则 `S-CLEAN-DEFAULT` 上，置信度一律 `medium`。「扫描干净、无重复、无冲突、非碎片，那就默认晋升」不是判断，是判不出来时的默认值。也就是说，规则层已经到顶，再补规则只能多砍 13 条（2%），剩下的 329 条它没有任何信息量。

而现在的流程强制人把这 342 条逐条过一遍。人在这里做的既不是规则能做的（规则已经做完了），也不是 AI 该做的（AI 层要人手动触发三次命令才会跑）。这是当前"难操作"的根因。

**二、晋升路径没有按内容查重。** `memory` 表只有主键，没有内容唯一性约束；`apply` 的 `add` 分支直接 `memories.add()`，插入前不查同作用域是否已有相同正文。而库里已经存在同一内容散落在多个档案的情况：跨档案正文完全重复 23 组、冗余 79 条；`codebuddy:MEMORY.md` 被导入 3 次。这些条目一旦分别晋升，同一条事实会在记忆库里变成多条 active 记录。

**三、视图切分与展示方式在放大操作成本。** 快照、批次、待处理三个视图描述的其实是同一条流水线的三个环节（档案 = 批次，库里 51:51 一一对应），合并不会丢信息。而快照条目的详情当前渲染在表格**下方**的容器里，一次铺 500 张卡片——点开一行之后要一直往下滚才能看到内容，且无法在展开态里做任何处理。

另一个量化事实：533 条里只有 329 条是实质正文，其余是结构残片 143 条（frontmatter、标题行、`---` 分隔线，其中 `---` 单独出现 18 次）、blocked 占位符 45 条（42 份是同一个 `[blocked:exfiltrate_all_memories]`）、碎片 3 条、加粗小标题 13 条。「量很大」的一半来自解析噪声而非内容。

## What Changes

### 1. 策略预授权的自动整理（新能力 `auto-onboarding`）

把"逐条人工审批"降级为"按已授权策略批量放行 + 例外上报"。

- 用户一次性签发一份**策略**（声明可自动应用的条目条件、作用域上限、敏感度上限、AI 与规则一致性的要求），策略以内容哈希记录，改动即失效。
- 自动应用**不是**绕开审批：审批仍由确定性代码按 `plan_hash` 绑定并签发，只是签发依据从"人逐次点"变成"人签发过的策略 + 条目满足策略条件"。每次自动应用写审计事件，记录策略标识与命中条件。
- 不满足策略的条目（冲突、涉敏感、跨作用域、AI 与规则不一致、低置信）进入待决策队列，由工作台或 MCP 工具呈现，等待人决定。
- **AI 判断有两个入口，优先在写入时完成。** 写记忆的调用方本身通常就是 Agent——模型已在场、上下文已在手，事后单看一段脱了上下文的文本，信息反而更少。因此单条写入时由调用方随写入一并给出判断（`verdict` / `confidence` / `rationale` / `dedupe`），确定性代码校验后即时落库或即时转待决策，**不进入任何事后队列**。
- 只有写入方不是 Agent 时（批量导入的存量快照，import 是机械动作，没有逐条在场者），才走"分派 → 判断 → 回收"的事后通道，而且这一轮由 Agent 自己跑，不需要人逐条点击。
- 两条通道**共享同一套判定条件与落库路径**，不允许出现"写时判断"与"事后判断"结论不同却都能落库的情况。

### 2. 晋升去重（`memory-governance` 修改）

- 计划生成时，同一作用域内 `normalized_content` 相同的条目合并为一个操作，其余标记为重复并记录指向。
- `add` 应用前查重：同作用域已存在相同正文的 active 记忆时，不新建记忆，改为追加证据与来源，并记审计。这一步让"多次导入 → 多次晋升"收敛为一条记忆，也使重复应用成为幂等操作。
- 明确不合并的情形：`keep_both` 语义（用户显式要求两条并存）、跨作用域（device-local 与 project-global 是不同记忆）、已被用户显式更正的修订历史。
- **写入路径也查重**：`memory_add` / `cairn add` 当前插入前完全不查重，同一条事实被会话反复记下就会变成多条 active 记忆。写入与应用共用同一个查重函数，行为必须一致——否则"从快照晋升"去重了、"Agent 顺手记一条"又会重复。

### 3. 导入工作台（`local-console` 修改）

- 快照、批次、待处理合并为一个「导入」视图：批次表为行，详情走右侧抽屉。
- 抽屉内分两段：「系统已自动处理」与「需要你判断」，并给出批量处理入口。
- 按来源折叠重复导入：同一 `source_label` 的多次快照在界面上折叠为"最新一份 + 历史展开"，库内数据不动。
- 抽屉状态进入地址参数，刷新与分享可还原。

### 不改什么

- 不引入本地模型，不改变 `plan_hash + approval_id` 的确定性校验位置。
- 不放松 `local_only` 与设备限定内容的物理排除。
- 不改数据库 schema 的既有约束；去重在代码层实现，不用唯一索引（会破坏 `keep_both` 与历史修订）。
- 不接管 Agent 原生记忆文件。

## Capabilities

### New Capabilities

- `auto-onboarding`：策略签发、条件判定、自动应用与审计、例外上报。

### Modified Capabilities

- `memory-governance`：计划生成与应用的幂等去重语义。
- `local-console`：导入视图合并、抽屉式详情、来源折叠、批量处理入口。

## Impact

- 新增：`src/onboarding/policy.ts`（策略解析、校验、条件判定）、`src/onboarding/auto.ts`（自动编排与审计）、`src/governance/dedup.ts`（写入与晋升共用的查重）、`src/onboarding/judgement.ts`（判断的校验与落库，两个入口共用）、`src/interfaces/console/drawer` 相关前端资源、`cairn policy` 与 `cairn onboard auto` 子命令、MCP 工具 `memory_policy` 与 `memory_decide`。
- 修改：`src/interfaces/app-service.ts`（`addMemory` 接受判断并查重）、`src/governance/propose.ts`（同哈希合并）、`src/governance/apply.ts`（add 前查重）、`src/interfaces/console/{model,server}.ts`、`src/interfaces/console/assets/{ui-js,ui-css,url-state}.ts`、`src/interfaces/cli/main.ts`、`src/interfaces/mcp/server.ts`。
- 规格：`openspec/specs/memory-governance/spec.md`、`openspec/specs/local-console/spec.md` 被修改；新增 `openspec/specs/auto-onboarding/spec.md`。
- 风险：策略预授权改变了"谁有权签发审批"的边界，属安全相关的治理变更，必须在设计中给出可撤销、可回滚与审计可查的完整路径，并在验收中包含伪造策略与越权策略的负向用例。
