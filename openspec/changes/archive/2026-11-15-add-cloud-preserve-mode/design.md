## Context

事故实测事实（本会话逐项验证）：

- push 常规分支对非 personal-global 记忆**静默完成任务**（`push.js`：「作用域迁移属后续边界」）；27 条项目记忆的迁移与 3 条内容更新就此丢失。
- 迁入 device-local 的 11 条正确产生了 scope_exit——迁出语义已通，缺口是「迁入不可同步目的地时个人链不发迁出通知」与「非个人全局内容无处发布」。
- 对端（0.6.1）个人链应用完好；两台设备共享 vault 密钥；schema v6 无需变更。
- 用户决策（2026-11-15）：采用「全量密文保管 + 拉取侧物化过滤」方向，vault 级开关默认关闭；**明确推翻**「local_only 物理排除」作为唯一语义——AGENTS.md 安全与授权行、cloud-sync 规格、`docs/cairn-security.md` 随本变更改写。

## Goals / Non-Goals

**Goals**
- 作用域调整全端一致（本次事故核心修复，两种模式都生效）。
- 保管模式：设备限定与项目内容密文上云（归属设备标签 + 作用域描述符），他机不物化；设备找回（deviceId 不变时 pull 恢复）。
- 消灭静默完成；默认关闭 = 既有用户零行为变化。

**Non-Goals**
- 不做项目记忆物化到其他设备（二期：改物化过滤即可，协议零变化）。
- 不做 agent-private / session-ephemeral 上云（任何模式都不）。
- 不做 deviceId 变更后旧保管链的自动迁移（re-enroll 场景另议；现有 `restore` 通道兜底）。
- 不引入新密钥材料（复用 `deriveSpaceKey(vaultKey, spaceId)`，保管链 spaceId = `preserve/<deviceId>`）。
- 不动备份通道、治理链路、检索语义。

## Decisions

### D1：vault 级开关，默认关闭

vault.json 增 `preserve_device_bound`（缺省 false）。关闭 = 物理排除语义不变；开启 = 设备限定与项目内容上行到保管链。理由：本产品经 npm 公开发布，默认安全姿态必须保守；用户自己的 vault 打开即得全部能力；代价仅一条模式判断。开关入口：`cairn vault init-remote --preserve-device-bound` 与 `cairn vault config --preserve-device-bound on|off`（后者新子命令）。

### D2：保管链按设备划分（`preserve/<deviceId>`），他人不拉

否决"单条共享 preserve 链"：对端拉它只能过滤丢弃，白下载且扩大密钥泄露面。按设备划分后：pull = 个人链 + 本设备保管链，他人保管链对象完全不被下载。设备找回场景：home 保留 → deviceId 不变 → pull 保管链即恢复。

### D3：作用域描述符进事件载荷，物化过滤在 apply

事件（upsert）payload 增 `scope` 描述符（preset/projectId/deviceId/spaceName）。apply 规则：personal 链事件 → 物化为 personal-global（现状不变）；本设备保管链事件 → 按描述符物化（device-local 归本机、项目内容归本机）；描述符缺失（旧对端事件）→ 按现状处理。作用域调整 = 同一记忆的新 upsert 带新描述符 + 个人链迁出事件（如离开个人链）——**不新增事件类型**，既有 upsert/tombstone/scope_exit 词汇表够用。

### D4：迁出完整性（模式无关的核心修复）

rescope 出队语义：记忆离开个人链 → 入队 `sync_scope_exit`（入队固化 fromSpaceKey=personal，防 push 延迟期间二次迁移发错链）；迁入可发布目的地 → 入队对应上行任务。push 消灭静默分支：不可路由任务完成 + 审计 `sync_job_unroutable`。此修复在关闭模式下同样生效——对端残留副本自动收敛，不再需要人工清理脚本。

### D5：兼容性

preserve 前缀对 0.6.x 旧版本完全不可见（它们只请求 personal 链）；个人链在两种模式下的事件词汇不变（upsert/tombstone/scope_exit），旧对端行为零变化。新版本设备遇旧对端：互不影响（各拉各的链）。

### D6：命名与历史包袱

个人链 spaceKey 仍叫 `personal-global`（历史键名，含义仍是"个人全局内容链"）——不改名，避免对端游标/兼容断裂；保管链是新增命名空间。

### D7：归属设备的记录与展示（schema v7）

- `memory` 表增 `origin_device_id` 列（NULL = 未知）：本机创建记录本机设备标识；同步 apply 记录事件来源设备；存量行置空如实展示「未知」。写入后不可被修订改写（它是溯源事实，不是可编辑属性）。
- 载荷暴露：列表/详情/API 携带归属设备；控制台卡片就近展示徽章（与作用域徽章同一渲染路径），过滤器新增「来源设备」条件（选项含「未知」，带记忆数），工作台与静态导出同构。
- **不参与授权**：读取授权仍以作用域为唯一依据——归属设备是溯源与检索辅助，不是权限边界（防止未来有人拿它当 ACL 用）。检索/MCP 的 device 参数留作后续（控制台先行）。
- schema v6 → v7：仅加列 + 回填置空，无数据改写；迁移路径沿用既有 migrations 机制。

### D8：同步事件与归属设备的衔接

事件本就携带 deviceId（链设备）；apply 落地时把 `event.deviceId` 记为落地记忆的归属设备。个人链事件的 deviceId = 发送设备（不是"all"），因此跨设备到达的个人全局记忆也能如实标注来源。

## Risks / Trade-offs

- **密钥泄露爆炸半径扩大**（仅保管模式开启的 vault）：从"个人全局"扩大到"全部记忆"。已在 proposal 向用户明示并确认；`docs/cairn-security.md` 如实改写。
- **对端下载量**：他人保管链不被拉取，增量只有本机保管链——可控。
- **双模式测试矩阵**：入队/push/pull/backfill 各有 ON/OFF 两态——单测与 e2e 都按模式参数化，变异对照防"模式判断被绕过"。
- **作用域描述符缺失的旧事件**：个人链存量事件无描述符——apply 按现状处理（personal-global），向后兼容。
- **设备找回依赖 deviceId 不变**：re-enroll 换 id 后旧保管链成孤儿——v1 明示边界（restore 通道兜底），自动迁移另立提案。

## Migration

schema v6 → v7：`memory` 加 `origin_device_id` 列，存量行置空（展示「未知」），无数据改写。发版后：用户 vault 开启保管模式 → `backfill --apply`（存量设备限定与项目内容入保管链）→ push；对端（0.6.1）pull 个人链收到迁出通知 → 27 条残缺副本自动 archived。对端升级到含本变更的版本后，拉自己的保管链可找回其设备限定内容。

## Open Questions

1. 开关入口最终形态（`vault config` 子命令 vs 仅 init-remote flag）——实现期按 CLI 面最小化原则定。
2. 保管链事件是否需要独立保留策略（目前沿用同步链只追加、不删除语义）。
