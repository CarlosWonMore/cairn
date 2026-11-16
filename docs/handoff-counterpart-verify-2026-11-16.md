# 对端增量验证提示词（v4：0.6.8 + 回答你的两个疑问）

> 复制整段给对端 agent。**你这轮通过，而且提出的检索问题很有价值**——但结论要修正：`--project` 一直存在，是对端**文档没写**导致能力被隐藏。已修并发布 0.6.8。

---

## 先回答你的两个疑问

### 疑问①：`cairn search` 与 MCP `memory_search` 默认不召回 project-global —— **这是设计，不是缺陷**

规格 `scoped-retrieval`「全通道作用域隔离」原文：

> 检索查询 MAY 显式携带项目身份；携带时，项目作用域记忆仅对同一项目的查询可见……**未携带项目身份时，项目作用域记忆 MUST 保持不可见**。

实现依据：`scopeAllowsRead` 要求 `scope.projectId` 与查询 `projectId` **严格相等**。所以：

- 不带项目身份 → 项目内容不可见（**规格要求**，不返回正文/来源/计数）
- 带项目身份 → 只返回同一项目的内容，且**不放宽**设备维度、Agent 维度、读允许名单检查

这是「项目 A 不得读到项目 B」的实现方式，不是 bug。

### 疑问②：你说「建议 CLI search 加 --project 参数」—— **它一直都有，只是帮助文本没写**

我实测：`cairn search "双设备同步的三个盲区" --project <UUID>` → **命中 1 条**。不带参数 → 0 条。

根因：`--help` 里 `search` 那行只写了 `[--status] [--scope-id] [--include-expired]`。**能力被文档隐藏**，你据此判断是新需求，合理但可避免。0.6.8 已补上 `--project <id|alias>`（`export` 那条也一起补了）。

另外还修了一处：CLI 的 `--project` 此前**不接受别名**（传路径别名会静默 0 命中，而 MCP 能解析成 UUID）。现在两者共用同一解析，未登记别名会明确报 `E_NOT_FOUND` 并提示 `cairn project resolve`，不再静默空结果。

---

## 本次任务（0.6.8，很小）

### 铁律
只允许 `sync pull` 这一写本地动作；不 push、不 `backfill --apply`、不 forget、不 rescope。
**本次不需要 pull**（主设备没有新内容发布），所以实际上只有一个升级动作和几条只读验证。

### 第 0 步：升级
```bash
cairn backup
npm i -g @carloswon/cairn-memory@0.6.8
cairn --version          # 期望 0.6.8
```

### 第 1 步：验证 --project 现在写在帮助里
```bash
cairn --help | grep -A1 'search "'
```
期望输出里含 `[--project <id|alias>]`。

### 第 2 步：用 UUID 验证项目内容可见
```bash
cairn search "双设备同步的三个盲区" --project 01a1daf8-a232-769f-82e3-6c4da78985d4
cairn search "双设备同步的三个盲区"
```
期望：第一条**命中 1 条**；第二条 **0 条**（规格要求：不带身份不可见）。

### 第 3 步：验证别名等价（可选，需要先登记一次别名）
你这轮报告说本机 3 个项目的 aliases 都是空列表（pull 物化只建项目行不带别名）。所以这步需要一次写动作 `project resolve`——**如果你不想做写动作，跳过并说明"跳过：需要额外写动作"**。

```bash
cairn project resolve "<一个本机真实路径，例如你的仓库根>" --name <名字>
cairn search "双设备同步的三个盲区" --project "<上面那个路径>"
```
期望：第二次 search **命中 1 条**（修复前是静默 0 命中）。

再试未登记别名：
```bash
cairn search "测试" --project "D:/definitely/not/registered"
```
期望：**明确报错**（`E_NOT_FOUND`）并提示 `cairn project resolve`，**不是**静默 0 结果。

### 第 4 步：报告
```
升级：cairn --version = <值>
help：search 行是否含 --project = <是/否>，实际那一行原文
UUID 检索：<命中条数>（期望 1）
无身份检索：<命中条数>（期望 0）
别名检索：<命中/跳过原因>
未登记别名：<报错文案首行 / 实际行为>
异常与未验证项：<如实写>
```

### 判定
- help 含 `--project` + UUID 命中 1 + 无身份 0 ⇒ 本轮通过。
- 别名那步若跳过，注明原因即可，不影响判定。

### 回滚
本版无 schema 迁移、无数据写入，升级即可；如需回退重装 0.6.7。
