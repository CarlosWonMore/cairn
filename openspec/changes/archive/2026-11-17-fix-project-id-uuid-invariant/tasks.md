## Tasks

### 1. 形态校验单一出处

- [x] 1.1 `src/core/ids.ts` 新增 `isUuidShape(value: string): boolean`（正则形态校验，大小写不敏感，不限定版本）+ 单测（合法 uuidv7 通过 / 大写通过 / 路径、别名原文、空串、null 形态拒绝）。证据：新单测全绿。

### 2. 闸 1：validateScopeSpec

- [x] 2.1 先红：写测试「预设解析以路径作 projectId 必须 `E_SCOPE_INVALID` 且三表行数不变」，在当前实现上跑红。证据：红色输出留档。
- [x] 2.2 实现：`validateScopeSpec` 的 project 分支并入 `isUuidShape` 校验（走既有 `problems[]` 聚合），跑绿。证据：测试转绿 + 既有 scope 测试不回归。
- [x] 2.3 反向测试：合法 uuidv7 与已登记别名写入行为与既有语义一致（命中指纹不重复建行）。证据：测试通过。

### 3. 闸 2：ensureProject

- [x] 3.1 先红：写测试「内部直调项目行落库传路径字符串必须拒绝且零新增行」，跑红。
- [x] 3.2 实现：`ensureProject` 入口断言形态（命中前先校验），失败抛 `E_SCOPE_INVALID` 并附 `project resolve` 修复指引，跑绿。证据：测试通过。

### 4. doctor 检出

- [x] 4.1 fixture 库注入路径键 `project` 行 + 连带 `space`/`scope` 行，`doctor --json` problems 必须命中（含表名与行标识）；健康 fixture 库必须 0 项。证据：两条测试通过。
- [x] 4.2 只读保证：doctor 执行前后 fixture 库文件字节级 sha256 一致。证据：比对记录。

### 5. 变异对照

- [x] 5.1 分别去掉闸 1 / 闸 2 / doctor 扫描各一次，对应测试必须回红；用 Edit 改 Edit 还原（禁 `git checkout`）。证据：三轮红色输出 + 还原后全绿。

### 6. 全量回归与真实库复核

- [x] 6.1 `npm test` 全量回归（基线 2026-11-16 为 908/907/0/1，以当轮实测为准）+ `npm run typecheck` 0 错误。证据：退出码 0 + 测试数与基线一致或更高。
- [x] 6.2 `npm run test:e2e` 通过（不碰真实库，跑完自删）。证据：退出码 0。
- [x] 6.3 真实库只读复核：`cairn doctor --json` problems 不含畸形项目行（预期 0——本会话已手修）。证据：JSON 输出留档 `artifacts/`。

### 7. 文档与归档

- [x] 7.1 `docs/cairn-usage.md` 项目作用域写入处补「必须用 `project resolve` 的 id 或已登记别名」；`docs/M0-session-handoff.md` 追加本变更记录。证据：文档 diff。
- [x] 7.2 `openspec validate --json` 与 `--strict` 双通过、4/4 制品状态核对后归档。证据：校验输出。
