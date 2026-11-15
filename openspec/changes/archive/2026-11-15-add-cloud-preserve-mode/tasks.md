## 0. 归属设备（schema v7）

- [x] 0.1 迁移 v7：`memory` 加 `origin_device_id` 列（存量置空），schema_version 校验同步
- [x] 0.2 记录点：本机创建记录本机设备；同步 apply 记录事件来源设备；写入后修订不改写
- [x] 0.3 载荷暴露：列表/详情/API 携带归属设备（空 = 未知）；MCP 检索载荷照带（检索过滤参数留作后续）
- [x] 0.4 单测：本机创建/跨设备到达/未知三态 + 授权不受归属设备影响

## 0a. 控制台：来源设备展示与过滤

- [x] 0a.1 记忆卡片就近渲染归属设备徽章（与作用域徽章同一渲染路径；未知如实显示）
- [x] 0a.2 记忆视图过滤器新增「来源设备」条件（选项含「未知」，带消歧标识与记忆数）；`/api/memories` 支持 device 参数（服务端过滤）
- [x] 0a.3 过滤条件写入地址、刷新还原（与既有过滤同一机制）；静态导出页同构支持（内嵌模型过滤，零请求）
- [x] 0a.4 单测/e2e：设备过滤回写地址、静态页零请求过滤、徽章渲染

## 1. 模式开关与配置

- [x] 1.1 vault.json 增 `preserve_device_bound`（缺省 false）；`vault status` / doctor 输出当前模式
- [x] 1.2 开关入口：`vault init-remote --preserve-device-bound` 与 `vault config --preserve-device-bound on|off`
- [x] 1.3 订阅集/路由查询：`syncableChains()` —— personal 链恒在；保管模式开启时加 `preserve/<deviceId>`

## 2. push：迁出完整性 + 保管链路由

- [x] 2.1 迁出完整性（模式无关）：记忆离开个人链 → 入队 `sync_scope_exit`（入队固化 fromSpaceKey）
- [x] 2.2 保管模式开启：device-local / project 内容写入与迁移 → 入队路由到 `preserve/<deviceId>` 的上行任务（事件携带归属设备标签 + 作用域描述符）
- [x] 2.3 保管模式关闭：维持物理排除；不可路由任务完成 + 审计 `sync_job_unroutable`（消灭静默完成）
- [x] 2.4 push 按链分组发布（personal / preserve 各自 chunk/manifest/代次），输出按链分列

## 3. pull：物化过滤

- [x] 3.1 pull 范围 = 个人链 + 本设备保管链（保管模式开启时）；他人保管链不下载
- [x] 3.2 apply 物化过滤：个人链 → personal-global（现状）；本设备保管链 → 按作用域描述符物化；描述符缺失（存量旧事件）→ 按现状处理
- [x] 3.3 个人链迁出事件应用：「不再持有」语义（archived + meta 标记）不回归

## 4. backfill 多链

- [x] 4.1 保管模式开启：对账覆盖保管链（device-local / project 内容入链）；关闭：候选仅个人全局（现状）
- [x] 4.2 输出按链分列（候选/新增/已存在/排除）；幂等、只读默认、不触网语义不变

## 4a. 存量迁出通知补发（8.5 排期时发现的缺口，追加）

- [x] 4a.1 `findScopeExitGap`：曾推个人链（sync_pushed 元数据）、已离开个人链、无任何 sync_scope_exit 任务的活动记忆；backfill --apply 补发（固化 fromSpace），已有过迁出任务（不论状态）不重发
- [x] 4a.2 规格场景「存量迁出通知补发」加入 delta（冷启动对账）；doctor 增缺口提示（与上行缺口同一自愈纪律）
- [x] 4a.3 单测：模拟 0.6.x 直改 scope 的事故形状 → dry-run 报告/apply 补发/对端 archived/重复对账不重发

## 5. 可观测与文案

- [x] 5.1 doctor/status：保管模式 + 各链 headSeq/游标/pending/缺口
- [x] 5.2 CLI help 文案修正：`sync push|pull` 并非"默认只读"，仅 backfill 默认只读

## 6. 文档与边界改写

- [x] 6.1 `docs/cairn-sync.md`：保管模式章节（双模语义、链结构、物化过滤、找回路径、旧版本边界）
- [x] 6.2 `docs/cairn-security.md`：物理排除 → 双模语义；密钥泄露爆炸半径的如实说明
- [x] 6.3 AGENTS.md「安全与授权」行改写（用户已确认推翻；保留"云端对象无明文"与"candidate/sensitive 特别提示"）
- [x] 6.4 README 同步段一句话提及保管模式

## 7. 测试

- [x] 7.1 单测：模式开关读取与 doctor/status 呈现（默认 false）
- [x] 7.2 单测：迁出完整性——离开个人链必入队 scope_exit（目的地为 project / device-local 两态），入队固化 fromSpace
- [x] 7.3 单测：push 路由——OFF 模式物理排除 + 不可路由审计；ON 模式保管链路由 + 事件作用域描述符
- [x] 7.4 单测：apply 物化过滤——个人链/本机保管链/描述符缺失三态；他人保管链不拉取
- [x] 7.5 单测：backfill 双模式分列与幂等
- [x] 7.6 e2e（fake backend，双设备）：ON 模式全场景——A 开保管模式写入 device-local + 迁移 27 条到项目作用域 + push；B（旧版本语义）pull：27 条 archived、device-local 内容不落地；A 重建数据目录 pull 找回
- [x] 7.7 变异对照：还原"静默完成分支"，7.2/7.3 必须变红；去掉物化过滤，7.4 必须变红

## 8. 验证与门禁

- [x] 8.1 `npm test` 全绿，测试数高于当前基线（846）
- [x] 8.2 `npm run typecheck` 0 错误
- [x] 8.3 `npm run test:e2e`（onboarding 全链）不回归
- [x] 8.4 `openspec validate add-cloud-preserve-mode --strict` 通过
- [x] 8.5 真实云端两设备验证（2026-11-15 用户授权后执行，记录：docs/verify-preserve-mode-2026-11-15.md）——本机 v7 迁移 + 开模式 + backfill（48+27）+ push；云端审计 137/137 完整性、明文 0 命中；对端 0.6.1 pull 收 27 条迁出通知，active 33→6、archived +27、零数据丢失；对端升级后的自有保管链找回留作发版后可选动作（见记录 §5）（需用户单独授权）：本机开模式 + backfill + push → 对端 pull（个人链迁出生效）→ 对端升级后 pull 自己保管链找回 → doctor 双端 per-chain 汇总正确
