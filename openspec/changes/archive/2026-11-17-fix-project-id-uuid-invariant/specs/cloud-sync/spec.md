## ADDED Requirements

### Requirement: 项目身份形态不变式与写入阻断

项目身份 MUST 以 UUID 形态作为主键。作用域预设解析与项目行落库层 SHALL 在写入前校验 `projectId` 形态：非 UUID 形态的 projectId（路径、别名原文或任意自由文本）MUST 以 `E_SCOPE_INVALID` 拒绝，且 `project`、`space`、`scope` 三表 MUST NOT 产生以路径或别名为键的行。该不变式 MUST 对所有写入入口一致成立，包括 CLI、MCP、本地控制台与治理计划应用。拒绝时错误信息 SHALL 提示先经 `cairn project resolve` 取得稳定 id。校验逻辑 SHALL 单一出处实现，MUST NOT 在各入口重复实现。

#### Scenario: 路径作 projectId 被预设解析层拒绝

- **GIVEN** 任一写入口把原始路径（如 `D:/某项目`）当作 projectId 传入 `project-global` 预设解析
- **WHEN** 解析执行
- **THEN** 返回 `E_SCOPE_INVALID`，且 `project`、`space`、`scope` 三表行数不变

#### Scenario: 合法项目身份不受影响

- **GIVEN** 写入口传入经 `project resolve` 登记的 uuidv7 项目 id 或已登记别名
- **WHEN** 解析 `project-global` 作用域并写入一条记忆
- **THEN** 行为与既有语义一致（命中既有作用域指纹，不新建重复行）

#### Scenario: 绕过预设解析的项目行写入同样被拒

- **GIVEN** 内部路径绕过预设解析直接触发项目行落库（`ensureProject` 等价行为）并传入路径字符串
- **WHEN** 执行
- **THEN** 调用被拒绝，且三表零新增

### Requirement: 畸形项目身份行的健康检出

`doctor` SHALL 只读扫描 `project`、`space`、`scope` 三表：凡行主键或 `project_id` 非 UUID 形态的行，MUST 作为问题列入报告（含表名与该行标识），MUST NOT 静默忽略，MUST NOT 自动修改或删除任何行。健康库上该检查 MUST 报告 0 项问题。

#### Scenario: 注入的畸形行被报告

- **GIVEN** fixture 库中存在一条主键为路径的 `project` 行及其连带 `space`、`scope` 行
- **WHEN** 执行 `cairn doctor --json`
- **THEN** problems 中包含该畸形行（含表名与行标识），检查不静默通过

#### Scenario: 健康库不报

- **GIVEN** 三表中全部行主键与 project_id 均为 UUID 形态
- **WHEN** 执行 `cairn doctor --json`
- **THEN** 该检查不产生任何问题项
