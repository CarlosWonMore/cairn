/**
 * 治理模块（memory-governance spec）公共入口：候选计划的真实应用。
 *
 * 职责边界——模型只生成候选，以下全部是确定性代码：
 * - proposePlan：候选逐项校验（instruction 拒绝、秘密/注入扫描、精确去重、
 *   opHint 映射）→ awaiting_approval 计划 + plan_hash。审批不在此签发，
 *   必须由本地可信通道（CLI / MCP UI）另行 issueApproval；
 * - applyPlan：消费一次性真实审批（重放/过期/篡改由确定性代码校验，
 *   调用方声明 user_confirmed 不构成凭证）→ 逐 op 幂等应用（per-op 事务、
 *   应用前秘密复检、目标修订快照重检）→ 审计。
 *
 * 隐私硬约束：审计、报告、错误详情只含计数、id 与 masked 摘要；
 * 记忆正文与秘密原文绝不进入日志、投影或上行内容。
 */
export * from './propose.js';
export * from './apply.js';
