# 给 ZCode：DSH 记忆面板（client 插件）为什么渲染不出来

> 交接方：DSH 会话（2026-11-02 02:00，Asia/Shanghai）
> 仓库：`D:\Project\AI MemoryGLM` ｜ 分支 `main` ｜ HEAD `446a40a`
> **核心问题：Host 侧插件已 `active`，但浏览器里看不到面板。**

---

## 一、先看结果，别先看我怎么说

| 事实 | 证据 |
|---|---|
| Host 插件**加载成功** | 日志 `plugin.snapshot {\"pluginId\":\"include:cairn-dsh-memory\",\"fiberPhase\":\"active\"}` |
| MCP 连接**正常** | `[cairn-mcp] stdio server ready (pid 41848)`，进程存在 |
| **client 产物疑似未被接管** | 见下方「我的探测方法本身有问题」 |
| 面板**从未在界面上出现过** | 用户连续 5 次重启后确认看不到 |

---

## 二、我走过的弯路（请勿重走）

这是本次交接**最重要的一节**。我连续 5 次修错，每次都只追着报错里出现的那个属性名改：

| 次 | 我改的 | 结果 | 真因 |
|---|---|---|---|
| 1 | 插件对象不再暴露 `recall` 属性 | 失败 | 症状 |
| 2 | `inject` 加 `tools` | 失败 | 症状 |
| 3 | config 改从 apply 第二参数取 | 失败 | 症状 |
| 4 | **导出改成插件对象 `{name,inject,apply}`** | ✅ `active` | **真因** |
| 5 | slot 换位置 + 加 HTTP 数据通路 | **仍看不到** | 未知 |

第 4 次为什么是真因——asar 里加载器的代码：

```js
if (typeof plugin === 'function') return {
  apply: (ctx) => plugin(guarded(ctx))   // 函数导出被当 apply，ctx 成了第一个参数
};
```

我的默认导出曾是工厂函数 `createCairnMemoryPlugin(options)`，于是被代理的 ctx 落进了 `options`，读 `options.recall` / `options.config` 立刻抛 `cannot get property ... without inject`。**三次报错是同一个错误的不同面具。**

---

## 三、当前代码与配置的确定事实

### Host 侧（已工作）

`plugin/dsh/src/index.ts`：

```ts
export const name = 'cairn-dsh-memory';
export const inject = ['tools'];
export function apply(ctx, config) { ... }
export default { name, inject, apply };
```

行为：监听 `session/event` 攒用户消息 → `agent/pre-step` 时调 `ctx.tools.call('mcp__cairn__memory_search', ...)` → `agent.inject(...)` 注入 → 写 `lastUsage`。

单测 26/26 通过（`plugin/dsh/tests/`）。

### Client 侧（疑似有问题）

`plugin/dsh/src/client.js` 当前是**裸 ESM 风格**：

```js
window.__ModuleLoader__.load({
  id: 'cairn-dsh-memory',
  factory(require) {
    const React = require('react');
    ...
    return { inject: ['slots'], apply(ctx) { ... } };   // ← 直接返回对象
  },
});
```

而**能工作的** `dsh-connect-workbuddy/lib/client.js` 是 **CJS 包装**：

```js
window.__ModuleLoader__.load({
  id: 'dsh-connect-workbuddy',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    ...
    exports.apply = apply;
    exports.inject = inject;
    exports.name = name;
    return module.exports;      // ← 返回 module.exports
  }
});
```

**我怀疑这是主因之一，但没有验证。** 请重点核对。

### package.json 的 `dsh.client`

可工作的 workbuddy：

```json
"client": {
  "inject": ["@deepseek-ai/dsh-client-ui-settings", "@deepseek-ai/dsh-client-ui-slots", ...],
  "platform": "web"
}
```

我的（参考 decoration 模板补的）：

```json
"client": {
  "platform": "web",
  "immediately": true,
  "inject": ["@deepseek-ai/dsh-client-ui-conversation"]
}
```

注意：workbuddy 的 `inject` 里有 `@deepseek-ai/dsh-client-ui-slots`，我的没有。**这可能是差异。**
---

## 四、我的探测方法本身有问题（别重犯）

我用 `curl` 探测 `/plugins/cairn-dsh-memory/client.js` 得到 404，一度以为是证据。**这个探测方法无效**：

```bash
# 我测的（无效）：连已装且正常工作的插件也是 404
curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:12281/plugins/dsh-connect-workbuddy/client.js"
# → 404
```

从 asar 里 `@deepseek-ai/dsh-client-modules` 的说明看，真实形态是**按 combo 合并**的：

> `.../plugins/??...&rev=...`，with one bootstrap combo for the modules row and one or more application combos for the other rows; each phase is partitioned before a URL exceeds 3 KiB.

即：多个 bundle 被合并进一条 `??` 请求，不是一对一路径。所以「访问单个 client.js 得 404」**不构成证据**。

---

## 五、请 ZCode 做的事（按顺序）

### 1. 确认 client 产物到底有没有被宿主接管

推导方式建议：

- 打开 `http://127.0.0.1:12281`，在浏览器 Network 里筛 `plugins`，看 boot combo 请求里是否出现 `cairn-dsh-memory`
- 或在页面控制台查 `window.__ModuleLoader__` 已注册的 id 列表（若有 API）
- 对照 `dsh-connect-workbuddy` 的同名请求，看两者的差异

**先确认它有没有进入 boot graph，再谈渲染。** 如果连 graph 都没进，问题在 manifest 或加载阶段，不在 slot。

### 2. 核对三处我怀疑但不确认的地方

| # | 怀疑点 | 怎么验 |
|---|---|---|
| a | `factory` 必须返回 `module.exports`（CJS 包装），直接返回对象不行 | 按 workbuddy 的形状改写后重试 |
| b | `dsh.client.inject` 缺 `@deepseek-ai/dsh-client-ui-slots` | 补上后重试 |
| c | `exports["./client"]` 指向 `./src/client.js` 而 `files` 只含 `dist` | 确认宿主是从 package 目录读还是按 files 打包 |

### 3. 确认 slot 名

我用的是 `conversation.session.header.actions`。依据是 asar 里 ConversationRoot 的渲染：

```js
children: renderSlot("conversation.session.header.actions", {})
```

**已排除**：`conversation.session.header.views.actions`——它的注释写着内容是进 View tab 的 **More 下拉菜单**（`The View tab row's More launcher`），不是直接可见，所以我不再用它。

请确认 `conversation.session.header.actions` 在当前版本真的被 render（我只有静态代码依据，没有运行时证据）。

---

## 六、验收标准（看得见才算过）

1. 会话顶部出现一个记忆状态指示（文字标明状态，不只靠颜色）
2. 三种状态能区分：`已注入` / `已过滤` / `未命中`
3. 点开能看到：召回条数、命中通道、预算占用、被过滤条数、注入条目摘要
4. 库里已有一条可命中的记忆用于验证：

```bash
cd "D:/Project/AI MemoryGLM"
npx tsx src/interfaces/cli/main.ts search "投影"   # 应能命中（2026-11-02 已写入）
```

5. **回归**：`npm test` 668/667/0/1；`npx tsx --test plugin/dsh/tests/*.test.ts` 26/26

---

## 七、边界与纪律

- **只改 `plugin/dsh/`**，不要动 `src/`。Host 侧已工作，别推倒重来。
- 改完必须**重启 DSH** 才生效（client 产物在启动时装配）。
- 不采信我的自述：我这次给的全是「怀疑」而非「确认」，请自行验证。
- 未验证就写「未验证」，不要因为看着合理就说通过。

---

## 八、如何反馈

在本文件末尾追加；重点写「与我怀疑点的出入」：

```markdown
## ZCode 排查结果（YYYY-MM-DD HH:mm）

### 根因
（一句话说清到底是什么导致面板不显示）

### 与 DSH 怀疑点的对照
| 怀疑点 | 是否成立 | 证据 |
|---|---|---|
| a. factory 需返回 module.exports | | |
| b. inject 缺 ui-slots | | |
| c. exports 路径与 files 不一致 | | |
| d. slot 名不对 | | |

### 修改与验证
（改了哪些文件 + 重启后是否真看到面板 + 贴证据）
```

---

## ZCode 排查结果（2026-11-02，Round-4/5：根因实锤）

### 根因（一句话）
`conversation.session.header.actions` 是 **list slot**，注册选项必需 `id` 字段；我们写的是 keyed slot 的形状（`key` + `priority`），`slots.register` 校验直接抛 `list slot … requires options.id`，**面板从未注册成功**。此前各轮修复（路由先于 tools 注册、waiting chip、双路径 webServer）都是必要的外围，最后卡住的就是这一处。

### 证据链（三层独立实锤，不靠推测）
1. **DSH 渲染进程日志**（用户提供的 `app-1793560489940.log`）：`Uncaught Error: list slot "conversation.session.header.actions" requires options.id`，堆栈穿过 cairn combo 帧（`…cairn-dsh-memory/client.js…&rev=7ddb7b4527d7:11026:30`）——证明我们的 apply 确实执行、确实走到了 register、被校验拒绝。同一日志第 1 行证明 `cairn-dsh-memory/client.js` 已在 boot combo 里（加载阶段无问题）。
2. **asar 校验代码**（`D:\Program Files\DSH NEXT\resources\app.asar` 反查）：`case "list": if (e.id === void 0) throw … requires options.id`；另有 `case "keyed"` 用 `key`+`priority` 查重、`case "chain"` 要求 `select`。slot 服务有三种槽型，key/priority 是 keyed 的契约，不是 list 的。list 查重按 `id`+`priority`（缺省 0）。
3. **可工作参照** `dsh-connect-workbuddy/lib/client.js`（`profiles/desktop/node_modules/` 下，日志实证它成功注册 9 slots）：所有 list slot 注册一律 `{name, id, order, locale?, inject}` + 组件第二参，无一带 `key`。

### 与 DSH 怀疑点的对照
| 怀疑点 | 是否成立 | 证据 |
|---|---|---|
| a. factory 需返回 module.exports | 不成立（返回对象可用） | 日志堆栈实证 apply 已执行到 register |
| b. `dsh.client.inject` 缺 ui-slots | 不成立 | 同上；slots 服务已拿到我们的注册并完成校验 |
| c. exports 路径与 files 不一致 | 不成立 | client.js 已进 boot combo（日志第 1 行 rev=7ddb7b4527d7） |
| d. slot 名不对 | 名字对，形状错 | 校验器认得该 slot 并按 list 契约校验；错在选项缺 `id` |

### 次级发现：apply 外层的 try/catch 永远接不住注册抛错
Uncaught 堆栈显示 `slots.inject` 的回调是在**后续的全局 reconcile tick** 里才被调（该次 reconcile 的入口甚至是别的插件注册触发的 `notifyDeclaration`），此时 apply 早已返回。所以 catch 必须放进回调本体——已移。这条对后续写 DSH client 插件的任何人都是坑。

### 修改与验证
- `plugin/dsh/src/client.js`：`key`→`id`、`priority:20`→`order:20`（镜像 workbuddy 形状），try/catch 移入回调本体，附 comment 说明槽型契约。
- `node --check` 通过；插件单测 26/26 通过（`npx tsx --test plugin/dsh/tests/*.test.ts`）。
- **usage 端点已在真实 DSH 实证可用**：`http://127.0.0.1:34420/plugins/cairn-dsh-memory/usage`（带 token）→ `200 {"status":"miss","label":"未命中"}`——正是 serveUsage 的兜底形状。Host 侧路由注册成立，数据通路只剩前端挂载这一环。
- **待办**：重启 DSH 后目视确认面板（预期先见 waiting chip「Cairn 记忆面板…」，端点可达后转三态 chip）。ZCode 无法替用户完成这最后一步。

---

## ZCode 排查结果（2026-11-02，Round-6：面板已挂载，崩在详情段）

### 进展确认（app-1793561469588.log）
- `requires options.id` **消失**，combo rev 变为 `7dfaf02b8b8d`——Round-4/5 的 id 修复已生效。
- **面板组件已成功挂载**：`MemoryUsagePanel` 出现在渲染堆栈，且被宿主 slot crash boundary 接住（`slot entry crashed in 'conversation.session.header.actions'`）。
- 新症状：`TypeError: Cannot read properties of undefined (reading 'length')` at `MemoryUsagePanel`。

### 根因（一句话）
端点在「还没有任何召回」时返回退化兜底形状 `{status:'miss',label:'未命中'}`（serveUsage 原来的 `?? {…}`），缺 `injected` 等字段；面板一进详情段读 `usage.injected.length` 抛 TypeError，宿主 crash boundary 把整个条目卸载——面板「一闪即逝/一点就没了」。

### 修复（两侧都修，防御性原则：client 对任意响应形状都不得抛）
1. `src/usage-state.ts`：新增导出 `EMPTY_USAGE`（RecallUsage 全字段完备的兜底常量，附教训 comment）。
2. `src/index.ts`：serveUsage 兜底改用 `EMPTY_USAGE`。
3. `src/client.js`：新增 `normalize()`——fetch 响应一律归一化成字段完备对象再进 state；详情段条目再垫一层对象兜底。
4. 回归测试 +4：`usage-state.test.ts` 锁死 EMPTY_USAGE 字段完备；`injector.test.ts` 用假 webServer 捕获 handler，锁死端点兜底 JSON 含全部 8 字段且 `injected` 是数组。

### 验证
- 插件单测 30/30（26→30）；`tsc --noEmit` 净；`node --check` 净；dist 重建后 `import('./dist/usage-state.js').EMPTY_USAGE` 形状核对通过。
- 待用户重启 DSH 复验。

---

## ZCode 排查结果（2026-11-02，Round-7：tab 化 + 召回链路真实形状）

### 用户反馈的两个问题
1. 面板出现在 header「ptc 模式」后面 → 用户期望**像「轨迹」一样是独立 tab**。
2. 触发了记忆获取动作，面板仍显示 未命中/0/none/0 B —— 而轨迹里能看到调用记录。

### 根因 A（数据）：读错事件形状，召回一次都没跑过
- 面板显示「命中通道：none」是 `EMPTY_USAGE` 的特征值（真实跑过召回的 miss 是 `fts`）→ lastUsage 恒为 null。
- asar 实锤：`user/message` 事件的消息体在 **`evt.data`**（`event.data.source.kind === 'user'`，Keys 断言含 `turn`/`content`），旧实现读 `evt.message` → 永远 undefined → 用户消息永远抓不到 → pre-step 里 `shouldInject(空串)` 拒绝。
- **轨迹里的「调用记录」是 agent 显式调 MCP 工具（手动路径），与插件的自动召回（pre-step）是两条路**——面板只统计后者。这是用户困惑的直接原因，已在面板里加了说明文字。

### asar 实锤的宿主契约（本轮全部反查自 `app.asar`）
- `agent/pre-step`：`dispatch.waterfall("agent/pre-step", { messages, ...position, signal }, fallback)`；监听器签名 `(payload, next)`，可返回 `{kind:'reject'}`，fallback 返回 `{kind:'enter', messages}`。
- **payload 自带 `messages`** —— 用户原文不必从 session/event 攒。
- `agent.inject(message: UserMessage): void` 是真实 API（宿主文档：pre-step 监听器用它 "add durable request material"）。
- `conversation.view` 是会话 tab 槽：轨迹插件的注册形状 `{name, id:'trajectory', order:10, locale, label:()=>t(...), children?, inject:(sessionId)=>props}` + 组件第二参。

### 修改
1. `src/index.ts`：
   - pre-step 改为**直接读 `payload.messages`**（末尾向前找第一条有文本的 user 消息）；session/event 兜底改读 `evt.data` 且只认 `source.kind==='user'`。
   - 新增 `extractText`/`extractStepText`（导出，含形状兼容：字符串/`{type,text}`数组/`{text}`对象）。
   - 新增摘要级诊断 `diag`（lastEventType/lastCapture/lastPreStep，**不含正文**），`usage?debug=1` 可读——后续排查不再需要用户来回重启试错。
2. `src/client.js`：header chip 改为 `conversation.view` 独立 tab（id `cairn-memory`，order 90，label「记忆」），整页布局：三态状态 + 明细 + 注入列表 + 说明文字。
3. 回归测试 +5（30→35）：真实 pre-step 形状驱动召回并注入、session/event 真实形状兜底、agent-instructions 不触发、debug 参数、extractText/extractStepText 形状兼容。

### 验证
- 插件单测 35/35；`tsc` 净（dist 已重建，含新代码）；`node --check` 净。
- 待用户重启 DSH：① 会话顶部应出现「记忆」tab（与轨迹并列）；② 发一条消息后 tab 内数据应从 0 变化（`usage?debug=1` 可由 ZCode 直接 curl 验证链路）。

---

## ZCode 排查结果（2026-11-02，Round-8：tab 已确认，修召回查询构造）

### 用户反馈
「记忆」tab 出现了 ✓；但从记忆库拉取记忆时 tab 无内容，问是否验证方式不对。

### debug 端点实锤（ZCode 直接 curl，端口 2829）
`matchedBy: fts`（非兜底 none）→ **召回链路已通**：hook 挂上、MCP memory_search 调用成功、lastUsage 已写入；但 `lastPreStep.messageLen:0/reason:empty_message`（最后一步是空载荷步，如子代理步）且唯一的带正文步查询返回 0 条。另：`lastEventType:'?'` → session/event 对 include-fiber **从未送达**（fallback 死路，主来源 payload.messages 不受影响；已加 `lastEventCount` 便于后续确认）。

### 根因 B（有效性）：整句查询在 FTS5 trigram 下恒 0
cairn 检索分词只按标点切 CJK 段（≥3 字整段进 FTS 短语＝要求整段子串命中；2 字走有界 LIKE）。无标点自然语言长句＝一个长段 → 必然 0 条。用户手动拉取（agent 显式调工具）用了关键词所以能命中——**两条路的差异是设计如此，但自动路的查询构造确实要修**。

### 修改
- `src/index.ts` 新增导出 `deriveQueries(message)`：消息 → 短查询组，按命中可靠性排序——CJK 高频 2-gram（top2，LIKE 通道）→ ASCII 词（top2）→ 标点短句（前 8 字）→ 整句前 24 字；去重、上限 6。`makeToolRecall` 多路查询按 id 去重合并、够 topK 提前停。
- diag 加 `lastEventCount`（区分「事件从未送达」vs「送达但无 type」）。
- 回归 +5（35→40）：2-gram 优先、标点短句、去重上限、ASCII 词、多路合并注入。

### 正确的验证方式（给用户）
- 面板只统计**自动召回**（每轮对话前注入）；agent 显式调 Cairn 工具的记录在「轨迹」，不计入面板——设计如此。
- 验证自动召回：正常聊天（如「投影预算是多少」），无需让 agent 去拉记忆；tab 应显示 召回条数>0 → 已注入/已过滤。
- 插件单测 40/40；tsc 净；dist 已重建。待重启复验。

---

## ZCode 排查结果（2026-11-02，Round-9：全操作留痕 + 可配置展示）

### 用户反馈
聊天了还是没有（tab 未命中）；并提出需求：**所有经 cairn 记忆的操作都留痕，且可配置留哪些、展示到什么程度、筛选、条数/时长等（类轨迹的选项）**。

### debug 端点实锤（新端口 52227）
- `lastEventCount: 155, lastEventType: '(no type)'` → session/event **有送达**，但旧 handler 只收了一个参数——**asar 实锤真实签名是 `(session, event)` 双参数**，旧实现把 session 对象当事件用，永远抓不到 type。已修（兜底捕获恢复）。
- pre-step 触发但 messageLen 0：最后一步是空载荷步（子代理/压缩步）；带正文步的召回跑了但 0 命中——用户聊天内容可能与库无交集，多路查询已上线，待真实对话复验。
- 新增 diag：`lastRecall {queries, candidates, ms}`、`toolHookRegistered`、`toolEvents`。

### 新功能：活动记录（本轮主体）
- **留痕范围**：① 每轮对话的自动召回（查询路数/候选/注入，reason 非 ok 时标注）；② **所有经 `mcp__cairn__*` 的工具调用**（asar 实锤 `tools/post-execute` 签名 `(exec, result, next)`，`exec.name` 取工具名）——agent 手动拉取从此也进面板。自己的召回调用用 3s 时间窗压住防重复记。
- **记录纪律**：只存摘要（工具名/计数/状态），参数与返回内容一律不留（秘密纪律 D3 同源）。
- **可配置**：`PluginConfig.record.{recall,tools}`（记录层开关，默认全开）；展示层在 tab 里配——类型筛选（自动召回/工具调用）、明细程度（简要/详细）、条数（15/30/120），localStorage 持久化（key `cairn-memory-tab-filters`）。
- **上限**：内存环 120 条，随 DSH 重启清空；跨重启的持久化留痕属审计层扩展（`audit_event` 表现只记治理操作，不含检索），列为下一变更候选。
- serveUsage：payload 恒带 `recent`（最近 15），`?history=1` 带全部。

### 测试与验证
- 插件单测 42/42（+2：双参签名、留痕正反例）；发现并修正一处假通过（跨 apply 实例读空日志），改为同实例 spy 读 payload。
- tsc 净；dist 已重建。待重启复验。

---

## ZCode 排查结果（2026-11-02，Round-10：持久化改为插件开关，默认内存）

### 用户决策
不采用「核心审计层常开留痕」（提案已撤回，git `2b60bac` 留档可复活），改为**插件内开关：内存 / 落盘二选一，默认内存**。

### 实现
- **开关状态权威在 host**：marker 文件 `<CAIRN_HOME|~/.cairn>/activity-dsh.enabled`（存在即开），重启后保持用户选择；面板只能经 `POST /plugins/cairn-dsh-memory/persist {enabled:boolean}` 切换（GET 查状态，非法 body 400）。
- **落盘形态**：`activity-dsh.jsonl` 每行一条摘要（同内存环条目形状）；超 2MB 滚动 `.old`；开启时把文件尾部回放进内存环（t+summary 去重）。
- **纪律不变**：条目只含时间/类型/摘要计数；测试断言查询原文与记忆正文零出现；写失败 FAIL-OPEN 只进 stderr。
- **面板**：活动区筛选行新增「记录存储：内存 | 落盘」chip（乐观更新 + 3s 轮询的 `payload.persist` 校准），底部提示两种模式语义。

### 测试
- 插件 48/48（+6：默认内存不落盘 / 切换落盘+零出现 / 重启回放不重复 / 切回内存停追加 / 2MB→小阈值轮转 / 非法 body 400）；主库回归 668 项 667 pass / 0 fail。
- 途中修正两处测试自身缺陷：跨实例读空日志的假通过已在前轮修过，本轮新增 afterEach 导入缺失与 apply({}) 无 webServer 两处。

### 状态
- dist 已重建，待用户重启 DSH 后在「记忆」tab 试切换内存/落盘。

---

## ZCode 排查结果（2026-11-02，Round-11：内存/落盘看不到 = Rules of Hooks 违规）

### 现象（用户重启后）
记忆 tab 存在且可选中，但内容区全空——活动记录区与「记录存储：内存|落盘」chip 都不见。

### 取证路径（浏览器自动化，本次启动 rev=77fd79f2098e）
1. usage 端点带 `persist` 字段 → host 是新代码，且活动记录有真实条目（自动召回 + cairn.memory_get 工具调用）——后端一切正常。
2. 页面内 fetch 完整 combo（4.18MB）并 grep 标记：`记录存储`/`persist 路由`/`活动记录`/`id: 'cairn-memory'` 全部在 → **served bundle 就是最新代码**。
3. 进会话抓 DOM：tablist 里 `tab "记忆" [active] [selected]` **注册成功**，但 `[data-cairn-usage]` 数量 0 → 组件渲染即崩，宿主 crash boundary 静默卸载。

### 根因
Round-10 把 `React.useEffect`（persist 校准）写在了 `if (!data) return` **之后**：首渲染 data=null 提前返回少执行一个 hook，3s 后数据到达重渲染时 hook 数变多，React 抛 "Rendered more hooks than during the previous render"，组件被 crash boundary 整个卸载。Round-9 无此 bug（该 effect 是 Round-10 新增的）。

### 修复
`src/client.js`：useEffect 前移到所有 early return 之前（带 null 守卫 + `state.data` 依赖），附 comment 说明 hook 顺序纪律；顺带删掉死变量 `persistOn`。

### 状态
dist 无需重建（client.js 由宿主直接读取）；待用户再重启一次 DSH（rev 重算后生效）目视确认面板完整渲染。
