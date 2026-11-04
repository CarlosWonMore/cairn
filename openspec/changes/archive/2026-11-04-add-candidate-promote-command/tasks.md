# Tasks: 候选晋升命令（cairn promote）

## 1. 存储层：作用域迁移

- [x] 1.1 `src/store/memories.ts`：新增 `migrateScope(id, newScopeId, opts)`：更新 `memory.scope_id` 并复查外键完整性；验证：迁移后 `foreign_key_check` 为空，`memory_revision` 等子表行数不变
- [x] 1.2 `migrateScope` MUST 拒绝把记忆迁到 `session-ephemeral` 以外的非法作用域；验证：非法预设抛出治理拒绝类错误，数据不变
- [x] 1.3 `migrateScope` MUST 拒绝把记忆迁出 `device-local` 到会放大可见面的作用域以外的非法组合（具体白名单以 `scope-store` 既有规则为准）；验证：越权组合被拒
- [x] 1.4 迁移 MUST 留下审计事件，含变更前后作用域；验证：`audit_event` 中可查到 `fromScope` 与 `toScope`

## 2. 应用层：晋升与拒绝

- [x] 2.1 `src/interfaces/app-service.ts`：新增 `promoteCandidate(id, opts)`：`opts` 含 `scopePreset?` / `scopeId?`；实现：校验状态为 candidate → 在**同一事务**内完成状态与作用域更新 → 重建 outbox 任务 → 记录审计；验证：事务后记忆为 active、权威为 `user_confirmed`、作用域为期望值
- [x] 2.2 晋升后的权威 MUST 为 `user_confirmed`（用户审阅并批准），MUST NOT 沿用候选的 `agent_inferred`；验证：断言 `authority` 字段
- [x] 2.3 晋升 MUST 保留 `promoteToActive()` 既有的 `E_FORBIDDEN` 守卫（拒绝把推断/未验证来源作为晋升后权威）；验证：构造非法权威参数被拒
- [x] 2.4 晋升 MUST 删除该记忆在**旧作用域**下的 pending outbox 任务，并按**新作用域**重新入队；验证：事务后旧任务不存在、新任务 `scope_id` 正确、幂等键按新修订生成
- [x] 2.5 晋升过程中任一步失败 MUST 整体回滚；验证：注入失败后候选状态与作用域均未变、无孤儿任务
- [x] 2.6 `src/interfaces/app-service.ts`：新增 `rejectCandidate(id, reason)`：候选 → `tombstoned` + 审计；验证：终态为 tombstoned，审计含理由
- [x] 2.7 拒绝 MUST 走秘密扫描，理由文本不得回显疑似秘密；验证：含注入特征的理由被拒且不回显原文

## 3. CLI 入口

- [x] 3.1 `src/interfaces/cli/main.ts`：新增 `promote <id> [--scope-preset <preset>] [--scope-project <id>]`；输出 `{ id, status, authority, scopePreset, scopeId }`；验证：`--json` 输出可被 `JSON.parse` 解析且字段完备
- [x] 3.2 新增 `reject <id> <reason>`；输出 `{ id, status }`；验证同上
- [x] 3.3 两个命令 MUST 以稳定退出码区分：成功 / 状态冲突（E_CONFLICT_STATE）/ 未找到（E_NOT_FOUND）/ 治理拒绝（E_FORBIDDEN）；验证：四个场景各断言退出码
- [x] 3.4 命令 MUST NOT 依赖交互确认（无 TTY 环境也要能跑）；验证：非交互环境执行成功
- [x] 3.5 `cairn search --status candidate` 或等价手段 MUST 能列出待审候选（`memory_search` 当前过滤掉 candidate，需确认 CLI 侧是否可列）；验证：能列出 3 条 candidate

## 4. 测试

- [x] 4.1 `tests/store/memories.test.ts`：作用域迁移的外键完整性、子表行数不变、非法作用域被拒
- [x] 4.2 `tests/interfaces/app-service.test.ts`：晋升的权威、状态、作用域、outbox 重建、失败回滚、幂等
- [x] 4.3 `tests/interfaces/cli.test.ts`：两个命令的退出码与 JSON 输出形状
- [x] 4.4 负向：对 active / archived / tombstoned 执行晋升或拒绝均被拒且数据不变

## 5. 文档与验收

- [x] 5.1 `docs/cairn-usage.md` 写明两个命令的用法、作用域选项与「CLI 即签发通道」的含义
- [x] 5.2 `docs/cairn-security.md` 补一句：候选批准是本地 CLI 的显式动作，不可被远端或 Agent 代签
- [x] 5.3 `npm test` 全绿，计数较基线净增，0 失败
- [x] 5.4 端到端手测（用**库副本**，不碰真实库）：造 1 条 candidate → `promote --scope-preset device-local` → 断言 active + device-local + 审计完整 + outbox 重建

## 6. 归档前

- [x] 6.1 用户审阅四个制品
- [x] 6.2 归档时把 delta 合并进 `memory-governance` 与 `agent-interfaces` 主规格
- [x] 6.3 **真实库的 3 条 candidate 的晋升需用户明确指令后再执行**（spec 纪律：真实库操作单独授权）
