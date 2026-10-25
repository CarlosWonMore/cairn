# 独立验证报告：add-local-first-memory-mvp

日期：2026-10-25
验证环境：Windows x64 / Node v22.22.2 / npm 10.9.7 / OpenSpec CLI 1.14.3
验证方式：不采信交接文档与 tasks.md 自述，全部结论来自本机复跑与隔离实验。

## 1. 结论

产品能力真实可用，边界标注诚实，OpenSpec 制品结构完整。但**当前状态不能按"全部测试通过"验收，也不宜直接 archive**：

| 判定项 | 结果 |
|---|---|
| 功能是否与规格一致 | 基本一致（29 条 Requirement / 42 个 Scenario 均有实现入口与测试覆盖，抽查负向行为全部成立） |
| 是否可复现"296 项测试全部通过" | **否**。本机稳定 295 pass / 1 fail，三次复跑一致，exit 1 |
| 该失败是否为产品缺陷 | **否**。是测试自身的固定睡眠竞态，写入路径经隔离实验证明可靠 |
| 包分发是否可用 | CLI/MCP bin 可用；库入口 `import('@cairn/memory')` 失效；包内混入 87 个测试编译产物 |
| 文档与实现是否一致 | 存在 4 处漂移，其中 1 处是流程规则互相冲突 |

建议：先修 3 个 P1（测试竞态、包入口、打包卫生），再修正"296 全通过"的表述，然后才做 verify/archive。

## 2. 独立复跑记录

| 检查 | 命令 | 实测结果 |
|---|---|---|
| OpenSpec 单变更校验 | `openspec validate add-local-first-memory-mvp --strict` | valid: true，issues: [] |
| OpenSpec 全量校验 | `openspec validate --all --strict` | passed，failed: 0 |
| 制品完成度 | `openspec status` | proposal / specs / design / tasks 4/4，tasks 37/37 |
| 类型检查 | `npm run typecheck` | exit 0，无输出 |
| 全量测试（3 次） | `npm test` | 3 次均为 tests 296 / pass 295 / fail 1 / exit 1，单轮约 31s |
| 失败用例隔离复跑 | `tsx --test tests/interfaces/mcp.test.ts` | 单文件也失败（3/4），与并发无关，稳定复现 |
| 包安装冒烟 | `npm pack` → 全新目录 `npm install` → init/add/search | 全通过，bin shim `cairn` / `cairn-mcp` 正常，包内无 `*.db` |
| 工作区状态 | `git status` | 干净，11 次提交，remote 指向 CarlosWonMore/cairn |

测试断言总量 1,397 条，无 `skip` / `todo`，无空测试。

## 3. 问题清单

### P1-1 测试竞态：`npm test` 在本机稳定失败 1 项

- 失败用例：`MCP：客户端断开后服务器退出，本地库仍可被 CLI 使用（会话隔离）`
- 位置：`tests/interfaces/mcp.test.ts:144`，断言在 `:169`，报错 `0 !== 1`
- 直接原因：`:159` 发出 `memory_add` 后，`:160` 只做 `await probe.wait(500)` 就 `kill()`，从未等待 id=20 的响应。本机 tsx 启动 + 首写耗时超过 500ms，进程被杀时写入尚未发生。
- 隔离实验（每档 3 轮，脚本见 `artifacts/verify-2026-10-25/probe-mcp-race.mjs`）：

| 条件 | CLI 检索命中数 |
|---|---|
| 固定等 500ms、不等响应（复刻用例） | 0 / 0 / 0 |
| 固定等 2000ms、不等响应 | 1 / 1 / 1 |
| 等待 id=20 响应后再杀 | 1 / 1 / 1 |

- 结论：不是数据丢失、不是 WAL/提交问题，是测试判据不可靠。同模式固定睡眠还有 7 处（`mcp.test.ts` 74/84/88/127/179，`e2e.test.ts` 185/196/206），E2E 用 800/600/500ms 余量更大故通过，属同类隐患。
- 影响：README、tasks.md 第 8 组、handoff 三处"296 项测试全部通过"在本机不可复现，按 AGENTS.md 验收纪律属"报告与复跑矛盾"，不能作为 archive 依据。

### P1-2 包入口指向不存在的文件

```
exports["."] = ./dist/src/index.js   → 不存在（src/ 下也没有 index.ts）
```

- 实测：`import('@cairn/memory')` → `ERR_MODULE_NOT_FOUND`；`import('@cairn/memory/core')` 正常（35 个导出）。
- 影响：CLI/MCP 用户无感，但以库方式消费包的人直接失败。要么补 `src/index.ts` 聚合导出，要么删掉该 exports 映射。

### P1-3 打包卫生：测试产物进包

- `npm pack` 实测：225 files / 1.3MB，其中 `dist/tests/` 占 **87 个文件**。
- 根因：`tsconfig.json` 的 `include` 同时含 `src/**/*.ts` 与 `tests/**/*.ts`，编译产物落在 `dist/tests`；`package.json` 的 `files` 只写了 `dist`。
- 与 tasks.md 7.3"包内不含真实记忆、日志或临时产物"的表述不符（实测确实不含数据库与记忆，但含测试产物）。
- 建议：新增 `tsconfig.build.json` 只编译 `src`，或 `files` 精确到 `dist/src`。

### P2-1 文档一致性漂移（4 处）

| 位置 | 问题 |
|---|---|
| `openspec/config.yaml` context | "Stage: 当前处于 M0 验证与首个变更提案阶段；只有用户明确 apply 后才能实现" —— 实现已完成，状态过期 |
| `openspec/config.yaml` context | "Delegation: 非决策型批量实现…优先派发 CodeBuddy CLI" **与 `AGENTS.md`「2026-10-25 起本地开发不再派发 CodeBuddy CLI」直接冲突**，同一仓库两条相反流程规则 |
| `design.md` D9 | 仍写 `ai-memory worker run-once`，实际命令是 `cairn worker run-once` |
| `docs/M0-session-handoff.md` 第 4 行 | 项目目录写 `D:\Project\AI Memory`，实际为 `D:\Project\AI MemoryGLM` |

### P2-2 其他小问题

| 项 | 说明 |
|---|---|
| `files` 含 `CHANGELOG.md` | 文件不存在；npm 静默忽略，但包清单与实物不符 |
| `package.json` `private: true` | 与"npm 发布 / npx 试用"分发路线冲突；design 已把公开发布列为非目标，属已知延后项，发布前必须处理 |
| 审批重放语义表述 | 实测重放 `apply` 返回 exit 0 + `alreadyApplied: true`、`applied: 0`（幂等短路），并非"拒绝"。实现符合 spec 的幂等要求，但 handoff 写的"审批一次性重放拒绝"不精确 |

## 4. 已验证符合预期的部分

- **真实 CLI 全链路**：`init` → `doctor` → `add` → `search` → `import` → `onboarding status` → `plan create` → `approve` → `apply` → `forget` → `export` 全部按规格工作。
- **doctor 诚实分级**：`remote=not_configured`、`model=not_configured`、`ok=true`，并在 notes 里说明核心不依赖二者；`db.integrity=ok`、`fts.ok=true`。
- **导入不可变性**：导入前后 `sourceHashBefore === sourceHashAfter`，档案 `imported_unverified`，批次 2 条 clean / 0 blocked。
- **治理负向全部成立**：
  - 缺审批 apply → exit 2（用法拒绝）
  - 有效审批 → `applied=2`，检索命中 1
  - 篡改后计划 + 旧审批 → exit 3 `E_APPROVAL_INVALID`
  - `forget` → 状态 `tombstoned`，导出不含已遗忘正文，检索归零
- **库层兜底真实存在**（非仅应用层判断）：`outbox_reject_local_upstream`（非 encrypted 或非 all 设备直接 ABORT）、`memory_reject_blocked_insert/update`、`plan_hash_change_revokes_approval`、`plan_applied_immutable`、FTS 同步触发器。
- **中文检索**：`MCP 会话期间`（中英混合）、`会话期间`、`MCP`、`写入`、全文五种形态全部命中，`matchedBy` 在 fts / like 间按预期切换。
- **打包安装**：全新临时目录安装 tarball 后 CLI 与 MCP bin 可用，init/add/search 通过，包内无数据库文件。
- **规格覆盖率**：5 份 delta spec 共 29 条 Requirement、42 个 Scenario；抽查克隆、投影回环、同名外来条目、local_only、伪造审批、注入、tombstone、supersede、E_TARGET_CHANGED 均有对应测试文件。
- **Node 版本**：文档称仅 Node 24 验证，本次在 Node 22.22.2 上类型检查与功能全部正常（`node:sqlite` 打 ExperimentalWarning，属已知实验性 API 边界）。

## 5. 未验证 / 无法验证项

| 项 | 原因 |
|---|---|
| GitHub 仓库可见性 | 本机无 `gh` CLI，无法核实"私有仓库"声明 |
| 真实 ECS/OBS 同步 | 与文档一致：仅有 `NotConfiguredRemote`，无云端实现 |
| macOS/Linux、真实宿主 CLI 认证 | 与文档一致：fixture-only / blocked，未虚标 |
| 长时间/大数据量检索性能 | 未做规模压测，文档亦未宣称 |

## 6. 建议修复顺序

1. `tests/interfaces/mcp.test.ts:144` 改为等待 id=20 响应后再 kill（其余 7 处固定睡眠按同法收敛为"等响应"，保留超时上限）。
2. 补 `src/index.ts` 聚合导出，或移除 `exports["."]`。
3. 拆 `tsconfig.build.json` 只出 `src` 产物，重跑 `npm pack` 确认 225 → 约 138 文件。
4. 同步修正 4 处文档漂移，并把"296 项全部通过"改为可复现的表述（例如"296 项，其中 1 项为已知时序用例，修复后全绿"）。
5. 上述通过后，再跑一次 `npm test` + `openspec validate --all --strict`，然后进入 verify/archive。

修复动作涉及修改源码与测试，本次未执行，待确认后再动。

## 7. 复现用探针

| 脚本 | 用途 |
|---|---|
| `artifacts/verify-2026-10-25/probe-mcp-race.mjs` | 对比固定睡眠与等待响应两种条件，定位竞态阈值 |
| `artifacts/verify-2026-10-25/probe-mcp-persist.mjs` | 证明 MCP 写入在进程被杀后仍持久化 |
| `artifacts/verify-2026-10-25/probe-governance-e2e.mjs` | 全链路 + 伪造/篡改/重放/遗忘负向用例 |

`artifacts/` 已被 `.gitignore` 排除，不影响仓库状态。
