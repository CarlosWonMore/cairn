# Proposal: 收紧「记忆调用对用户可见」的需求正文

## Why

归档 `add-memory-panel-split-layout` 与 `fix-memory-panel-session-scope` 后，`openspec validate --specs --strict` 报一条告警：

> requirements[13]: Requirement text is very long (>500 characters).

原因是这条需求在两次变更里被连续追加：布局、自适应、拖拽、会话隔离、累计注入、点选高亮全塞进同一个需求正文。场景已经覆盖了细节，正文里再逐句复述一遍既超长，也让「一条需求一个行为」的边界糊掉。

## What Changes

**只改这条需求的正文措辞，不改任何场景、不改任何实现。** 压缩为四段：可见性 / 三态 / 版式与会话口径 / 交互。所有 MUST 语义保留，删掉的是重复表述。

## Capabilities

### Modified Capabilities

- `agent-interfaces`：需求正文压缩到 500 字符以内，场景集合与约束强度不变。

## Impact

- 只改 `openspec/specs/agent-interfaces/spec.md` 的一条需求正文。
- 不改代码、不改测试；归档后 `openspec validate --specs --strict` 应为 9/9 通过。
- 风险：压缩措辞可能丢掉某个 MUST 的约束力 → 逐条对照原正文后保留全部 MUST。
