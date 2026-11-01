## MODIFIED Requirements

### Requirement: 批次进度全局可见

系统 SHALL 在单个视图中列出全部导入批次及其进度，并 SHALL 把该批次对应的快照来源、字节数与脱敏状态并入同一行；MUST NOT 只展示当前活跃批次，MUST NOT 把快照与批次拆成两个视图。

进度 MUST 区分「待处理」与「已跳过」两个计数；待处理 MUST NOT 包含已跳过的条目，已跳过的条目 MUST 仍可查询其判定依据。

#### Scenario: 多批次全景
- **WHEN** 库中存在多个待整理批次
- **THEN** 系统一次列出全部批次，逐行给出来源、字节数、脱敏状态、total、clean、blocked、promoted、skipped、remaining，并按 remaining 从高到低排序，使"还欠多少"可一眼回答

#### Scenario: 待处理计数不含已跳过
- **WHEN** 某批次内所有可处理条目都已晋升或已跳过
- **THEN** 该批次的 remaining 为 0，而 promoted 与 skipped 分别反映各自的数量，总数仍可与 clean 对应

#### Scenario: 已跳过条目可查
- **WHEN** 用户查看某批次的已跳过条目
- **THEN** 系统列出这些条目及其判定依据，MUST NOT 让它们从界面上完全消失

#### Scenario: 批次内条目待处理队列
- **WHEN** 用户打开某个批次
- **THEN** 系统在该批次的抽屉中展示其条目、每条的建议动作与依据，并标明该批次之外还有多少同类待处理项；MUST NOT 把条目渲染到列表下方的页面位置

#### Scenario: 档案与批次一一对应
- **WHEN** 库中每个档案恰好对应一个批次
- **THEN** 系统在同一行呈现两者，不重复占两行
