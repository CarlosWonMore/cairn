# Tasks: 上行入队完备性与冷启动对账

> 验收纪律：每个任务都要有可复跑的机器证据（测试名或命令 + 期望输出）。不得以"已实现"代替"已验证"。
> 硬边界（写错即返工）：入队**不下沉**到 `src/store/memories.ts`；`src/sync/apply.ts` 与 `src/sync/pull.ts` 保持零入队。

## 1. 现状与防线

- [x] 1.1 在 `tests/sync/` 增加回归用例：执行 `sync pull` 应用远端事件（含新增与修订）后，`outbox_job` 中 `sync_upstream` 的待办数不变。**这条先写、先跑，作为后续改动的护栏。**
- [x] 1.2 用 `grep` 固化"存储层无入队"这一事实：`src/store/memories.ts` 不 import `outbox`；在用例或注释中记录该边界，防止后来者下沉。

## 2. 单点判定

- [x] 2.1 确认 `scopeAllowsUpstream` 仍是唯一准入判断；新增入口一律复用它。若发现第二处自行比较 `syncPolicy` 的实现，合并到该函数（预期不存在，需在报告中给出 grep 结果作为证据）。
- [x] 2.2 验证 `outbox.enqueue` 的作用域物理排除仍会写 `scope_exclusion` 审计；补一条断言覆盖 `device_bound` 分支（现有用例可能只覆盖了 `local_only` 分支）。

## 3. 治理层补落点（`src/governance/apply.ts`）

- [x] 3.1 `add` 分支：`memories.add` 成功后，按返回记忆的 `scopeId` 判定并入队；幂等键 `memory:<id>`。
- [x] 3.2 `keep_both` 分支：同 3.1（它与 `add` 共用落库代码，确认不是遗漏分支）。
- [x] 3.3 `merge` 分支：`memories.revise` 后按**目标记忆的实际作用域**入队；幂等键含新修订标识 `memory:<targetId>:rev:<revisionId>`，与 `reviseMemory` 一致。
- [x] 3.4 入队失败不得中断计划应用：作用域被排除属正常返回，不得抛错、不得把 op 标记为 failed。
- [x] 3.5 测试：三类操作（add / merge / keep_both）各写一条用例，断言应用后每条目标记忆都有对应的 `sync_upstream` 行；另写一条用例断言设备限定目标零行。

## 4. 编排层补落点（`src/interfaces/app-service.ts`）

- [x] 4.1 `rejectCandidate()`：转墓碑后补一条墓碑语义的上行任务，幂等键与 `forgetMemory` 保持同一形状（`memory:<id>:tombstone`）。
- [x] 4.2 `applyDecision()` 的 `merge` 分支：目标记忆内容被替换后补上行。
- [x] 4.3 `applyDecision()` 的 `promote_candidate` 分支：候选晋升为 active 后补上行（当前只在 `promoteCandidate()` 里有，两处要对齐）。
- [x] 4.4 测试：`rejectCandidate` 后有且仅有一条墓碑任务；重复调用不产生第二条。

## 5. 对账命令 `cairn sync backfill`

- [x] 5.1 新增 `src/sync/backfill.ts`，导出 `findUpstreamGap(store)`（只读，返回 `{memoryId, scopeId}[]`）与 `backfillUpstream(store, {apply, limit})`。
- [x] 5.2 缺口 SQL 按 design D3 实现：`status='active'` + 作用域 `encrypted` + `device_id='all'` + `NOT EXISTS(任意状态的 sync_upstream)`；**不限制 job 状态**。
- [x] 5.3 CLI：`cairn sync backfill [--apply] [--limit N]`，默认只读；`--json` 输出 `{candidates, enqueued, existing, excluded, memoryIds}`。
- [x] 5.4 帮助文本中加入该子命令，标注"只写本地队列，不与云端交互"。
- [x] 5.5 测试：dry-run 前后 outbox 完全一致（用行数与 payload 哈希比对）；`--apply` 后缺口归零；连续两次 `--apply` 第二次新增为 0；`device-local` 记忆不计入候选且不产生行。
- [x] 5.6 测试：远端已配置但网络不可达时执行 `--apply` 仍成功退出，且无网络调用（可用不可解析的 baseUrl 或断言不 import 任何 RemoteStore）。

## 6. 可观测性

- [x] 6.1 `doctor` 增加 `counts.upstreamGap`，健康时恒为 0。
- [x] 6.2 非零时在 `notes` 给出一行可执行提示（指向 `cairn sync backfill`），**不进 `problems`**、不改变退出码。
- [x] 6.3 测试：构造缺口后 `doctor` 报出准确计数且 `ok` 仍为 true；补齐后计数为 0。
- [x] 6.4 记录该查询的实测耗时（当前规模），并在 design 的"未决与延后"里保留规模上限说明。

## 7. 占位断言与既有测试

- [x] 7.1 派发前普查：`grep -rn "不在本批\|待 [0-9]\|后续变更\|本批不" tests/`，把结果列进任务报告。
- [x] 7.2 凡既有用例断言"`applyPlan` / `rejectCandidate` 后无 outbox 行"者，属被本变更契约推翻的**占位断言**，必须更新，并在报告中逐条列出（原断言 → 新断言 → 依据的 spec 条目）。
- [x] 7.3 既有行为的守护断言只许追加，不许改写。

## 8. 全量验收

- [x] 8.1 `npm run typecheck` 通过（0 错误）。
- [x] 8.2 `npm test` 全量通过；记录 **测试总数 / 通过数 / 失败数 / skip 数**，与基线（2026-10-30 起 609/608/0/1）对比并解释增量。
- [x] 8.3 `openspec validate add-sync-outbox-completeness --strict` 通过。
- [x] 8.4 变异对照：任选一处**承重断言**（建议 5.3 的"不限制 job 状态"或 6.1 的缺口计数），用纯数据方式改坏实现，确认对应测试变红且**只有该条**变红，然后还原并用 `git diff` 确认干净。
- [ ] 8.5 在真实库的副本上跑 `cairn sync backfill` dry-run，记录候选数（预期接近 23），**不执行 `--apply`**（真实库上的应用由用户单独授权）。
  - 已完成副本验证：候选 23、`--apply` 后归零、`doctor.upstreamGap` 23→0、副本已删。**真实库尚未 `--apply`**，需用户单独授权。

## 9. 文档

- [x] 9.1 更新 `docs/cairn-sync.md`：加入 `sync backfill` 的用途、只读语义与典型用法（首次启用同步后跑一次）。
- [x] 9.2 在 `docs/cairn-sync.md` 的安全边界节补一句：本命令不产生任何网络请求。
- [x] 9.3 更新 `CHANGELOG.md` 的 Unreleased 段。