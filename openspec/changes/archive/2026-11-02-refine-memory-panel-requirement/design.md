# Design

## Context

`add-memory-panel-split-layout` 与 `fix-memory-panel-session-scope` 连续两次在同一需求
「记忆调用对用户可见」上追加正文与场景，累积后触发 `openspec validate --specs --strict`
的 `requirements[13]: Requirement text is very long (>500 characters)` 告警。

## Goals / Non-Goals

**Goals**：把需求正文压回 500 字符以内；保留全部 MUST 与全部 9 个场景。

**Non-Goals**：不改任何实现、不改任何场景、不增减约束强度。

## Decisions

### D1：只改正文措辞，不动场景

场景是行为契约的可测形态，正文是它的摘要。超长的原因正是正文把场景内容又复述了一遍。
因此删掉的是重复表述，不是约束。

### D2：压成四段结构

可见性 / 三态 / 版式与会话口径 / 交互。四段各自对应一组场景，读正文即可知道场景在覆盖什么。

### D3：逐条对照保留 MUST

压缩的最小单位是句子，不是 MUST。改前逐条列出原正文里的 MUST，改后逐条确认仍在。

## Risks / Trade-offs

- **措辞压缩可能弱化某个 MUST** → 逐条对照，已确认全部保留。
- **未来仍会再追加** → 这次归档后，新行为应先加场景；正文只在语义变化时改。

## Migration Plan

纯文档变更，无迁移。回滚即恢复原正文。

## Open Questions

无。
