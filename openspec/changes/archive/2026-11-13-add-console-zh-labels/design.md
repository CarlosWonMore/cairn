## Context

控制台的所有文案都写在 `src/interfaces/console/assets/ui-js.ts` 的单个 `String.raw` 模板里，被原样嵌进页面；测试直接对这个字符串做断言，因此「页面里跑的」与「测过的」是同一份代码。既有已有四张 label 表（`ACTION_LABEL` / `DISPOSITION_LABEL` / `ANN_STATUS_LABEL` / 各种 `*_CHIP`），它们负责「建议动作」与「批注」两组枚举——**记忆本体这组没有**。

枚举事实源在 `src/core/types.ts`：`MEMORY_KINDS` 8 个、`MEMORY_STATUSES` 6 个、`AUTHORITIES` 4 个。作用域与扫描状态是字符串列，取值散在 store 层。

## Goals / Non-Goals

**Goals**
- 默认中文标签，一键切原文，切换不动数据。
- 中文模式下原始枚举值仍可查（hover）。
- 映射表单点定义，未知值安全降级。

**Non-Goals**
- 不做完整的 i18n 框架（没有多语言需求，只有一中一原两态）。
- 不翻译记忆正文、导入来源名、错误消息——那些是内容不是标签。
- 不改服务端返回、不加接口参数。
- 不翻译 `contentHash` / UUID 这类标识。

## Decisions

### D1：两态是「原文」与「中文」，不是「中文」与「英文」

「原文」更准确：它承诺的是**库里的真实取值**，而不是某个语言。将来若枚举本身改了词，原文模式跟着变，不需要维护第二套映射。

### D2：`label(value, table)` 单点，未知值原样返回

```js
function label(v, table) { return (table && table[v]) || v; }
```

未知值原样显示而不是空白或 `undefined`：新加 `kind` 时最坏情况是回到英文，不是界面出现空洞。这也是唯一能让「不崩」与「可读」同时成立的选择。

### D3：hover 保留原值用 `title`，不引入悬浮层

`chip(text, tone, title)` 第三个参数可选；只有被翻译过的 chip 传 `title=原始值`。原文模式下不传（值就在文本里，再挂 title 是冗余）。

### D4：状态放在 `state.labelLang`，与 `state.mode` 同级

`mode`（brief/full）已有完整的持久化链路：`localStorage` 的 `MODE_KEY` + URL 的 `mode` 参数。**不把语言塞进 URL**——地址栏是「查询条件」的载体，语言是显示偏好，混进去会让分享链接带上别人的阅读习惯。只走 localStorage，与 theme 一致。

> 取舍：这违反「所有视图状态可寻址」的字面要求。但主题早已是这个例外（`THEME_KEY` 也不进 URL），语言与主题同类。规格里因此只要求「刷新后保持」，不要求「复制地址能复现」。

### D5：切换只重渲染，不重新请求

`toggleLabelLang()` 只改 `state.labelLang` → 写 localStorage → `render()`。`render()` 对 memories 视图会重新走 `api()`——**这是当前既有行为**（切模式也是重新拉）。为避免把这句话写成空头承诺，tasks 里加一条实测：切换前后 `/api/memories` 请求数不增加。若实测发现确实发请求，则改为只重绘已加载数据，不改规格措辞。

## Risks / Trade-offs

- **风险**：映射表与服务端枚举漂移。→ 测试断言「`MEMORY_KINDS` 里每个值都在映射表中」，漂移会变红。
- **风险**：新增 chip 调用点忘记走 `label()`。→ 测试断言源码里不存在直接 `chip(mem.kind` 这类未包装调用。
- **取舍**：不做语言切换的快捷键。已有 1-7 / P / M / T / ? 六个，再加会拥挤；按钮够用。

## Migration

无 schema 变更。旧 localStorage 无该键时默认中文，与「默认中文」一致，不需要迁移代码。
