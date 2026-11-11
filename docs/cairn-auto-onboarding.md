# 策略预授权的自动整理

本文说明 `add-auto-onboarding` 引入的三件事：**写入时判断**、**策略预授权**、**导入工作台**。
读完应该能回答三个问题：什么时候可以不用人点、撤销之后到底发生了什么、以及这个机制为什么不能自己给自己授权。

---

## 1. 为什么需要它

真实库的实测结论（2026-10-29，533 条快照）：规则引擎已经跑到天花板——判了 191 条 skip，剩下 342 条虽然都判 `promote`，但**全部来自兜底规则 `S-CLEAN-DEFAULT`、置信度一律 medium**。这等于没有判断。

于是只剩两条路：

- 每条都让人点一遍 → 133 次点击，人一定会开始乱点；
- 给"明显该放过"的条目做一次**有边界的预授权**，把人的注意力留给真正需要判断的少数。

本变更走第二条。边界是：**预授权是一份写下来的、可核对哈希的规则；它决定"哪些能自动过"，永远不决定"哪些能写进哪些作用域"**。

---

## 2. 判断在写入时完成

原方案把 AI 判断放在"事后打包 → 判断 → 回收"的流程里。实施中改了，因为写记忆的调用方通常**就是 Agent**：模型已在场、上下文已在手。事后单看一段脱了上下文的文本，信息反而更少。

所以现在有两个入口，共用同一套判定与落库路径：

| 入口 | 谁在用 | 判断从哪来 |
| --- | --- | --- |
| 写入时 | Agent 直接 `memory_add` / `cairn add` | 请求里的 `judgement` 对象，Agent 顺手给出 |
| 存量导入 | 批量导入的历史快照 | `memory_decide` 分派 → 判断 → 回写，单次调用完成 |

写入时的请求长这样：

```json
{
  "content": "生产环境数据库端口是 5433",
  "kind": "fact",
  "judgement": {
    "verdict": "keep",
    "confidence": "high",
    "rationale": "环境事实，长期有效",
    "dedupe": "merge"
  }
}
```

### `judgement` 能改什么、不能改什么

这是整个机制里最容易被误用的一处，所以单独列表。**`judgement` 只影响"这条值不值得记"，不影响"允许不允许记"。**

| 字段 | 允许 | 禁止 |
| --- | --- | --- |
| `sensitivity` | — | 不能通过判断降级。敏感度只由写入参数决定，判断里根本没有这个字段 |
| `scopeId` / 作用域 | — | 不能通过判断扩大或改写。作用域由调用参数与策略白名单共同决定 |
| `approvalId` / 审批 | — | 判断不构成任何审批凭证；审批只能由 `issueApproval` 签发 |
| `verdict` | 只影响这条要不要落库、落成 active 还是 candidate | 不能把 `skip` 变成"删掉既有记忆" |
| `confidence` | 影响 `skip` 的降级与策略门槛 | 中低置信的 `skip` 一律降级为 candidate，不静默丢弃 |
| `dedupe` | `merge`（默认，命中重复就并入）/ `keep_both`（显式并存） | 不能跨作用域并入；目标不在本作用域直接 `E_VALIDATION` |

`confidence` 缺省视为 `low`——"没声明"不等于"有把握"。旧复核文件缺这个字段时按 `low` 归一化读取。

---

## 3. 策略：一份签好名的规则

策略是 `~/.cairn/policy/<id>.json`，由 CLI 签发。它不是配置，是一份**带内容哈希的授权凭证**：改一个字节哈希就变，读取时重算比对，不一致直接 `E_FORBIDDEN`，不降级使用。

```bash
cairn policy sign --id weekly --scopes personal-global --max-sensitivity normal \
                  --allow-create --min-confidence 0.6 --note "每周整理用"
cairn policy list
cairn policy show --id weekly
cairn policy revoke --id weekly
```

### 字段

| 字段 | 含义 | 说明 |
| --- | --- | --- |
| `id` | 策略标识 | 出现在每条审计与代签通道里 |
| `allowedScopes` | 允许的目标作用域 | 同时接受 preset 名（`personal-global`）与 scope id；未命中即拒 |
| `maxSensitivity` | 允许的最高敏感度 | `normal` / `sensitive`。超过即转人工 |
| `requireAiAgreement` | 是否要求规则层与 AI 层一致 | 一致才自动，不一致转人工 |
| `allowCreate` | 是否允许新建记忆 | 关掉即"只许并入、不许新建" |
| `minConfidence` | 置信度门槛 | 只有声明了置信度才比较；不声明不因此被卡住 |
| `note` | 人读的备注 | 会进审计，方便事后认账 |

未知字段一律拒绝——宽松默认会让"我以为是这个意思"变成写入事故。

### 条件判定顺序

```
scan_state → scope → sensitivity → conflict → ai_agreement → confidence → duplicate → create
```

顺序不是随意的：**本地能判的排在前面**。敏感度超限的条目不值得花一次模型调用去问 AI 意见，也不该在"AI 说可以"之后才发现作用域不对。所以先失败、先转人工，省掉无用的调用与误导性的理由。

两处语义值得单独说明：

- **duplicate 问的不是"能不能创建"，而是"规则层有没有给对动作"**。有重复时唯一正确的动作是 `merge`；如果规则层给的是 `promote`，说明它没看见重复，这一条就该转人工，而不是"允许创建"。
- **confidence 只在有判断时才比较**。否则 `requireAiAgreement=false` 会被这一项悄悄抵消，等于策略写了不管用。

---

## 4. 查重是一个函数、三个调用点

`findDuplicate(db, scopeId, content)` 是唯一判定，出现在三处：写入时、计划生成时、计划应用时。三处必须是同一个函数、同一套"什么算重复"的规则。

只认 `active` 与 `candidate`：

- `archived` 不算重复——归档是"保留但不用"，重新记下同一条是恢复意图；
- `tombstoned` 不算重复——遗忘之后重记是合法的新意图。

如果三处各写一份判定，最典型的坏结果是"归档后重新导入永远无法晋升"：写入路径认为重复（不新建）、晋升路径认为不重复（不合并），条目就卡在中间。

索引 `memory_scope_content` 建在 `(scope_id, content_hash)` 上，**非唯一**：查询键是哈希，重复的判定逻辑在代码里，不交给数据库约束——约束会连带阻止 `keep_both` 这种合法并存。

---

## 5. 跑一次自动整理

```bash
cairn onboarding auto --policy weekly --dry-run   # 只分档，不写库
cairn onboarding auto --policy weekly             # 应用
cairn onboarding auto --policy weekly --redo      # 连已晋升的条目也重新判一遍
```

工作台里对应"导入"视图顶部的下拉 + 自动整理按钮，`只预演` 勾上即 dry-run。

### 输出

每条条目落进 `auto` 或 `manual` 两档，逐条带理由：

- `auto` 档按作用域分组生成计划，**一个批次一个计划**，不把不同 scope 混进同一计划；
- 代签走 `channel = policy:<id>:<hash8>`、`approved_by = local_cli`——**不新增枚举值**，否则所有既有审批查询都要跟着改；
- 审计强制携带 `policyId` 与 `policyHashPrefix`，缺任一即拒绝写入；
- 汇总自校验：`applied + skipped + failed + manual === totalItems`，不平就是程序错了，不是数据错了。

### 幂等与 `--redo`

已晋升的条目默认不再处理：否则第二次运行会把它们重新走一遍，既不幂等，也让"再跑一次看看"变成对记忆的额外扰动。

`--redo` 是唯一的显式重做开关。它同时放宽两处——**选择**（不再按已晋升过滤）与**规则层**（连已晋升条目一起判）。只放宽选择、不放宽规则层的话，条目会被选中但拿不到建议，一路 `needs_human` → skip，重做等于空转。

点名指定条目（`--item`）也视为显式重做：调用方已经说清要哪几条了，不该再被"已晋升"静默过滤成一条名为"不属于批次"的误导性报错。

---

## 6. 撤销

```bash
cairn policy revoke --id weekly                 # 整策略撤销
cairn policy revoke --id weekly --batch <id>    # 只撤这一批
```

撤销做的是**转 tombstone，不物理删除**：记忆不再被检索，但修订历史、来源、审计都留着。"撤过没撤过"永远查得到。

### 撤销是粘的

撤销**不会**让条目自动回到"待整理"。这一点是刻意的：如果撤销后普通运行会自动重做，那么一次定时任务或一次续跑就能把用户刚撤销的东西写回来，撤销等于没做。

要重做必须显式 `--redo`。

### 撤销后的重新整理为什么能成立

- 判定不认 `tombstoned`（见第 4 节），所以重新整理不会撞上自己留下的墓碑；
- `markItemPromoted` 在原目标已被遗忘时允许改挂到新记忆并追加上一条审计。否则条目会永远卡在"已晋升到一条已不存在的记忆"这个状态里；
- 审计是只增不改的历史，旧映射保留，判定以新的一条为准。

---

## 7. 与既有治理约束的关系

| 既有约束 | 本变更如何遵守 |
| --- | --- |
| 模型只提候选，不执行 | 判断只写进 `judgement` 与复核文件；执行由确定性代码按策略判定后完成 |
| `plan_hash + approval_id` 双校验 | 自动路径同样签发审批，只是签发者记为 `local_cli`、通道记为 `policy:<id>:<hash8>` |
| 一次性有效期 | 自动签发的审批同样带 `ttlMs`，过期即失效 |
| 作用域不可扩大 | 策略白名单 + 写入参数双重约束；判断无法影响 |
| 敏感度不可降级 | 判断里没有这个字段；策略只能设上限，不能放宽单条 |
| 审计即状态 | 晋升状态承载在 `audit_event`（`category='onboarding'`, `action='item_promoted'`），schema 冻结不加列 |
| `memory_decide` 不能授权自己 | 该工具不接受策略内容、不接受 `channel` 参数，`auto` 只消费已签发策略 |

一条边界值得单独说：**`memory_decide` 无法签发策略**。这是刻意的——如果判断通道能顺带把策略也签了，那"预授权"就变成了"AI 给自己发权限"，整个审批链条就退化成摆设。

---

## 8. 出错时看哪里

| 现象 | 多半是 |
| --- | --- |
| `E_FORBIDDEN`（退出码 3） | 策略被改过（哈希不符）或已被撤销 |
| `E_VALIDATION`（退出码 2） | 策略字段非法、未知字段、并入目标跨作用域 |
| `E_CONFLICT_STATE`（退出码 4） | 同一条目要改挂到另一条仍存在的记忆 |
| `E_NOT_FOUND`（退出码 1） | 策略 id 或批次不存在 |
| `applied = 0` 且全是 `needs_human` | 规则层没给建议；用 `--redo` 或先跑 AI 复核 |
| `applied = 0` 且全是 skip | 内容已全部在库中（已并入或已存在），这是正常结局，不是失败 |

审计查询（只看自动整理，不碰人工审批）：

```sql
SELECT at, json_extract(detail,'$.policyId'), json_extract(detail,'$.batchId'),
       json_extract(detail,'$.applied')
  FROM audit_event
 WHERE category = 'policy' AND action = 'auto_applied'
 ORDER BY at DESC;
```

## 跳过是粘性的、可查的、需 redo 才重来

判定某条导入条目「不采用」时，系统写一条 `item_skipped` 审计事实，而不是只在当次运行的汇总里体现。这解决了首次全量整理后的一个真实残留：533 条导入条目里 18 条晋升、其余判跳过，但控制台的「待晋升」计数降不下来——因为 `remaining` 当时只认 `item_promoted`。

现在的判定口径：

| 谓词 | 含义 | 用途 |
| --- | --- | --- |
| `item_promoted` | 确实生成了记忆 | 「已晋升」计数 |
| `item_skipped` | 判定不采用 | 「已跳过」计数 |
| 二者任一 | 已处理完毕 | `remaining`（待处理） |

**为什么跳过不复用晋升事实**：审计只增不改，让「已晋升」同时表示「跳过」会让这个唯一谓词对所有消费方说谎，日后无法分辨哪些条目真的变成了记忆。

### 查看已跳过的条目

跳过的条目会退出待处理队列，但**不会从视野里消失**：

```bash
# 看某批次的进度（remaining 已不含跳过）
cairn onboarding status --batch <batchId>

# 看该批次被判跳过的条目及其依据
cairn onboarding skipped --batch <batchId> [--limit 200]
```

控制台的导入视图同样把「已跳过」单独成列，抽屉内保留每条的状态（已晋升 / 已跳过 / 仍待处理）。

### 想推翻跳过结论

跳过是**粘性的**：普通重跑不会把跳过的条目重新拉回队列。要重新处理必须显式重做：

```bash
cairn onboarding auto --policy <id> --batch <batchId> --redo
```

重做只放宽选择层，**不删除**既有的跳过审计——审计只增不改，这一点与「撤销是粘的」保持一致。

### 历史数据不会自动出队

本机制上线后，历史上被判过 skip 但没有留下事实的条目**不会自动消失**。它们需要通过一次显式重跑产生真实判定；系统不会替它们伪造历史。

---

## 修订提案：Agent 处置批注的正确姿势（add-agent-managed-revision）

批注（「需要修改」等）表达的是**人的意图**，不是 Agent 的写入授权。Agent 拿到批注后正确的动作不是直接改记忆，而是**出具一张方案卡由人确认**：

| 角色 | 能做 | 不能做 |
|---|---|---|
| Agent（MCP） | `revision_propose`（写卡）、`revision_list`（读卡） | **没有任何 apply 类工具** |
| 人（CLI / 控制台） | `cairn revision apply|reject`、控制台点采纳/拒绝 | — |

方案卡包含：目标记忆与提出时的修订标识、改前摘要与**拟改后的完整正文**、改动理由、关联批注、提出者与时间。存 `<home>/console/revision-proposals.json`，不建表、不参与同步。

采纳的语义（设计要点，不要绕过）：

- **版本一致性**：记忆的当前修订必须仍是提出时的那一份；已被改过 → 拒绝并标陈旧（stale），提案保留、记忆不变。`reviseMemory` 的 `expectedCurrentRevisionId` 是第二道保险，两层检查都在。
- **权威记 `user_confirmed`**：内容是 Agent 起草的，但批准动作来自人——写 `agent_inferred` 会低估，写 `user_explicit` 会高估。
- **秘密双查**：生成时扫描（落盘即泄露，等不得）；采纳时 `reviseMemory` 再扫一次。
- **拒绝可留痕**：拒绝记理由与时间、不删提案；陈旧卡也可以拒绝（否则永远清不掉），已采纳/已拒绝的卡不能再处置。
- `cairn doctor` 的 notes 会提示待确认提案数（不进 problems、不改退出码）。

Agent 会话内的标准流程：`memory_annotations_list` 看批注 → `memory_get` 读全文 → `revision_propose` 出卡 → 告诉用户去 `cairn revision list` / 控制台确认。**不要**用 `memory_update` 直接改有批注的记忆——那绕过了人的确认。
