import { err, isCairnError } from '../core/errors.js';
import { EvidenceInput, SecretScanResult } from '../core/types.js';
import { CairnStore } from '../store/open.js';
import { PlanOpRecord, PlanRecord } from '../store/plans.js';

/**
 * 计划应用（apply，spec memory-governance「计划绑定真实审批」+「幂等应用与中断续跑」）。
 *
 * 前置（确定性校验，顺序有意为之）：
 *   1. plan.status === 'applied' → 返回 alreadyApplied 报告，不消耗审批；
 *   2. expireStale() 过期清扫（只清扫 awaiting_approval/draft）；
 *   3. 篡改预检（只读）：审批与计划绑定 + plan_hash 一致。放在状态检查之前，
 *      因为批准后改哈希会触发 DB 触发器把计划置为 invalidated 并撤销审批——
 *      若先查状态会以 E_APPROVAL_INVALID 掩盖真正的篡改；先比哈希让
 *      「批准后计划被修改」以 E_PLAN_TAMPERED 暴露（spec memory-governance）；
 *   4. status 必须是 'approved'（否则 E_APPROVAL_INVALID，审批不被消耗）；
 *   5. consumeApproval：一次性凭证（重放 E_APPROVAL_REPLAY、过期
 *      E_APPROVAL_EXPIRED、撤销 E_APPROVAL_INVALID），失败不消耗 uses。
 *
 * 逐 op 应用（每个 op 独立 store.db.transaction：记忆写入 + 证据 + op 状态同事务）：
 *   - 已 applied/skipped → 计入 skipped，不产生任何副作用（续跑幂等）；
 *   - 应用前秘密复检（op.content 存在时）：不干净 → op 标记 failed（只存 masked
 *     摘要）、剩余 op 保持 pending、撤销已消耗审批、抛 E_SECRET_DETECTED
 *     （details 只含 {kind, masked}，绝不回显原文）；
 *   - add/keep_both：memories.add(authority='user_confirmed', createdBy='plan:<id>')；
 *     keep_both 且带 target 时补 addRelation(new, target, 'contradicts')；
 *   - merge：memories.revise(target, …, expectedCurrentRevisionId=快照)；
 *     E_TARGET_CHANGED → op failed('target_changed')、剩余 pending、原样抛出
 *     （拒绝基于过期目标应用，spec「目标在批准后变化」）；
 *   - 其他每 op 错误：op failed(error code) 并继续其余 op（失败计数进报告）；
 *   - 全部处理完成 → setStatus('applied') + 审计 plan/applied（无正文）。
 *
 * 恢复路径（spec「应用在 halfway 中断」）：
 *   - 进程在逐 op 应用中途退出：审批已消耗（一次性）、计划仍 approved、
 *     已完成 op 状态为 applied。此时用同一 approvalId 重试会得到
 *     E_APPROVAL_REPLAY；恢复 = plans.revokeApproval(旧审批) +
 *     plans.setStatus(planId,'awaiting_approval') → 重新 issueApproval →
 *     再次 applyPlan（已 applied/skipped 的 op 幂等跳过，最终结果与单次成功一致）。
 *   - 治理性中止（E_SECRET_DETECTED / E_TARGET_CHANGED）：applyPlan 已就地
 *     撤销消耗掉的审批并把计划送回 awaiting_approval（plan_hash 不变，重新批准
 *     的是同一份计划内容），可直接「再次 issueApproval → 再次 applyPlan」；
 *     failed 的 op 会被重试并确定性复现同一失败——此类计划应重新 propose
 *     （剔除带秘密/目标已推进的条目），而不是反复重试。
 */

export interface ApplyResultEntry {
  opIndex: number;
  opType: string;
  memoryId?: string;
  note?: string;
}

export interface ApplyReport {
  planId: string;
  alreadyApplied: boolean;
  applied: number;
  skipped: number;
  failed: number;
  results: ApplyResultEntry[];
}

export interface ApplyPlanInput {
  planId: string;
  approvalId: string;
  deviceId: string;
  scan: (text: string) => SecretScanResult;
  /** 按 itemId 附加证据：随 add 初始修订 / merge 新修订落库。 */
  evidenceByItem?: Record<string, EvidenceInput[]>;
}

export function applyPlan(store: CairnStore, input: ApplyPlanInput): ApplyReport {
  const { planId, approvalId, deviceId, scan } = input;
  const emptyReport: ApplyReport = { planId, alreadyApplied: true, applied: 0, skipped: 0, failed: 0, results: [] };

  let plan = store.plans.requireById(planId);
  if (plan.status === 'applied') return emptyReport;

  // 过期清扫（approved 计划不受影响），随后以最新状态继续
  store.plans.expireStale();
  plan = store.plans.requireById(planId);

  // 篡改预检（只读）：先于状态检查，见模块文档
  const approval = store.plans.requireApproval(approvalId);
  if (approval.planId !== planId) {
    throw err('E_APPROVAL_INVALID', '审批与计划不匹配', { approvalId, expectedPlan: approval.planId });
  }
  if (approval.planHash !== plan.planHash) {
    throw err('E_PLAN_TAMPERED', '计划哈希与审批不一致：计划在批准后被修改', { approvalId });
  }

  if (plan.status !== 'approved') {
    throw err('E_APPROVAL_INVALID', `计划状态为 ${plan.status}，不能应用`, { planId, status: plan.status });
  }

  // 一次性审批消费：重放/过期/撤销在此拒绝；失败不消耗 uses
  store.plans.consumeApproval(approvalId, planId, plan.planHash);

  const evidenceByItem = input.evidenceByItem ?? {};
  let applied = 0;
  let skipped = 0;
  let failed = 0;
  const results: ApplyResultEntry[] = [];

  /** 治理性中止：退役已消耗的一次性审批并把计划送回 awaiting_approval（见模块文档恢复路径）。 */
  const abortRun = (reason: string): void => {
    try {
      store.plans.revokeApproval(approvalId);
      store.plans.setStatus(planId, 'awaiting_approval');
      store.audit.record('plan', 'apply_aborted', { type: 'plan', id: planId }, { approvalId, reason });
    } catch {
      // 尽力而为：清理失败不掩盖原始治理错误
    }
  };

  for (const op of store.plans.ops(planId)) {
    // 续跑幂等：已完成的操作不再产生任何副作用
    if (op.status === 'applied' || op.status === 'skipped') {
      skipped += 1;
      results.push({
        opIndex: op.opIndex,
        opType: op.opType,
        note: op.status === 'applied' ? 'already_applied' : 'already_skipped',
      });
      continue;
    }

    // 应用前秘密复检：错误与 op.error 只含 masked 摘要，绝不回显原文
    if (op.content != null) {
      const rescan = scan(op.content);
      if (!rescan.clean) {
        const maskedFindings = rescan.findings.map((f) => ({ kind: f.kind as string, masked: f.masked }));
        const summary = maskedFindings.length > 0
          ? `secret_detected ${maskedFindings.map((f) => `${f.kind}:${f.masked}`).join(',')}`
          : 'secret_detected:injection_findings';
        store.plans.markOpFailed(op.id, summary);
        failed += 1;
        abortRun('E_SECRET_DETECTED');
        throw err('E_SECRET_DETECTED', '计划应用被阻断：操作内容检测到疑似秘密（不回显原文）', {
          planId,
          opIndex: op.opIndex,
          findings: maskedFindings,
        });
      }
    }

    try {
      const memoryId = store.db.transaction(() => {
        const id = applyOp(store, plan, op, evidenceByItem, deviceId);
        if (op.opType === 'skip') store.plans.markOpSkipped(op.id);
        else store.plans.markOpApplied(op.id);
        return id;
      });
      const entry: ApplyResultEntry = { opIndex: op.opIndex, opType: op.opType };
      if (op.opType === 'skip') {
        skipped += 1;
        entry.note = 'skipped';
      } else {
        applied += 1;
        if (memoryId !== undefined) entry.memoryId = memoryId;
      }
      results.push(entry);
    } catch (e) {
      if (isCairnError(e) && e.code === 'E_TARGET_CHANGED') {
        store.plans.markOpFailed(op.id, 'target_changed');
        failed += 1;
        abortRun('E_TARGET_CHANGED');
        throw e; // 原样抛出（details 只含 memoryId/expected/actual）
      }
      const note = isCairnError(e) ? e.code : 'E_INTERNAL';
      store.plans.markOpFailed(op.id, note);
      failed += 1;
      results.push({ opIndex: op.opIndex, opType: op.opType, note: `failed:${note}` });
    }
  }

  store.plans.setStatus(planId, 'applied');
  store.audit.record('plan', 'applied', { type: 'plan', id: planId }, {
    approvalId,
    deviceId,
    applied,
    skipped,
    failed,
  });

  return { planId, alreadyApplied: false, applied, skipped, failed, results };
}

/** 应用单个操作（在调用方的 per-op 事务内执行），返回新记忆 id（skip 为 undefined）。 */
function applyOp(
  store: CairnStore,
  plan: PlanRecord,
  op: PlanOpRecord,
  evidenceByItem: Record<string, EvidenceInput[]>,
  deviceId: string,
): string | undefined {
  const evidence = evidenceForOp(op, evidenceByItem);
  switch (op.opType) {
    case 'skip':
      return undefined;
    case 'add':
    case 'keep_both': {
      if (typeof op.content !== 'string' || op.content.length === 0) {
        throw err('E_VALIDATION', `${op.opType} 操作缺少 content`, { opIndex: op.opIndex });
      }
      const memory = store.memories.add(
        {
          kind: op.kind ?? 'fact',
          content: op.content,
          scopeId: op.scopeId ?? plan.scopeId,
          authority: 'user_confirmed',
          createdBy: `plan:${plan.id}`,
          evidence,
        },
        deviceId,
      );
      if (op.opType === 'keep_both' && op.targetMemoryId) {
        store.memories.addRelation(memory.id, op.targetMemoryId, 'contradicts');
      }
      return memory.id;
    }
    case 'merge': {
      if (!op.targetMemoryId) {
        throw err('E_VALIDATION', 'merge 操作缺少 targetMemoryId', { opIndex: op.opIndex });
      }
      if (typeof op.content !== 'string' || op.content.length === 0) {
        throw err('E_VALIDATION', 'merge 操作缺少 content', { opIndex: op.opIndex });
      }
      const { memory, revision } = store.memories.revise(
        op.targetMemoryId,
        op.content,
        {
          expectedCurrentRevisionId: op.targetExpectedRevision ?? undefined,
          reason: op.reason ?? 'plan merge',
          author: `plan:${plan.id}`,
        },
        deviceId,
      );
      for (const ev of evidence) store.memories.addEvidence(memory.id, revision.id, ev);
      return memory.id;
    }
  }
}

function evidenceForOp(op: PlanOpRecord, evidenceByItem: Record<string, EvidenceInput[]>): EvidenceInput[] {
  if (op.itemId == null) return [];
  return evidenceByItem[op.itemId] ?? [];
}
