# 对端增量验证提示词（v3：一条新记忆 + 0.6.7 升级）

> 复制整段给对端 agent。**这次任务很小**——只有 1 条新记忆要拉，外加升级到 0.6.7 确认一个修复。

---

## 先说清楚：同步链路本身已经验收完毕

你的三轮报告（0.6.4 收敛 / 0.6.5 定位缺口 / 0.6.6 缺口归零）已经把**项目链跨设备同步**验证闭环，变更已归档并发布。**你不需要再做全量重验。**

本次有两件独立的小事：

1. **拉一条新记忆**：主设备今天 16:39 左右发布了一条项目记忆（教训类，关于多设备同步的三个盲区），cairn 项目链 headSeq **4 → 5**。你现在的游标停在 4，所以有 1 条待拉。
2. **升级到 0.6.7**：修了一个**项目作用域写入**的 bug（与同步链路无关，`src/sync/` 一行未动）。如果你会用 MCP 的 `memory_add` 往项目作用域写记忆，这个很关键；如果不用，升级只是保持版本一致。

---

## 铁律

只允许 `sync pull` 这一写本地动作；不 push、不 `backfill --apply`、不 forget、不 rescope、不手工改库。
升级前先 `cairn backup`。

---

### 第 0 步：升级到 0.6.7

```bash
cairn backup                          # 记下 path 与 sha256
npm i -g @carloswon/cairn-memory@0.6.7
cairn --version                       # 期望 0.6.7
cairn doctor                          # schemaVersion 应仍为 8（本版无迁移）
```

### 第 1 步：pull 拉那条新记忆

```bash
cairn sync pull
```

**期望**：
- cairn 项目链（`project/…a232`）出现 `headSeq=5`、`applied=1`（这次不再是早退分支，`outcome` 会真实出现）
- 其余链仍 `appliedBefore=0`、`outcome=null`（已到头）
- `totalApplied=1`

**这是本轮唯一的关键数字**：`applied=1`。

### 第 2 步：确认新记忆落地

```bash
cairn search "双设备同步的三个盲区"
```
或按内容检索"发射端/接收端不对称"。期望：命中一条 `project-global · cairn`、status `active` 的记忆，正文开头含「**双设备同步的三个盲区**」。

### 第 3 步：确认状态没有被意外改动

```bash
cairn status
cairn doctor
```
期望（相对你上一轮）：总数 **50 → 51**（+1 新记忆）、project-global active **27 → 28**、archived 仍 14、personal-global 仍 7、`upstreamGap` 仍 0。

其余计数一项都不该变。

### 第 4 步（可选，只有你会用 MCP 写项目记忆时才做）

验证 0.6.7 的修复。**如果你平时不通过 MCP 往项目作用域写记忆，这步可以跳过并告诉我"不适用"。**

用 MCP 工具 `memory_add`，传**已登记的项目别名**（不是 UUID）：
```
content: "0.6.7 别名解析验证（对端临时，可忽略）"
kind: "fact"
scope_preset: "project-global"
project_id: "<你本机已登记的某个项目路径别名，例如 D:/... >"
```

**期望**：写入成功，且该记忆的 `scope.project_id` 是 **UUID**（不是路径字符串）。
验证后**不要删除**（避免额外的写动作），在报告里注明它的 id 即可，我会在本机侧核对项目链是否收到它。

> 如果你更愿意只读核对，也可以跳过这步——不重要。

### 第 5 步：报告

```
升级：cairn --version = <值>；schemaVersion = <值>
pull：totalApplied = <n>（期望 1）
  project/…a232(cairn) headSeq=<n> applied=<n> skipped=<n> revived=<n>
  其余链 <spaceKey> appliedBefore=<n> outcome=<null 或结构>
落地核查：search 命中 <有/无>；作用域=<preset·项目名>；status=<值>；正文开头=<20 字>
状态对比：总数 <a>-><b>；project active=<n>；personal active=<n>；archived=<n>；upstreamGap=<n>
第 4 步：<已验证 / 不适用 / 跳过>
异常与未验证项：<如实写>
```

### 判定

- `pull` 的 `applied=1` 且 search 能命中 ⇒ 增量同步正常，本轮通过。
- 若 `applied=0` 且 cairn 链仍 `headSeq=4` ⇒ 说明上游没发布成功，告诉我，我回头查。
- 若总数不是 51 ⇒ 贴 `cairn status` 原始输出。

### 回滚
本次只拉 1 条新记忆，不删任何数据。需要回退用第 0 步的备份。
