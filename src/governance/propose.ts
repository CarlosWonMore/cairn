import { contentHash } from '../core/hash.js';
import { findDuplicate } from './dedup.js';
import { err } from '../core/errors.js';
import { EvidenceInput, MEMORY_KINDS, MemoryKind, SecretScanResult } from '../core/types.js';
import { CairnStore } from '../store/open.js';
import { PlanOpInput, PlanRecord } from '../store/plans.js';

/**
 * 候选计划生成（propose，spec memory-governance「计划绑定真实审批」前置环节）。
 *
 * 模型只产出候选（ProposedItem）；本模块是纯确定性代码管线：
 *   1. 逐项校验（content 非空且 ≤1MB、kind 合法、instruction 直接拒绝——
 *      instruction 只能走用户显式写入，不得经由候选计划入库）；
 *   2. 秘密/注入扫描（scan 由调用方注入，通常为 core/secrets 的 scanText）；
 *      不干净 → 整项 rejected，findings 只保留 {kind, masked}，绝不回显原文；
 *   3. 精确去重：与本地库现有记忆按规范化内容哈希（contentHash）比对，
 *      命中 → 不建 op，记 duplicates；
 *   4. opHint 映射：skip → skip op；targetMemoryId + merge/keep_both → 对应 op
 *      （携带 targetExpectedRevision 修订快照）；其余 → add op；
 *   5. 全部被拒/去重、无任何 op → E_PLAN_INVALID；
 *   6. createPlan（awaiting_approval，plan_hash 由 store 规范化计算）；
 *   7. 审计 plan/proposed：detail 只含计数，不含正文。
 *
 * 审批不在此签发：proposePlan 只产出 awaiting_approval 计划，
 * 必须由本地可信通道（CLI/MCP UI）另行 issueApproval——
 * 调用方声明 user_confirmed 不构成审批凭证（spec memory-governance）。
 */

/** 单条候选正文上限（与 MemoryRepository.validateMemoryInput 一致）。 */
export const MAX_ITEM_CONTENT_LENGTH = 1_000_000;

const OP_HINTS = ['add', 'merge', 'keep_both', 'skip'] as const;
export type OpHint = (typeof OP_HINTS)[number];

export interface ProposedItem {
  /**
   * 必须引用已存在的 import_item（plan_operation.item_id 外键约束），
   * 同时作为 applyPlan evidenceByItem 的键（按条目附加证据）。无导入来源时可省略。
   */
  itemId?: string;
  content: string;
  kind: MemoryKind;
  opHint?: OpHint;
  /** merge/keep_both 的目标记忆。 */
  targetMemoryId?: string;
  /** 目标修订快照：apply 时重检，目标推进后 E_TARGET_CHANGED。 */
  targetExpectedRevision?: string;
  reason?: string;
  /**
   * 随行证据提示。计划 op 本身不承载证据；证据在 applyPlan 时通过
   * evidenceByItem（按 itemId）落库，调用方用自己的 items 数组构造该映射。
   */
  evidence?: EvidenceInput[];
}

/** 被拒条目：只含原因与打码摘要，绝不回显正文/秘密原文。 */
export interface RejectedItem {
  itemId?: string;
  reason: string;
  findings: { kind: string; masked: string }[];
}

/** 与库中现有记忆精确重复的条目。 */
export interface DuplicateItem {
  itemId?: string;
  duplicateOfMemoryId: string;
}

export interface ProposeOutput {
  plan: PlanRecord;
  planHash: string;
  /** 建立的操作数（= plan.itemCount）。 */
  accepted: number;
  rejected: RejectedItem[];
  duplicates: DuplicateItem[];
}

export interface ProposePlanInput {
  scopeId: string;
  items: ProposedItem[];
  sourceArchiveIds?: string[];
  proposedBy: string;
  scan: (text: string) => SecretScanResult;
}

export function proposePlan(store: CairnStore, input: ProposePlanInput): ProposeOutput {
  const rejected: RejectedItem[] = [];
  const duplicates: DuplicateItem[] = [];
  const ops: PlanOpInput[] = [];
  /** 批内已占用正文哈希 → 保留它的条目 id（用于告诉调用方"重复到哪条去了"）。 */
  const batchHashes = new Map<string, string | null>();

  for (const item of input.items) {
    // 1. 逐项确定性校验：逐项拒绝（不抛错），全部无 op 时才抛 E_PLAN_INVALID
    if (typeof item.content !== 'string' || item.content.trim().length === 0) {
      rejected.push({ itemId: item.itemId, reason: 'content 不能为空', findings: [] });
      continue;
    }
    if (item.content.length > MAX_ITEM_CONTENT_LENGTH) {
      rejected.push({ itemId: item.itemId, reason: `content 超过 ${MAX_ITEM_CONTENT_LENGTH} 字符上限`, findings: [] });
      continue;
    }
    if (!(MEMORY_KINDS as readonly string[]).includes(item.kind)) {
      rejected.push({ itemId: item.itemId, reason: `kind 非法: ${String(item.kind)}`, findings: [] });
      continue;
    }
    if (item.kind === 'instruction') {
      rejected.push({ itemId: item.itemId, reason: 'instruction 只能通过用户显式写入创建，不能进入候选计划', findings: [] });
      continue;
    }
    if (item.opHint != null && !(OP_HINTS as readonly string[]).includes(item.opHint)) {
      rejected.push({ itemId: item.itemId, reason: `opHint 非法: ${String(item.opHint)}`, findings: [] });
      continue;
    }
    // plan_operation.item_id 外键 REFERENCES import_item(id)：
    // 提前确定性校验，避免 createPlan 落库时抛原始 SQLITE 错误
    if (item.itemId != null) {
      try {
        store.archives.requireItem(item.itemId);
      } catch {
        rejected.push({ itemId: item.itemId, reason: 'itemId 不存在于 import_item，不能绑定到计划操作', findings: [] });
        continue;
      }
    }

    // 2. 秘密/注入扫描：不干净 → 整项拒绝；findings 只保留 kind 与 masked
    const scanResult = input.scan(item.content);
    if (!scanResult.clean) {
      const hasSecretFinding = scanResult.findings.length > 0;
      rejected.push({
        itemId: item.itemId,
        reason: hasSecretFinding ? 'content 检测到疑似秘密' : 'content 检测到疑似提示注入指令',
        findings: scanResult.findings.map((f) => ({ kind: f.kind, masked: f.masked })),
      });
      continue;
    }

    // 3. 精确去重：skip 不承载正文、不建记忆，不参与去重；
    //    其余条目与库中现有记忆比对，再与批内更早条目比对
    if (item.opHint !== 'skip') {
      const hash = contentHash(item.content);
      // 与写入路径共用同一判定（governance/dedup）：只认 active/candidate。
      // 若用 findByContentHash，会把 archived 也算成重复，导致"归档后重新导入永远无法晋升"。
      const existing = findDuplicate(store.db, input.scopeId, item.content);
      if (existing) {
        duplicates.push({ itemId: item.itemId, duplicateOfMemoryId: existing.memoryId });
        continue;
      }
      if (batchHashes.has(hash)) {
        const keep = batchHashes.get(hash) ?? null;
        rejected.push({
          itemId: item.itemId,
          // 前缀机器可读（调用方据此把证据并到保留项），后缀给人看。
          reason: `repeatOf:${keep ?? '?'} 与同批更早条目内容重复`,
          findings: [],
        });
        continue;
      }
    }

    // 4. opHint 映射
    if (item.opHint === 'skip') {
      // skip op 只记录决策与原因，不携带正文（减少计划中的秘密暴露面）
      ops.push({ opType: 'skip', itemId: item.itemId ?? null, reason: item.reason ?? null });
      continue;
    }
    batchHashes.set(contentHash(item.content), item.itemId ?? null);
    const common = {
      itemId: item.itemId ?? null,
      content: item.content,
      kind: item.kind,
      reason: item.reason ?? null,
    };
    if ((item.opHint === 'merge' || item.opHint === 'keep_both') && item.targetMemoryId) {
      ops.push({
        opType: item.opHint,
        targetMemoryId: item.targetMemoryId,
        targetExpectedRevision: item.targetExpectedRevision ?? null,
        ...common,
      });
    } else {
      // 其余（含带 target 但未声明 merge/keep_both 的）一律 add
      ops.push({ opType: 'add', ...common });
    }
  }

  // 5. 空计划拒绝（store.plans.createPlan 亦有兜底）
  if (ops.length === 0) {
    throw err('E_PLAN_INVALID', '所有候选均被拒绝或去重，计划为空', {
      itemCount: input.items.length,
      rejectedCount: rejected.length,
      duplicatesCount: duplicates.length,
    });
  }

  // 6. 落库为 awaiting_approval 计划（plan_hash 基于规范化操作列表）
  const { plan, planHash } = store.plans.createPlan({
    scopeId: input.scopeId,
    sourceArchiveIds: input.sourceArchiveIds,
    ops,
    proposedBy: input.proposedBy,
    keyPrefix: 'governance',
  });

  // 7. 审计：只记计数与 id，不含正文
  store.audit.record('plan', 'proposed', { type: 'plan', id: plan.id }, {
    itemCount: ops.length,
    rejected: rejected.length,
    duplicates: duplicates.length,
  });

  return { plan, planHash, accepted: ops.length, rejected, duplicates };
}
