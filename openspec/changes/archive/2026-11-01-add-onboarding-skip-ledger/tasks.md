# Tasks

## 1. 跳过事实的写入

- [x] 1.1 `src/onboarding/batches.ts`：新增 `SKIPPED_ACTION='item_skipped'` 与 `markItemSkipped(store, itemId, {basis, reasonCode?})`，写 `audit_event`（category='onboarding'，detail 含 itemId/basis/reasonCode，**不含正文**）；验证：`tests/onboarding/skip-ledger.test.ts` 断言写入成功且 detail 无正文
- [x] 1.2 幂等：同 `(itemId, basis)` 重复标记不产生第二条审计；验证：同文件连续两次调用后计数不变
- [x] 1.3 与晋升互斥的边界：已晋升的条目再记跳过时按追加事实处理，不抛错；最终「是否需要处理」以已处理为准；验证：同文件断言两条事实并存且 remaining 为 0
- [x] 1.4 `blocked` 条目拒绝写入跳过事实（`E_VALIDATION`）；验证：同文件用 blocked 条目断言抛错且审计数不变

## 2. 谓词扩展（唯一出处）

- [x] 2.1 `promotedPredicate()` 扩展为同时给出 `skipped*` 与 `handled*`（promoted OR skipped），**`exists/notExists` 语义保持不变**；验证：`tests/onboarding/batches.test.ts` 断言三个谓词在两两组合下的布尔正确性
- [x] 2.2 `batchProgress()` 的 `remaining` 改用 `handledNotExists`，并新增 `skipped` 字段；验证：同文件断言 `total = promoted + skipped + remaining + blocked` 平衡
- [x] 2.3 `nextBatchChunk()` 改用 `handledNotExists`，已跳过条目不返回；验证：同文件断言跳过后再取切片不含该条目
- [x] 2.4 全仓库不得出现新的手写 `action = 'item_promoted'` 子句；验证：grep 计数检查（预期仅 `batches.ts` 内出现且不新增调用点）

## 3. 判定入口接线

- [x] 3.1 `src/onboarding/auto.ts` 的 skip 分支：真实运行（非 dry-run）时对每条 skip/needs_human 调 `markItemSkipped`；验证：`tests/onboarding/auto.test.ts` 断言 dry-run 不写、真实运行写入
- [x] 3.2 `src/interfaces/app-service.ts` 的 `memory_decide` skip 分支接线；验证：`tests/interfaces/decide-mcp.test.ts` 断言决定为 skip 后写入跳过事实
- [x] 3.3 `--redo` 语义：带重做标记时忽略 handled 谓词重新选择条目，**不删除既有审计**；验证：`tests/onboarding/auto.test.ts` 断言 redo 后条目重新进入判定且审计条数只增

## 4. 查询接口

- [x] 4.1 CLI `onboarding status` 输出增加 `skipped` 字段；验证：`tests/interfaces` 下断言字段存在且与库一致
- [x] 4.2 CLI 支持查询某批次的已跳过条目（条目 id + 依据 + 理由），只读；验证：断言返回条数与库内跳过事实数一致
- [x] 4.3 文档：`docs/cairn-auto-onboarding.md` 增补「跳过是粘性的、可查的、需 redo 才重来」一节；验证：文档命令可复制执行

## 5. 控制台呈现

- [x] 5.1 `src/interfaces/console/model.ts`：批次行与汇总增 `skipped` 列，`remaining` 口径同步；验证：`tests/console/model` 断言两列独立且平衡
- [x] 5.2 `assets/ui-js.ts`：抽屉内分区呈现「已跳过及其依据」，不是从列表移除；验证：`tests/console/assets.test.ts` 形状断言
- [x] 5.3 静态导出同样含已跳过分区；验证：`npm run test:ui` 覆盖静态页断言

## 6. 集成验收

- [x] 6.1 全量测试 `npm test` 全绿，计数较基线（636）净增，0 失败
- [x] 6.2 真实库只读核对：`onboarding status` 显示 `remaining=470`、`skipped=0`（历史未回填，符合 design 的显式说明），并确认 promoted=18
- [x] 6.3 临时 HOME 端到端：造 10 条 fixture，判 6 条 skip、4 条 promote，断言最终 `remaining=0`、`skipped=6`、`promoted=4`，且被跳过条目仍可查询

## Workflow follow-up

- 变更归档前需用户审阅四个制品。
- 归档时把两条 delta 合并进 `auto-onboarding` 与 `local-console` 主规格。
