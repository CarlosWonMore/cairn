## 1. 链键与路由（契约层，先做）

- [x] 1.1 `src/sync/vault.ts`：新增 `PROJECT_CHAIN_PREFIX = 'project/'`、`projectSpaceKey(projectId)`、`isProjectSpaceKey(spaceKey)`、`projectIdFromSpaceKey(spaceKey)`；`syncableChains()` 扩展为「个人链 + 各项目链 + 本设备保管链（模式开启时）」，项目链列表由调用方传入（不在该函数里读 DB 或网络）
- [x] 1.2 `src/sync/route.ts`：`enqueueMemorySync` 中 `project-global` 分支**置于保管链分支之前**——入队 `sync_upstream`（payload 不变），返回 `chain = projectSpaceKey(scope.projectId)`；`project-device` 与 `device-local` 维持原样；`project-global` 缺 `projectId` 时降级到保管链并审计 `sync_job_unroutable`（不得静默）
- [x] 1.3 契约单测：`project-global` 入队 → `sync_upstream` 且 chain 为 `project/<uuid>`；`project-device` → `sync_preserve`；`device-local` 关闭模式 → 零行；`project-global` 无 projectId → 不可路由 + 审计

## 2. push：项目链发布

- [x] 2.1 `src/sync/push.ts` `routeJob()`：`sync_upstream` 且记忆作用域为 `project-global` → `{spaceKey: projectSpaceKey(projectId), role: 'project'}`；`preserveDeviceBound` **不影响**该分支（这是与保管链的关键差别）
- [x] 2.2 `buildEventsForChain`：新增 `role === 'project'` 的物理排除断言（只承载 `project-global`，否则审计不可路由）；事件描述符取当前作用域（`projectId` + `spaceName`），`scopeId` 字段填 `project-global`
- [x] 2.3 `sync_scope_exit` 事件载荷新增 `terminalScope`：从记忆**当前**作用域构造（迁移后即目的地）；记忆已不存在时省略该字段
- [x] 2.4 单测：项目内容 push 后对象位于 `project/<uuid>/devices/<dev>/...`；事件描述符含 projectId；关闭保管模式时项目内容**仍**上项目链（与 device-local 被排除形成对照）

## 3. pull：发现与物化

- [x] 3.1 `src/sync/pull.ts`：新增 `listProjectChains(remote)`——`remote.list('project/')` 提取去重 `projectId`；列举失败 → 审计 `project_chain_list_failed` 并跳过（不得阻断个人链）
- [x] 3.2 `syncPull` 把「本地已知项目链 ∪ 远程发现项目链」并入 `syncableChains` 入参
- [x] 3.3 `src/sync/apply.ts`：`chainRole` 增加 `'project'`；`materializeScope` 在 `role==='project'` 时忽略描述符的 preset 差异，**强制**按描述符 `projectId` 解析 `project-global` 作用域；描述符缺 `projectId` → `E_FORBIDDEN` → skip + 审计 `project_scope_not_materialized`
- [x] 3.4 **解除标记（最高风险）**：`role === 'project' && marked` → 清除 `scope_exit:` 标记 + `archived → active` + `migrateScope` 到描述符作用域 + 审计 `project_reheld`；个人链的 `shadowed` 分支保持逐字不变
- [x] 3.5 单测（先红后绿）：对端持标记 → 收项目链 upsert → 变 active 且落在项目作用域；同条件下个人链普通 upsert 仍 shadowed；项目链 upsert 命中本地历史修订 → skipped 且不重复建行

## 4. 终态作用域

- [x] 4.1 `src/sync/apply.ts` `scope_exit` 分支：存在 `terminalScope` 时写 `meta` 键 `terminal_scope:<memoryId>`（canonical JSON）；缺省不写（旧事件）
- [x] 4.2 遗忘清理：记忆转墓碑时删除该 `meta` 键（与既有 meta 清理同处）
- [x] 4.3 载荷暴露：列表/详情/API 携带终态作用域（缺省为空 → 展示「未知」）；MUST NOT 参与授权
- [x] 4.4 单测：终态为 project P / 设备限定（带归属设备）/ 缺省三态；终态不影响检索与授权

## 5. backfill 与可观测

- [x] 5.1 `src/sync/backfill.ts`：`findUpstreamGap` 增加第三类——`active` + `preset='project-global'` + 无任何 `sync_upstream` 任务（按作用域区分于保管链口径）；报告增加 `chains.project`
- [x] 5.2 报告文案与 JSON 字段按链分列（personal / project / preserve），保持默认只读、幂等、不触网
- [x] 5.3 `doctor`/`status`：每条项目链的 localSeq / pullCursor / pending / gap；缺口计数按链分列
- [x] 5.4 单测：项目链 dry-run 候选数与 apply 后归零；重复 apply 幂等；不触网（无网络时退出码 0）

## 6. 控制台展示

- [x] 6.1 记忆卡片与详情对「不再持有」副本展示终态作用域与归属设备（复用既有徽章渲染路径；可翻译文案走标签体系，不进 title）
- [x] 6.2 `/api/memories` 载荷携带终态作用域；静态导出同构（零请求）
- [x] 6.3 单测 + e2e-ui：终态徽章渲染、静态页同构、无 title 承载可翻译文案（单测 `tests/console/terminal-scope.test.ts`；`npm run test:ui` 实测 120/120，报告 `artifacts/console-ui-2026-11-16.json`）

## 7. 文档与边界

- [x] 7.1 `docs/cairn-sync.md`：新增「项目链」章节（链键、路由、发现、物化、标记解除、旧版本边界、对端需升级）
- [x] 7.2 `AGENTS.md`「安全与授权」行：明确 project-global 跨设备、device-local 仍不跨设备、project-device 绑设备
- [x] 7.3 `docs/M0-session-handoff.md` 追加本轮状态与下一入口

## 8. 验收门禁

- [x] 8.1 `npm run build` + `npm run typecheck` 零错（独立复跑，均 exit 0）
- [x] 8.2 `npm test` 全绿（2026-11-16 独立复跑 **889 / 888 pass / 0 fail / 1 skip**；基线 869 → +20）
- [x] 8.3 变异对照：`if (false && role === 'project' && marked)` → 2 条红（「项目链 upsert 解除不再持有」「终态作用域随遗忘与重新持有清理」）；还原后 16/16 绿
- [x] 8.4 负对照：把物理排除断言改恒假 → **首轮零红**（原靶集没打到它，守卫在正常路径不可达）→ 补批次 4 两条 await-窗口用例后复跑变红 2 条，还原后 16/16 绿
- [x] 8.5 `openspec validate add-cross-device-project-sync --strict` 通过；`validate --specs --strict` 10/10
- [x] 8.6 真机（2026-11-16 用户授权后执行）：backfill 预演候选 **27**（修了判据 bug 后）→ `--apply` 入队 27 → `push` 三条项目链 headSeq 4/22/1、`unroutable 0` → 云端对象 16→**22（+6）** → 解密审计 **27 条 upsert 内容哈希全对、0 解密失败、明文命中 0**、描述符 27 条全带 projectId → 本机自拉取 **totalApplied 0**（27 条全 skipped）；`status` 三条项目链 gap=0，`doctor` integrity ok / upstreamGap 0
- [x] 8.7 对端（用户执行，三轮迭代闭环）：**0.6.4 收敛**（archived 38→14、project active 27、无项目内容落 personal-global、新增 device-local 0）→ **0.6.5 定位缺口根因**（upstreamGap 27→24，暴露 revive 副本 origin 缺失）→ **0.6.6 缺口归零**（schema v8 回填 24 条 origin，upstreamGap **24→0**、backfill 三段候选全 0、pull 幂等 totalApplied=0、状态逐项不变）。对端三轮报告均附代码级证据与只读 SQL，全程未自行修复。
