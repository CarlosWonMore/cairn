## Why

**已验证事实（2026-11-16 真实库事故）**：`cairn sync pull` 返回 `E_IO syncd_remote_error (400)`，而 `doctor` 同时报告 `remote verified`、`problems: []`——诊断体系对根因完全失明。根因是 `project` 表存在一条**主键为原始路径**（`D:/Project/AI MemoryGLM`）的孤儿行（当天 16:29 由旧构建的 MCP 写入会话创建，正是 0.6.7 修复的「写入路径建孤儿 scope」缺陷，但该会话的 dist 尚未重建），并连带 `space`、`scope` 各一行。`pull` 枚举同步链时以含 `:` 与空格的 spaceKey 请求 syncd，被整体 400 拒绝；`push` 无感知（该链 localSeq 0、无任务）。已按「一致性备份 → 事务内删除 3 行 → 复跑 pull/doctor/status」手工修复，全部恢复正常（备份 `~/.cairn/backups/cairn-backup-1794843460191.db`）。

**代码事实（本会话实读源码）**：项目身份的形态约束目前完全依赖各写入口自闸（0.6.7 MCP 写路径别名解析 + UUID 校验、0.6.9 全部 CLI 写入口统一解析），存储层没有任何形态防线——`validateScopeSpec`（`src/core/scope.ts:189`）只检查「project 作用域必须绑定 projectId」，不检查形态；`ensureProject`（`src/store/scopes.ts:45`）把传入的任意字符串直接落 `project` 表。任何未来的新写入口、治理计划应用路径或旧构建进程都能再次写穿并复现同类事故。

**产品假设**：在作用域预设解析与项目行落库这一层统一加 UUID 形态断言，可以把「项目身份必须是 UUID」从各入口的约定升级为存储层不变式；再配 doctor 对存量畸形行的只读检出，畸形数据从「拉取时报 400 且诊断失明」变成「体检时显式报告」。

## What Changes

- `validateScopeSpec` 新增项目身份形态校验：`scopeKind='project'` 时 `projectId` MUST 为 UUID 形态，否则以 `E_SCOPE_INVALID` 拒绝，错误信息提示先经 `cairn project resolve` 取得稳定 id。
- `ensureProject` 增加同一断言作为第二道闸：绕过预设解析的内部路径同样 MUST 拒绝；`project`/`space`/`scope` 三表 MUST NOT 出现以路径或别名为键的行。
- `doctor` 新增畸形项目身份检出：只读扫描三表，行标识或 `project_id` 非 UUID 的行 MUST 作为问题列入报告（含表名与行标识），MUST NOT 静默忽略、MUST NOT 自动修改或删除任何行。
- 不变：合法 uuidv7 项目身份与既有别名解析、`project resolve` 只查/登记语义、同步链协议与密钥派生、schema（无迁移）。

## 非目标

- 不做孤儿行的自动清理或修复命令——删除行属治理动作，走人工 + 备份流程（本次事故已验证该流程有效）；doctor 只报不修。
- 不改 `sync pull` 对畸形 spaceKey 的行为（当前整体报错保持；阻断前移到写入层后，正常使用不应再产生畸形链）。若未来需要拉取侧逐链韧性，另立变更。
- 不改 syncd 服务端；不限定 UUID 版本（只校验形态，不强制 v7）。
- 不做跨设备的项目身份校验传播（事件描述符语义不变）。

## 风险与回滚

- **风险 1**：合法调用方传入「曾经可用」的非常规 projectId（如内部夹具直接用路径）被新断言拒绝。缓解：先红后绿测试锁定行为边界；`E_SCOPE_INVALID` 错误信息给出修复指引（先 `project resolve`）；全量回归确认既有入口无一路径键依赖。
- **风险 2**：doctor 新检查在真实库误报。缓解：只读扫描 + 形态校验与写入层共用同一实现（单一出处 `src/core/ids.ts`）；本机真实库复核 0 孤儿（本会话已手修）后才算通过。
- **回滚**：三处改动相互独立、无 schema 变更、不写任何存量行，revert 提交即完全回滚；已落库数据无需回滚。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `cloud-sync`：新增「项目身份形态不变式与写入阻断」与「畸形项目身份行的健康检出」两条需求——projectId 形态在作用域解析与项目行落库层强制，doctor 对存量畸形行显式报告。

## Impact

- **代码**：`src/core/ids.ts`（新增 `isUuidShape()`，与 `uuidv7` 同文件单一出处）、`src/core/scope.ts`（`validateScopeSpec`）、`src/store/scopes.ts`（`ensureProject`）、doctor 检查实现（`src/interfaces/` 下 doctor 所在模块，以仓库实际结构为准）。
- **测试**：新增 `tests/store/project-uuid-invariant.test.ts`（预设解析拒绝路径键 / `ensureProject` 直写拒绝 / 合法 uuidv7 与已登记别名不受影响 / doctor 检出 fixture 注入的畸形行 / 健康库不报）+ 三轮变异对照。全量回归基线以当轮实测为准（2026-11-16 为 908/907/0/1）。
- **迁移**：无 schema 变更；存量库已手修，本变更不携带修复脚本。
- **文档**：`docs/M0-session-handoff.md` 追加本变更记录；`docs/cairn-usage.md` 项目作用域写入处补一句「必须用 `project resolve` 的 id 或已登记别名」。
- **真机**：无需真实云端操作；真实库验证仅为只读 `doctor --json` 复核（预期 0 畸形行）。
