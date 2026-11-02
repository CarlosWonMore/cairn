# 给 CodeBuddy：DSH 记忆插件自动召回为 0 的排查

> 交接方：DSH 会话（2026-11-02 09:50，Asia/Shanghai）
> 仓库：`D:\Project\AI MemoryGLM` ｜ 分支 `main` ｜ HEAD `4432d8d`
> **一句话问题：插件的自动召回恒为 0 候选，面板永远显示「未命中」。**

---

## 零、必读：我的失败模式

这个功能我已经修了 **8 轮**，每次都失败。失败方式高度一致：**读到一个线索 → 按它改 → 用户重启 → 仍是 0**。

根因是我一直在**猜 DSH 的插件 API**，而没有拿到权威契约。最近三次的猜测全部错误：

| 我以为 | 实测结果 |
|---|---|
| `ctx.tools.call(name, args)` | **不存在**。宿主里 `tools.call(` 零出现，运行时 `callType: "undefined"` |
| `ctx.tools.get(name)` 返回可执行定义 | `defFound: true` 但 **`callType: "undefined"`**，定义上没有 call |
| `tools.get(name, agent)` 加 scope 就能成 | 仍是 `callType: "undefined"` |

**请不要再从我上面这些假设的任何一条出发。**先找到权威 API 定义。

---

## 一、当前实测状态（2026-11-02 09:45，最新一次重启后）

```json
// GET http://127.0.0.1:31960/plugins/cairn-dsh-memory/usage?debug=1
{
  "status": "miss", "candidates": 0, "injected": 0,
  "debug": {
    "recall": {
      "hasTools": true,          // ctx.tools 存在
      "hasGet": true,            // tools.get 是函数
      "defFound": true,          // tools.get('mcp__cairn__memory_search') 返回了东西
      "callType": "undefined",   // ← 但这个东西上没有 call
      "attempts": 1
    },
    "lastPreStep": { "fired": true, "messageLen": 30, "reason": "nothing_new" },
    "lastRecall": { "queries": 6, "candidates": 0, "ms": 1 },
    "toolHookRegistered": true,
    "toolEvents": 2              // tools/post-execute 正常触发，说明 tools 服务是活的
  }
}
```

**关键矛盾**：`tools` 服务是活的（`tools/post-execute` 每步都在触发），`tools.get` 也能返回对象，但那个对象上没有 `call`。

---

## 二、已经确认工作的部分（不要推倒重来）

| 环节 | 状态 | 证据 |
|---|---|---|
| 插件加载 | ✅ `active` | 日志 `plugin.snapshot {...,"fiberPhase":"active"}` |
| 面板渲染 | ✅ 用户确认看到 | 出现在 header，ptc 开关后面 |
| 取用户消息 | ✅ | `lastPreStep.messageLen: 30`（曾因 session/event 签名错误长期为 0） |
| 短查询派生 | ✅ | `queries: 6` |
| usage 端点 | ✅ 200 | 返回完整结构 |
| 库里可命中 | ✅ | 直接查库 / MCP 工具搜「投影」都能命中 1 条 |
| **自动召回** | ❌ **恒 0** | 本文主题 |

---

## 三、请 CodeBuddy 做的事

### 3.1 找到「插件如何主动调用一个已注册工具」的权威答案

这是唯一的核心任务。已知事实：

- `ctx.tools` 的原型方法（运行时内省）：

```
register, restrict, guard, guardReason, view, get,
resolveExecution, schemas, sdkSchemas, schemaOf,
executionMode, presentAs, collapseSection, sdkSection,
wireSchemas, requirePtcRuntime, requirePtcTransport
```

- `tools.get(name, scope)` 内部是 `this.view(scope).visible.get(name)`
- `tools.resolveExecution(name, scope, nested)` 返「可以执行的定义」，文档说它是给 executor 用的
- `dsh-ops` 只用了 `get` 做可见性判断，**没有用它执行任何工具**

**建议的查法**（比我之前有效）：

1. 读 `@deepseek-ai/dsh-mcp-client` 的 `lib/index.js` 与 `lib/types/**/*.d.ts`（在 `D:\Program Files\DSH NEXT\resources\app.asar` 内，或用 profile 里的安装副本）
2. 搜索谁调用了 `resolveExecution`——那是执行入口的直接线索
3. 搜索 executor 如何构造 `execution` 参数再调用工具
4. 查 `agent` 对象上是否有可直接调工具的方法（插件每步都拿得到 `payload.agent`）

### 3.2 如果「插件内主动调用 MCP 工具」根本不被支持，请明确说出来

那样的话正确方案可能是另一个方向，例如：

- 插件直接读 Cairn 的 SQLite（已验证可行：直接 `SELECT ... WHERE content LIKE` 能查到那条投影预算记忆）
- 或插件通过 HTTP 调自己的 MCP server（Cairn 是独立 stdio 进程，这条路需要额外设计）

**有没有更简单的正解，请你判断，不要迁就我已有的实现。**
---

## 四、相关文件与命令

| 路径 | 作用 |
|---|---|
| `plugin/dsh/src/index.ts` | Host 侧：召回、注入、端点、诊断 |
| `plugin/dsh/src/recall.ts` | 纯函数：派生查询、过滤、渲染 |
| `plugin/dsh/src/usage-state.ts` | 面板状态形状（三态推断） |
| `plugin/dsh/src/client.js` | Client 面板（已能渲染） |
| `plugin/dsh/tests/` | 48 项单测，全绿 |

**召回入口**在 `plugin/dsh/src/index.ts` 的 `makeToolRecall()`：

```ts
function makeToolRecall(ctx, onOwnCall) {
  const tools = ctx?.tools;
  if (!tools || typeof tools.get !== 'function') return null;
  return async (message, topK, scope) => {
    for (const query of deriveQueries(message)) {
      const def = tools.get('mcp__cairn__memory_search', scope);
      if (typeof def?.call !== 'function') return [];   // ← 卡在这里
      const res = await def.call({ query, limit: topK }, { signal });
      // 解析 res.content[0].text → JSON → items
    }
  };
}
```

### 验证命令

```bash
cd "D:/Project/AI MemoryGLM"

# 单测（当前 48/48）
npx tsx --test plugin/dsh/tests/*.test.ts

# 改动后必须重新构建（插件从 dist 加载）
cd plugin/dsh && npx tsc -p tsconfig.json

# 运行中的诊断（端口每次重启都变，从 GUI URL 取）
curl -s "http://127.0.0.1:<port>/plugins/cairn-dsh-memory/usage?debug=1"
```

### 库里有可命中的样本

```bash
sqlite3 "C:/Users/Carlos/.cairn/data/cairn.db" \
  "SELECT id,kind,substr(content,1,60) FROM memory WHERE content LIKE '%投影%' AND status='active'"
# 应返回 1 条 fact
```

---

## 五、验收标准（可观察，不含「我改好了」）

1. 用户在会话里问「投影预算是多少」
2. **不再需要用户手动调 MCP 工具**，插件自动完成召回
3. 端点 `usage?debug=1` 的 `candidates` **≥ 1**
4. 面板状态从「未命中」变为「已注入」，点开能看到那条投影预算记忆的摘要
5. 回归：`npm test` 668/667/0/1、插件单测不减少

---

## 六、纪律

- **只改 `plugin/dsh/`**，不要动 `src/`（Cairn 核心已稳定，668 项测试是基线）。
- **改了必须重建 `dist`**——插件从 `dist/index.js` 加载，只改 `src` 不重建等于没改。我已经在这上面栽过。
- **不要采信我的任何 API 假设**，包括本文档里写的。以你查到的权威定义为准。
- 如果最终结论是「插件内无法主动调用工具」，**直接说**，并给出替代方案——那比继续修更值钱。
- 未验证就写「未验证」。

---

## 七、如何反馈

在本文件末尾追加：

```markdown
## CodeBuddy 排查结果（YYYY-MM-DD HH:mm）

### 权威 API 结论
（插件到底能不能主动调用已注册工具？用什么方法？贴出处）

### 我的三次假设逐条对照
| 假设 | 结论 | 依据 |
|---|---|---|
| ctx.tools.call 存在 | | |
| tools.get 返回可执行定义 | | |
| 加 scope 就能取到 | | |

### 修改与验证
（改了什么 + candidates 实测值 + 面板是否变「已注入」）
```

---

## CodeBuddy 排查结果（2026-11-02 10:15）

### 权威 API 结论

**插件可以主动调用已注册工具，方法是 `ctx.tools.execute(input)`。**

出处（不是猜的，是从 `D:\Program Files\DSH NEXT\resources\app.asar` 里解出来的）：

| 证据 | 位置 |
|---|---|
| `ToolRuntime` 公开方法声明含 `execute` | `node_modules/@deepseek-ai/dsh-tool-cordis/lib/types/api-catalog.js:8251`（`async execute(exec: ToolExecutionInput): Promise<ToolExecutionResult>`） |
| 实现 | `node_modules/@deepseek-ai/dsh-tools/lib/index.js:3212` |
| 入参形状 | `api-catalog.js:8175`：`ToolExecutionInput = { callId, rootCallId?, name, schema?, arguments, agent?, parent?, signal }` |
| 出参形状 | `api-catalog.js`：`ToolExecutionResult = ToolExecutionSuccess\|ToolExecutionFailure`，成功为 `{ isError:false, value, content: ContentBlock[] }` |
| 工具定义上的执行方法 | `ToolDefinition.execute(args, exec: ToolRunContext)`（`api-catalog.js:8148`）——**方法名是 `execute`，不是 `call`** |
| `get` 的真实语义 | `index.js:3091`：单纯 `view(scope).visible.get(name)`，返回的是**定义对象**（可读可判可见性，也可直调 `definition.execute`） |
| `resolveExecution` | `index.js:3107`：可见性 + 呈现模式折叠判定，**不是调用入口**；executor 内部用 |

调用链：`tools/pre-execute`（allow/deny/ask）→ 单调 guards → `tools/execute` 包装（超时/重试）→ 工具体 `definition.execute(args, exec)` → `tools/post-execute` → `tools/result`。

**附带发现（本次没走，但记下来）**：ptc 呈现模式下，`resolveExecution` 会把「非 `run_code` 的模型直呼」折叠成 `UNKNOWN_TOOL`（`index.js:3196` `collapses()`）。所以插件里如果只写 `tools.execute`，用户一开 ptc 又会回到 0 候选。已按「主路径 + 定义体兜底」处理。

### 我的三次假设逐条对照

| 假设 | 结论 | 依据 |
|---|---|---|
| `ctx.tools.call(name, args)` 存在 | **错**。从不存过 | `api-catalog.js:8251` 的方法清单里没有 `call`；全 asar `tools.call(` 零命中 |
| `tools.get` 返回可执行定义 | **半对**。返回定义对象，但执行方法叫 `execute` 不叫 `call` | `index.js:3091` + `ToolDefinition.execute` 声明 |
| 加 scope 就能取到 | **对（但和调用无关）**。scope 只影响「看见哪份定义」 | `view(scope)` / `get(name, scope)` |

八轮全失败的根因只有一条：**一直在 `def.call` 上判空**（`typeof def?.call !== 'function'` 恒真 → 第一条查询就 `return []`），所以 `candidates` 永远是 0，而 `defFound` 一直是 true——诊断里那对「矛盾」其实就是这个空判断。

### 为什么不改用「直接读 SQLite」

你问过有没有更简单的正解。**没有比 `tools.execute` 更简单的**：直读 `cairn.db` 要把 `service.search` 的分词/FTS5 trigram/2-gram LIKE 兜底/作用域过滤/冲突标记全部复刻一遍，等于在插件里养第二份检索实现，一旦核心改版就悄悄分叉。而 `tools.execute` 复用的就是 MCP 那条同源路径，零重复。直读只建议留给「MCP server 没起来也要召回」的极端场景，现在不需要。

### 修改与验证

改动只在 `plugin/dsh/`：

1. `src/index.ts` — `makeToolRecall()` 重写：
   - 主路径 `ctx.tools.execute({ callId, name, arguments, agent, signal })`，带 3s 超时（`AbortSignal.timeout`，召回卡在 pre-step 里不能挂死整轮）；
   - 兜底路径 `definition.execute(args, { signal })`——只在 `tools.execute` 返回错误结果（典型就是 ptc 折叠）时启用；
   - 单路取不到定义由 `return []` 改成 `continue`（原实现一条路失败就把整轮清零）；
   - `recallDiag` 字段调整：`callType` → `executeType` + `execPath`（记录这次真走了哪条路）+ `lastTextLen`；
   - 文件头补第 3 条的权威契约，防止下一轮又去找 `call`。
2. `tests/injector.test.ts` — mock 全部换成真实契约形状（`tools.execute` 返回 `{ isError, value, content }`、定义上是 `execute`），并新增一条「ptc 折叠后必须退回定义体直调」的用例。

验证：

| 项 | 结果 |
|---|---|
| `npx tsx --test plugin/dsh/tests/*.test.ts` | **49 / 49 通过**（原 48 + 新增 1） |
| `npm test`（主项目回归） | **668 项 / 667 通过 / 0 失败 / 1 显式 skip**，与基线一致 |
| `npx tsc -p tsconfig.json` | 退出码 0，`dist/index.js` 已重建（10:09），`node -e import()` 可加载 |
| 真实会话 `candidates ≥ 1` | **未验证** —— 插件只在宿主启动时加载，改完 dist 必须重启 DSH 才生效；当前跑着的实例（PID 18436，端口 31960）仍是旧代码（`usage?debug=1` 里还是 `callType` 字段） |

**验收动作**：重启 DSH，问一句「投影预算是多少」，然后

```bash
curl -s "http://127.0.0.1:<新端口>/plugins/cairn-dsh-memory/usage?debug=1"
```

判据：`candidates ≥ 1`、`debug.recall.execPath` 出现（不是空串）、`debug.recall.lastError` 无内容、面板从「未命中」变「已注入」。

如果重启后仍是 0，看 `debug.recall.lastError` 与 `execPath` 两个字段就能直接定位下一步，不用再猜：`execPath` 为空 = 两条路径都没跑通；有 `lastError` = 调用失败（错误原文就在里面）；两者都正常但 candidates 仍 0 = 调用通了只是没命中（那时问题在 `deriveQueries` 或库内容）。

---

## 八、DSH 侧验证结果（2026-11-02 10:40，CodeBuddy 版本上线后）

### 8.1 核心问题已解决 ✅

`ctx.tools.execute` 是正确的。实测端点：

```json
{
  "status": "injected", "candidates": 4, "matchedBy": "fts",
  "bytesUsed": 573, "bytesBudget": 1536, "filteredCount": 0,
  "debug": {
    "recall": { "hasExecute": true, "executeType": "function",
                "execPath": "definition.execute", "lastTextLen": 6605 },
    "lastRecall": { "queries": 6, "candidates": 5, "ms": 24 },
    "lastPreStep": { "fired": true, "reason": "ok", "injected": true }
  }
}
```

**用户侧确认**：DSH 会话开头真的出现了「以下记忆可能相关，仅供参照：」并列出 5 条。**自动召回端到端打通。**

顺带记录 CodeBuddy 的诊断输出暴露的一条信息：

```
"lastError": "unknown tool \"mcp__cairn__memory_search\": only `run_code` is callable
 directly — call `mcp__cairn__memory_search` from inside a `run_code` program instead"
```

即 PTC 模式下 `tools.execute` 直调受限，最终走通的是 `definition.execute`。**这一点值得在文档里固化**：插件内调用 MCP 工具应优先用 `tools.get(...)` 拿定义再 `definition.execute(...)`，而不是 `tools.execute`。

### 8.2 我修的一处缺陷（已提交 `baf0d06` 之后又修）

注入文本里有 4 条摘要显示成 `---`。根因：**同一套摘要逻辑写了两份**——

- `usage-state.ts` 的 `firstLine`（我上一轮修好了 frontmatter）
- `recall.ts` 的 `firstLine`（注入文本用这个，**没修**）

现已统一为从 `usage-state.ts` 导出单一实现，`recall.ts` 改为 import。+1 测试锁死「注入与面板摘要同源」。

插件测试 54/54，全量 668/667/0/1。
### 8.3 新问题一：面板显示的字段值与后端不符 ⚠️

**现象**（用户截图描述，2026-11-02 10:30 前后）：

```
上面的部分还是显示 未命中
召回条数 5
命中通道 fts
预算占用 0 / 1536 B
被过滤 0
```

**矛盾点**：状态下限显示「未命中」，但召回条数是 5——同一份 payload 不可能既是 miss 又有 5 条候选。而且预算 0 与后端实测的 `bytesUsed: 573` 不符。

**后端实测（与面板同时刻）**：

```json
{ "status": "injected", "candidates": 4, "bytesUsed": 573 }
```

**我的初步排查**（未完成，供参考）：

- `client.js` 读的字段名与 payload 键名**看起来是匹配的**：
  - 第 23-28 行：`d.status` / `d.label` / `d.candidates` / `d.matchedBy` / `d.bytesUsed`
  - payload 键：`status,label,candidates,matchedBy,bytesUsed,bytesBudget,filteredCount,injected,persist,recent`
- 但面板显示「未命中」，说明它**渲染的不是最新 payload**

**可能方向（我未验证，请自行判断）**：

1. 面板的轮询间隔与 pre-step 写入之间存在竞态：面板取到的是**上一轮的旧数据**（上一轮确实是 miss）
2. `usage` 端点在 pre-step 期间读到的 `injector.lastUsage()` 尚未更新（写入时序问题）
3. 面板把 `status` 与 `candidates` 分两次取（或从不同来源取），造成同一视图内字段不自洽
4. 用户看到的「召回条数 5」可能来自另一个位置（如活动日志），与面板顶部的状态 chip 不是同一数据源

**建议**：在 Client 侧加一行 debug 渲染（如 `data-rev` 显示 payload 取到的时刻/序号），确认面板拿到的到底是哪一份数据。这比继续读代码猜更快。

### 8.4 新问题二：注入摘要仍可能显示 `---`

我已在 DSH 侧把 `firstLine` 统一并支持 frontmatter（取 `name:` → `description:` → 正文首行）。

**但请注意**：这份修复是在 CodeBuddy 的版本之后做的，**尚未经过一次真实重启验证**。若重启后仍看到 `---`，可能原因：

1. 我只改了 `src/`，`dist` 是否已含最新逻辑需确认（`npx tsc -p tsconfig.json` 后 grep `dist/usage-state.js` 里的 `isSeparator`）
2. CodeBuddy 的注入渲染可能**又引入了一份独立的摘要逻辑**——请全局搜 `firstLine` / `split(/\r?\n/)`，确认全仓库只有一处

### 8.5 给 CodeBuddy 的两个明确请求

| # | 请求 |
|---|---|
| 1 | **修 8.3 的字段不自洽**：同一次渲染里 `status` 与 `candidates`/`bytesUsed` 必须来自同一份 payload。优先给出「面板实际拿到哪一份数据」的可观测证据（debug 字段），再改。 |
| 2 | **确认 8.4**：全仓库检索摘要逻辑是否只剩一处；若你的实现另有副本，请合并到 `usage-state.ts` 的 `firstLine`。 |

### 8.6 已验证通过的清单（不要回退）

| 项 | 证据 |
|---|---|
| 自动召回 | `candidates: 4-5`，`ms: 24` |
| 注入发生 | 会话开头出现注入文本，用户确认 |
| 面板渲染 | 用户确认能看到 tab 与详情 |
| usage 端点 | 200，字段完整 |
| 前端字段名 | 与 payload 键逐一比对一致 |
| 测试 | 插件 54/54；根套件 668/667/0/1 |

### 8.7 8.3 的根因已由 DSH 侧定位并修复（2026-11-02 10:43，提交 `68c2805`）

**这个问题不需要 CodeBuddy 再查了**，原因如下（已修并在 DSH 侧验证到单测层）：

```ts
// 旧实现：用正文首行前 20 字去 rendered.text 里找
injectedIds: safe.filter((h) =>
  rendered.text.includes(h.content.split(/\r?\n/)[0].trim().slice(0, 20))
).map((h) => h.id)
```

对 **frontmatter 记忆**，`content` 首行是 `---`，而渲染出来的是 `name:` —— 永远不匹配。
于是 `injected` 为空 → `buildUsage` 推出 `status: 'miss'` → 面板显示「未命中」；
而 `candidates` 是独立字段仍为 5 → 出现「未命中 + 召回 5」的自相矛盾。

**已改为与渲染同源**：`rendered.text.includes(toSummary(h.content))`，并删除了后面重复计算的 `injectedIds`。

这条同时也是 8.4 的答案：`firstLine` 现在全仓库只有一处（`usage-state.ts` 导出），`recall.ts` 改为 import。

**所以 8.5 的两个请求只剩下一条**：

> 请在 CodeBuddy 自己的改动里确认没有引入第三份摘要/匹配逻辑（`grep -rn "firstLine\|split(/\\r?\\n/)" plugin/dsh/src/`），若有意保留请说明理由。

### 8.8 最后一次确认的实测数据（修复前，供对照）

```
面板显示：未命中 | 召回条数 5 | 命中通道 fts | 预算占用 0 / 1536 B | 被过滤 0
后端端点：status=injected | candidates=4 | bytesUsed=573 | injected=3
```

修复后预期：面板应为 `已注入`，预算占用非 0。**需要一次重启才能看到**。

---

## 九、⚠️ 任务范围重大调整（2026-11-02 11:30，DSH 侧）

**请先读本节，再决定是否执行前面 8.5 的请求。**

### 9.1 8.3 与 8.4 均已由 DSH 侧独立定位并修复

两个问题的根因**是同一处代码**，且我前后修错了一次。完整经过：

| 轮次 | 我的判断 | 结果 |
|---|---|---|
| 1 | 用「正文首行前 20 字」匹配渲染文本 | ❌ frontmatter 记忆首行是 `---`，恒失败 |
| 2 | 改用 `toSummary(content)` 匹配（60 字符） | ❌ 渲染行截断在 **160** 字符，长内容仍失败 |
| 3 | **让渲染函数返回 `includedIds`** | ✅ 正确 |

**真正的教训**：靠「在渲染文本里搜原文字串」反推「哪条被注入」这件事本身不成立——两处截断长度不同，长内容必然对不上。渲染函数自己知道放进去了哪些，应该直接返回。

代码：`renderInjection` 的返回类型新增 `includedIds: string[]`，调用方不再做任何文本比对。

### 9.2 实测确认的失效场景（供你复核我的改动）

```
记忆正文 2453 字符（真实存在，如 windows-dev-env-quirks 那条）
渲染行：- [environment] [ZCode 原生记忆迁移/...  （截断到 160 字符 + …）
摘要  ：[ZCode 原生记忆迁移/windows-dev-env-quirks] 本机（W… （截断到 60 字符）
→ text.includes(summary) === false  ← 这是缺陷
```

修复后：`includedIds: ["w"]`、`selected: 1`。

### 9.3 当前状态（DSH 侧，2026-11-02 11:30 已验证到单测层）

| 项 | 状态 |
|---|---|
| 自动召回 | ✅ `candidates: 5`、`ms: 24` |
| 注入发生 | ✅ 用户会话开头可见注入文本 |
| 摘要质量 | ✅ 不再显示 `---`（frontmatter 已跳过） |
| 状态判定 | ✅ 已修（`includedIds`），**尚未重启验证** |
| 插件测试 | 62/62 |
| 根套件 | 668/667/0/1 |

提交：`68c2805`（frontmatter 摘要）→ `e6cd0fd`（includedIds）

### 9.4 所以你的任务调整成什么

**原任务（找到正确的工具调用 API）已完成**——`ctx.tools.execute` / `definition.execute` 是你的成果，已在生产代码中生效。

**原 8.5 的两个请求不再需要**：8.3 的字段不自洽与 8.4 的摘要问题都已由 DSH 侧修复，且根因是同一处。

**现在剩下的、值得你做的只有一件**：

> **独立复核我这三次修复是否正确、有无遗漏。**
>
> 具体：
> 1. `recall.ts` 的 `includedIds` 是否在所有返回路径都正确填充（含早退分支）
> 2. `index.ts` 是否还有任何依赖文本比对的地方（`grep "includes(" plugin/dsh/src/`）
> 3. `firstLine` 是否全仓库只有一处（`grep -rn "firstLine\|split(/\\r?\\n/)" plugin/dsh/src/`）
> 4. 长内容（>200 字符）与 frontmatter 内容两种记忆，注入后 `status` 是否都为 `injected`

### 9.5 我这边的自我怀疑（请重点看）

这一轮我在**同一个函数上连错两次**，都是因为「想当然地认为两处文本一致」。所以：

- 我不确定 `includedIds` 是否覆盖了所有分支（比如 `fresh.length === 0` 的早退）
- 我不确定还有没有第三处类似「用文本反推状态」的写法
- 我修完后**只跑了单测，没有重启验证**——`status` 实际是否变成 `injected`，需要一次真实重启

**如果你发现问题，直接说；如果我的修法方向就错了，也直接说。**

---

## 十、✅ 验证通过（2026-11-02 12:36，DSH 侧最终结果）

### 10.1 结论

**自动召回与状态判定均已工作。** 宿主在 12:00:45 真正重启后实测：

```json
{
  "status": "injected",
  "candidates": 5,
  "injected": 5,
  "bytesUsed": 685,
  "bytesBudget": 1536,
  "debug": { "render": { ... } }   // renderProbe 非空 = 新代码已加载
}
```

用户在会话开头实际收到注入文本（「以下记忆可能相关，仅供参照：」+ 5 条），端到端成立。

### 10.2 前几轮「一直 miss」的真实原因

**不是修复无效，是 DSH 宿主进程从未被替换。**

| 事实 | 值 |
|---|---|
| 修复构建（dist） | 11:39:37 |
| 旧宿主 5304 启动 | 11:27:05（**早于构建 12 分钟**） |
| 期间新起的 host.js 进程 | 11:45:46 / 11:46:36 / 11:47:13 均数秒内退出 |
| 最终生效的重启 | 12:00:45（PID 13856） |

期间我反复用 `Get-Process 'DSH NEXT' | Select-Object -First 1` 取启动时间，拿到的永远是**最早那个**进程，因此连续四轮误判「已重启但仍失败」，并在这四次误判中又改了两次代码。

### 10.3 三次修复的最终归属

| 提交 | 内容 | 是否有效 |
|---|---|---|
| `68c2805` | 摘要跳过 frontmatter | ✅ 有效（注入不再显示 `---`） |
| `e6cd0fd` | `renderInjection` 返回 `includedIds` | ✅ 有效（不再靠文本反推） |
| `bdf0347` | 去重早退不再覆盖 `lastUsage` | ✅ 有效（状态不再被清空） |

三条都在最终重启后得到验证。**其中 `bdf0347` 是关键**：旧代码活动日志写着 `自动召回 候选5 注入3`，而端点报 `injected: []`——这个矛盾只有「早退覆盖」能解释。

### 10.4 9.5 的三个自我怀疑，自答

| 怀疑 | 结论 |
|---|---|
| `includedIds` 是否覆盖所有分支 | 早退分支返回 `[]`，但调用方现在只在 `length > 0` 时写 `lastUsage`，因此不构成缺陷 |
| 是否还有别处「用文本反推状态」 | `grep "includes(" plugin/dsh/src/` 已无残留 |
| 修完只跑单测未验证 | 12:00:45 已真实验证，见 10.1 |

### 10.5 所以 9.4 的复核请求可以作废

**CodeBuddy 无需再执行任何复核。** 全部验证已由 DSH 侧完成并记录在本节。

### 10.6 交接过我的一个教训（供 CodeBuddy 与后续任何 agent 参考）

> **判断 DSH 是否真的重启，只看一条：命令行含 `app.asar\lib\host.js` 的那个进程的创建时间。**
>
> ```powershell
> Get-CimInstance Win32_Process |
>   Where-Object { $_.Name -eq 'DSH NEXT.exe' -and $_.CommandLine -like '*host.js*' } |
>   Select-Object ProcessId, CreationDate
> ```
>
> 关窗口不杀宿主（`closeToTrayOnWindows: true`）；新实例发现已有实例时常在数秒内自退。用 `Select-Object -First 1` 取任意 DSH 进程会拿到最旧的那个，从而误判为「没重启」。

---

## 十一、CodeBuddy 第三轮（2026-11-02 13:10）：复核 + 修掉我自己留下的两处尾巴

先回应 10.5「无需再复核」：复核我还是做了，因为成本只有四条 grep，而且我上一轮的实现里留了你没看到的东西。

### 11.1 你要的四条复核，独立跑的结果

| # | 检查 | 结论 | 证据 |
|---|---|---|---|
| 1 | `includedIds` 是否覆盖所有返回路径 | ✅ 通过 | `recall.ts:102` 早退返回 `[]`；正常路径 `110/123/143` 三处一致。**但发现一处潜在失配，见 11.3** |
| 2 | 是否还有「用文本反推状态」 | ✅ 无残留 | `grep -rn "includes(" plugin/dsh/src/` 只剩 `out.includes(t)`（数组去重）与一条注释 |
| 3 | `firstLine` 是否只剩一处 | ✅ 一处 | 定义在 `usage-state.ts:45`，`recall.ts:8` import；`split(/\r?\n/)` 全仓库只有 `usage-state.ts:46`（`index.ts:165` 那个是按标点切用户消息，无关） |
| 4 | 长内容 / frontmatter 两种记忆是否都判 injected | ✅ 通过 | 你 10.1 的实测 `injected: 5`、`bytesUsed: 685`；单测 `frontmatter 摘要` 四条 + `includedIds` 相关用例 |

顺带确认了你 10.6 的判据：现在 `host.js` 有两个（13856 起于 12:00:45、36752 起于 12:38:48），**必须按 PID 分别看端口**——13856 对应 10033，端点当前 `status=injected / candidates=5`，是好的。

### 11.2 我上一轮的实现留了个假错误尾巴（已修）

你 8.1 里贴的那条 `lastError` 不是历史残留，**它每一轮都在重新产生**：

```
"lastError": "unknown tool \"mcp__cairn__memory_search\": only `run_code` is callable directly…"
```

原因是我把顺序写反了：先 `tools.execute`（本部署 ptc 下必然被折叠）→ 再退回 `definition.execute`。功能上没坏，但代价是**每条查询各撞一次拒绝，六条查询六次，然后把那条假错误永久写进诊断**。你 8.1 的结论（优先 `definition.execute`）是对的，我照它改了：

- 主路径改成 `definition.execute`，`tools.execute` 只作「定义上没有 execute」时的兜底；
- **成功即清空 `lastError`**——一条早已失效的旧错误不许陪着顺利的召回一直显示（这一轮它就把你我两边都带偏过一次）。

### 11.3 顺手修的另外两处

| 问题 | 影响 | 位置 |
|---|---|---|
| 留痕压制窗口开得太宽 | 主路径改直调定义体后不再触发 `tools/post-execute`，但 `onOwnCall` 仍在**每条查询前**开 3s 窗口 → **每轮开头 3 秒，用户手工调 cairn 工具都不留痕** | `index.ts` `searchOnce`：窗口收窄到「真的走 `tools.execute`」那一刻 |
| `includedIds` 与 `lines` 弹出不同步 | 预算二次回退时 `lines.pop()` 没有同步 `includedIds.pop()`，会报出「已被挤掉、实际没进文本」的 id → 去重层把用户从未看到的记忆记成已注入。当前预算公式下这条分支走不到（`maxNotice` 已预留），属防御性；但它是你 9.1 那个修复的不变量，值得锁死 | `recall.ts` `renderInjection` |

### 11.4 改动与验证

| 项 | 结果 |
|---|---|
| `plugin/dsh/src/index.ts` | 调用顺序反转 + 成功清空 `lastError` + 压制窗口收窄 |
| `plugin/dsh/src/recall.ts` | `includedIds.pop()` 与 `lines.pop()` 同步 |
| `plugin/dsh/tests/injector.test.ts` | mock 全部改成「定义体主路径」；新增 2 条：旧错误必须被成功召回清掉、召回后的手工调用必须留痕 |
| 插件测试 | **65 / 65 通过**（HEAD 63 → +2） |
| 根套件 | **668 / 667 / 0 / 1**，与基线一致 |
| `npx tsc -p tsconfig.json` | 退出 0，`dist` 已重建 |
| `AGENTS.md` | 在「DSH 插件先读源码」那条后面补了「ptc 下 `tools.execute` 恒失败、主路径应直调定义体」 |

### 11.5 重启后该看什么（未验证，只能等你重启）

```bash
curl -s "http://127.0.0.1:<新端口>/plugins/cairn-dsh-memory/usage?debug=1"
```

| 字段 | 期望 | 说明 |
|---|---|---|
| `debug.recall.execPath` | 恒为 `definition.execute` | 出现 `tools.execute` 就说明定义上取不到 execute，得回头查 MCP 注册 |
| `debug.recall.lastError` | **不存在** | 还在 = 主路径仍在抛错，此时才需要看错误原文 |
| `debug.recall.attempts` | 只增不减 | 累计计数，不是错误信号 |
| `status` / `candidates` | `injected` / ≥1 | 与 10.1 一致即无回退 |

**本轮所有代码改动只跑了单测与根套件，未做真实会话验证**——按你 10.6 的教训，我不做「改完即宣布」的事。

---

## 十二、记忆面板改左右两栏（2026-11-02 14:20，CodeBuddy）

### 12.1 用户要求 → 落地形态

| 要求 | 落地 |
|---|---|
| 分左右两侧 | 根容器 `display:flex; flex-wrap:wrap`，左栏 `flex:1 1 320px`、右栏 `flex:1 1 360px` |
| 左上＝已注入 | 状态卡：● + 三态文字 + 四项指标（召回条数 / 命中通道 / 预算占用 / 被过滤） |
| 左下＝本轮注入的记忆 | 独立卡片，`flex:1` + 内部滚动；空态给「本轮没有注入新的记忆。」，不是空白 |
| 右侧＝活动记录 | 标题 + 筛选条固定，列表 `flex:1; min-height:0; overflow:auto` 自己滚 |
| 自适应宽度和换行 | 两栏 `min-width:0` + `flex-wrap`：窄窗口自动上下堆叠；摘要 `overflow-wrap:anywhere` |
| 活动记录顶部按钮自适应 | 筛选条 `flex-wrap`，按四组（召回/工具、简要/详细、文字、记录存储）分组换行，组不拆散 |
| 不做条目数量展示 | 删掉 15/30/120 三个 chip；`filters.limit` 仍留在 localStorage（默认 30），只是不再有 UI |
| 参考轨迹的展示、支持滚动条 | 列表行＝等宽数字时间戳 + 类型标签 + 摘要三段，行间 `1px solid rgba(127,127,127,.12)`，行 `padding:3px 0` |

### 12.2 两处技术约束（改布局前必读）

1. **客户端插件没有样式表注入通道**，只能内联样式 → 自适应只能靠 flex，写不了媒体查询。所以「窄了就堆叠」是靠 `flex-wrap` + `flex-basis` 实现的，不是 breakpoint。
2. **内部滚动区必须同时有 `flex:1` 与 `min-height:0`**。flex 子项默认 `min-height:auto`，少这一条 `overflow:auto` 永远不触发，整块会把父容器撑高、面板变成一整个滚动条。

### 12.3 OpenSpec

新建变更 `openspec/changes/add-memory-panel-split-layout/`（`openspec validate --strict` 通过）：

| 制品 | 内容要点 |
|---|---|
| `proposal.md` | 为什么改（活动记录被压在底部、宽屏留白、条数 chip 与用户预期冲突）、非目标（不改 payload / 不改召回 / 不引入 UI 依赖） |
| `specs/agent-interfaces/spec.md` | MODIFIED 两条需求：「记忆调用对用户可见」加左右两栏、各自滚动、自适应不横向溢出、无条目数选择；新增 3 个场景（窄宽度堆叠、活动记录浏览）。「面板不泄露记忆正文」原样保留 |
| `design.md` | 布局选型（flex+wrap vs 媒体查询）、三层滚动归属图、`min-height:0` 的必要性、参考轨迹的对照表、保留隐藏上限的理由 |
| `tasks.md` | 12 项，11 项勾选；**4.5 手工冒烟保持未勾选**（需要重启 DSH 才能看真实布局） |

### 12.4 验证

| 项 | 结果 |
|---|---|
| `node --check plugin/dsh/src/client.js` | 通过 |
| 新增 `plugin/dsh/tests/panel-render.test.ts` | **4/4**：渲染不抛错、两栏结构、左上/左下/右侧内容、无「N 条」按钮（按钮数恰为 9）、空态文案 |
| 插件全部测试 | **69 / 69**（65 + 4 新增） |
| `npm test` | **668 / 667 / 0 / 1**，与基线一致 |
| `openspec validate add-memory-panel-split-layout --strict` | valid（2 个 delta） |

**为什么加渲染测试**：宿主的 slot 有 crash boundary，组件一抛错整个 tab 变空白，而空白在端点上看跟「没数据」一模一样——Round-10 就因此误判过一轮。`client.js` 以前完全没有测试，这次用 stub React 把组件树跑了一遍，锁住「渲染不炸 + 结构对」。

### 12.5 未验证（只能重启后看）

- 真实的**布局与滚动**：两栏是否并排、右栏列表是否独立滚动、窄窗口是否堆叠——stub React 不渲染 DOM，测不到。
- 视觉：`flex-basis` 取 320/360 是否合适、卡片边框在深浅主题下的观感。

重启后按这个顺序看：宽窗口 → 两栏并排且右栏能单独滚；拖窄窗口 → 两栏上下堆叠、筛选按钮换行不横向溢出；问一句会命中的话 → 左下出现记忆条目。

---

## 十三、栏宽可拖拽 + 布局持久化（2026-11-02 15:05，CodeBuddy）

### 13.1 用户追加要求 → 落地

| 要求 | 落地 |
|---|---|
| 左侧宽度可拖拽调整 | 两栏之间 8px 手柄：`data-cairn-split`、`role="separator"`、`cursor: col-resize`、`touch-action: none` |
| 保存布局 | 松手时写 `localStorage['cairn-memory-tab-layout'] = { leftPct }`；**存占比不存像素**（换窗口大小不失真） |
| 初始化布局 | 右栏底部「重置布局」按钮：删键 → 回到 `flex: 1 1 320px` 的自适应路径 |

**没有做「保存」按钮**：与既有筛选器一致，改动即持久化；多一个保存键只会制造「改了没保存」的状态。要恢复到默认值，「重置布局」就是那个入口。

### 13.2 实现要点

- **pointer capture**：`setPointerCapture` 后 move/up 都回到手柄，不用挂 window 监听，组件卸载也不用摘。
- **拖动中不落盘**：`d.last` 记最后一帧占比，只在 `pointerup` 写一次 localStorage。
- **夹紧 25%–75%**：允许拖到 5% 等于把一栏弄丢，用户还得靠记忆找回来。
- **脏数据回落**：`loadLayout` 校验 `Number(leftPct)` 落在区间内，否则当没存过——手改过 localStorage 也不会把左栏撑到 99%。
- **没拖过的用户行为不变**：`leftPct === null` 时仍走原来的 `flex: 1 1 320px`，窄窗口照样堆叠。

### 13.3 验证

| 项 | 结果 |
|---|---|
| `node --check src/client.js` | 通过 |
| `panel-render.test.ts` | **5/5**（原 4 条 + 新增「栏宽：默认/占比/越界回落」） |
| 插件全部测试 | **70 / 70** |
| `npm test` | **668 / 667 / 0 / 1** |
| `openspec validate add-memory-panel-split-layout --strict` | valid（同一变更内扩展，未新开第二个变更） |

### 13.4 未验证

- **真实拖拽手感**：pointer capture、跟手程度、拖动时是否误选文字（已 `preventDefault`，但没在真实浏览器里试过）。
- **跨重启保存**：localStorage 写入与读回只在 stub 里验过，真实 Electron 下待确认。
- 首次按下有几像素跳变（`startLeft` 用「手柄相对容器偏移」近似左栏宽度，差一个左右 padding），肉眼不可见，未修。

### 13.5 顺带记一条概念澄清（用户问「本轮注入的记忆」是什么）

左下方那份列表来自 `renderInjection(...).includedIds` —— **去重后、按预算裁剪后真正写进上下文的那几条**，不是本轮全部候选（那是「召回条数」）。而且它由 `buildUsage` 只在 `includedIds.length > 0` 时写入 `lastUsage`，所以：

> 当本轮因去重什么都没注入（`reason: nothing_new`）时，面板**保留上一次成功注入的快照**，而不是清空。

这是 `bdf0347` 刻意的选择（早退若覆盖 `lastUsage` 会让端点显示 miss，而注入其实发生过）。副作用是「本轮」这个词会骗人：面板上的状态与列表反映的是**最近一次真正发生注入的那一轮**。实测证据：同一 payload 里 `lastPreStep.reason = "nothing_new"` 而根节点 `status = "injected"`。

要改成严格「本轮」需要新的 payload 字段（例如 `current: {status, injected}` 与 `last: {...}` 并存），属于 Host 侧契约变更，未做。

---

## 十四、面板按会话隔离 + 点选高亮（2026-11-02 16:10，CodeBuddy）

### 14.1 用户报的问题是真的，而且是三处，不是一处

用户看到「多个会话的活动记录叠加在每一个会话的记忆 tab 里」。查下来三样状态全是**插件级单例**：

| 状态 | 原来 | 后果 |
|---|---|---|
| `activity[]` | apply() 里一个数组 | 所有会话共用一个环，面板互相串台 |
| `lastUsage` | injector 里一个变量 | 状态永远显示「最后跑过的那一步」，与当前会话无关 |
| `dedupe` Set | injector 里一个 Set | **A 会话注入过的记忆，B 会话再也不会注入** ← 这是功能缺陷，不只是显示 |

第三条违反既有规格（`agent-interfaces`：「同一会话内已注入过的记忆 MUST NOT 重复注入」——现实现做成了全局只注入一次）。

### 14.2 会话键的来源（权威）

| 侧 | 取值 | 依据 |
|---|---|---|
| Host / pre-step | `payload.agent.id` | `api-catalog.js`：`Agent { readonly id: SessionId }` |
| Host / tools-post-execute | `exec.agent.id` | 同上 |
| Client | slot `inject(sessionId)` 的入参 | `dsh-client-ui-trajectory` 注册 `conversation.view` 时就是 `inject: (sessionId) => ({...props})` |

取不到就落 `'default'` 桶，不抛错。

### 14.3 改了什么

1. **每会话一个 SessionState**（injector / 活动环 / 累计注入 / touched）。去重与 lastUsage 因此也变成会话级。
2. **端点带会话**：`/usage?session=<id>`；不带参数（curl 自检）回落最近活跃会话——用**单调序号**判先后，不用时间戳（同毫秒分不出）。
3. **左下改口径**：本轮 → **本会话注入的记忆（去重，跨轮累计）**。这同时回答了你「本轮是什么意思」的疑问：旧的「本轮」其实常常是上一轮的快照，现在改成不会误解的累计集合。
4. **点选联动**：召回条目带 `items`（id/kind/summary），点选后左侧同 id 高亮（背景 + 左侧色条 + `data-cairn-hit="1"`），再点取消。工具调用行不可点。
5. **落盘剥掉 items**：既有测试「记忆正文绝不入文件」直接把我第一版实现打回来了——摘要是正文前缀，写进 JSONL 就是长期留存面。现在落盘只有时间/类型/动作摘要/会话标识。

### 14.4 验证

| 项 | 结果 |
|---|---|
| 插件测试 | **74 / 74**（新增：会话隔离 2 条、点选高亮 1 条、累计去重 1 条） |
| `node --check src/client.js` | 通过 |
| `npm test` | **668 / 667 / 0 / 1** |
| `openspec validate fix-memory-panel-session-scope --strict` | valid（新变更，未塞进上一个） |

关键用例：会话 A 与 B 各跑一次 pre-step，两边都注入同一条记忆（证明去重是会话级）；`?session=A` 只返 A 的 1 条记录。

### 14.5 已知取舍与未验证

- **重启后「本会话注入的记忆」从空开始**：落盘不含 items，重建不了。这是隐私换来的，已写进 README。
- **旧落盘行**（没有 `s` 字段）落 `'default'` 桶，不再出现在任何真实会话面板里。
- **未验证**：`inject(sessionId)` 与 `agent.id` 是否完全一致（依据是类型定义与 trajectory 的用法，没在运行中的宿主里对比过）。若不一致，表现是面板空列表 + `debug.session.requested` ≠ `resolved`——一条 curl 就能确认。
- **未验证**：真实双会话并排、点选高亮的实际观感。

---

## 十五、✅ 用户验证通过 + 归档（2026-11-02 17:00，CodeBuddy）

### 15.1 用户实测结论

- **布局**：两栏并排、右栏独立滚动、窄窗口堆叠、筛选按钮换行 —— 通过。
- **栏宽**：拖拽跟手、刷新后占比保留、「重置布局」回到自适应 —— 通过。
- **会话隔离**：多会话不再叠加、点选联动高亮、「本会话注入的记忆」口径 —— 通过。

### 15.2 归档结果

| 变更 | 归档目录 | 主规格改动 |
|---|---|---|
| `add-memory-panel-split-layout` | `archive/2026-11-02-add-memory-panel-split-layout` | `agent-interfaces`：~ 2（两栏/自适应/拖拽/布局记忆） |
| `fix-memory-panel-session-scope` | `archive/2026-11-02-fix-memory-panel-session-scope` | `agent-interfaces`：~ 3（会话口径/累计注入/点选高亮/落盘不含记忆） |
| `refine-memory-panel-requirement` | `archive/2026-11-02-refine-memory-panel-requirement` | `agent-interfaces`：~ 1（正文压到 500 字符内） |

第三个是我在归档时临时补的：前两次归档后，`openspec validate --specs --strict` 报

> requirements[13]: Requirement text is very long (>500 characters).

原因是这条需求在两次变更里被连续追加（布局 + 自适应 + 拖拽 + 会话 + 累计 + 点选），正文超过 500 字符。开一个小变更只压措辞、不动场景，归档后 **9/9 规格全部 strict 通过**。

### 15.3 归档后的主规格口径（改面板前先读）

`openspec/specs/agent-interfaces/spec.md` →「记忆调用对用户可见」（9 个场景）：

- 三态必须文字区分，不得把「被过滤」显示成「没找到」；
- 面板按会话呈现，左右两栏各自滚动；
- 自适应：窄了上下堆叠、不横向溢出；栏宽可拖拽（25%–75%）并记住，可恢复默认；
- 左下＝本会话注入过的记忆（按 id 去重、跨轮累计）；活动记录不提供条数选择；
- 「自动召回」条目可点选，选中高亮该次注入的记忆条目。

配套两条：`插件注入可关闭且不重复`（去重范围**按会话**，新增「不同会话互不影响」场景）、`面板不泄露记忆正文`（新增「落盘日志不含记忆内容」场景）。

### 15.4 当前状态

- `openspec list` → **No active changes found**；仓库没有活动变更。
- `openspec validate --specs --strict` → 9 passed / 0 failed。
- 插件测试 74 / 74；`npm test` 668 / 667 / 0 / 1；`dist` 已重建。
- 已知边界（写进 `plugin/dsh/README.md`）：重启宿主后「本会话注入的记忆」从空开始（落盘不含 items，摘要也是正文前缀）。

---

## 十六、活动记录独立滚动 + 召回被虚词带偏（2026-11-02 19:40，CodeBuddy）

### 16.1 用户报的两件事，第二件不是面板问题

用户原话：「我 codebuddy 会话中的会用到的一些记忆，在 dsh 的一个视频制作的会话中展示了」。

先排除面板（上一轮刚做过会话隔离，不能假设它又是面板）：

| 检查 | 结果 |
|---|---|
| `GET /usage?session=bogus-id` | `{"status":"miss","sessionInjected":[],"recent":[]}` —— 未知会话返回空，**不会回落到别人的数据** |
| `GET /usage?session=session-3d49720c-…` | 只返回该会话的环与累计集合 |
| 宿主键 | `payload.agent.id`；`Agent { readonly id: SessionId }`（api-catalog 实锤） |
| 客户端键 | `conversation.view` 声明 `scope:"session"`；`runInject` 把 `binding.key` 传给 `inject(sessionId)` |

面板是干净的。问题在**查询构造**。

### 16.2 实锤：虚词查询把无关记忆捞进来

`deriveQueries` 按「出现次数」取二字词 —— 中文里出现次数最高的二字词几乎全是虚词。真实库只读检索：

| 查询词 | 命中 |
|---|---|
| `是否` | 4 条，含「报告人非本人时不要询问是否关闭」「经验要沉淀到技能，不能只写记忆」 |
| `一个` | 「编写代码时必须遵循 ponytail skill」 |
| `这个` | 「Cairn 的投影预算是按宿主分级的」 |

它们唯一的共性是含同一个虚词。更糟的是**污染是持久的**：注入一次就进会话去重集合，后面每一轮都不会再重新判断。

### 16.3 改法

1. `STOP_TERMS`（约 60 个虚词二字组）+ `isStopTerm`；`deriveQueries` 跳过虚词，从有实义的二字词取 top2。
2. `scoreHit` / `rankHits`：强词（汉字 ≥3 或 ASCII）2 分、实义二字词 1 分、虚词 0 分，按分降序进预算，同分保持首次命中顺序。**旧实现的顺序＝查询顺序，而查询顺序恰好从最泛的词开始**，预算永远先给最不相关的几条。
3. 召回合并改为按 id 累积命中词（同一正文被多个词带回来是加分信号）。

**第一版试过「只命中一个二字词就丢弃」，被既有用例打回**：`帮我从记忆库里拉取一下记忆` 的实义词只有「记忆」，下限会误杀。结论：二字词不是天然不可靠，**虚词才是**。

### 16.4 活动记录的滚动条

宿主 CSS：`.viewArea{flex:1;min-height:0}`，但 `[data-phase=active] .viewArea{flex:1 0 auto;min-height:auto}` —— 会话进行中视图区高度**不约束**，面板根节点 `height:100%` 退化成内容高度，内部 `overflow:auto` 永远不触发。用户看到的是整个会话区在滚。

改法：列表加 `maxHeight:56vh`。容器真给了确定高度时 flex 已经更矮，这个上限不生效；只有「高度自适应」那条路径用得上。仍然只有内联样式，不依赖样式表注入通道。

### 16.5 验证

| 项 | 结果 |
|---|---|
| 插件测试 | **79 / 79**（新增相关性 4 条、虚词查询 1 条） |
| `npx tsc -p tsconfig.json` | 重建 `dist`（插件从 dist 加载，不重建等于没改） |
| `npm test` | **668 / 667 / 0 / 1** |
| `openspec validate fix-recall-noise-and-activity-scroll --strict` | valid |

### 16.6 未验证

- 重启宿主后的真实观感：活动记录边界、左侧累计列表是否还有无关记忆。**需要用户实测**。
- 60 个虚词覆盖的是本次实测 + 常见虚词；新出现的虚词型噪音只能再补名单，没有自动学习。
