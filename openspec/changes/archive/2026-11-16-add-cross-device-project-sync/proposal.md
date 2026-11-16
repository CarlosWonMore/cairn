## Why

2026-11-16 的真实云端对账暴露了一个能力缺口（不是数据错误）：项目作用域内容在 `preserveDeviceBound` 下**任何配置都不会跨设备**——`syncableChains()` 只含个人链 + 本设备保管链，`pull` 对他人 `preserve/` 前缀完全不列举。实测后果：主设备 26 条 project-global 记忆（hdrs6 22 / cairn 3 / fsmp 1）在对端只能呈现为"不再持有"，而设备限定的 10 条在对端连"这条属于哪台设备、属于哪个作用域"都无法展示。

用户已明确产品语义（2026-11-16）：**personal-global 必须跨设备（拉取、作用、展示）；项目作用的记忆要按本机治理结果同步到云端，并且对端必须收到同样的作用域治理结果，不能都归为 personal-global**。设备限定内容保持不跨设备复制，但对端需要如实呈现它的**归属设备、终态作用域与"本机不持有"标签**。

## What Changes

- **新增项目链 `project/<projectId>`**（一个项目一条链；projectId 是跨设备稳定 UUID）：`project-global` 内容上行到本项目链，**所有设备都列举并拉取**；`project-device` 仍走本机保管链（它本就绑定设备）；`device-local` 保持不跨设备。
- **物化按描述符落项目作用域**：事件携带 `scope: {preset:'project-global', projectId, spaceName}`，接收端按 projectId find-or-create 项目与空间行后物化——不是个人全局。
- **必须在项目链上解除"不再持有"标记**：接收端若对该记忆存在 `scope_exit:` 标记，收到项目链 upsert 时 SHALL 复用保管链已有的"重新持有"路径（清除标记 + archived→active + 按描述符迁移作用域），否则这 26 条会被"迟到修订"判定挡住，表现为"推了但对端看不到"。
- **迁出通知携带终态作用域描述符**：`scope_exit` 事件新增可选 `terminalScope`（preset/projectId/deviceId/spaceName）。接收端据此把本地副本的展示作用域与标签更新为终态（例如"设备限定（属主 dev_xxx）· 本机不持有"），**仍不复制内容**、不产生墓碑。这样设备限定的 10 条在对端就有正确的作用域、范围与标签。
- **backfill 增加项目链缺口**：与个人链、保管链并列报告与补齐；`doctor`/`status` 汇报每条项目链的 localSeq/游标/待办/缺口。
- **BREAKING（协议新增，对旧版本不破坏）**：新增链空间前缀 `project/`。旧版本设备（≤0.6.3）只列举个人链与本机保管链，看不到项目链——不报错、不卡链，表现为"仍不持有"。因此**对端必须升级**才能看到项目作用域内容。
- **不变**：E2EE 体系与密钥派生（项目链同样走 `deriveSpaceKey(vaultKey, spaceKey)`，spaceKey = `project/<projectId>`）；chunk/manifest 协议与代次 CAS；个人链语义与迁出通知语义；`agent-private` / `session-ephemeral` 永不上云；设备备份通道；治理链路。

## 非目标

- 不做项目订阅、不做成员/权限模型、不做团队共享。
- 不把 device-local 内容复制到其他设备（用户确认：只处理对端已有副本的作用域与标签，不新增复制）。
- 不改服务端 syncd（无新增路由；项目链复用既有 chunk/manifest 协议）。
- 不做云端对象回收（旧 `preserve/` 副本按追加语义保留）。

## 风险与回滚

- **风险 1（最高）**：项目链 upsert 到达时若未解除 `scope_exit` 标记，26 条会被 `upsert_shadowed_by_scope_exit` 挡住，症状是"推送成功但对面看不到"。缓解：该分支必须由**先红后绿**的测试锁定，并做变异对照。
- **风险 2**：新链路使项目内容进入"跨设备可见"，可见范围扩大。缓解：仅 `project-global`（encrypted + deviceId=all + 已显式同步策略）走项目链；`project-device` 与 `device-local` 不变。
- **风险 3**：冷启动的设备需要发现存在哪些项目链。缓解：`remote.list('project/')` 前缀列举发现；无项目时零请求成本可接受（单次列举）。
- **回滚**：删除 `project/` 链路由（route 回退到保管链）后，项目内容回到"仅本机保管"；已上云的项目链对象按追加语义留存但不再被拉取；本地库无需回滚（作用域行本就在）。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `cloud-sync`：新增项目链（`project/<projectId>`）与项目内容跨设备物化；迁出通知携带终态作用域描述符；backfill 与可观测扩展到项目链；明确 device-local 不跨设备但终态作用域须如实传播。
- `memory-store`：记忆可记录"终态作用域"用于不持有副本的展示（不改状态机语义，不引入新状态）。
- `local-console`：记忆视图对"不再持有"副本展示终态作用域与归属设备标签。

## Impact

- **代码**：`src/sync/vault.ts`（项目链键与 `syncableChains` 扩展）、`src/sync/route.ts`（project-global 路由到项目链，优先于保管链）、`src/sync/push.ts`（`routeJob` 与事件描述符、scope_exit 终态描述符）、`src/sync/pull.ts`（列举 `project/` 发现链）、`src/sync/apply.ts`（新增 project 角色 + 解除标记 + 终态作用域记录）、`src/sync/backfill.ts`（项目链缺口）、`src/sync/events.ts`（`terminalScope` 字段）、`src/interfaces/*`（doctor/status/控制台展示）。
- **测试**：新增 `tests/sync/project-chain.test.ts`（入队路由 / 跨设备物化 / 标记解除 / 旧版本降级 / device-local 终态标签）+ 扩展 `tests/sync/preserve-mode.test.ts`（项目链拉取 vs 保管链不拉取的边界对照）+ 变异对照。基线以当轮实测为准（2026-11-15 为 869/868/0/1）。
- **迁移**：无 schema 变更（`outbox_job.job_type` 复用 `sync_upstream`；触发器本就放行 encrypted + device_id=all）。存量 26 条通过 `sync backfill --apply` 首次进入项目链。
- **文档**：`docs/cairn-sync.md` 增加项目链章节；`docs/M0-session-handoff.md` 追加本轮；`AGENTS.md` 同步边界行更新（设备限定仍不跨设备）。
- **真机**：需用户再次授权执行 `sync backfill --apply` + `sync push`（写云端）；对端升级后由用户执行 `sync pull` 验证。
