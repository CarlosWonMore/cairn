# Tasks

## 1. 适配器表达投影能力

- [x] 1.1 `src/agents/adapters.ts`：`HostAdapter` 增加 `projectionMode: 'brief' | 'index' | 'none'` 与 `projectionBudgetBytes: number`；为 7 个宿主逐一赋值（DSH/Claude/Cursor/Copilot=brief 2048，WorkBuddy=brief 8192，ZCode=index 2048，OpenClaw=none 0）；验证：`tests/agents/adapters.test.ts` 断言每个宿主的模式与预算
- [x] 1.2 WorkBuddy 的能力分级从 `blocked` 改为 `fixture-only`，并改写 notes 说明证据来源（应用代码 `MemoryCollector`，10K 上限）；验证：同文件断言 `mcpConfigCapability`/`blockCapability` 与 notes 内容
- [x] 1.3 Copilot 的 notes 增加「与 Copilot Memory 并存」警告；验证：同文件断言 notes 含该警告

## 2. 简报渲染器

- [x] 2.1 新增 `src/projection/brief.ts`：`selectMemoriesForProjection(store, scopeIds, budget)` —— **取数阶段**即排除 `local_only` / `sensitive` / `blocked`；验证：`tests/projection/brief.test.ts` 构造三类敏感记忆，断言返回集合不含它们
- [x] 2.2 `renderBrief(memories, budgetBytes)`：每行 `- [kind] 首行截断 (id:xxxxxxxx)`，超预算按 `confidence desc → updated_at desc → id asc` 裁剪并写省略条数；验证：同文件断言截断条数正确、省略提示存在
- [x] 2.3 `renderIndex(memories, budgetBytes)`：每行 `- [标题](id:xxxxxxxx) — 一句话`，单行 ≤200 字符；验证：同文件断言行长度上限与格式
- [x] 2.4 字节可复现：同一输入两次渲染结果逐字节相同；验证：同文件断言（不含时间戳）

## 3. 接入 plan/apply

- [x] 3.1 `src/agents/config.ts`：`planAgentConfig` 生成受管块内容时，改用简报渲染器（`projectionMode==='none'` 时退回原路由文案）；验证：`tests/agents/config.test.ts` 断言 after 含记忆摘要且不含敏感内容
- [x] 3.2 投影内容变化仍走 `plan → approve → apply`，`beforeHash` 校验不变；验证：同文件覆盖正常应用与目标变化被拒
- [x] 3.3 幂等：同一记忆集重复 apply 不重写文件；验证：同文件断言第二次 `changed=false`

## 4. doctor 与文档

- [x] 4.1 `doctorAgentConfig` 报告 `projectionMode`、预算、实际占用字节、是否出现截断；验证：`tests/agents/config.test.ts` 断言字段存在且数值与文件一致
- [x] 4.2 `docs/cairn-usage.md` 增补「投影简报」一节：分级表、预算、敏感排除、Copilot 并存警告；验证：文档命令可复制执行
- [x] 4.3 `docs/M0-session-handoff.md` 记录本次与三处调研结论（WorkBuddy 10K / ZCode index / AGENTS.md 三宿主通用）

## 5. 集成验收

- [x] 5.1 `npm test` 全绿，计数较基线（649）净增，0 失败
- [x] 5.2 真实库只读核对：对真实 DSH home 执行 `agent plan --host dsh`，断言 plan 中投影区块含真实记忆摘要、且不含 sensitive 记忆，文件未被修改
- [x] 5.3 临时 HOME 端到端：plan → apply → doctor → uninstall，断言最终字节恢复原始、投影块含预期记忆数

## Workflow follow-up

- 归档前需用户审阅四个制品。
- 归档时把两条 delta 合并进 `agent-interfaces` 与 `agent-onboarding` 主规格。
- 后续独立变更：`add-lesson-kind`、`add-dsh-memory-plugin`。
