# Tasks: 稳定的项目身份

> 硬边界：不改已有 projectId；不做模糊匹配；不校验路径存在性；CLI 与 MCP 复用同一实现。

## 1. 归一化（纯函数，先做，可单测）

- [x] 1.1 新增 `src/store/project-alias.ts`，导出 `normalizeAlias(raw: string): { kind: 'git' | 'path', value: string }`。
- [x] 1.2 git 形态：`https://Host/org/repo.git`、`git@host:org/repo.git`、`ssh://git@host/org/repo.git` 三种写法归一为同一种。
- [x] 1.3 路径形态：盘符大写、`\\`→`/`、去尾部斜杠、**保留目录名大小写**。
- [x] 1.4 测试：三种 git 写法等价；`d:\\proj\\x\\` == `D:/proj/x`；`D:/proj/x` != `D:/proj/xy`；`D:/Proj` != `D:/proj`（Linux 大小写敏感）。

## 2. 项目仓储

- [x] 2.1 新增 `src/store/projects.ts`：`resolveProject(raw, { name? })`、`addAlias(projectId, raw)`、`listProjects()`。
- [x] 2.2 `resolveProject`：命中别名 → 返回 `{ projectId, created: false, matchedAlias }`；未命中 → 建项目（`uuidv7()`）+ 首别名 → `{ created: true }`。
- [x] 2.3 `addAlias`：别名被别的项目占用 → `E_CONFLICT_STATE`，报告归属，不改数据。
- [x] 2.4 别名变更写审计（`project` 类目）。
- [x] 2.5 **不要**改动 `ensureProject`（`src/store/scopes.ts:45`）对已有行为的影响；如需接入，走本模块。
- [x] 2.6 测试：命中/新建、别名冲突拒绝、追加别名不改记忆归属、`listProjects` 只读。

## 3. CLI

- [x] 3.1 `cairn project resolve <path-or-url> [--name N]`。
- [x] 3.2 `cairn project list`。
- [x] 3.3 `cairn project alias add <project-id> <path-or-url>`。
- [x] 3.4 帮助文本更新。
- [x] 3.5 测试：CLI 输出与 MCP 输出一致（同一路径）。

## 4. MCP

- [x] 4.1 `project_resolve`（参数 `path_or_url`、可选 `name`）。
- [x] 4.2 `project_list`。
- [x] 4.3 复用 `src/store/projects.ts`，不得另写一套。
- [x] 4.4 测试：MCP 与 CLI 结果一致；MCP 侧不触发新建的读取路径（list）严格只读。

## 5. 全量验收

- [x] 5.1 `npm run typecheck` 0 错误。
- [x] 5.2 `npm test` 全量通过，报告四个数字并与基线（746/745/0/1）对比。
- [x] 5.3 `openspec validate add-stable-project-identity --strict` 通过。
- [x] 5.4 变异对照：把 `normalizeAlias` 里的 `.git` 剥离去掉 → 确认「三种 git 写法等价」用例变红且只有它红；还原复绿。
- [x] 5.5 负对照：改一个无关常量 → 零红。

## 6. 文档

- [x] 6.1 `docs/cairn-usage.md` 补「项目身份与别名」小节，说明 id 是 UUID、路径只作别名、以及**跨设备需手工登记别名**这一当前边界。
- [x] 6.2 `CHANGELOG.md` Unreleased。
