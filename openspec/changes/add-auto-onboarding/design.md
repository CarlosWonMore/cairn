# Design: 策略预授权的自动整理与导入工作台

## Context

`add-memory-workbench` 已归档，主规格里有 `local-console` 与 `memory-review` 两个新能力，`memory-governance` 已记录审批通道参数化。本变更在它们之上改三件事：让审批可以按已签发策略代签、让重复内容收敛为一条记忆、让导入视图可操作。

约束来自既有规格，不可放松：模型只生成候选，审批与作用域由确定性代码校验；`plan_hash + approval_id` 仍是一次性、有有效期、单次使用；`local_only` 与设备限定内容物理排除。

## Goals / Non-Goals

**Goals**

- 533 条实测数据下，人工决策量从 342 条降到两位数。
- 同一内容无论从几个快照晋升，最终只有一条 active 记忆。
- 导入视图在一个屏幕内可操作，详情不离开列表上下文。

**Non-Goals**

- 不做自动签发策略。策略签发必须由人在终端或本地界面完成。
- 不引入本地模型；AI 判断仍由当前 Agent 会话内的模型产生。
- 不改 `memory` 表的既有约束，不加唯一索引。
- 不做跨作用域去重，不动 `keep_both` 语义。

## Decisions

### D1 策略签发复用既有审批链路，不新增 `approved_by` 枚举

`approval.approved_by` 有 `CHECK (approved_by IN ('user','local_cli','mcp_ui'))`。SQLite 不支持 `ALTER TABLE ... ADD CONSTRAINT`，新增枚举值要重建表，会破坏 schema 稳定性，也让既有 51 个档案的审计轨迹面临迁移风险。

做法：自动签发时写 `approved_by='local_cli'`、`channel='policy:<policyId>:<policyHash 前 8 位>'`。语义上成立——策略签发确实是本地确定性代码执行的，不是外部调用方声明的。

代价与对策：`channel` 变成可区分但可伪造的字段。因此约束不放在数据库，放在三处：
1. 签发路径唯一：只有 `policyAutoApply()` 能写 `policy:` 前缀的 channel，MCP 与 HTTP 层不能直接指定 channel。
2. 审计事件强制携带 `policyId` 与 `policyHash`，缺任一即拒绝写入。
3. 验收包含负向用例：构造 `channel='policy:fake'` 请求，系统必须拒绝。

### D2 策略条件顺序固定，最廉价最先失败

判定顺序：`scan_state` → 作用域 → 敏感度 → 冲突 → 两层一致性 → 重复。

顺序不是风格问题。AI 判断是外部产物，可能还没生成，也可能陈旧；若先查"两层一致"，会让注定因敏感度超限而被拒的条目白等一次模型调用。先做本地可判的四项，能把待判断集合从 342 压到实际需要的规模，再交给 AI。

敏感度比较用序数而非集合：`normal(0) < sensitive(1) < blocked(2)`，条目敏感度 `>` 策略上限即拒绝。MUST NOT"降级后应用"——降级等于篡改用户标注。

冲突判定读 `conflict` 表中该记忆是否存在未解决记录。注意：条目来源是 `import_item`，尚未成为记忆，此时判的是"它将合并到的目标记忆是否处于冲突态"；`add` 类型无目标，这一项直接通过。

### D3 查重是一个函数、三个调用点

去重不是一个功能点，是三个时机共用同一条判定：

| 调用点 | 解决什么 | 谁触发 |
| --- | --- | --- |
| 写入时（`memory_add` / `cairn add`） | 同一条事实被会话反复记下 | Agent 每次显式记 |
| 生成计划时 | 一次计划内的重复（同批三段相同正文） | 批量整理 |
| 应用计划时 | 跨计划重复、计划重试 | 批量与写入都落到这里 |

实现上只有一处判定：`findDuplicate(store, scopeId, normalizedContent)` 返回命中的 active 记忆或 `null`，三个调用点各自决定后果（合并证据 / 标记 `repeatOf` / 返回 `deduped`）。

分三份写判定是错的：越界条件会各自漂移，出现"写入时认为重复、晋升时认为不重复"这种事后无法解释的状态。

**为什么写入路径必须查**：`memories.add()` 当前直接 `INSERT`，插入前没有任何内容比对（`memory` 表只有主键约束，实测确认）。同一个 Agent 在两次会话里记下同一件事，就会得到两条 active 记忆，而且两条的 authority 都是"用户明确要求记住"，事后连该删哪条都判不出来。

**生成时合并**的额外价值：让 UI 在计划阶段就能说"这 3 条会变成 1 条"，而不是应用完之后用户才发现记忆数没按预期增加。

### D4 不用唯一索引，改用非唯一索引加速

`CREATE UNIQUE INDEX ... ON memory(scope_id, normalized_content) WHERE status='active'` 看起来正好，但会与 `keep_both` 直接冲突——用户显式要求两条矛盾并存时，两条都是 active 且可能同内容（用户先矛盾后改回同一说法）。历史修订还会让 `normalized_content` 在 `superseded` 与 `active` 之间交错。

所以只加非唯一索引 `memory_scope_content ON memory(scope_id, normalized_content)`，去重判定留在代码里，可读、可测、可解释。索引本身用 `CREATE INDEX IF NOT EXISTS` 写在既有迁移里，不新增迁移文件。

### D5 导入视图合并：数据层合成行，前端单表 + 抽屉

`archive` 与 `batch` 在库里 1:1（实测 51:51），因此数据层直接合成一行：

```
ImportRow = { archiveId, batchId, sourceLabel, byteSize, redactionState,
              total, clean, blocked, promoted, remaining,
              importCount, lastImportedAt }
```

`importCount` 用于来源折叠：同 `sourceLabel` 出现多次时，前端默认只展开 `lastImportedAt` 最大的一行，其余进 `<details>`。折叠是纯呈现，服务端仍返回全部行。

抽屉用 `position: fixed` 的右侧面板，宽 `min(720px, 92vw)`，遮罩 `rgba(0,0,0,.35)`，`role="dialog"` + `aria-modal="true"`，打开时焦点移入、关闭时归还触发元素。三个关闭入口（Esc、遮罩、按钮）共用 `closeDrawer()`，避免状态不一致。

地址参数复用已抽出的 `assets/url-state.ts`，新增 `drawer`（batchId）与 `item`（itemIndex）两个字段。`file://` 静态导出下不写 `history`，只按参数重放。

### D6 判断有两个入口，写时优先

cairn 不调模型，这一点没有变。但"模型不在场"这个前提只对**批量导入**成立，对**显式写入**不成立——调 `memory_add` 的那一方本身就是握着上下文的 Agent。

**入口一：写入时（默认路径）**

让它顺手给出判断，比事后重新看一遍脱了上下文的文本更准，也不额外消耗一轮会话：

```json
{
  "content": "生产环境数据库端口是 5433",
  "kind": "fact",
  "judgement": { "verdict": "keep", "confidence": "high",
                 "rationale": "环境事实，长期有效", "dedupe": "merge" }
}
```

确定性代码接住后依次做：内容校验 → 查重 → 判断落实 → 审计。`verdict=skip` 且 `confidence=high` 时不写库；`skip` 但置信度不足时写为 `candidate` 而不是丢弃——丢弃不可逆，降级可逆。

**入口二：事后（只服务存量导入）**

51 个快照 533 条是 `import` 机械产生的，没有逐条在场者。这部分走 `memory_decide action=next|submit|auto` 三步，由 Agent 自己跑一轮，不需要人逐条点击。

**两个入口共用一套校验**：如果写时判断能靠 `judgement` 绕过策略条件、而事后判断不能，那"自动化边界"就形同虚设——任何调用方只要自称 Agent 就能越界。因此 `judgement` 只影响"这条**值得不值得**记"，不影响"**允许不允许**记"；后者一律由策略与确定性校验决定。

**`memory_decide` 不能签发策略**（不变）：签发只有 `cairn policy sign`（终端）与工作台（本地回环 + 令牌）两条路径。这样"谁能授权自动化"始终由人掌握，MCP 只能消费已授权的策略。

### D7 撤销用 tombstone，物理记录保留

自动应用产生的记忆在审计中带 `policyId`。撤销按 `(policyId, batchId)` 查全部相关记忆，逐条转 `tombstoned` 并写撤销事件。不物理删除，因为：证据链要能回答"这条为什么曾经在库里"，且撤销后重新整理必须能重新判定同一批次而不被 tombstone 挡住。

### D8 并发与一致性

自动整理持写连接，长事务分批提交（每批一个计划），不跨批持有事务。理由：整批一个事务会让 342 条的处理要么全成要么全废，而实际情况是部分条目注定失败（写入校验、冲突），必须允许"成功 300 条、失败 42 条"这种真实结果。

工作台读连接与自动整理写连接并发时，读侧靠 SQLite 快照语义，不阻塞、不呈现半写状态。

### D9 失败分类与退出码

沿用既有约定：`E_VALIDATION`(2) 可返工、`E_FORBIDDEN`(3) 拒绝类需用户决策、`E_CONFLICT_STATE`(4) 并发或外部阻塞、`E_DB_LOCKED`/`E_MIGRATION_FAILED`(5) 环境问题。策略被篡改与已撤销都用 `E_FORBIDDEN`——它们不是"参数写错了"，是"这件事不被允许"，两者在退出码上必须分开。自动整理在部分失败时以 2 退出，并在汇总里给出分类计数——不因为个别条目失败就报 5 掩盖真实原因。

### D10 `judgement` 能改什么、不能改什么

判断是**建议**，不是授权。每一行都对应一个负向用例：

| 字段 | 允许 | 禁止 |
| --- | --- | --- |
| `verdict` | `keep` / `skip` / `merge_into:<id>` | 其它值；`merge_into` 指向不存在或跨作用域的记忆 |
| `confidence` | `high` / `medium` / `low` | 省略（缺省按 `low`，即不足以单独支撑 `skip`） |
| `rationale` | 一句话理由 | 空字符串 |
| `dedupe` | `merge`（默认）/ `keep_both` | 其它值；`keep_both` 时不给原因 |
| 敏感度 | 无权限 | 把 sensitive 降为 normal——敏感度只由写入参数决定 |
| 作用域 | 无权限 | 扩大或改变作用域——只由写入参数与策略白名单决定 |
| 审批 | 无权限 | 构成审批凭证；`memory_add` 的 authority 是 `user_explicit`，本就不经审批链 |

与既有原则同构：**模型只生成候选，确定性代码校验**。判断把"候选值不值得留下"自动化了，但没有让"留下需要什么条件"松动。

## Risks

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| 策略条件写宽，自动放行低质内容 | 记忆库污染，且用户难以事后定位 | 条件默认保守（只允许 clean + 作用域白名单 + 无冲突 + 两层一致）；提供按策略撤销；汇总里给出每类跳过原因计数 |
| `channel='policy:'` 被伪造 | 自动化审批边界失效 | 签发路径唯一 + 审计强制 `policyHash` + 负向验收用例 |
| 去重误合用户想分开的两条 | 丢失用户意图 | `keep_both` 豁免；跨作用域豁免；重复条目以"被告知"而非"被静默丢弃"的方式呈现 |
| 自动整理跑在真实库上不可逆 | 真实记忆被改 | 默认只对合成 HOME 运行；真实库需显式 `--home`；验收用真实库只读冒烟 |
| 抽屉重构引入前端回归 | 已有 7 视图失效 | 复用 `url-state.ts` 单一来源；`assets.test.ts` 与 `render.test.ts` 断言抽屉存在与关闭路径 |
