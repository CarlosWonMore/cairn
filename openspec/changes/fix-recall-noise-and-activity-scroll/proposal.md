# Proposal: 召回不许被虚词带偏 + 活动记录独立滚动

## Why

用户实测两件事，其实是两个独立缺陷：

**1. 视频会话里出现别的项目的记忆。** 用户原话：「codebuddy 会话中会用到的一些记忆，在 dsh 的一个视频制作的会话中展示了」。查证结果：**这不是面板串台，是召回被虚词带偏**。

- 面板侧已被排除：`?session=bogus-id` 返回空 payload（`sessionInjected: []`、`recent: []`），会话切片是好的。
- 召回侧有实锤：`deriveQueries` 取消息里出现次数最高的两个二字词当查询，中文里这几乎总是「一个 / 这个 / 可以 / 是否」这类虚词。用真实库验证——

  | 查询词 | 返回 |
  |---|---|
  | `是否` | 4 条，含「报告人非本人时不要询问是否关闭」「经验要沉淀到技能」等互不相干的记忆 |
  | `一个` | 「编写代码时必须遵循 ponytail skill」 |
  | `这个` | 「Cairn 的投影预算是按宿主分级的」 |

  这些命中的唯一共同点是含一个虚词。它们被当作"相关记忆"注入，再被去重集合永久记住，于是这个会话后面每一轮都在用别的主题的记忆。

**2. 活动记录没有自己的滚动条。** 宿主 CSS 在会话进行中把视图区放成 `min-height: auto`（`[data-phase=active] .viewArea`），面板根节点的 `height:100%` 因此失效，内部 `overflow:auto` 永远不触发——列表长到撑开整页，滚动的是整个会话区。

## What Changes

1. **虚词不进查询**：新增 `STOP_TERMS` 黑名单（一个/这个/可以/是否/我们……共 60 个），`deriveQueries` 选二字词时跳过它们，从有实义的二字词里取 top2。
2. **按相关性重排**：两条命中同时命中时，不再"查询顺序即优先级"（最泛的词排最前）。改为强词 2 分、实义二字词 1 分、虚词 0 分，按分降序，同分保持首次命中顺序。
3. **活动记录自己滚**：列表加 `maxHeight: 56vh`（容器真给了确定高度时 flex 已经更矮，此上限不生效），配合既有的 `flex`/`min-height:0`。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `agent-interfaces`：
  - 新增「注入内容不得由虚词单独驱动」——注入必须与当前问题有实质关联，MUST NOT 仅凭高频虚词命中就注入。
  - 「记忆调用对用户可见」补一条：活动记录 MUST 在自身区域内独立滚动，MUST NOT 与整个会话区共用一个滚动条。

## Impact

- `plugin/dsh/src/recall.ts`：`STOP_TERMS` / `isStopTerm` / `scoreHit` / `rankHits`。
- `plugin/dsh/src/index.ts`：`deriveQueries` 跳过虚词；召回合并改为按 id 累积命中词并交给 `rankHits`。
- `plugin/dsh/src/client.js`：活动列表加 `maxHeight`。
- 测试：`recall.test.ts`（新增 4 条相关性用例）、`injector.test.ts`（新增 1 条虚词查询用例）。
- 风险：
  - **黑名单把有实义的词挡住** → 只在「明确是虚词」时收录，并对「记忆 / 投影 / 视频 / 剪辑 / 同步 / 授权」写了误伤用例。
  - **重排让注入顺序变化** → 预算裁剪仍按排序后的顺序，不会漏掉更相关的条目；顺序本身不是对外契约。
