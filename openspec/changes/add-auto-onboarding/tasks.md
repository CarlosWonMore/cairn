# Tasks: 策略预授权的自动整理与导入工作台

## 1. 策略层

- [x] 1.1 `src/onboarding/policy.ts`：定义策略结构（`id`、`allowedScopes`、`maxSensitivity`、`requireAiAgreement`、`allowCreate`、`minConfidence`、`note`），拒绝缺字段，不做宽松默认
- [x] 1.2 规范化序列化与内容哈希：同一语义必然得到同一哈希（字段顺序、空白、换行归一）
- [x] 1.3 签发：写 `<home>/policy/<id>.json`，签发记录含哈希、时间、通道；重复签发同一 id 需显式 `--force`
- [x] 1.4 校验：读取时重算哈希，与签发记录不一致即以治理拒绝类错误终止，不降级使用
- [x] 1.5 `evaluatePolicy(item, suggestion, policy, ctx)`：按 `scan_state → 作用域 → 敏感度 → 冲突 → 两层一致 → 重复` 顺序判定，返回 `{ ok, failedCondition }`
- [x] 1.6 验证：`tests/onboarding/policy.test.ts`，覆盖哈希稳定性、改动即失效、六种条件各自失败、条件顺序（敏感度超限时不查询 AI 结果）

## 2. 自动编排

- [x] 2.1 `src/onboarding/auto.ts`：把规则结果与策略判定组合成 `auto | manual` 两档，逐条记录分档理由
- [x] 2.2 按作用域分组生成计划，每批一个计划，不把不同 scope 混进同一计划
- [x] 2.3 自动签发：`approved_by='local_cli'`、`channel='policy:<id>:<hash8>'`，不新建枚举值
- [x] 2.4 审计事件强制携带 `policyId` 与 `policyHash` 前缀，缺任一即拒绝写入
- [x] 2.5 汇总：`applied`、`skipped`、`manualByCondition`、`failedByCode`，且输出总数字可与批次条目数校验相等
- [x] 2.6 `revokeByPolicy(policyId, batchId)`：转 tombstone、写撤销事件、保留修订历史
- [x] 2.7 验证：`tests/onboarding/auto.test.ts`，覆盖全条件满足、两层不一致转入 manual、敏感度超限、部分失败不中断、汇总数学一致、撤销后可重新整理、伪造 `channel` 被拒

## 3. 去重与写入时判断

- [x] 3.1 `src/governance/dedup.ts`：`findDuplicate(store, scopeId, normalizedContent)` 返回命中的 active 记忆或 `null`，是三个调用点共用的唯一判定
- [x] 3.2 `propose`：同批次内按 `normalized_content + scopeId` 分组，同组只产出一个 `add`，其余 `skip` 且 reason 为 `repeatOf:<itemId>`，证据合并到保留项
- [x] 3.3 `apply` 的 `add` 分支：插入前调用 3.1，命中则只追加证据与来源并标注 `deduped`
- [x] 3.4 迁移 `003_dedup_v1`：`CREATE INDEX IF NOT EXISTS memory_scope_content ON memory(scope_id, content_hash)`，非唯一（查询键是 content_hash，不是 normalized_content——后者只是 hash 的输入）
- [x] 3.5 `src/onboarding/judgement.ts`：判断的解析与校验（`verdict` / `confidence` / `rationale` / `dedupe`），非法值直接拒绝，不用默认值补齐
- [x] 3.6 `AppService.addMemory` 接受可选 `judgement`：校验 → 用 3.1 查重 → 落实判断 → 审计（记录判断来源、理由、结论）
- [x] 3.7 `verdict=skip` 的分档：高置信不写库并审计；中低置信写为 candidate 并标注待确认，不得静默丢弃
- [x] 3.8 `memory_add` 与 `cairn add` 暴露判断参数（MCP 用对象参数，CLI 用 `--judgement/--confidence/--rationale/--dedupe`），帮助文本与 `VALUE_FLAGS` 同步
- [x] 3.9 验证：`tests/governance/dedup.test.ts`（三批次收敛为一条、重复应用幂等、`keep_both` 不被合并、跨作用域各存一条、重复条目在待决策中可见）+ `tests/onboarding/judgement.test.ts`（六类非法判断各被拒、敏感度不可降级、作用域不可扩大、skip 低置信转候选、写时判断不落入待决策队列）+ `tests/interfaces/write-judgement.test.ts`（10 项端到端：二次写入并入而不新建、证据累积、keep_both 并存、merge_into 越界被拒、候选被命中时晋升而不留两条、审计留痕）

## 4. 导入工作台

- [x] 4.1 `src/interfaces/console/model.ts`：`buildImportRows()` 合成 `archive + batch` 单行，含 `importCount` 与 `lastImportedAt`
- [x] 4.2 `assets/ui-js.ts`：`renderImports()` 单表替换快照/批次/待处理三视图，行内给出 total/clean/blocked/promoted/remaining
- [x] 4.3 抽屉组件：右侧覆盖面板、`role="dialog"`、焦点移入与归还、Esc/遮罩/按钮三入口共用关闭逻辑
- [x] 4.4 来源折叠：同 `sourceLabel` 默认只展开最新一次，历史进 `<details>`，库内数据不动
- [x] 4.5 抽屉内批量处理："按建议全部处理"先展示动作分布与条数，确认后生成计划；两层不一致或不满足策略的条目不纳入并单独列出
- [x] 4.6 自动整理结果呈现：批次行显示本次摘要与策略标识，提供按策略撤销入口
- [x] 4.7 `assets/url-state.ts`：新增 `drawer` 与 `item` 字段，刷新与分享可还原
- [x] 4.8 验证：`tests/console/{assets,url-state,model,render,server}.test.ts` 增补抽屉、折叠、批量、地址往返与 `/api/imports`、`/api/policies`、`/api/onboarding/{auto,revoke}`，旧视图断言同步更新（浏览器端点击验证并入 7.3 的真服务冒烟）

## 5. CLI

- [x] 5.1 `cairn policy sign|list|revoke`，含 `--json` 与退出码
- [x] 5.2 `cairn onboard auto --policy <id> [--batch <id>] [--dry-run]`，`--dry-run` 只输出分档结果不写库
- [x] 5.3 帮助文本与 `VALUE_FLAGS` 同步（`policy`、`batch`）
- [x] 5.4 验证：`tests/interfaces/policy-cli.test.ts`，覆盖签发、改动后运行被拒、dry-run 零写入（字节级 sha256 比对）、撤销

## 6. MCP

- [x] 6.1 `memory_decide`：`action=next|submit|auto`，只服务没有在场写入方的存量导入条目；`next` 受字符预算与条数上限约束，`submit` 逐条校验，`auto` 只消费已签发策略
- [x] 6.2 明确禁止：`memory_decide` 不接受策略内容、不接受 channel 参数，无法签发策略
- [x] 6.3 验证：`tests/interfaces/decide-mcp.test.ts`，覆盖三步闭环、越界条目整批拒绝、陈旧结果不采信、无法通过该工具签发策略、已落库的写时判断不被事后通道覆盖

## 7. 文档与验收

- [x] 7.1 `docs/cairn-auto-onboarding.md`：策略字段说明、条件顺序与理由、撤销路径、与既有治理约束的关系
- [x] 7.2 README 快速开始、AGENTS.md 当前入口、`docs/M0-session-handoff.md` 回写
- [x] 7.3 真实库只读冒烟：扩展 `scripts/smoke-console.mjs` 覆盖导入视图与抽屉接口，断言 `cairn.db` 字节级 sha256 前后一致、零表变化（18 端点全绿，`verdict PASS`，`changedTables []`）
- [x] 7.4 合成 HOME 端到端：构造与真实库同构的 fixture（533 条含 143 结构残片 / 45 blocked / 23 组重复正文），跑完整自动整理，断言人工队列只剩两位数、同内容收敛为一条（`npm run test:e2e`：auto 488 / manual 45 / applied 336 / skipped 152 / failed 0，336 条 active 对应 336 个不同正文，`maxPerContent=1`）
- [x] 7.5 `npm test` 三连跑 + `tsc --noEmit` + `npm pack --dry-run`，核对测试数只增不减（606/605/0/1 连续三次一致；typecheck 0；pack 214 files / 320.5 kB）
- [x] 7.6 `openspec validate add-auto-onboarding` 与 `--strict`，核对 4/4 制品

## 8. 实施后追加（审阅时未识别、实施中发现）

- [x] 8.1 「已晋升」谓词收敛为唯一出处 `promotedPredicate()`：实施中发现它在 6 个文件里各写一份，`policy revoke` 的语义正是在其中一处漏掉的（撤销后条目永远卡在"已处理"，重做 `applied=0`）
- [x] 8.2 `auto` 生成 merge op 改取规则层给的 `targetMemoryId`：原来用 `findDuplicate(content)` 取目标，对"正文不同但近似"的条目会静默降级成 `add`，多出重复记忆
- [x] 8.3 同批重复改用 `skipped` + `E_DUPLICATE`：原来记 `E_PLAN_INVALID` + `failed`，端到端跑出 56 条"失败"假象
- [x] 8.4 `onboarding revoke --policy <id>`：撤销"结果"原来在 CLI 里没有入口（只有撤销授权）；`revoked` 审计补 `batchIds`，整策略撤销时界面才显示得出"已撤销"
- [x] 8.5 浏览器点击级验收 `npm run test:ui`（`scripts/e2e-console-ui.mjs`，Playwright + 系统 Chrome）：46/46，报告落 `artifacts/console-ui-<date>.json`。抓到并修掉三个真缺陷——摘令牌时清掉整个 query、切视图不关抽屉（遮罩挡住导航）、策略下拉不记选择；对应形状断言留在 `tests/console/assets.test.ts`
