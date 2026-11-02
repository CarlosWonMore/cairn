# Design

## 会话键从哪来

| 位置 | 取值 | 依据 |
|---|---|---|
| Host（pre-step） | `payload.agent.id` | `api-catalog.js`：`Agent { readonly id: SessionId }` —— **Agent 的 id 就是会话 id** |
| Host（tools/post-execute） | `exec.agent.id` | 同上（模型发起的工具调用带 agent） |
| Client | slot `inject(sessionId)` 的入参 | `dsh-client-ui-trajectory` 的 `conversation.view` 注册就是 `inject: (sessionId) => ({...props})` |

取不到时一律落 `'default'` 桶，不抛错：面板少一块数据比整个 tab 崩掉好。

## 为什么所有状态都要按会话分，而不是只在读的时候过滤

只在端点过滤是不够的——`dedupe` 是**写入侧**状态：A 会话注入过的 id 进了同一个 Set，B 会话的 `renderInjection` 就会把它当成「已注入」直接跳过。所以 injector 必须一个会话一个实例（各自持有一份 dedupe 与 lastUsage）。

代价是内存随会话数线性增长，但每个会话只有几十条摘要，且随进程重启清零。

## 数据形状

端点新增两个字段，都是**只增不改**：

```json
{
  "session": "6f1c…",
  "sessionInjected": [{ "id": "…", "kind": "fact", "summary": "…" }],
  "recent": [{ "t": "…", "kind": "recall", "summary": "自动召回 候选5 注入1", "items": [{ "id": "…", "kind": "fact", "summary": "…" }] }]
}
```

`injected`（最近一次注入）保留不动，客户端在没有 `sessionInjected` 时回退到它——老宿主 + 新面板不会白屏。

## 点选高亮的实现

- 活动条目携带 `items`（注入的 id + 类型 + 摘要），点击时取 `items[].id` 组成集合；
- 左侧条目按 `id` 命中即加背景与左侧色条，并打 `data-cairn-hit="1"`（测试与肉眼都好查）；
- 再点同一条取消；只对带 `items` 的条目（自动召回）可点，工具调用行保持纯展示；
- 选中键 = `t|kind`，不用数组下标——列表会随筛选/轮询变化，下标不稳定。

## 落盘不写 items（隐私取舍）

内存环里保留 `items` 供点选，写 JSONL 时剥掉。理由：摘要是正文的前缀，文件是长期留存面，一旦写进去就无法收回；而内存环随进程消失。

代价：**重启后「本会话累计注入」从空开始**（面板会显示「本会话还没有注入过记忆」，直到下一次注入）。这条写进 README 的「已知边界」。

旧版本落盘行没有 `s` 字段，回放时落 `'default'` 桶——分不清归属就不给任何真实会话看，这是「宁可空、不串台」的同一个原则。

## 未验证

- 真实的 `inject(sessionId)` 是否与 `agent.id` 完全一致（依据是类型与 trajectory 的用法，没有在运行中的宿主里对比过）。若不一致，表现为面板显示空列表 + `debug.session.requested` 与 `resolved` 不同——一条 curl 就能确认。
