# 云端记忆对账验证（2026-11-16，只读）

> 环境：主设备 `dev_01a18002-defd-7ba9-acd0-ae3fb1606b4e`（Windows，`~/.cairn`，schema v7，cairn 0.6.3）+ syncd 中继 `http://100.65.135.122:8471`（Tailscale 内网，vault `01a1c44b-d59d-7464-a954-18b7074aa747`，`preserveDeviceBound = true`）。
> 对端设备 `dev_01a1bdfb-a85f-74c7-8a3f-b505830b54b4`（0.6.3）。
> **本轮未执行任何写操作**：未 `sync push`、未 `forget`、未 `rescope`、未改 `src/`。

## 0. 起因

对端 agent 报告"云端记忆被对端覆盖，本机 47 条、云端应 46 条少一条"。本文件是对该说法的独立核对结论。

## 1. 方法

1. `cairn status` / `cairn doctor` / `cairn vault status`（只读命令）。
2. 解密列举远端全部对象：`scripts/audit-remote-preserve.mjs` 同构的只读脚本，遍历 `personal-global/devices/*` 与 `preserve/<本机>/devices/*`，逐 chunk 解密（AAD 按 space/kind/objectId 绑定），**0 解密失败**。
3. 与本机库按**内容哈希血统**逐条对齐（本地 id 不可跨设备引用，这是既有设计约束）；本地一方取 `memory.content_hash` 与全部 `memory_revision.content_hash` 的并集。
4. 明文泄露扫描：取 8 条保管链记忆正文前 24 字节片段，在全部远端原始字节中检索，**0 命中**。

对应脚本：`artifacts/cloud-align2.cjs`、`artifacts/cloud-align3.cjs`、`artifacts/cloud-align4.cjs`、`artifacts/coverage-final.cjs`、`artifacts/scope-forensics.cjs`（均为只读连接 + 只读列举）。

## 2. 云端实际内容（解密后）

| 链 | 设备段 | 事件数 | 构成 | manifest headSeq |
|---|---|---|---|---|
| `personal-global` | 本机 `dev_01a18002` | **87** | 46 upsert + 3 tombstone + **38 scope_exit** | **87** |
| `personal-global` | 对端 `dev_01a1bdfb` | 43 | 全部 upsert | 43 |
| `preserve/dev_01a18002` | 本机 | 48 | 全部 upsert（project-global 27 + device-local 21） | 144 |

远端对象总数 **15**（13 个 personal 对象 + 2 个 preserve 对象）。

与本机对账：本机 `status.sync.chains[personal-global].localSeq = 87`、`gap = 0`，与云端本机段 headSeq **完全一致**。

## 3. 关键结论

### 3.1 没有"覆盖"

同步链是**每设备每空间单写者的追加链**，本机段与对端段是两条独立的 87 / 43 事件段，物理上不存在跨设备覆写入口。syncd 的 `DELETE` 只放行解码后 key 含 `/backups/` 的对象（`docs/cairn-sync.md` §自建 syncd），同步链对象服务端一律拒绝删除。

### 3.2 本机是内容超集

- 云端 137 条 upsert 事件（含历史修订），**去重后 59 个内容哈希**。
- 本机 65 个内容哈希，**云端 59 ⊆ 本机 65**，`cloudOnly = 0` —— 云端没有任何本机不存在的内容。
- 本机独有 6 个哈希**全部不是生效内容**（已遗忘或历史修订），生效内容中 `localOnlyActive = []`。

### 3.3 上行无积压

`outbox_job`：168 done / **0 pending / 0 retry / 0 failed / 0 dead / 0 conflict**；`doctor.counts.upstreamGap = 0`；`cairn sync backfill` 只读预演**候选 0 条**（个人链 0、保管链 0、迁出通知 0）。

### 3.4 对端报告的两处偏差

| 对端说法 | 实测 |
|---|---|
| "云端少一条，应显示 46" | 那是**对端本机 `outbox_job` 的 pending 任务**（`01a1df7e-2276-…`，attempts 0，worker 未跑），不是云端缺内容。 |
| 样本记忆 `01a1df7e-2273-7768-8b6c-51d7e6ab1987` | **我们的云端里不存在这条**（扫描全部 137 条 upsert，无匹配 memoryId）。它是对端本地未上行的内容。 |

## 4. 同内容不同作用域的 36 条

对端 43 条 upsert 按内容哈希映射到本机：

| 类别 | 条数 | 本机现状 |
|---|---|---|
| 仍在本机 personal-global | 7 | 6 active + 1 tombstoned（作用域一致，无需处理） |
| 内容一致但已迁到 **project-global** | **26** | hdrs6 22 / cairn 3 / fsmp 1 |
| 内容一致但已迁到 **device-local** | **10** | 本机限定 |
| 本机不存在 | 0 | — |

覆盖关系：

- 本机段共发出 **38 条 `scope_exit`**，覆盖上述 **36 条**（多出 2 条对应本机迁出、但对端从未上行过的记忆）。
- 另一维度交叉验证：`sync_pushed:personal-global:` 元数据存在 **38** 条（27 project + 11 device-local），与发出迁出通知的 38 条数量吻合 —— 迁出完整性没有漏项。
- 本机审计：`scope_exit_applied` 38、`upsert_shadowed_by_scope_exit` 38（迟到修订被正确挡住，没有把已迁出内容拉回个人链）。
- 对端 2026-11-15 实测已收到 27 条迁出通知（`docs/verify-preserve-mode-2026-11-15.md` P3：active 33→6、archived 11→38、总数 46 不变）。

## 5. 判定的边界（必须区分"数据正确"与"能力缺失"）

数据层面：**无需修改云端**。三条链的内容未丢失、未错位、无积压。

能力层面：**项目作用域内容目前不可能跨设备**。`preserveDeviceBound = true` 下：

- `syncableChains()` = 个人链 + **本设备**保管链；
- `pull` 对他人 `preserve/` 前缀完全不列举（`tests/sync/preserve-mode.test.ts`「他人保管链不拉取」是固化的断言）；
- 关闭保管模式则项目内容走 `sync_job_unroutable` 审计，同样不出本机。

即：那 26 条 project-global 与 10 条 device-local，**现有实现在任何配置下都不会到对端**。要让对端拿到与作用域一致的治理结果，必须扩展同步协议（见 `docs/cloud-reconcile-plan-2026-11-16.md` 阶段 1–3）。

## 6. 可复现命令

```bash
# 只读状态
npm run cli -- status
npm run cli -- doctor
npm run cli -- vault status
npm run cli -- sync backfill        # 默认只读预演，不联网

# 云端全量审计（只读；需要 CAIRN_SYNCD_TOKEN / CAIRN_SYNCD_URL 环境变量）
node scripts/audit-remote-preserve.mjs

# 本轮对齐脚本（只读连接 + 只读列举）
node artifacts/cloud-align2.cjs
node artifacts/coverage-final.cjs
```

## 7. 遗留

1. 个人链 `chunks/` 下有 3 个历史探针对象 `probe300k-1/2/3.bin`，syncd 只放行 `/backups/` 的 DELETE，**清不掉**；需要 `add-syncd-purge` 变更（已在 handoff §3 待办 B）。
2. `preserve/<本机>` 链保留了 26 条项目内容的历史副本（追加语义，服务端不可删）。协议扩展后它们会成为"历史副本"，不建议也无法回收。
