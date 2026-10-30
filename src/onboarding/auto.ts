import { err } from '../core/errors.js';
import { nowIso } from '../core/time.js';
import { scanText } from '../core/secrets.js';
import type { EvidenceInput } from '../core/types.js';
import type { CairnStore } from '../store/index.js';
import { proposePlan, ProposedItem } from '../governance/propose.js';
import { applyPlan } from '../governance/apply.js';
import { findDuplicate } from '../governance/dedup.js';
import { markItemPromoted, promotedPredicate } from './batches.js';
import { readReviewsIndex } from '../interfaces/console/review-store.js';
import { computeSuggestions, type SuggestedAction, type Suggestion } from '../interfaces/console/suggestions.js';
import {
  CONFIDENCE_SCORE,
  evaluatePolicy,
  requireUsablePolicy,
  type PolicyCandidate,
  type PolicyCondition,
  type SignedPolicy,
} from './policy.js';

/**
 * 自动编排（design D1 / D2 / D6 / D7）。
 *
 * 这个模块只做三件事：把条目分成 auto / manual 两档、按作用域生成计划、
 * 用已签发策略代签审批并应用。它**不判断内容好不好**——那是规则层与 AI 层的事，
 * 它只回答"已签发的策略允许不允许自动处理这一条"。
 *
 * 不 import AppService：AppService 会反过来 import 本模块，互相引用会让
 * 初始化顺序变得不可预测。这里直接用 store 与 governance 层的原语。
 */

export interface AutoRunScopeSelection {
  preset?: string;
  projectId?: string;
  scopeId?: string;
}

export interface AutoRunInput {
  policyId: string;
  batchId?: string;
  scope?: AutoRunScopeSelection;
  /** 只分档不写库。 */
  dryRun?: boolean;
  /** 只处理这些条目；省略表示整批。 */
  itemIds?: string[];
  /**
   * 重新处理已晋升过的条目。默认跳过：同一批跑第二次不该把记忆再走一遍 merge。
   * 撤销之后要重做，用这个开关显式声明意图。
   */
  redo?: boolean;
  /** 审批有效期，默认 5 分钟。 */
  ttlMs?: number;
}

export interface AutoTierEntry {
  itemId: string;
  tier: 'auto' | 'manual';
  action: SuggestedAction;
  reason: string;
  failedCondition: PolicyCondition | null;
  detail: string;
}

export interface AutoPlanResult {
  planId: string;
  scopeId: string;
  ops: number;
  applied: number;
  skipped: number;
  failed: number;
  approvalId: string;
}

export interface AutoRunSummary {
  policyId: string;
  policyHashPrefix: string;
  batchId: string;
  scopeId: string;
  scopeName: string;
  dryRun: boolean;
  totalItems: number;
  auto: number;
  manual: number;
  applied: number;
  skipped: number;
  failed: number;
  /** 转人工的条目按未满足条件计数。 */
  byCondition: Record<string, number>;
  byAction: Record<string, number>;
  failures: { itemId: string; code: string; message: string }[];
  plans: AutoPlanResult[];
  /** 汇总自校验：applied + skipped + failed + manual === totalItems。 */
  balanced: boolean;
  tiers: AutoTierEntry[];
}

/** 找不到批次时与 AppService 用同一判定：最近一个还有未晋升 clean 条目的批次。 */
function pickBatchId(store: CairnStore, batchId?: string): string {
  if (batchId) {
    const exists = store.db.get('SELECT 1 AS x FROM import_item WHERE batch_id = ? LIMIT 1', batchId);
    if (exists == null) throw err('E_NOT_FOUND', `批次不存在: ${batchId}`);
    return batchId;
  }
  const rows = store.db.all(
    `SELECT i.batch_id AS bid FROM import_item i
      WHERE i.scan_state = 'clean' AND i.batch_id IS NOT NULL
        AND ${promotedPredicate('i').notExists}
      GROUP BY i.batch_id ORDER BY i.batch_id DESC LIMIT 1`,
  );
  if (rows.length === 0) throw err('E_VALIDATION', '没有待整理的批次；请先 cairn import');
  return String(rows[0]!.bid);
}

function resolveTargetScope(store: CairnStore, sel: AutoRunScopeSelection = {}) {
  if (sel.scopeId) return store.scopes.requireById(sel.scopeId);
  const preset = sel.preset ?? 'personal-global';
  if (preset === 'device-local') return store.scopes.resolvePreset('device-local', { deviceId: store.identity.deviceId });
  if (preset === 'project-global') return store.scopes.resolvePreset('project-global', { projectId: sel.projectId });
  return store.scopes.resolvePreset(preset as never, {});
}

/** 审计强制带策略标识：缺任一即拒绝写入（tasks 2.4）。 */
function recordPolicyAudit(
  store: CairnStore,
  action: string,
  policy: SignedPolicy,
  detail: Record<string, unknown>,
): void {
  const policyHashPrefix = policy.policyHash.slice(0, 8);
  if (!policy.spec.id || !policyHashPrefix) {
    throw err('E_FORBIDDEN', '自动整理审计缺少策略标识，拒绝写入');
  }
  store.audit.record('policy', action, { type: 'policy', id: policy.spec.id }, {
    policyId: policy.spec.id,
    policyHashPrefix,
    ...detail,
  });
}

function evidenceForItem(itemId: string, archiveId: string): EvidenceInput {
  return {
    evidenceKind: 'import_ref',
    importArchiveId: archiveId,
    locator: `item:${itemId}`,
    trustLevel: 'third_party',
  };
}

export function runAutoOnboarding(store: CairnStore, input: AutoRunInput): AutoRunSummary {
  store.assertWritable();
  const policy = requireUsablePolicy(store.paths.home, input.policyId);
  const batchId = pickBatchId(store, input.batchId);
  const target = resolveTargetScope(store, input.scope);

  // 策略白名单：preset 名与 scope id 都接受，但必须命中其一。
  if (!policy.spec.allowedScopes.includes(target.preset) && !policy.spec.allowedScopes.includes(target.id)) {
    throw err('E_FORBIDDEN', `目标作用域 ${target.preset}(${target.id}) 不在策略 ${policy.spec.id} 的允许集内`, {
      allowedScopes: policy.spec.allowedScopes,
    });
  }

  const rows = store.db.all(
    'SELECT id, archive_id, content, scan_state FROM import_item WHERE batch_id = ? ORDER BY id',
    batchId,
  );
  const wanted = input.itemIds ? new Set(input.itemIds) : null;
  // 已晋升过的条目默认不再处理：否则第二次运行会把它们重新走一遍 merge，
  // 既不幂等，也会让"再跑一次看看"变成对记忆的额外扰动。
  // 撤销（policy revoke）不会让它们自动回到这里——撤销必须是粘的，见 batches.ts。
  const promoted = new Set(
    store.db
      .all(`SELECT i.id AS id FROM import_item i WHERE i.batch_id = ? AND ${promotedPredicate('i').exists}`, batchId)
      .map((r) => String(r.id)),
  );
  // 点名指定条目也是一次显式重做：调用方已经说清要哪几条了，不该再被
  // "已晋升"静默过滤掉（那只会变成一条名为"不属于批次"的误导性报错）。
  const redo = input.redo === true || wanted != null;
  const selected = rows.filter(
    (r) => (wanted == null || wanted.has(String(r.id))) && (redo || !promoted.has(String(r.id))),
  );
  if (wanted && selected.length !== wanted.size) {
    const found = new Set(selected.map((r) => String(r.id)));
    const missing = [...wanted].filter((id) => !found.has(id));
    throw err('E_NOT_FOUND', `以下条目不属于批次 ${batchId}: ${missing.slice(0, 5).join(', ')}`, { missing });
  }

  // 规则层与 AI 层：各建一个按 itemId 的索引。
  // redo 时必须让规则层连已晋升条目一起判：只放宽选择、不放宽规则层的话，
  // 条目会被选中但拿不到建议，一路 needs_human → skip，重做等于空转。
  const ruleItems = new Map<string, Suggestion>();
  for (const s of computeSuggestions(store, { batchId, includePromoted: redo }).items) {
    ruleItems.set(s.itemId, s);
  }
  const aiIndex = readReviewsIndex(store);

  const tiers: AutoTierEntry[] = [];
  const byCondition: Record<string, number> = {};
  const byAction: Record<string, number> = {};

  for (const row of selected) {
    const itemId = String(row.id);
    const content = String(row.content);
    const scanState = String(row.scan_state) === 'blocked' ? 'blocked' : 'clean';
    const rule = ruleItems.get(itemId);
    const ai = aiIndex.get(itemId);

    const dup = scanState === 'clean' ? findDuplicate(store.db, target.id, content) : null;
    const ruleAction: SuggestedAction = rule?.action ?? 'needs_human';
    // 重复内容的正确动作是并入，不是新建。
    const effectiveRuleAction: SuggestedAction = dup ? 'merge' : ruleAction;
    const hasConflict =
      rule?.targetMemoryId != null &&
      store.db.get("SELECT 1 AS x FROM conflict WHERE memory_id = ? AND status = 'open' LIMIT 1", rule.targetMemoryId) != null;

    const candidate: PolicyCandidate = {
      itemId,
      scanState,
      scope: target.preset,
      // import_item 没有敏感度列：被判敏感的条目在导入阶段已进 blocked，这里恒为 normal。
      sensitivity: 'normal',
      hasConflict,
      ruleAction: effectiveRuleAction,
      aiAction: ai?.action ?? null,
      aiConfidence: ai ? CONFIDENCE_SCORE[ai.confidence] : null,
      isDuplicate: dup != null,
      wouldCreate: effectiveRuleAction === 'promote' && dup == null,
    };

    const verdict = evaluatePolicy(candidate, policy);
    const tier: 'auto' | 'manual' = verdict.ok ? 'auto' : 'manual';
    if (!verdict.ok && verdict.failedCondition) {
      byCondition[verdict.failedCondition] = (byCondition[verdict.failedCondition] ?? 0) + 1;
    }
    byAction[effectiveRuleAction] = (byAction[effectiveRuleAction] ?? 0) + 1;
    tiers.push({
      itemId,
      tier,
      action: effectiveRuleAction,
      reason: rule?.reason ?? '规则层未给出建议',
      failedCondition: verdict.failedCondition,
      detail: verdict.detail,
    });
  }

  const autoEntries = tiers.filter((t) => t.tier === 'auto');
  const manual = tiers.length - autoEntries.length;

  // 按作用域分组生成计划（tasks 2.2）。当前只有一个目标作用域，
  // 分组结构与"不同 scope 不混进同一计划"的约束都在这里，将来多目标时直接生效。
  const groups = new Map<string, { scopeId: string; items: ProposedItem[]; skipped: number }>();
  const rowById = new Map(selected.map((r) => [String(r.id), r]));

  for (const entry of autoEntries) {
    const row = rowById.get(entry.itemId)!;
    const archiveId = String(row.archive_id);
    const content = String(row.content);

    if (entry.action === 'skip' || entry.action === 'needs_human') {
      const g = groups.get(target.id) ?? { scopeId: target.id, items: [], skipped: 0 };
      g.skipped += 1;
      groups.set(target.id, g);
      continue;
    }

    // 内容已在目标作用域里存在（active 或 candidate）：没有任何东西要新建。
    // 治理层会把它记成 duplicate 并拒掉，结果就是"计划为空 → 抛错"——那不是异常，
    // 是"没活干"。所以在这里先认出来，记成 skipped 而不是让它变成一次失败。
    // 之所以连 merge 一起短路：opHint=merge 且正文与目标完全相同，也等于已并入。
    const existing = findDuplicate(store.db, target.id, content);
    if (existing != null) {
      const g = groups.get(target.id) ?? { scopeId: target.id, items: [], skipped: 0 };
      g.skipped += 1;
      groups.set(target.id, g);
      continue;
    }

    const opHint = entry.action === 'promote' ? 'add' : entry.action;
    // merge 的目标要取**规则层指的那条**，不是按正文再查一次：
    // 规则层的合并建议针对"语义近似但正文不同"的条目，按正文查重根本查不到它，
    // 拿查重结果当目标就会把 merge 静默降级成 add，多出一条重复记忆。
    const mergeTarget = entry.action === 'merge' ? ruleItems.get(entry.itemId)?.targetMemoryId ?? undefined : undefined;
    const item: ProposedItem = {
      itemId: entry.itemId,
      content,
      kind: 'fact',
      opHint: opHint === 'merge' || opHint === 'keep_both' || opHint === 'add' ? opHint : 'add',
      targetMemoryId: mergeTarget,
      reason: `policy:${policy.spec.id} ${entry.reason}`.slice(0, 400),
      evidence: [evidenceForItem(entry.itemId, archiveId)],
    };
    const g = groups.get(target.id) ?? { scopeId: target.id, items: [], skipped: 0 };
    g.items.push(item);
    groups.set(target.id, g);
  }

  const summary: AutoRunSummary = {
    policyId: policy.spec.id,
    policyHashPrefix: policy.policyHash.slice(0, 8),
    batchId,
    scopeId: target.id,
    scopeName: target.preset,
    dryRun: input.dryRun === true,
    totalItems: selected.length,
    auto: autoEntries.length,
    manual,
    applied: 0,
    skipped: 0,
    failed: 0,
    byCondition,
    byAction,
    failures: [],
    plans: [],
    balanced: false,
    tiers,
  };

  if (input.dryRun === true) {
    summary.skipped = autoEntries.filter((e) => e.action === 'skip' || e.action === 'needs_human').length;
    summary.balanced = summary.auto + summary.manual === summary.totalItems;
    return summary;
  }

  const archiveIds = [...new Set(selected.map((r) => String(r.archive_id)))];
  const channel = `policy:${policy.spec.id}:${policy.policyHash.slice(0, 8)}`;

  for (const g of groups.values()) {
    summary.skipped += g.skipped;
    if (g.items.length === 0) continue;

    const proposed = proposePlan(store, {
      scopeId: g.scopeId,
      items: g.items,
      sourceArchiveIds: archiveIds,
      proposedBy: `policy:${policy.spec.id}`,
      scan: scanText,
    });

    for (const r of proposed.rejected) {
      // 同批重复（repeatOf:<itemId>）不是失败：那一条的正文已经并进保留项，
      // 记成 E_PLAN_INVALID 会让汇总冒出几十个"失败"，读起来像程序出错了。
      // 真正的拒绝（秘密/注入/itemId 不存在）才算失败。
      if (/^repeatOf:/.test(r.reason)) {
        summary.skipped += 1;
        summary.failures.push({
          itemId: r.itemId ?? '(未绑定)',
          code: 'E_DUPLICATE',
          message: '同批重复：正文已并入保留项，证据已合并',
        });
        continue;
      }
      summary.failed += 1;
      summary.failures.push({ itemId: r.itemId ?? '(未绑定)', code: 'E_PLAN_INVALID', message: r.reason });
    }
    for (const d of proposed.duplicates) {
      // 库内已有同内容：并入既有记忆即可，不计失败。
      summary.skipped += 1;
      summary.failures.push({
        itemId: d.itemId ?? '(未绑定)',
        code: 'E_DUPLICATE',
        message: `已并入既有记忆 ${d.duplicateOfMemoryId}`,
      });
    }

    // 证据合并：把批内被合并条目的证据并到保留项（spec memory-governance）。
    const evidenceByItem: Record<string, EvidenceInput[]> = {};
    for (const it of g.items) if (it.itemId) evidenceByItem[it.itemId] = [...(it.evidence ?? [])];
    for (const r of proposed.rejected) {
      const m = /^repeatOf:([^\s]+)/.exec(r.reason);
      if (!m || m[1] === '?' || !r.itemId) continue;
      const keep = m[1]!;
      const src = rowById.get(r.itemId);
      if (!src) continue;
      (evidenceByItem[keep] ??= []).push(evidenceForItem(r.itemId, String(src.archive_id)));
    }

    if (proposed.accepted === 0) {
      summary.plans.push({
        planId: proposed.plan.id,
        scopeId: g.scopeId,
        ops: 0,
        applied: 0,
        skipped: 0,
        failed: 0,
        approvalId: '',
      });
      continue;
    }

    const { approval } = store.plans.issueApproval({
      planId: proposed.plan.id,
      channel,
      approvedBy: 'local_cli',
      ttlMs: input.ttlMs,
    });

    const report = applyPlan(store, {
      planId: proposed.plan.id,
      approvalId: approval.id,
      deviceId: store.identity.deviceId,
      scan: scanText,
      evidenceByItem,
    });

    // 必须把条目标记为已晋升，否则下一次运行会把它当成未处理、再走一遍 merge。
    // AppService.applyPlan 里做了这件事，这里直接调治理层，得自己补。
    // 不吞错：markItemPromoted 现在只在"原目标记忆仍在、却要改挂到另一条"时抛
    // E_CONFLICT_STATE，那是真实的状态冲突，吞掉会让后续幂等判断全部错位。
    const ops = store.plans.ops(proposed.plan.id);
    for (const res of report.results) {
      const op = ops.find((o) => o.opIndex === res.opIndex);
      if (op?.itemId && res.memoryId) {
        markItemPromoted(store, op.itemId, res.memoryId);
      }
    }

    summary.applied += report.applied;
    summary.skipped += report.skipped;
    summary.failed += report.failed;
    // results 只含成功落库的操作；失败数由 report.failed 给出，具体原因在 apply 的审计里。
    if (report.failed > 0) {
      summary.failures.push({
        itemId: `(plan:${proposed.plan.id})`,
        code: 'E_APPLY_PARTIAL',
        message: `${report.failed} 条在应用阶段失败`,
      });
    }
    summary.plans.push({
      planId: proposed.plan.id,
      scopeId: g.scopeId,
      ops: proposed.accepted,
      applied: report.applied,
      skipped: report.skipped,
      failed: report.failed,
      approvalId: approval.id,
    });

    const memoryIds = report.results
      .map((r) => r.memoryId)
      .filter((id): id is string => typeof id === 'string')
      .slice(0, 1000);
    recordPolicyAudit(store, 'auto_applied', policy, {
      batchId,
      planId: proposed.plan.id,
      approvalId: approval.id,
      channel,
      applied: report.applied,
      skipped: report.skipped,
      failed: report.failed,
      memoryIds,
      note: policy.spec.note,
      at: nowIso(),
    });
  }

  summary.balanced = summary.applied + summary.skipped + summary.failed + summary.manual === summary.totalItems;
  return summary;
}

/**
 * 按策略撤销（design D7）：转 tombstone 而不物理删除，并且让同一批次可以被重新整理
 * ——判定不认 tombstoned，所以重新整理不会撞上自己留下的墓碑。
 */
export function revokeByPolicy(
  store: CairnStore,
  policyId: string,
  opts: { batchId?: string } = {},
): { tombstoned: number; memoryIds: string[] } {
  store.assertWritable();
  const rows = store.db.all(
    "SELECT detail FROM audit_event WHERE category = 'policy' AND action = 'auto_applied' ORDER BY at",
  );
  const ids = new Set<string>();
  // 整策略撤销（不带 batchId）也必须说清"撤了哪几批"：审计里只写 batchId:null
  // 的话，界面与后续排查都无法把撤销挂回某个批次，会表现为"撤了但看不出撤过"。
  const touchedBatches = new Set<string>();
  for (const row of rows) {
    let detail: Record<string, unknown>;
    try {
      detail = JSON.parse(String(row.detail)) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (detail['policyId'] !== policyId) continue;
    if (opts.batchId != null && detail['batchId'] !== opts.batchId) continue;
    if (typeof detail['batchId'] === 'string') touchedBatches.add(detail['batchId']);
    const list = detail['memoryIds'];
    if (!Array.isArray(list)) continue;
    for (const id of list) if (typeof id === 'string') ids.add(id);
  }

  let tombstoned = 0;
  for (const id of ids) {
    const mem = store.memories.get(id);
    if (!mem || mem.status === 'tombstoned') continue;
    store.memories.forget(id, `按策略 ${policyId} 撤销自动整理结果`, `policy:${policyId}`);
    tombstoned += 1;
  }
  store.audit.record('policy', 'revoked', { type: 'policy', id: policyId }, {
    policyId,
    batchId: opts.batchId ?? null,
    /** 实际被这次撤销覆盖的批次；整策略撤销时 batchId 为 null，靠这个字段挂得回去。 */
    batchIds: [...touchedBatches],
    tombstoned,
  });
  return { tombstoned, memoryIds: [...ids] };
}
