## Context

2026-11-16 真实库事故的完整链路（已验证事实，证据为本会话排障记录与备份 `~/.cairn/backups/cairn-backup-1794843460191.db`）：

1. 旧构建 MCP 会话（dist 未含 0.6.7 修复）走写入路径，把原始路径当作 projectId 传入作用域解析；
2. `resolvePreset('project-global', {projectId: 路径})` → `upsertByFingerprint` → `ensureSpaceFor` → `ensureProjectScope` → `ensureProject`，层层放行，`project`/`space`/`scope` 三表各落一行路径键孤儿；
3. `sync pull` 枚举链时把 `project/<路径>` 当 spaceKey 请求 syncd → 400；`doctor` 的链检查只看缺口/游标，对此失明。

现状守卫分布：写入口各自闸（0.6.7 MCP、0.6.9 CLI），存储层零防线。本变更把不变式下沉到存储层，并给 doctor 补上检出。

## 目标形态（两道闸 + 一处检出）

```
写入口（CLI/MCP/控制台/applyPlan）
  └─ 预设解析 resolvePreset / createCustom
       └─ validateScopeSpec          ← 闸 1（单点：所有预设与自定义作用域都过这里）
            └─ upsertByFingerprint → ensureSpaceFor → ensureProjectScope
                 └─ ensureProject    ← 闸 2（防未来新调用方绕过 validateScopeSpec）
doctor                              ← 检出（只读扫三表，只报不修）
```

## 技术选型（含证据）

- **形态校验单一出处**：`src/core/ids.ts` 新增 `isUuidShape(value: string): boolean`，正则 `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`（大小写不敏感；只校验形态，不限定版本——存量合法项目均为本项目 `src/core/ids.ts` 的 `uuidv7()` 产物）。与 `uuidv7` 同文件：身份的「生成」与「校验」同源，后续改生成器时不会被遗忘。不引入第三方 uuid 库（项目 deps 仅 MCP SDK/ciphers/hashes，正则足够且零成本）。
- **闸 1 挂点**：`validateScopeSpec`（`src/core/scope.ts:189`）已有「project 作用域必须绑定 projectId」分支，形态校验并入同一分支，问题走既有 `problems[]` 聚合与 `E_SCOPE_INVALID` 抛出路径，不新增错误码。`resolvePreset` 与 `createCustom` 都先过它，天然覆盖全部预设与自定义入口。
- **闸 2 挂点**：`ensureProject`（`src/store/scopes.ts:45`）入口处先断言形态（幂等命中已有行前也先校验参数——拒绝语义不依赖命中与否），失败抛 `E_SCOPE_INVALID`，message 附加修复指引：「projectId 必须是 UUID 形态；先 `cairn project resolve <路径或URL>` 取得稳定 id（别名会自动解析）」。
- **doctor 检出**：新增只读检查，扫 `project.id`、`space.project_id`（`space_kind='project'` 行）、`scope.project_id`（`scope_kind='project'` 行），非形态命中即列入 problems（结构含 table/id/reason）。与既有 doctor 检查同层输出，不改变 doctor 诚实分级语义。

## 威胁模型

- **畸形身份的产生通道**：① 旧构建进程写库（已发生，本次事故）；② 未来新写入口漏闸；③ 治理计划应用（`applyPlan`）直接构造作用域。三通道全部经闸 1/闸 2 收口。
- **绕过面**：外部工具直接写 SQLite 超出产品边界——doctor 检出兜底（只报不修，修复属治理动作）。
- **残留风险**：`sync pull` 对畸形 spaceKey 仍整体报错。接受：写入层阻断后正常使用不再产生畸形链；拉取侧逐链韧性列入非目标。

## 迁移与回滚

- 无 schema 迁移；不写任何存量行。存量库已人工修复（备份在案），本变更不携带修复脚本。
- 回滚：三处改动独立，revert 提交即回滚。

## 故障注入与测试

- **先红后绿**：新测试在当前实现上应红（路径键 projectId 被接受）——先写测试跑红，再实现转绿。
- **变异对照（三轮）**：分别去掉闸 1 / 闸 2 / doctor 扫描，对应测试必须回红；用 Edit 改 Edit 还原（禁 `git checkout`，防冲掉未提交实现——2026-11-13 教训）。
- **doctor 只读保证**：对 fixture 库执行 doctor 前后做字节级 sha256 比对，必须一致（复用 smoke-console 的既有手法）。
- **fixture 纪律**：全部测试走合成 HOME（`CAIRN_HOME`），不碰真实库、不要求真实云端凭据。
- **真实库只读复核**：`cairn doctor --json` problems 不含畸形项目行（本会话手修后的回归确认）。

## 可观测性

- 拒绝路径：`E_SCOPE_INVALID` 携带形态说明与修复指引（Agent 可自愈——先 resolve 再重试）。
- doctor：problems 结构化（table/id/reason），健康时 0 项。
