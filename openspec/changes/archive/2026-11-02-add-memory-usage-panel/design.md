# Design

见 `proposal.md`。这里记录实现形态。

## Context

- DSH UI 插件：`package.json` 加 `dsh.client` 段与 `./client` 导出，client 产物注册到 slot。
- 目标 slot：`conversation.session.header.views.actions`——「对话/轨迹」视图旁的操作区。
- Client 模板形状：`window.__ModuleLoader__.load({ id, factory(require){ ... return { inject:['slots'], apply(ctx){...} } } })`。

## Goals / Non-Goals

**Goals**：五个字段可见、三种状态可分、不泄正文。

**Non-Goals**：不做历史回看（那属于控制台）、不做编辑、不做统计图表。

## Decisions

### D1：状态用「最近一次」而非历史

面板只显示**本轮最近一次**召回结果。历史在控制台看。

**理由**：会话顶部是即时可观测点，不是分析面板。堆历史会让它变成第二个控制台。

### D2：三种状态是硬区分，不是颜色差别

`injected` / `filtered` / `miss` 用**文字**标明，不只靠颜色。

**理由**：颜色对色觉障碍用户不可靠；而且「被过滤」这个状态的语义比「没找到」重要得多，必须读得出来。

### D3：只传摘要，正文永不进入面板状态

Host 侧写入状态时只放 `{ id, kind, summary }`，`summary` 截断到 60 字符。敏感项在召回过滤阶段就被剔除，状态里只留计数。

**理由**：面板是高频可见区域，正文进入面板等于扩大了泄露面。

### D4：UI 失败不影响会话

Client 插件渲染异常由宿主隔离；Host 侧写状态失败也只是少一个面板，召回照常。

### D5：无法自动验证的部分如实标注

能测的：状态形状、三态判定、摘要截断。
不能测的：slot 是否真的渲染出来、用户是否真的看到。后者只能手工冒烟。

## Risks / Trade-offs

- **slot 名变动** → 只依赖公开名；渲染失败由宿主隔离。
- **面板占用顶部空间** → 默认折叠为一行摘要，点击展开详情。
- **无法 CI 验证 UI** → 如实标注 fixture-only。

## Migration Plan

纯新增。回滚：移除 `dsh.client` 段与 client 产物即可，Host 侧不受影响。

## Open Questions

- 面板是否需要在「轨迹」视图隐藏。可延后。