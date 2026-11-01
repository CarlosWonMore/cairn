# Design

见 `proposal.md`。本文件记录怎么做，以及为什么这样选。

## Context

- `generateProjection` 已有完整能力：幂等 upsert、首次备份、原子写、受管标记、revision 递增。它缺的只是**内容来源**。
- `HostAdapter` 现有 `blockTargetPath` / `blockCapability`，没有表达「这个宿主能吃多少、什么形态」。
- `ROUTER_BLOCK_CONTENT` 是写死常量，`config.ts` 直接用它。

## Goals / Non-Goals

**Goals**

- 投影携带真实记忆内容，按宿主语义分级。
- 敏感内容物理排除、预算确定、字节可复现。

**Non-Goals**

- 不做实时召回（那是 DSH 插件的事）。
- 不做记忆摘要的 LLM 生成（本次用确定性规则渲染，避免引入模型依赖）。

## Decisions

### D1：摘要用确定性渲染，不用 LLM

每条记忆投影为一行：`- [<kind>] <首行截断> (id:<前8位>)`。

**为什么不用 LLM 摘要**：那会引入模型依赖与不确定性，且破坏「同输入同字节」的可复现性。确定性渲染虽然朴素，但可测试、可审计、零成本。

### D2：排序键全序且不含时间

排序：`confidence(desc) → updated_at(desc) → id(asc)`。

**为什么是 confidence 不是 importance**：`memory` 表没有 `importance` 字段（实际核对过 schema），`confidence` 是真实存在且写入时已确定的。设计文档初稿写了 importance，属于未核对 schema 的疏漏，已纠正。

**为什么保留 updated_at**：它是记忆内容的属性，不会因"现在几点"而变。真正危险的是 `now()`——那会让每次渲染都不同。测试要锁死这一点。

### D3：敏感排除先于一切渲染

`local_only` / `sensitive` / `blocked` 在**取数阶段**就过滤掉，不进渲染函数。

**理由**：如果先渲染再过滤，一旦某处漏过滤就会泄露。取数即过滤，泄露面为零。

### D4：index 模式复用同一渲染器的不同模板

ZCode 需要 `- [标题](指针) — 一句话` 形态，每行 ≤200 字符。用同一取数 + 同一排序，只换渲染模板与预算。

**理由**：避免两套筛选逻辑分叉（这正是 `promotedPredicate` 曾经踩过的坑）。

### D5：三宿主共享 AGENTS.md

DSH（用户级）、Claude Code（项目级）、Cursor（项目级）都读 `AGENTS.md`。

但**DSH 是用户级、后两者是项目级**，不能真的共用同一个文件。所以「共享」的正确含义是：**同一份简报内容可以渲染到各自的落点**，而不是写同一个路径。这避免了跨宿主互相覆盖。

## Risks / Trade-offs

- **投影泄露** → D3 取数即过滤 + 负向测试（构造 sensitive 记忆，断言绝不出现）。
- **字节不稳定** → D2 全序排序 + 断言「两次渲染字节相同」。
- **WorkBuddy 8KB 与用户级 4KB 混淆** → 本次只处理项目级 `<cwd>/.workbuddy/memory/MEMORY.md`（10K）；用户级 4K 文件留待后续，notes 中说明。
- **Copilot 与 Copilot Memory 竞争** → 只在 doctor/notes 警告，不删改宿主既有记忆。

## Migration Plan

- 无 schema 变更。
- 已有投影：下次 `agent apply` 会替换受管块内容；备份机制保证可回滚。
- 回滚：`cairn agent uninstall` 恢复原字节。

## Open Questions

- 用户级 WorkBuddy 4KB 文件是否也要投影（需先确认两者优先级）。可延后。
