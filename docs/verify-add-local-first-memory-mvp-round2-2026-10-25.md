# 第二轮独立验证：修复后复核

日期：2026-10-25
复核对象：`a98fd6b`（修复）、`92b23fa`（归档）、`6a8a49f`（strict 校验修正）
环境：Windows x64 / Node v22.22.2 / OpenSpec CLI 1.14.3

## 1. 结论

上一轮报告的 3 个 P1 修掉了 2.5 个：P1-2 包入口、P1-3 打包卫生**已彻底修好**；P1-1 的测试竞态**已修好**，但修复过程中暴露出的**底层产品缺陷没有修完**——并发冷启动时 `openStore` 仍会抛 `attempt to write a readonly database`。

因此当前状态仍不满足 archive 前提，而变更**已经被归档**（`92b23fa`，在修复提交后 39 秒）。

| 判定项 | 结果 |
|---|---|
| P1-1 MCP 用例竞态 | 已修好。`mcp.test.ts` 单文件连跑 3 次均 4/4 通过，改为等 stdio ready + 等响应 |
| P1-1 底层迁移/打开竞态 | **未修好**。4 进程冷启动失败率 20%，全量测试 6 轮中 2 轮失败 |
| P1-2 包入口 | 已修好。root 125 导出 / core 35 导出，`import('@cairn/memory')` 正常 |
| P1-3 打包卫生 | 已修好。142 files / 171kB，无 `dist/tests`，CHANGELOG 已补 |
| P2 文档漂移 | 修了 3 处，但**新增 3 处与事实相反的表述** |
| archive 时机 | **不合规**。测试未稳定绿即归档，且归档后文档仍写"尚未 archive" |

## 2. 仍未修复的产品缺陷（P1）

### 现象

全新数据目录下，多个进程同时冷启动打开同一个库，部分进程直接失败：

```
[cairn] 未预期错误: Error: attempt to write a readonly database
    at openStore (src/store/open.ts:100:12)
    at CairnDb.run (src/store/db.ts:59:34)
```

`open.ts:100` 是迁移后紧接着的那条 `INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_created_at', ?)`。

### 实测数据

| 场景 | 样本 | 失败 |
|---|---|---|
| 3 个 CLI 同时冷启动 `add`（真实用户场景） | 40 轮 × 3 进程 = 120 | 11 轮失败，**12/120 进程失败（10%）** |
| 4 进程冷启动并发写（复刻 `concurrency.test.ts`） | 40 轮 × 4 进程 = 160 | 8 轮失败（20%） |
| 同上，错误签名统计 | 25 轮 × 4 进程 = 100 | 7/100 失败，**7 次全是同一个签名**：`SQLITE_READONLY` @ `open.ts:100` |
| 先 `init` 再并发写（预初始化库） | 10 轮 × 4 进程 | 0 失败 → 只在"建库"阶段触发 |
| `concurrency.test.ts` 单文件连跑 | 3 次 | **2 次失败**，1 次通过 |
| 全量 `npm test` 连跑 | 6 次 | **2 次失败**（run1、run6，均卡在 `not ok 55 并发：4 进程同时写入同一本地库`），4 次通过 |

### 根因定位

`CairnDb.open`（`db.ts:33`）在每次打开时执行 `PRAGMA journal_mode = WAL`。多个进程同时首次创建同一个库时，该语句与另一方的建库/加锁交错，连接落入可写失败状态；随后 `openStore` 的第一条写语句即抛 `SQLITE_READONLY`（errcode 8）。`busy_timeout` 对 `SQLITE_READONLY` 不生效，因此不会被现有忙等待机制吸收。

`a98fd6b` 把迁移循环改成"持写锁后重读版本号"，解决了 DDL 重复建表的冲突，但**没有覆盖紧随其后的写语句**，故障点只是从迁移 DDL 前移到了 meta 插入。

该缺陷在修复前就存在（`git show fe38efd:src/store/open.ts` 第 100 行与 `db.ts` 的 WAL 设置完全相同），不是本次修复引入的。

### 建议修法

1. 把 `CairnDb.open` + `runMigrations` + `meta` 写入 + `registerDevice` 整段包成有界重试（如 5 次，50→800ms 退避），对 `SQLITE_READONLY(8)` / `SQLITE_BUSY(5)` / `SQLITE_LOCKED(6)` 重开连接重试；与现有 `E_DB_LOCKED` 重试契约保持一致。
2. `PRAGMA journal_mode = WAL` 执行后校验返回值确为 `wal`，不是则重试。
3. 首建库用 `O_EXCL` 抢占式创建，只有一个进程执行初始化，其余等待后再打开。
4. 补一条确定性的回归测试（现有 `concurrency.test.ts` 是概率命中，单跑 2/3 失败、也可能 3/3 通过，不能作为稳定门禁）。

## 3. 已确认修好的部分

- **MCP 用例**：`waitReady()` 等 stderr 的 `stdio server ready`，各步改用 `responseOf(id)` 轮询，固定睡眠全部去掉。单文件 3 次全 4/4 通过。
- **包入口**：`src/index.ts` 聚合导出已加，root 125 / core 35，两种导入均成功。
- **打包**：`tsconfig.build.json` 只编 `src`；`npm pack` 142 files / 171kB / 解包 667kB，`dist/tests` 已归零，`CHANGELOG.md` 已存在。
- **OpenSpec**：`openspec list` 无活跃变更，5 份规格已合并进 `openspec/specs/`，29 条 Requirement 完整保留，`validate --all --strict` 5/5 通过。
- **P2 已修正项**：`design.md` D9 改为 `cairn worker run-once`；handoff 项目路径已标注迁移；重放语义改写准确（已应用计划幂等短路 `alreadyApplied`，未应用计划 `E_APPROVAL_REPLAY` 拒绝）；`config.yaml` 的 Delegation 规则已与 `AGENTS.md` 对齐（ZCode 子代理）。

## 4. 新引入的文档错误（P2）

| 位置 | 现内容 | 事实 |
|---|---|---|
| `README.md:15` | "已实现并通过全部测试（296 项，npm test exit 0，**经独立验证报告复核**）" | 6 轮全量有 2 轮失败；且第一轮验证报告的结论与"复核通过"相反 |
| `openspec/config.yaml:8` | "Stage: …已完成实现并通过独立验证（296 项测试）；**尚未 archive**" | 已在 `92b23fa` 归档，`openspec list` 无活跃变更 |
| `docs/M0-session-handoff.md:166` | "296 项测试全部通过，npm test exit 0；…**变更尚未 archive**" | 同上；该节第 6 条仍写"决定是否 archive" |

另：handoff 第 4 节"平台：仅 Windows x64 + Node 24 验证；`node:sqlite` 在 Node 22 上未复验"已过期——本次两轮都在 Node 22.22.2 上跑的，且正是 22 上暴露了上述并发缺陷。

## 5. 流程问题

- `a98fd6b`（11:04:13）→ `92b23fa`（11:04:52），修复提交 39 秒后即归档，中间没有稳定性复跑。
- `AGENTS.md` 要求"archive 前核对测试证据和文档；外部未验证项不得靠归档消失"。当前归档基于单次绿灯，而该绿灯在复跑下不可重现（6 轮 2 失败）。
- 归档产物 `openspec/changes/archive/2026-10-25-add-local-first-memory-mvp/tasks.md` 仍写"296 项测试全部通过"，与归档依据不一致。

## 6. 建议

1. 修 `openStore` 冷启动竞态（第 2 节建议修法 1+2，最小改动即可消除 `SQLITE_READONLY`）。
2. 把 `concurrency.test.ts` 从"概率命中"改成确定性用例（预置 `O_EXCL` 抢占或注入并发时序）。
3. 修 `README.md:15`、`config.yaml:8`、`handoff:166` 三处与事实相反的表述；`npm test` 连续 5 轮全绿后再写"全部通过"。
4. 归档已完成，不建议回滚归档动作；但应在 handoff 追加一节说明"归档时遗留的冷启动竞态与其修复状态"，避免后续会话把归档当成"全部清零"。

## 7. 本轮探针

| 脚本 | 用途 |
|---|---|
| `artifacts/verify-2026-10-25/probe-user-cold-start.mjs` | 真实场景：3 个 CLI 同时冷启动 `add` |
| `artifacts/verify-2026-10-25/probe-cold-start-race.mjs` | 4 进程冷启动并发写复刻 |
| `artifacts/verify-2026-10-25/probe-error-tally.mjs` | 错误签名分布统计（单一根因确认） |
| `artifacts/verify-2026-10-25/probe-cold-start-diag.mjs` | 抓取失败进程完整堆栈 |
| `artifacts/verify-2026-10-25/probe-preinit-vs-cold.mjs` | 预初始化库 vs 冷启动对比 |

## 8. 对第一轮结论的更正

第一轮判定"MCP 用例失败是测试竞态、不是产品缺陷"——就该用例而言成立（等响应后数据确实持久化）。但当时没有对**冷启动并发**单独加压，因此漏掉了同一路径下的真实缺陷 `SQLITE_READONLY`。本轮已补测并定位到 `open.ts:100`。
