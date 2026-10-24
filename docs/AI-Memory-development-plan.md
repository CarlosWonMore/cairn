---
title: AI Memory 系统构想
---

> 版本：2.0（重构稿）\
> 日期：2026-10-24\
> 状态：可进入原型验证；团队共享暂不实施

## 1. 决策摘要

这个方向具备可行性，但可行的是“个人记忆主权层”，不是“统一所有 Agent 的内部记忆数据库”，也不是另一个规格驱动开发平台。

产品的一句话定义：

> 为同一使用者的多台设备、多个 Agent 提供本地可用、按需同步、可解释、可删除、可迁移的记忆层；云端只是加密中继和备份，不是使用记忆的前提。

本方案做出以下明确决策：

1. 本地优先。每台设备以自己的 SQLite 为唯一可写运行副本；断网时新增、检索、修改、导出仍可使用。

2. 云端可选。提供 ECS 自建 HTTP 同步服务和华为 OBS 这类 S3 兼容对象存储两种远端；二者同步同一套加密 chunk/manifest 协议。

3. 不同步 SQLite 文件本身。同步单位是不可变、压缩、加密的事件 chunk；快照只用于加速新设备初始化。

4. 兼容分层。标准 MCP 是主接口，CLI 是管理入口，受管 Markdown/规则区块是低能力 Agent 的投影；不承诺接管所有 Agent 的私有原生记忆。

5. 记忆粒度不是一个枚举。用“空间 + 项目 + 设备 + Agent + 同步策略”组成作用域，并提供常用预设和受约束的自定义空间。

6. 指令与事实分治。用户明确指令、用户确认的事实、模型推断候选、原始事件分别建模；模型推断不得静默覆盖用户明确内容。

7. 无模型也能用。显式记忆、FTS5 检索、导入导出、同步、冲突处理均不依赖 LLM；向量检索与自动抽取是可拆增强件。

8. 抽取采用混合路由。当前 Agent 在会话内提出高质量候选；本地模型负责离线批处理；云端模型按空间显式 opt-in。最终以自有评测集选择模型，不预设哪家一定最好。

9. 同步和抽取退出 Agent 会话关键路径。默认不安装同步 hook；网络、Git、模型调用、重建索引都只由独立 worker、显式 CLI 或系统计划任务执行。

10. 冲突不做字段级最后写入获胜。使用修订链判断祖先与并发；并发内容保留双方并进入冲突队列，旧远端代次不能覆盖新本地状态。

11. 新实现推荐 TypeScript + Node.js + SQLite，发布到 npm，试用可用 npx，长期运行使用固定版本安装。npm 与 npx不是二选一，uvx 不作为主分发。

12. 可以先开源，但 Pro 必须靠托管 relay、桌面治理体验和高级评测等真实增量收费；离线能力、端到端加密、导出、自定义作用域和基础同步不能做成“安全赎金”。

## 2. 目标用户、核心场景与边界

### 2.1 目标用户

首要受众是个人开发者、AI 重度使用者和独立知识工作者，典型状态是：

- 同时使用台式机、笔记本、服务器或虚拟机；

- 同时使用 Claude Code、Cursor、GitHub Copilot、OpenClaw、WorkBuddy 等两个以上 Agent；

- 希望偏好、项目决策、环境信息和阶段性进展可以延续，但不希望把所有对话交给新的 SaaS；

- 有些记忆应跨设备、跨 Agent，有些只能留在当前设备或当前项目；

- 愿意自行配置 OBS 或 ECS，也可能完全没有云端资源。

首版不为团队管理员设计，不以公司权限体系、组织共享和审批流为销售前提。

### 2.2 首版必须完成的场景

1. 用户在 Agent A 中明确说“记住我的提交偏好”，之后在本机 Agent B 中可以检索并应用。

2. 用户在电脑甲写入个人公共记忆，通过 OBS 或 ECS 同步后，在电脑乙恢复并使用。

3. 设备路径、本地端口、临时目录、硬件约束只留在对应设备，不能随个人公共记忆上行。

4. 同一项目在不同设备上的本地路径不同，但仍映射到同一个逻辑项目。

5. 两台设备离线修改不同记忆，恢复网络后都能合并；若修改同一条记忆，系统保留证据并请求解决，不静默丢失。

6. 云端停机、模型超时、OBS 返回旧数据或 worker 崩溃时，当前 Agent 会话仍能继续，本地任务之后可以重试。

7. 用户可以检查一条记忆为何产生、来自哪次交互、被哪些 Agent 使用、何时失效，并能更正、遗忘和导出。

8. 用户没有配置任何模型或云端账号时，仍可使用显式记忆和关键词检索。

### 2.3 明确非目标

首版不做以下事情：

- 不做需求规格、任务拆解、验收门禁、OpenSpec/SDD 流程管理；与规格驱动的边界是“只管记忆生命周期”。

- 不做多人共享、组织权限、共享审批和团队空间；只保留未来扩展点。

- 不做通用笔记软件、Obsidian 替代品或完整聊天记录仓库。

- 不把 Postgres、Neo4j、独立向量数据库设为个人首版的必需组件。

- 不自动读取整个用户目录，不抓取 Agent 私有数据库，不依赖未公开接口伪造“全兼容”。

- 不在每次对话前后执行云同步，不让 MCP 进程承担必须常驻的后台同步任务。

- 不自动双向镜像所有 Agent 的原生记忆文件；导入和投影必须可区分、可停止、可避免回环。

- 不用“记忆”充当权限系统。记忆是模型上下文，不能替代 Agent 的权限、沙箱和审批设置。

本文中的“个人公共记忆”仅指同一使用者自己的设备与 Agent 可见，不等于互联网公开，也不等于团队共享。

## 3. 可行性判断与前置验证

### 3.1 各能力可行性

本地多 Agent 共库：可行性高。SQLite、MCP stdio、CLI 和受管文件投影均为成熟路径。

自定义记忆粒度：可行性高，但必须把作用域变成写入、检索、投影和同步共同执行的策略，不能只加几个标签。

ECS/OBS 多设备同步：可行性中高。难点不在上传下载，而在幂等、重复、乱序、旧代次、删除、冲突、密钥和恢复演练。

自动抽取：可行性中。可以稳定实现“生成候选”，不能预先保证“长期记忆总是正确”。质量必须靠证据、分域、审核和真实数据评测约束。

全 Agent 兼容：只能分层成立。支持 MCP 的 Agent 可覆盖核心工具；不支持 MCP 的 Agent 只能投影或导入导出；原生自动记忆没有公开写接口时，不能承诺功能对齐。

开源后收费：有可行性但不是自然结果。强大的免费项目已经覆盖大量基础能力，Pro 必须解决托管运维、冲突治理、设备管理和评测等持续痛点。

### 3.2 最大的工程风险

真正的风险不是 SQLite 能否存下数据，而是以下四件事：

1. 同步或 hook 故障把 Agent 会话拖死；

2. 旧版本、并发修改或错误合并把新记忆覆盖；

3. 自动抽取把错误、恶意内容或秘密写成高权威长期记忆；

4. scope 只用于搜索过滤，却在同步包、导出文件或 Agent 投影中泄露。

因此，首版成功标准应是“故障下安全降级”，而不是功能数量。

### 3.3 Build、复用还是 fork

Engram 与本方向最接近：本地 SQLite 权威库、Go 单二进制、MCP/CLI、FTS5、可移植同步 chunk 和可选云复制都值得优先做复用评估。agentmemory 则提供了 TypeScript、多 Agent、混合检索和公开评测的参照。

建议把“复用评估”列为 M0 的正式门槛：

- 如果现有项目能通过公开扩展点满足 OBS/ECS、设备作用域、自定义空间、端到端加密和会话故障隔离，优先复用或向上游贡献，不重复造核心。

- 如果必须侵入其同步权威模型、重写权限边界并长期维护大面积分叉，则按本方案独立实现轻量核心。

- 不因为许可证允许就直接 fork 一个庞大项目。维护成本、上游速度和功能表面积同样属于成本。

- 本方案的语言与分发建议针对“独立新核心”路线；若最终选择基于 Go 项目扩展，应单独重审，而不是同时维护两套核心。

## 4. 成熟 Agent 的可借鉴机制

### 4.1 Claude Code

官方当前区分 CLAUDE.md/AGENTS.md 持久指令与 auto memory 自动记忆。auto memory 使用本机 Markdown，`MEMORY.md` 是索引，每次启动仅加载前 200 行或 25KB，详细主题文件按需读取；自动记忆机器本地保存，不天然跨机器。官方也明确这些内容是上下文，不是强制配置。

吸收：

- 小型启动索引 + 主题内容渐进读取；

- 人工指令与机器习得记忆分开；

- 项目、用户、本地作用域；

- 明文可编辑、可删除；

- 不把记忆当成硬性权限控制。

不照搬：直接监听并双向改写其自动记忆目录。首版只做显式导入和受管投影，避免与 Agent 自身写入形成回环。

### 4.2 GitHub Copilot

Copilot Memory 当前区分 repository-level facts 与 user-level preferences。仓库事实带代码引用，使用前会对当前分支重新验证，只有验证通过的事实才使用；未使用记忆 28 天后删除，成功验证并使用可以刷新计时。该能力仍处于 public preview。

吸收：

- 仓库事实与个人偏好分域；

- 事实必须带证据；

- 使用前再验证，而非写入后永久相信；

- TTL、最后使用时间和最后验证时间；

- 支持用户查看与删除。

不照搬：本方案首版不把个人记忆变成团队仓库事实，也不假设 Copilot 原生 Memory 存在公开通用写接口。

### 4.3 Cursor

Cursor 官方明确模型补全之间不保留记忆，Rules 提供的是持久、可复用的提示上下文。项目规则支持 alwaysApply、路径 globs、按描述相关性附加和手动 @ 调用，也支持 AGENTS.md。

吸收：

- 常驻、按路径、按相关性、手动四种加载策略；

- 受管规则区块作为记忆投影；

- 不把规则文件误当成自动事实库。

### 4.4 OpenClaw

OpenClaw 当前使用 USER.md、MEMORY.md 和每日工作记录分层。USER.md 承载紧凑用户模型，MEMORY.md 承载精炼长期事实与决策，每日文件承载工作上下文；后台 dreaming 将符合阈值的短期信息晋升为长期记忆，并有来源污染门控与可审查摘要。官方同样强调记忆不执行权限策略。

吸收：

- 启动层、工作记录层、长期精炼层分离；

- 后台整理而非前台阻塞；

- 不可信来源不得晋升；

- 记录行为边界、有效期和来源权威；

- 官方导入只复制明确的 Markdown 记忆，源文件保持不变。

### 4.5 WorkBuddy

WorkBuddy 官方公开页明确：从会话历史提取事实、偏好、人物关系和跟进事项，定期整理，支持查看、编辑、删除、关闭、会话历史检索和从其他 AI 导入；官方也提醒自动抽取可能存在概括偏差或时效性问题。

吸收：

- 后台批处理节奏；

- 用户始终可查看、修正、删除和关闭；

- 提供迁移入口；

- 重要判断前需要核验。

外部系统不能据此假定存在稳定的原生记忆写入 API。首版以 MCP、导出文本和官方支持的导入路径为边界，不直接依赖内部实现。

### 4.6 TeamAI 的同步经验与硬约束

TeamAI 可借鉴的是版本化资产、原子变更、冲突留痕、回滚、诊断和多 Agent 投影。其近期 release 已出现将 post-tool-use 副作用移出内联路径、改为 detached 执行等改进，这与本方案方向一致。

但 release note 不等于所有版本、所有 Agent 的 hook 问题都已消失。结合实际使用中“hook 超时可能引发 Agent 会话异常终止”的反馈，本方案采用更严格的默认：

- 同步 hook 默认不存在；

- 网络 pull/push、Git 操作、模型调用、索引重建永不进入 hook；

- 可选 hook 只读预计算小文件或向本地持久队列追加极短事件；

- hook 必须有内部Deadline、外部超时、异常兜底和 fail-open；

- hook 失败只允许损失一次自动增强，不得影响用户会话。

## 5. GitHub 开源项目调研与取舍

调研时间为 2026-10-24，仓库活跃度与许可证通过 GitHub 元数据核验，功能以当前官方 README/文档为依据。下列“吸收”不代表复制代码，也不采用各项目未经独立复现的宣传基准。

### 5.1 Engram

现状：Go 单二进制，SQLite + FTS5，MCP/HTTP/CLI/TUI；本地 SQLite 是权威库，Git Sync 使用可移植压缩 chunk，另有可选云复制；MIT。

吸收：单进程易部署思路、增量同步包、显式保存重要知识、渐进检索、doctor 和恢复工具。

不照搬：首版不追求同等数量的 Agent 插件、云功能和工具表面；必须先审查其作用域是否能满足本方案的物理同步隔离。

### 5.2 basic-memory

现状：Markdown 是可读写的真相源，SQLite 是索引，支持本地语义检索和 MCP；云服务另提供跨设备同步；AGPL-3.0。

吸收：人类可读导出、项目空间、编辑与索引一致性检查、安装和升级故障要纳入验收。

不照搬：本方案不让 Markdown 与 SQLite 都成为可写权威源，避免双向双写；不复制 AGPL 代码。其 2026-10-24 关于对象存储旧 generation 被重新晋升、导致内容回滚的修复记录，进一步证明同步必须防止旧代次覆盖新状态。

### 5.3 claude-mem

现状：生命周期 hook 捕获会话，SQLite/FTS5 与向量检索，本地 worker 提供 API 和查看界面，渐进披露上下文；Apache-2.0。

吸收：会话压缩、渐进召回、引用过去观察、可查看的记忆管理界面。

不照搬：首版不安装一整套高频捕获 hook，不让 Agent 会话依赖 worker 已启动，不默认保存全部工具输出。

### 5.4 agentmemory

现状：TypeScript，支持多 Agent 共库，BM25、可选本地向量与结构图融合，提供公开评测；完整运行还依赖 iii engine 和多个本地端口；Apache-2.0。

吸收：keyless 时仍有 BM25 基线、来源通道、Agent 作用域、版本链、可复现评测和受控导出。

不照搬：首版不引入额外运行时、多个端口和超大 MCP 工具集合；宣传中的跨数据集对比不能当作本项目效果。

### 5.5 MemPalace

现状：保存逐字原文，默认不做摘要、抽取或改写，支持可插拔检索后端、本地嵌入和 MCP；默认后端及层级结构较重；MIT。

吸收：保留原始证据、无 LLM 也可检索、嵌入模型更换后重建索引、后台任务和 fail-open 思路。

不照搬：首版不复制 Palace 层级和默认 ChromaDB 依赖；原文保留应受容量与隐私策略控制，而不是无限收集。

### 5.6 mcp-memory-service

现状：本地与多种远端后端、MCP/REST、Agent ID、向量与 consolidation，支持自托管和可选同步；Apache-2.0。

吸收：Agent 身份贯穿写入与检索、远程能力可选、后台合并和本地模型接口。

不照搬：首版不维护大量后端、图数据库和完整仪表盘。

### 5.7 delx-memory

现状：较新的轻量 TypeScript 项目，SQLite/FTS5、跨 Agent namespace、显式用户意图写闸门、密钥形态阻断、TTL，使用 better-sqlite3；MIT。其功能和成熟度仍需独立验证。

吸收：显式写入闸门、小工具表面、文件权限、doctor、明确承认本地明文与惰性删除的边界。

不照搬：正则和密钥形态检测只能作为一道防线，不能宣称识别全部秘密；namespace 也不能替代完整同步策略。

### 5.8 mem0、Graphiti/Zep、Letta

mem0：吸收记忆抽取、更新、metadata 作用域和模型接口；不将其托管记忆基础设施直接等同于个人多设备本地同步。

Graphiti/Zep：吸收 episode 来源、有效时间/失效时间和时序关系；首版不引入图数据库与高昂写入抽取链。

Letta：吸收 core/archival 分层和 Agent 可管理 memory block；不引入完整 Agent runtime。

### 5.9 本产品的差异化应落在哪里

不是“也有 MCP”“也有向量”“也接很多 Agent”，而是以下组合：

- 个人多设备与多 Agent 是同一套一等模型；

- 自定义作用域同时约束读、写、投影和同步；

- ECS 与 OBS 使用同一协议，且远端默认只见密文；

- Agent 会话与同步/抽取故障严格隔离；

- 当前 Agent、本地模型、可选云模型可以通过同一评测集比较；

- 冲突、旧代次、删除和恢复都有可演练的行为，而不是一句“自动同步”。

## 6. 总体架构

```text
Claude Code / Cursor / Copilot / OpenClaw / WorkBuddy / 其他 Agent
        | MCP stdio              | CLI / 文件投影 / 显式导入
        v                        v
+---------------------- 本地核心 ----------------------+
|  Scope 与权限策略   Memory Service   Projection       |
|  SQLite + FTS5      修订链/来源       候选与冲突队列   |
|  本地事务内写 outbox/jobs；短操作；无网络依赖          |
+------------------------------------------------------+
                         |
                持久任务队列（同一本地事务）
                         |
          +--------------+---------------+
          | 独立 worker / CLI / 计划任务  |
          | 抽取、嵌入、投影、同步、维护  |
          +--------------+---------------+
                         |
                  RemoteStore 接口
                +--------+---------+
                | ECS syncd | OBS/S3 |
                +-------------------+
                仅保存密文 chunk/manifest
```

核心约束：

1. MCP stdio 的 stdout 只输出协议消息，日志只去 stderr 或文件。

2. MCP 和 CLI 共用同一个 core，不分别实现业务逻辑。

3. 记忆写入与 outbox/job 创建在同一个 SQLite 事务中提交，避免“记忆已写但同步任务丢失”。

4. 本地核心不依赖 daemon；daemon 只是 worker 的一种运行方式。

5. SQLite 使用 WAL、短事务和有界 busy timeout。多个 Agent 进程发生写争用时返回可重试状态，不能无限等待。

6. 云端永远不直接参与 Agent 的一次普通记忆检索或写入。

## 7. 记忆数据模型与可自定义粒度

### 7.1 一条记忆的基本字段

`memory` 保存当前物化状态，`memory_revision` 保存不可变修订，`evidence` 保存证据，`relation` 保存少量明确关系。

一条记忆至少包含：

- `id`：全局唯一、时间可排序的 UUIDv7/ULID；

- `owner_id`：首版本地个人所有者，为未来共享预留；

- `kind`：`instruction`、`preference`、`fact`、`decision`、`episode`、`procedure`、`environment`；

- `content`：规范化但可读的当前正文；

- `scope_id`：指向明确作用域，不用任意 tag 代替；

- `status`：`candidate`、`active`、`conflicted`、`superseded`、`archived`、`tombstoned`；

- `authority`：`user_explicit`、`user_confirmed`、`agent_inferred`、`imported_unverified`；

- `confidence`：仅表示抽取/核验置信，不得覆盖 authority；

- `source`：来源 Agent、会话、导入批次和消息范围；

- `observed_at`、`valid_from`、`valid_to`；

- `last_verified_at`、`last_used_at`、`expires_at`；

- `sensitivity`：`normal`、`sensitive`、`blocked`；

- `current_revision_id`、`content_hash`；

- `created_by`、`created_at`、`updated_at`。

首版只需要少量关系：`supersedes`、`contradicts`、`related_to`。不构建通用知识图谱。

### 7.2 作用域不是单一枚举

内部使用以下维度共同决定可见与同步：

- `space_id`：个人空间、项目空间或用户自定义空间；

- `project_id`：可选，使用稳定逻辑 ID，不把某台设备的绝对路径当项目主键；

- `device_id`：`all` 或一个随机生成的设备 ID；不采集硬件指纹；

- `agent_id`：`all` 或某个 Agent；`origin_agent` 另存，不能混为一谈；

- `sync_policy`：`local_only` 或 `encrypted`；

- `read_policy`：所有个人 Agent 或明确的 Agent allowlist；

- `retention_policy`：永久、按 TTL、按最近使用或仅保留工作期；

- `projection_policy`：允许投影到哪些 Agent/文件目标。

项目在不同设备上的路径通过 `project_alias` 映射。首次识别到 Git remote、目录名冲突或工作区变化时要求用户确认，不能仅凭路径自动合并两个项目。

### 7.3 内置预设

1. `personal-global`：本人全部设备、全部 Agent；可选择加密同步。

2. `device-local`：当前设备、全部 Agent；永不同步。

3. `project-global`：同一逻辑项目、本人全部设备、全部 Agent；可选择加密同步。

4. `project-device`：同一项目但仅当前设备；永不同步。

5. `agent-private`：当前 Agent 在个人或项目空间中的私有记忆；未绑定设备时可选择同步。

6. `session-ephemeral`：短期工作记忆，默认不进入长期启动上下文，可配置 TTL。

### 7.4 用户自定义粒度

用户可以创建命名空间，例如“工作”“生活”“开源项目”“仅服务器”“仅 CodeBuddy 的项目记忆”。

首版自定义空间只能从受约束字段组合：

- 继承哪个内置模板；

- 是否绑定项目；

- 设备为全部、当前设备或设备组；

- Agent 为全部或 allowlist；

- 是否允许加密同步；

- 是否允许启动注入；

- 保留期限与重要性；

- 是否允许模型自动候选写入。

不提供任意表达式语言，避免形成难以测试的第二套权限系统。自定义空间默认 `local_only`，并默认不向所有 Agent 放宽；使用者必须显式扩大范围。

### 7.5 作用域必须是物理边界

读取时的 scope filter 只是用户体验，不是完整安全边界。

必须同时做到：

- 写入时确定 sync eligibility；device/local-only 记忆不生成远端 outbox；

- 打包前重新检查作用域和策略；

- 同步包按 vault/space 分隔，排除的空间不是“加密后也一起上传”；

- Agent 投影按 projection\_policy 生成，禁止把全库导出到项目文件；

- 导出文件明确包含空间清单，导入时再次确认；

- 未来若开放共享，每个空间独立密钥与授权，不把 tag 过滤当权限系统。

作用域从 encrypted 收窄为 local\_only，只会停止后续上行，不会自动撤回此前已经上传的密文。产品必须明确提示历史远端副本仍存在，并通过新的 space generation、显式 purge 与远端生命周期策略完成清理；设备组或 Agent allowlist 收窄后，也必须重新生成投影，不能假设历史导出会自动消失。

## 8. 写入、生命周期、溯源与检索

### 8.1 写入通道

显式写入：用户通过 CLI 或 Agent 明确说“记住……”，可以直接成为 active；其中 instruction 只能来自用户明确输入或用户确认。

Agent 提议：当前 Agent 调用 `memory_propose`，只生成 candidate 和证据，默认不直接变成长期 active。

离线抽取：worker 从用户指定会话或导入批次生成 candidate，不接触当前 Agent 会话。

导入：从 Markdown、JSONL 或支持的 Agent 记忆文件导入，保留原文件、来源和导入批次；默认标为 imported\_unverified。

### 8.2 生命周期

```text
observed -> candidate -> active -> superseded / archived
                     \-> conflicted
active / candidate  -> tombstoned
```

规则：

- 自动候选不得静默覆盖 user\_explicit 或 user\_confirmed；

- 相同内容通过规范化 hash 去重，近似重复只生成合并建议；

- 自动合并不得删除证据或历史修订；

- 过期和失效默认退出检索/注入，不等于物理删除；

- `forget` 生成 tombstone 并同步停止使用；

- `purge` 是独立的物理清理流程，不能把 forget 宣传为所有介质上的不可恢复擦除。

### 8.3 证据与可信级别

候选必须给出产生它的消息范围、文件引用或导入位置。没有证据的模型推断不能自动晋升。

外部网页、工具输出、他人内容和不可信导入只作为证据，不得自动成为 instruction。进入上下文时使用明确的“参考记忆”边界，不能让记忆中的命令覆盖系统指令、权限或审批。

代码相关事实在使用前需要重新验证引用是否仍成立；无法验证时降级为历史信息，而不是继续以当前事实注入。

### 8.4 检索与上下文组装

首版基线：FTS5 + 作用域/状态/时间过滤 + 重要性、最近使用、最近验证排序。

中文检索不能只依赖 unicode61 默认分词。2026-10-24 Windows/Node 22/SQLite 3.51.2 合成探针显示，trigram 可命中三字中文子串，两字查询仍需精确 LIKE 回退。M0 应对比“FTS5 trigram + 短查询回退”与应用层 bigram 的召回、排序、索引体积和写入成本，完成评测前不锁定其中一种；无论采用何种索引都保留原始正文。

可选增强：本地 embedding + FTS5 的 RRF 融合。嵌入模型必须记录名称、版本和维度；切换模型只更新后台重建任务，不能阻塞当前查询。检索失败时回退 FTS5，而不是回退到云端模型。

上下文组装不是全库注入：

1. 先按当前 Agent、项目、设备、敏感级别和状态过滤；

2. 取少量 pinned/profile 记忆作为启动层；

3. 再按当前任务检索主题记忆；

4. 应用 top-K、总 token budget、同源去重和多样性限制；

5. candidate、conflicted、expired、tombstoned 默认不注入；

6. 返回 `why_recalled`、来源和验证状态，便于 Agent 与用户判断。

## 9. 多 Agent 兼容方案

### 9.1 兼容等级

L1：标准 MCP。任何支持 MCP 的 Agent 都可使用核心工具，不保证自动捕获。

L2：受管投影。对支持指令文件或 Rules 的 Agent，生成带有开始/结束标记的区块，只修改该区块。

L3：显式导入导出。对没有稳定公开接口的原生记忆，提供可审查的导入器和通用导出，不模拟私有 API。

L4：可选轻量 hook/插件。只对完成单独契约测试的 Agent 开启，默认关闭，且不得承担网络或重计算。

“兼容各 Agent”应发布为能力矩阵，不写一句无法验证的“全部支持”。

### 9.2 MCP 工具表面

首版只保留八个核心工具：

- `memory_context`：按当前上下文和 token budget 返回启动/任务记忆；

- `memory_search`：检索预览；

- `memory_get`：读取完整记忆与证据；

- `memory_add`：显式新增；

- `memory_propose`：提交候选与证据；

- `memory_update`：新增修订，不做原地无历史覆盖；

- `memory_forget`：生成 tombstone；

- `memory_status`：返回本地健康、待处理任务和冲突数量。

同步执行、物理 purge、冲突解决、模型配置、设备 enrollment 放在 CLI，避免 Agent 在会话中误触长任务或高风险操作。

工具使用 readOnly/destructive/idempotent 等行为标注；写操作要求明确参数，不能只凭一句自然语言猜测作用域。

### 9.3 文件投影与防回环

通用目标：AGENTS.md 中的受管区块。

Claude Code：MCP 为主，可显式导入 auto memory Markdown；对 CLAUDE.md/AGENTS.md 只写受管区块，不直接接管自动记忆目录。

Cursor：可生成项目 `.mdc` 规则或 AGENTS.md 投影；Rules 是加载入口，不等同自动记忆。

GitHub Copilot：使用 MCP 和适用的 instructions 投影；不假设原生 Copilot Memory 有公共写入接口。

OpenClaw：优先 MCP 或其官方 Markdown 导入路径；不整文件覆盖 USER.md/MEMORY.md，不混写其 dreaming 状态。

WorkBuddy：MCP 为主；对原生记忆使用通用导出文本和其公开支持的导入方式，不依赖内部数据库或私有接口。

每个投影文件记录 `generator`、`source_revision`、`content_hash` 和空间。文件监听默认不自动回读；用户编辑后的内容只有执行显式 `adopt/import` 才进入候选，防止“导出—回读—再导出”循环。

### 9.4 Hook 的安全预算

默认策略是不装 hook。若某 Agent 需要可选自动增强：

- SessionStart 只读取预计算的小型 context 文件；

- UserPromptSubmit 默认关闭，开启后也只能进行有界本地查询；

- Stop/PostToolUse 不执行抽取、云同步或 Git，只允许极短本地事件入队；

- daemon 不可用、DB 锁超时、文件缺失或任何异常均返回空增强并退出成功；

- 每次运行有内部 deadline，并由适配器配置外部超时；

- 不自动启动服务、不自动更新包、不访问网络；

- 失败只记录诊断，不向当前会话抛异常。

必须加入故障注入测试：worker 挂起、OBS 无响应、数据库损坏、模型不返回、进程被杀、stderr/stdout 异常，均验证 Agent 会话不被终止。

## 10. 多设备同步协议

### 10.1 同步单位

每台设备、每个空间维护独立的追加事件链：

- 事件键为 `(device_id, device_seq)`；

- chunk 包含一段连续事件、协议版本、空间、前后序号、前序 chunk hash 和内容 hash；

- chunk 压缩后加密，对象名包含内容 hash，上传后不可变；

- manifest 只记录该设备/空间的已发布 checkpoint；

- 先上传完整 chunk，再发布 manifest，绝不反向；

- 所有导入按事件键和 revision id 幂等。

上传后未更新 manifest 的孤儿 chunk 不影响正确性，可由维护任务识别。新设备通过快照 + 后续 chunk 初始化；快照不是权威源，首版不自动删除旧 chunk。

不得通过整目录复制来迁移或新增设备。克隆本地目录会复制 device\_id、事件链序号和发布状态，使两个实际设备成为同一写者的分叉。新设备必须走独立 enrollment；若检测到同一 device\_id 出现不一致 checkpoint，应停止发布并要求重新登记或恢复，禁止两个副本自动互相覆盖。

### 10.2 修订链与冲突

每次修改生成新的 `revision_id`，记录一个或多个 `parent_revision_ids`、正文、作用域、作者和 hash。

- 若远端修订是本地当前修订的祖先，可快进；

- 若本地是远端祖先，保留本地新状态；

- 若双方互不为祖先，则是并发修改；

- 并发正文不做字段级合并，保留两个修订和共同祖先，标记 conflicted；

- 冲突未解决时默认继续使用共同祖先，两个新修订均不自动注入；

- tombstone 与同时发生的 edit 也进入冲突/恢复队列，不静默复活或永久丢失；

- `last_used_at` 等非语义元数据可以取最大值，正文与作用域绝不采用这种简化。

这是一套适合个人多设备的保守合并策略，不宣称通用 CRDT，也不以设备时钟决定谁赢。时钟只用于 TTL 和展示，不能作为冲突正确性的依据。

### 10.3 旧代次、重复和乱序

对象存储或服务端可能返回旧 checkpoint 或旧对象。接收端必须遵守：

- 已接受的 revision/chunk hash 不降级；

- 小于等于已处理 device\_seq 的事件只做幂等检查，不重新应用；

- 父修订未知时进入等待依赖状态，不把它提升为当前版本；

- manifest 的 space head 不能回退；

- 旧 generation 即使正文重新出现，也不能覆盖更新的 accepted revision；

- 校验失败的 chunk 隔离，不进入数据库；

- 本地重放、远端重试和多次 pull 的结果必须一致。

### 10.4 Outbox 与 worker

所有同步、抽取、嵌入和重建任务进入持久 jobs/outbox。

worker 可由三种方式运行：

- 用户显式执行 `sync run` 或 `jobs run`；

- 系统计划任务定时执行；

- 用户主动启动常驻 daemon。

网络请求有连接/读取/总时限、指数退避和 jitter、熔断及死信；超过重试上限保留任务并展示原因，绝不无限循环。同步状态至少区分：仅本地、待上传、已同步、待拉取、冲突、密钥错误、远端不可用。

### 10.5 删除与物理清理

`forget` 的目标是停止使用并传播 tombstone。

`purge` 需要单独实现并明确限制：

- 本地通过重建不含目标记录的新数据库、校验后原子替换，避免只删行却残留于空闲页/WAL；

- 远端生成不含目标内容的新 space generation，再删除被取代 chunk；

- OBS 开启版本控制时，还要处理历史版本与生命周期规则；

- 云服务商既有备份、用户自行备份和已导出文件不作“已彻底擦除”的虚假承诺；

- purge 是显式维护操作，永不放入 hook 或普通 Agent 工具调用。

## 11. ECS 与华为 OBS 双后端

### 11.1 统一 RemoteStore 接口

```text
getObject(key)
putImmutable(key, bytes, hash)
list(prefix, cursor)
getManifest(space, device)
putManifest(space, device, manifest, expectedGeneration)
```

`delete` 只供显式 purge 使用。能力探针在初始化时检查条件写、列举分页、ETag、版本控制和加密相关行为；核心正确性不能依赖一个全局分布式锁。

### 11.2 ECS 自建 syncd

ECS 服务提供同一协议的 HTTPS API：

- 单用户、单 vault 起步；

- Bearer token 或等效认证、TLS、限流和请求体大小限制；

- 保存密文 chunk 和 manifest，不保存明文 SQLite；

- 本地文件 + SQLite 足以实现首版服务端，不要求 Postgres；

- Docker 部署，提供健康检查、备份和恢复说明；

- 服务端不能直接改写客户端记忆，只负责中继与元数据。

端到端加密仍在客户端完成，ECS 磁盘加密/服务端加密是附加层，不是替代。

### 11.3 华为 OBS/S3 兼容对象存储

建议前缀：

```text
vaults/<vault-id>/spaces/<space-id>/chunks/<content-hash>.bin
vaults/<vault-id>/spaces/<space-id>/devices/<device-id>/manifest.json
vaults/<vault-id>/spaces/<space-id>/snapshots/<generation>.bin
```

实施要求：

- chunk 以内容 hash 命名，重复上传等价，禁止用不同正文覆盖同一名称；

- 每设备只有本机单写者发布自己的 manifest，设备之间不共享一个全局可变对象；

- 若条件写或列举行为存在差异，以能力探针和契约测试为准，不假定所有 S3 扩展完全一致；

- 使用独立 bucket/prefix 和最小权限凭据，禁止公共读；

- 凭据放 OS keychain 或受控密钥注入，不写入记忆、普通配置明文、日志或导出包；

- 可叠加 OBS 版本控制、生命周期和服务端加密，但这些不能替代客户端 E2EE；

- 回归测试覆盖分页、重复、乱序、旧 manifest、网络中断、损坏对象和版本保留。

## 12. 加密、密钥与隐私

### 12.1 同步加密

远端默认不可读。使用成熟密码库实现带版本号的认证加密，例如 libsodium 的 XChaCha20-Poly1305；禁止自造加密算法。

每个 vault/space 有独立数据密钥。设备通过恢复密钥或现有设备授权完成 enrollment；密钥版本写入元数据，便于未来轮换。AAD 绑定协议版本、vault、space、chunk id 和 hash，防止密文被搬到其他上下文。

密钥丢失时远端内容无法恢复，产品必须明确提示并引导保存恢复材料，不能设置隐藏后门。

### 12.2 本地数据

首版本地 SQLite 可以是操作系统账户保护的明文文件，但必须如实说明：文件权限不等于对 root、磁盘镜像或恶意进程加密。

默认设置用户私有目录/文件权限，支持操作系统全盘加密；SQLCipher 等本地静态加密作为后续可选增强，不作为首版引入额外原生依赖的前提。同步 E2EE 和基础导出不得划为 Pro 独占。

### 12.3 秘密与敏感内容

- 默认不存储密码、token、cookie、私钥和完整认证头；

- 使用字段名、常见密钥形态和熵检测做多层阻断，但承认无法识别全部秘密；

- 命中阻断时拒绝写入，而不是只打码后继续同步；

- sensitive 记忆默认 local\_only，且不进入公共投影；

- 云端模型和云端 embedding 按空间单独授权，禁止本地模型失败后静默切换到云端；

- 默认无遥测，诊断日志脱敏，不记录正文和凭据；

- 只读取用户明确配置的导入路径，不自行扫描个人目录。

## 13. 抽取模型的最优解：混合路由 + 自有评测

### 13.1 不存在脱离场景的“最好模型”

当前 Agent、local LLM 和云端 API 各有约束：

当前 Agent：能看到当前任务、工具结果和用户纠正，通常具备最完整的上下文，不需要再次传输会话；但调用时机不稳定、占用当前交互额度，也不能假设它会在后台自动运行。

本地模型：隐私和离线最好，适合批处理；但不同硬件、上下文长度、中文能力和结构化输出稳定性差异明显，不能预设抽取质量一定足够。

云端模型：便于无人值守和统一质量，但有成本、隐私、网络和供应商依赖，必须 opt-in。

### 13.2 推荐默认路径

1. 用户明确记忆：不经过模型，直接写入。

2. 会话中的当前 Agent：在有意义的事项完成后，通过 `memory_propose` 提交结构化候选和证据；工具立即返回，不做二次模型调用。

3. 离线批处理：用户启用后，worker 调用 Ollama/LM Studio/OpenAI 兼容的本地端点；不可用时只保留原始待处理项或确定性候选。

4. 云端模型：只对明确授权的空间启用，本地失败不得自动外发。

5. 所有模型输出经过同一确定性治理管线，模型不能直接操作数据库。

### 13.3 统一候选协议

候选至少包含：

```json
{
  "kind": "preference",
  "content": "候选正文",
  "scope_hint": "project-global",
  "evidence": [{"source_ref": "session/message-range", "quote": "必要证据"}],
  "confidence": 0.0,
  "valid_from": null,
  "expires_at": null,
  "sensitivity": "normal",
  "supersedes_hint": null
}
```

治理管线依次执行：JSON Schema 校验、证据存在性、秘密阻断、scope 合法性、authority 赋值、规范化去重、冲突检测、审核策略、写入候选。

全局 instruction、高敏感内容、跨项目扩张、覆盖用户明确记忆和物理删除必须人工确认。普通低风险事实是否自动晋升可配置，但默认仍是候选优先。

MCP 请求中的 user\_confirmed=true 或“用户已同意”只是调用方声明，本身不能证明真实授权。authority 提升、scope 扩大和全局 instruction 确认，必须来自本地可信交互或可验证的确认记录；Agent 不得通过自填参数绕过审核。

### 13.4 模型接口与降级

`agent`：由当前 Agent 产生候选，不是后台偷偷调用同一 Agent。

`local-openai-compatible`：连接本机或内网模型端点。

`cloud-openai-compatible`：显式配置的云服务。

`none`：完全关闭自动抽取，其他功能不受影响。

模型超时、输出非法或服务不可用只影响 jobs 状态，不影响显式记忆和检索。provider fallback 只能在同一信任级别内发生。

### 13.5 建立自有评测，而非引用竞品分数

评测集至少覆盖中文与英文、明确应记/明确不应记、偏好变化、项目事实过期、跨项目相似内容、恶意提示注入、密钥、长会话和多设备冲突。

核心指标：

- 应记事实的召回；

- 不应记内容的误写率；

- 证据忠实度；

- scope 准确率；

- 重复与错误覆盖比例；

- 秘密阻断表现；

- 结构化输出合法率；

- 单条成本、延迟和离线可用性；

- 检索命中率与注入后的实际任务收益。

优化目标是高精确率和可治理，不是尽可能多地生成记忆。任何自动晋升阈值都由本评测确定，不能从竞品宣传值推导。

## 14. 开发语言、工程结构与分发

### 14.1 推荐 TypeScript，而不是双核心

独立新核心推荐：TypeScript + Node.js 22+，CI 覆盖 Node 22/24 与 Windows/macOS/Linux；SQLite 首版采用 better-sqlite3 一类成熟驱动和 FTS5。

理由：

- MCP、CLI、Agent 配置和各类适配器可共享一种语言；

- npm/npx 是目标用户最容易接受的分发路径；

- TypeScript 适合约束 Memory、Scope、Revision、RemoteStore 和候选协议；

- 本地模型通过 HTTP 调用，不需要为了模型再引入 Python 运行时；

- 已有轻量项目证明 TypeScript + better-sqlite3 的本地 MCP 路径可行。

主要风险是原生 SQLite 驱动在部分平台的预编译和安装体验。M0 必须验证目标架构；若覆盖不达标，应在统一 Store 接口下更换驱动，而不是让上层业务受影响。只有资源占用或部署被实测证明不达标时，才考虑 Go/Rust 重写 worker，不预先维护双语言核心。

### 14.2 不建议以 Python/uvx 作为主运行时

Python 适合模型研究和评测脚本，但主产品采用它会额外要求用户理解 Python/uv 环境。uvx 能缓解，却不能比目标 Agent 已有的 Node 配置更统一。模型通过本地 HTTP 解耦后，Python 不是必要条件。

### 14.3 npm 与 npx 的正确关系

- npm：包发布与安装渠道；

- npx：按需执行工具；

- uvx：Python 工具执行路径，不作为主方案。

推荐发布到 npm，并提供两个 bin：管理 CLI 与 MCP server。

试用：可用 `npx -y <package>@<exact-version> doctor`。

长期使用：安装固定版本后，让 Agent 配置指向解析后的本地可执行文件；不要每次会话都用 `@latest` 下载和启动。

升级：显式执行，先运行 doctor 与数据库备份/迁移检查；MCP 进程内不自动更新。

发布：固定依赖、npm provenance、SBOM、许可证扫描、跨平台安装测试和版本迁移测试。

### 14.4 建议工程模块

```text
packages/core       数据模型、作用域、修订链、事务、FTS5
packages/cli        init/add/search/edit/forget/export/import/doctor
packages/mcp        八个 MCP 工具与 stdio 协议
packages/projection 受管区块、各 Agent 适配器、防回环
packages/jobs       持久队列、重试、死信、计划任务接口
packages/extract    agent/local/cloud/none 提供者与候选治理
packages/sync       chunk、manifest、冲突、恢复、加密
packages/remote-ecs ECS syncd 与远端适配
packages/remote-s3  OBS/S3 适配与契约测试
packages/eval       抽取、检索、同步和故障注入评测
```

## 15. 安全与可靠性基线

以下均为发布门槛，不是可选优化：

1. 本地无网可完成显式新增、查询、修改、导出。

2. MCP stdout 不被日志污染，HTTP 默认只绑定 loopback。

3. 同步、模型、索引故障不会向 Agent 会话抛出致命异常。

4. 本地记忆和 outbox 同事务提交，进程死亡后可恢复。

5. 任意重复 pull、重复 push、乱序事件不会重复写或回滚。

6. 两台设备并发修改同一条记忆不会静默丢内容。

7. local-only/device 空间不会出现在远端包、公共投影或全量导出中。

8. 用户明确指令不会被模型候选自动覆盖。

9. 不可信内容不能自动成为 instruction 或长期高权威记忆。

10. 云端默认只见密文，凭据不出现在正文、日志和导出物中。

11. 忘记、物理 purge、远程历史版本和本地 WAL 的语义分别说明并测试。

12. 所有第三方依赖做许可证审查；AGPL/BUSL 项目只研究机制，不未经许可评估复制实现。

## 16. 里程碑与验收

### M0：复用评估与技术探针

交付：现有项目扩展评估、SQLite/FTS5 中文检索、MCP stdio、npm 安装、基础 OBS/ECS 能力探针。

通过条件：

- 明确 build/extend 决策；

- 三平台安装与中文检索可用；

- 多进程读写不会无限等待；

- stdio 无日志污染；

- 确认 OBS 所需接口行为，不能用假设替代；

- 确认选定 SQLite 驱动的目标平台覆盖。

首次初始化与迁移是 M0 的前置交付，详见附录 A。探针只能使用合成 fixtures 和临时 HOME，不读取真实个人记忆、不修改真实 Agent 配置。

- 验证有界发现、显式选择、不可变快照、导入档案先可检索、活动记忆需批准的两层路径；

- 验证重复导入幂等、源文件哈希不变、秘密/冲突/部分失败和进程中断恢复；

- 验证 AI 分批计划的 plan\_hash/approval\_id 绑定，Agent 自报确认或计划变化后不得应用；

- 验证各 Agent 配置 plan/apply/doctor/uninstall，以及 observe/router/mcp-primary 的边界与回滚。

### M1：纯本地核心

交付：SQLite、八类基础数据操作、内置 scope、自定义空间、修订链、证据、FTS5、JSON/Markdown 导入导出、doctor。

通过条件：

- 无模型、无云端完成全部核心场景；

- 重启后数据与索引一致；

- scope 在读、写、导出和投影均生效；

- 重复导入幂等；

- 忘记、归档和过期行为可验证；

- 性能数据在目标规模上实测并记录，不预先宣传固定毫秒数。

### M2：多 Agent 接入

交付：MCP、CLI、AGENTS.md 受管投影，以及 Claude Code、Cursor、Copilot、OpenClaw、WorkBuddy 的分层适配说明和可自动化的契约测试。

通过条件：

- 同一记忆可在至少两个不同 Agent 间显式写入和检索；

- 投影重复执行幂等，不修改用户区块；

- 导入不修改源文件，不回环；

- 无公开原生 API 的 Agent 明确标注能力边界；

- hook 默认关闭，所有可选增强通过故障注入测试。

### M3：ECS/OBS 同步

交付：outbox、worker、chunk/manifest、E2EE、设备 enrollment、ECS syncd、OBS RemoteStore、冲突解决与恢复工具。

通过条件：

- 两设备离线后同步不同记忆可自动合并；

- 同条记忆并发修改保留双方并产生冲突；

- 重复、乱序、旧代次、损坏 chunk 不回滚新状态；

- 断网和进程杀死不丢 outbox；

- local-only 内容经远端包检查确认未上行；

- 新设备仅凭恢复材料和远端数据可重建；

- OBS 版本控制与 purge 行为有实测说明；

- 云端故障期间 Agent 会话与本地功能不受影响。

### M4：模型与检索增强

交付：候选协议、当前 Agent 提议、本地模型 provider、可选云 provider、评测集、可选本地 embedding。

通过条件：

- 无模型路径完全不回归；

- 非法 JSON、无证据、秘密和越权 scope 不进入 active；

- 本地模型失败不外发、不阻塞；

- 当前 Agent 与本地模型在同一数据集上有可比较报告；

- 向量关闭或重建时 FTS5 仍可用；

- 自动晋升只在达到自有评测门槛后按类型逐步开放。

### M5：开源发布候选

交付：固定版本 npm 包、安装/升级/卸载、迁移与备份、完整安全文档、能力矩阵、故障手册、许可证与 SBOM。

通过条件：

- 新环境可用固定版本安装并接入两个 Agent；

- 升级前备份、迁移失败恢复和降级路径经过演练；

- 文档中的每项兼容声明都有对应测试或人工验收记录；

- 无默认遥测，无隐藏云端依赖；

- 用户可以完整导出自己的数据并离开产品。

## 17. 开源与 Pro 商业化

### 17.1 开源策略

建议核心使用 Apache-2.0：允许广泛采用，带明确专利授权条款，也便于未来商业产品共存。商标、名称和托管服务品牌单独管理。

开源核心应包含：

- 本地 SQLite 与 FTS5；

- MCP/CLI；

- 内置和自定义作用域；

- 修订、证据、冲突和导出；

- 基础 Agent 投影；

- ECS/OBS 基础同步与 E2EE；

- agent/local/cloud/none 模型接口；

- 基础评测与故障测试。

这些能力构成产品可信度，不能先故意阉割再收费。

### 17.2 Pro 候选

Personal Pro：

- 托管加密 relay 与设备 enrollment 体验；

- 桌面端记忆浏览、冲突解决、批量清理和恢复向导；

- 多设备健康视图、同步告警和一键诊断包；

- 高级去重/合并建议、模型对比报告和自定义评测；

- 加密备份策略、快照管理和恢复演练自动化；

- 高级支持与迁移服务。

后续 Team Pro 仅在共享需求重新立项后考虑：空间授权、成员管理、共享审批和审计。首版只预留 `owner_id`、space 独立密钥和未来 grant 接口，不实现共享 UI/API，也不让当前同步格式提前暴露“公共团队空间”。

### 17.3 收费可行性判断

开源可行，Pro 是否可行要用真实使用验证。基础记忆和 MCP 已高度竞争，单靠“本地 + 向量 + 多 Agent”很难形成持续收费理由。

更合理的护城河是：

- 多设备同步不丢、不回滚；

- 冲突和删除可治理；

- Agent 会话绝不被记忆系统拖死；

- 自定义作用域真正贯穿同步与投影；

- 用户能用数据比较模型，而不是被模型供应商绑定；

- 托管服务显著降低运维成本。

在出现稳定的多设备使用者之前，不急于设计复杂价格表。通过访谈、公开 issue、托管 relay 候补和手工服务验证付费意愿；默认不依赖隐式遥测做判断。

## 18. 最终实施顺序

推荐严格按以下顺序推进：

1. M0 先做 Engram/agentmemory 复用评估与平台探针，避免重复造轮子。

2. M1 做无模型、无云端的本地核心，先证明数据模型和 scope 正确。

3. M2 做 MCP 与受管投影，先验证两个 Agent，再扩展能力矩阵。

4. M3 做 ECS/OBS 共同协议、E2EE、冲突和恢复，不先做华丽仪表盘。

5. M4 再接入当前 Agent、本地模型和可选云模型，用同一评测集决定默认路由。

6. M5 完成 npm 固定版本分发、迁移与安全验收后开源。

7. Pro 只在真实多设备使用和托管需求出现后启动，团队共享另行立项。

最重要的取舍是：先证明“不会把 Agent 搞坏、不会把记忆同步错、不会把不该上传的内容传出去”，再追求自动抽取聪明程度和 Agent 数量。

## 附录 A：首次初始化、迁移与 Agent 启用（M0 前置）

### A.1 默认产品决策

支持“自动发现 + 预览选择 + 一键快照导入 + AI 引导整理 + 显式启用”，不支持无提示扫描、静默导入、静默改写原生记忆或安装时自动清空原有记忆。

首次易用性不依赖一次性语义合并。用户完成导入后，先得到带来源的本地可检索档案；共享活动记忆由后续可审核的整理计划逐步生成。无模型、拒绝整理或整理中途失败，都不影响已导入档案的检索与导出。

### A.2 三类动作必须独立授权

- 发现与导入：先列来源、路径、类型、大小和解析支持情况；用户选择后才读取正文、创建快照和导入。

- MCP 接入：单独展示将修改的配置条目、作用域、命令和启用方式，用户确认后才应用。

- 原生记忆适配：单独选择 observe、router 或 mcp-primary；任何原生文件改写、原生自动记忆关闭和恢复都必须另有备份与 diff。

ai-memory init 可以编排这些步骤，但不能把它们合并成一次不可拆分的授权。默认停在“导入档案可用 + 后续计划已生成”，不自动进入原生记忆接管。

### A.3 自动发现的来源与安全边界

首版只识别官方或有公开文档的来源，不读取各产品的私有数据库、浏览器缓存、完整会话日志或凭据文件。

- Claude Code：与项目对应的 auto memory 目录中的 MEMORY.md 与主题 Markdown；用户自定义的 autoMemoryDirectory 只作为显式来源。CLAUDE.md、AGENTS.md 和 .claude/rules 作为“指令/规则”单独分类，不与学到的记忆混为一谈。

- OpenClaw：USER.md、MEMORY.md 和可选的 memory/YYYY-MM-DD.md；配置、凭据、skills 和原始会话不属于默认记忆导入。吸收其“导入件独立存放、源文件不变、先检索而不直接并入启动记忆”的做法。

- Cursor：项目 .cursor/rules/\*.mdc 与 AGENTS.md 作为规则来源；不逆向读取编辑器私有存储。其他自动记忆只通过用户明确导出的文件或粘贴内容导入。

- WorkBuddy：用户明确选择的工作区记忆文件，以及官方“复制提示词—粘贴结果”的导出内容；不爬取云端个人记忆、应用缓存或会话日志。

- GitHub Copilot：.github/copilot-instructions.md、.github/instructions/\*.instructions.md 和 AGENTS.md 作为规则来源。个人 Copilot Memory 的官方个人管理页当前只提供查看和删除，首版采用手动导出/粘贴适配；组织管理员导出能力不当作个人用户能力。

- 其他 Agent：通过显式目录或文件适配器加入，不因存在一个同名目录就声称支持。

默认排除原始会话转录、token/cookie/私钥、应用配置和日志。daily notes 默认作为可选批次；发现阶段只读取有界已知位置的元数据，不递归扫描整个 Home、Desktop、Documents 或 AppData，不跟随符号链接，不访问网络盘，并设置文件数、单文件和总字节上限。

### A.4 两层导入：立即可检索档案与受治理活动记忆

第一层是 import archive。原始导入件经内容哈希快照后单独保存，记录 source、source\_ref、parser\_version、import\_batch、原始 scope 和 source\_hash；默认 authority=imported\_unverified、sync\_policy=local\_only。它可以被本地检索和导出，但不进入公共投影、不自动上行、不直接成为高权威指令。

第二层是 curated active memory。只有经过去重、冲突处理、scope 审核和计划批准的条目才进入 active，按自身 scope 参与投影和同步。

两层分离使“导入即可用”和“长期记忆必须可治理”同时成立。原始档案永不因语义合并被删除；合并结果通过 merged\_from、source\_refs 和 supersedes 关联来源。

### A.5 在 Agent 对话中完成首次抽取合并

设备发现、快照和原生配置修改由本地 CLI/UI 完成，MCP 不提供无参数的全盘发现工具。当前 Agent 只处理已授权、已快照、已分批的内容，并作为默认的高质量语义抽取器；MCP 服务内部不再偷偷调用第二个模型。

用户在对话中明确说“初始化我的记忆”或“继续整理导入记忆”后，才开始以下流程：

1. onboarding\_status：返回当前批次、进度、待处理数量和失败状态，不自动开始新扫描。

2. onboarding\_next\_batch：返回有界源片段、确定性 chunk\_id、证据位置及现有近似重复；避免把全部历史一次性塞入上下文。

3. 当前 Agent 生成 add、merge、keep\_both、supersede、skip 提议，并给出 source\_refs、scope\_hint、sensitivity 和理由。

4. onboarding\_propose：确定性管线完成 Schema、秘密、证据、scope、权限和重复校验，只保存计划与候选，不直接晋升 active。

5. onboarding\_review：按“可批量接受、必须人工判断、疑似秘密、scope 冲突、内容矛盾”分组展示 diff 和统计。

6. 用户在本地 CLI/UI 审核，或由宿主提供可信的 MCP elicitation；系统签发绑定 plan\_id、plan\_hash 和过期时间的 approval\_id。聊天文本或 user\_confirmed=true 本身不是批准凭证。

7. onboarding\_apply：只能应用与 approval\_id 完全匹配的计划版本；计划变化后必须重新批准。应用后输出新增、合并、保留双方、跳过、冲突和失败报告。

任务状态为 staged → extracting → reviewing → approved → applying → completed，支持 paused 和 recoverable failure。批次、计划和游标持久化，Agent 会话中断后可续跑，不产生重复记忆。onboarding 工具只在没有完成的初始化任务时按需暴露，结束后可关闭，避免扩大日常工具面。

对不支持 MCP prompts 的宿主，CLI 提供可复制的初始化提示词；对支持 prompts 的宿主，可以提供同一流程的模板，但提示词不是权限边界。大批量导入可由本地模型在后台预生成候选，当前 Agent 只处理冲突和审核，减少交互额度占用。

### A.6 合并与冲突规则

- 先做确定性规范化、精确哈希去重和秘密阻断，再让模型判断语义重复，不让模型承担可确定完成的工作。

- 相同事实可合并来源；相似但适用范围不同的内容保留双方，不能为了“去重”抹掉设备、项目或时间边界。

- 明确矛盾、同时有效或无法判定新旧的内容进入 keep\_both/conflicted；不得仅凭文件修改时间决定谁赢。

- 项目证据不得自动提升为 personal-global；来源不明或敏感内容默认 local\_only。指令、全局偏好、scope 扩大和覆盖用户明确记忆必须人工审核。

- 导入的自动记忆默认仍是 imported\_unverified，不能因为它原本位于 MEMORY.md 或 USER.md 就自动当成 user\_explicit。

- skip 只表示不晋升，不删除原始档案；重复导入按 source\_hash、parser\_version 和确定性目标键幂等。

### A.7 Agent 配置安装器

提供 ai-memory agent plan/apply/doctor/uninstall。plan 只读并输出 diff；apply 先备份，再优先调用官方 CLI 或只合并目标条目，绝不重写整份配置；doctor 分别验证配置生效、MCP 连接、工具清单和一次有界本地读写；uninstall 只移除本产品的受管条目和区块，不删除 vault 或用户其他配置。

- Claude Code：按用户选择使用 local/project/user scope 的官方 MCP 配置方式；优先使用 claude mcp add/add-json，并检查跨 scope 同名冲突、受管配置和实际连接状态。路由入口放在 CLAUDE.md 或其读取的 AGENTS.md 受管区块。

- Cursor：按选择合并项目 .cursor/mcp.json 或全局 ~/.cursor/mcp.json；保留既有 servers 和工具审批设置。路由入口使用 AGENTS.md 或独立 .cursor/rules/\*.mdc，不把长篇记忆复制进规则。

- OpenClaw：使用 openclaw mcp add 的保存前探测及 doctor --probe 验证；通过 include/exclude 限制工具面。路由入口放在 AGENTS.md，保留 USER.md/MEMORY.md 原文件，直到用户另行选择 mcp-primary。

- WorkBuddy：只合并 ~/.workbuddy/mcp.json 的 mcpServers 目标项，随后明确提示用户在自定义连接器中信任并启用；不得把“写入 JSON”宣称为“已经可用”。自然语言路由入口在 M0 通过公开支持的工作区记忆或技能机制验证，不能依赖私有缓存。

- GitHub Copilot：按 VS Code、JetBrains、Copilot CLI 和云端 agent 分别适配，不能提供所谓统一的 Copilot 配置。项目规则使用 AGENTS.md 或 .github/copilot-instructions.md；云端原生 Memory 的开关由用户在 GitHub 设置中另行决定。

所有安装操作都支持临时 HOME/配置目录下的契约测试。同名条目、受管配置、权限拒绝、需手动信任、需重启和无法探测的宿主必须明确报告，不能静默跳过。

### A.8 原生记忆的三种运行模式

observe 是导入后的默认模式：原生记忆和原生自动写入保持原样，MCP 只增加可检索档案与候选整理能力。此模式用于兼容性观察和回滚验证。

router 是推荐的长期使用模式：跨设备、跨 Agent 的长期记忆走 MCP；原生记忆保留为当前 Agent 的私有草稿或既有来源。仅在原生指令/规则文件中加入短小的受管路由区块，不删除原始记忆。必要时通过显式再次导入把原生新草稿变成候选，避免未经审核的实时双写。

mcp-primary 是验证后的可选模式：检索、冲突、备份和恢复达到验收后，用户可以关闭支持官方关闭方式的原生自动记忆，并把原生启动记忆缩减为指向 MCP 的受管入口。原文件必须保留在不可变备份中。若某 Agent 无法停止原生自动写入，则不能一边让原生系统继续维护索引，一边用静态指针覆盖它；应继续使用 router，而不是伪装成已经完成接管。

用户编写的 CLAUDE.md、AGENTS.md、规则、SOUL.md 和 IDENTITY.md 不自动“由 AI 总结后覆盖”。简化只发生在明确受管的记忆投影或原生启动记忆区块，并且必须提供 diff、备份和恢复；人格、边界和工程规则不属于可随意合并的事实记忆。

### A.9 受管自然语言路由入口

路由文案的目标是告诉 Agent 何时使用 MCP，而不是每次对话都强制检索，避免增加延迟、工具调用和上下文噪声。推荐语义如下：

> 跨设备、跨 Agent 的长期记忆由 AI Memory MCP 管理。用户明确要求记住、更正或忘记，或者当前任务确实需要历史偏好、决策和项目事实时，调用相应 MCP 工具；不要每次对话无条件检索。模型推断先提交候选，不覆盖用户明确记忆。原生记忆只保存当前 Agent 的私有草稿，避免与 MCP 重复保存。只有用户明确要求“初始化我的记忆”时，才执行导入内容的抽取与合并。

自然语言只是行为引导，不是强制控制。实际隔离、审批、作用域和删除仍由 MCP 服务与本地数据层执行；需要通过两个以上 Agent 的契约测试验证检索和写入是否按预期发生。

### A.10 默认首次使用路径与验收

首次路径为：doctor → 有界发现与来源预览 → 用户选择来源和 scope → 不可变快照与本地导入 → 立即可检索档案和迁移报告 → 独立的 MCP 配置计划 → 用户在各 Agent 中启用 → 对话内分批整理与批准 → 保持 observe 或主动选择 router/mcp-primary。

M0 使用合成 fixtures 和临时 HOME 验证，不读取真实个人记忆、不修改真实 Agent 配置。至少覆盖中文、重复文件、矛盾事实、跨项目同文、疑似密钥、畸形 frontmatter、超大文件、符号链接、部分解析失败、重复导入、计划批准后内容变化和进程中断恢复。

验收要求：源文件哈希不变；导入可重入；失败只影响对应来源并生成报告；无模型也能检索档案；未经批准的计划不能进入 active；配置写入可回滚；任何模式都不因初始化失败破坏 Agent 原有会话。

## 19. 参考资料

以下均为 2026-10-24 查阅的官方资料或仓库当前内容；仓库功能与许可证会变化，实施时应重新核对。

成熟 Agent：

- Claude Code Memory：https://code.claude.com/docs/en/memory

- GitHub Copilot Memory 概念：https://docs.github.com/en/copilot/concepts/prompting-and-context/copilot-memory

- GitHub Copilot Memory 管理：https://docs.github.com/en/copilot/how-tos/use-copilot-agents/copilot-memory/manage-for-yourself

- Cursor Rules：https://cursor.com/docs/rules

- OpenClaw Memory：https://docs.openclaw.ai/concepts/memory

- WorkBuddy 记忆：https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Memory

- TeamAI Releases：https://github.com/Tencent/teamai-cli/releases

开源项目：

- Engram：https://github.com/Gentleman-Programming/engram

- basic-memory：https://github.com/basicmachines-co/basic-memory

- basic-memory 旧 generation 回滚修复记录：https://github.com/basicmachines-co/basic-memory/commit/a5b557acd82b3462c96e58648ffb1cce3cedef9d

- claude-mem：https://github.com/thedotmack/claude-mem

- agentmemory：https://github.com/rohitg00/agentmemory

- MemPalace：https://github.com/MemPalace/mempalace

- mcp-memory-service：https://github.com/doobidoo/mcp-memory-service

- delx-memory：https://github.com/davidmosiah/delx-memory

- mem0：https://github.com/mem0ai/mem0

- Graphiti：https://github.com/getzep/graphiti

- Letta：https://github.com/letta-ai/letta

- paradigm-memory：https://github.com/infinition/paradigm-memory

云端与协议：

- 华为云 OBS 文档入口：https://support.huaweicloud.com/obs/index.html

- 华为云 OBS 下载对象与条件请求：https://support.huaweicloud.com/intl/zh-cn/api-obs/obs\_04\_0083.html

- 华为云 OBS 服务端加密说明：https://support.huaweicloud.com/intl/en-us/usermanual-obs/obs\_03\_0088.html

- Claude Code MCP：https://code.claude.com/docs/en/mcp

- Cursor MCP：https://cursor.com/docs/context/mcp

- OpenClaw MCP：https://docs.openclaw.ai/zh-CN/cli/mcp

- WorkBuddy 连接器：https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Connector

- GitHub Copilot 仓库指令：https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions
KS_DOC_REVIEWS	RI7ke8iN0VSvnTydcdscPL	102411	https://www.workbuddy.cn/space/d/RI7ke8iN0VSvnTydcdscPL
