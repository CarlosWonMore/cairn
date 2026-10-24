import { CairnDb } from './db.js';
import { err } from '../core/errors.js';
import { uuidv7 } from '../core/ids.js';
import { nowIso, isoPlusMs } from '../core/time.js';
import { sha256Canonical } from '../core/hash.js';
import { MemoryKind, Sensitivity } from '../core/types.js';
import { WriteGuardMixin } from './write-guard.js';

/**
 * 计划与审批仓储（任务 3.1/3.2）。
 * plan_hash 基于【规范化】计划内容（操作列表 + 目标修订 + 作用域 + 来源），
 * 字段顺序、空白、来源数组顺序变化不得影响哈希；任何内容变化必然改变哈希。
 * 审批一次性、有有效期；plan_hash 变化由触发器自动撤销在途审批。
 */

export type PlanOpType = 'add' | 'merge' | 'keep_both' | 'skip';
export type PlanStatus = 'draft' | 'awaiting_approval' | 'approved' | 'applied' | 'expired' | 'invalidated' | 'rejected';

export interface PlanOpInput {
  opType: PlanOpType;
  /** merge/keep_both 的目标记忆。 */
  targetMemoryId?: string | null;
  /** 目标修订快照：应用时重检，目标推进后拒绝（E_TARGET_CHANGED）。 */
  targetExpectedRevision?: string | null;
  itemId?: string | null;
  content?: string | null;
  scopeId?: string | null;
  kind?: MemoryKind | null;
  sensitivity?: Sensitivity | null;
  reason?: string | null;
  mergedFrom?: string[];
}

export interface PlanOpRecord {
  id: string;
  planId: string;
  opIndex: number;
  opType: PlanOpType;
  targetMemoryId: string | null;
  targetExpectedRevision: string | null;
  itemId: string | null;
  content: string | null;
  contentHash: string | null;
  scopeId: string | null;
  kind: MemoryKind | null;
  reason: string | null;
  mergedFrom: string[];
  idempotencyKey: string;
  status: 'pending' | 'applied' | 'skipped' | 'failed';
  appliedAt: string | null;
  error: string | null;
}

export interface PlanRecord {
  id: string;
  planHash: string;
  scopeId: string;
  status: PlanStatus;
  sourceArchiveIds: string[];
  itemCount: number;
  proposedBy: string;
  modelProvider: string | null;
  createdAt: string;
  expiresAt: string;
  appliedAt: string | null;
}

export interface ApprovalRecord {
  id: string;
  planId: string;
  planHash: string;
  approvedBy: 'user' | 'local_cli' | 'mcp_ui';
  channel: string;
  approvedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  maxUses: number;
  uses: number;
}

export interface CanonicalPlanOp {
  op_index: number;
  op_type: PlanOpType;
  target_memory_id: string | null;
  target_expected_revision: string | null;
  item_id: string | null;
  content_hash: string | null;
  scope_id: string | null;
  kind: MemoryKind | null;
  merged_from: string[];
}

export interface CanonicalPlan {
  v: 1;
  scope_id: string;
  source_archive_ids: string[];
  ops: CanonicalPlanOp[];
}

/** 规范化计划：内容进哈希的一律是哈希/ID/索引，正文不直接参与（稳定性+防篡改）。 */
export function canonicalizePlan(input: {
  scopeId: string;
  sourceArchiveIds: string[];
  ops: PlanOpInput[];
  hashContent: (content: string) => string;
}): CanonicalPlan {
  const ops: CanonicalPlanOp[] = [...input.ops]
    .map((op, i) => ({
      op: op,
      i,
    }))
    .sort((a, b) => {
      // 确定性排序：先按内容哈希（add/keep_both），再按目标 ID，最后原序号
      const ah = a.op.content ?? '';
      const bh = b.op.content ?? '';
      const ac = ah ? input.hashContent(ah) : (a.op.targetMemoryId ?? `~${a.i}`);
      const bc = bh ? input.hashContent(bh) : (b.op.targetMemoryId ?? `~${b.i}`);
      if (ac !== bc) return ac < bc ? -1 : 1;
      return a.i - b.i;
    })
    .map(({ op, i }, sortedIdx) => ({
      op_index: sortedIdx,
      op_type: op.opType,
      target_memory_id: op.targetMemoryId ?? null,
      target_expected_revision: op.targetExpectedRevision ?? null,
      item_id: op.itemId ?? null,
      content_hash: op.content ? input.hashContent(op.content) : null,
      scope_id: op.scopeId ?? null,
      kind: op.kind ?? null,
      merged_from: [...(op.mergedFrom ?? [])].sort(),
    }));
  return {
    v: 1,
    scope_id: input.scopeId,
    source_archive_ids: [...input.sourceArchiveIds].sort(),
    ops,
  };
}

export class PlanRepository extends WriteGuardMixin {
  constructor(private readonly db: CairnDb) {
    super();
  }

  /** 创建计划（awaiting_approval）：ops 落库并计算 plan_hash。 */
  createPlan(input: {
    scopeId: string;
    sourceArchiveIds?: string[];
    ops: PlanOpInput[];
    proposedBy: string;
    modelProvider?: string | null;
    ttlMs?: number;
    keyPrefix?: string;
  }): { plan: PlanRecord; planHash: string } {
    this.checkWritable();
    if (input.ops.length === 0) throw err('E_PLAN_INVALID', '计划不能为空');
    const canonical = canonicalizePlan({
      scopeId: input.scopeId,
      sourceArchiveIds: input.sourceArchiveIds ?? [],
      ops: input.ops,
      hashContent: (c) => sha256Canonical({ content: c }),
    });
    const planHash = sha256Canonical(canonical);
    const planId = uuidv7();
    const at = nowIso();
    const ttl = input.ttlMs ?? 24 * 60 * 60 * 1000;
    this.db.transaction(() => {
      this.db.run(
        `INSERT INTO onboarding_plan (id, plan_hash, scope_id, status, source_archive_ids, item_count,
           proposed_by, model_provider, created_at, expires_at)
         VALUES (?, ?, ?, 'awaiting_approval', ?, ?, ?, ?, ?, ?)`,
        planId,
        planHash,
        input.scopeId,
        JSON.stringify([...(input.sourceArchiveIds ?? [])].sort()),
        input.ops.length,
        input.proposedBy,
        input.modelProvider ?? null,
        at,
        isoPlusMs(at, ttl),
      );
      input.ops.forEach((op, i) => {
        const opId = uuidv7();
        const key = `${input.keyPrefix ?? 'plan'}:${planId}:${i}:${sha256Canonical({
          t: op.opType,
          m: op.targetMemoryId ?? null,
          c: op.content ? sha256Canonical({ content: op.content }) : null,
          it: op.itemId ?? null,
        })}`;
        this.db.run(
          `INSERT INTO plan_operation (id, plan_id, op_index, op_type, target_memory_id, target_expected_revision,
             item_id, content, content_hash, scope_id, kind, reason, merged_from, idempotency_key)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          opId,
          planId,
          i,
          op.opType,
          op.targetMemoryId ?? null,
          op.targetExpectedRevision ?? null,
          op.itemId ?? null,
          op.content ?? null,
          op.content ? sha256Canonical({ content: op.content }) : null,
          op.scopeId ?? null,
          op.kind ?? null,
          op.reason ?? null,
          JSON.stringify([...(op.mergedFrom ?? [])].sort()),
          key,
        );
      });
    });
    return { plan: this.requireById(planId), planHash };
  }

  requireById(id: string): PlanRecord {
    const row = this.db.get('SELECT * FROM onboarding_plan WHERE id = ?', id);
    if (!row) throw err('E_NOT_FOUND', `计划不存在: ${id}`);
    return mapPlan(row);
  }

  findById(id: string): PlanRecord | null {
    const row = this.db.get('SELECT * FROM onboarding_plan WHERE id = ?', id);
    return row ? mapPlan(row) : null;
  }

  ops(planId: string): PlanOpRecord[] {
    return this.db.all('SELECT * FROM plan_operation WHERE plan_id = ? ORDER BY op_index', planId).map(mapOp);
  }

  requireOp(planId: string, opIndex: number): PlanOpRecord {
    const row = this.db.get('SELECT * FROM plan_operation WHERE plan_id = ? AND op_index = ?', planId, opIndex);
    if (!row) throw err('E_NOT_FOUND', `计划操作不存在: ${planId}#${opIndex}`);
    return mapOp(row);
  }

  markOpApplied(opId: string): void {
    this.db.run("UPDATE plan_operation SET status = 'applied', applied_at = ? WHERE id = ?", nowIso(), opId);
  }

  markOpSkipped(opId: string): void {
    this.db.run("UPDATE plan_operation SET status = 'skipped' WHERE id = ?", opId);
  }

  markOpFailed(opId: string, error: string): void {
    this.db.run("UPDATE plan_operation SET status = 'failed', error = ? WHERE id = ?", error, opId);
  }

  setStatus(id: string, status: PlanStatus): void {
    const sets = status === 'applied' ? ", applied_at = '" + nowIso() + "'" : '';
    this.db.run(`UPDATE onboarding_plan SET status = ?${sets} WHERE id = ?`, status, id);
  }

  /** 过期清扫：返回被标记过期的计划 id。 */
  expireStale(now: string = nowIso()): string[] {
    const rows = this.db.all(
      "SELECT id FROM onboarding_plan WHERE status IN ('awaiting_approval','draft') AND expires_at <= ?",
      now,
    );
    for (const r of rows) this.db.run("UPDATE onboarding_plan SET status = 'expired' WHERE id = ?", r.id);
    return rows.map((r) => r.id as string);
  }

  // -------------------------------------------------------------------------
  // 审批（任务 3.2）：本地可信通道签发；MCP 请求里的 user_confirmed 不被信任
  // -------------------------------------------------------------------------

  issueApproval(input: {
    planId: string;
    channel: string;
    approvedBy?: 'user' | 'local_cli' | 'mcp_ui';
    ttlMs?: number;
    maxUses?: number;
  }): { approval: ApprovalRecord } {
    this.checkWritable();
    const plan = this.requireById(input.planId);
    if (plan.status !== 'awaiting_approval') {
      throw err('E_APPROVAL_INVALID', `计划状态为 ${plan.status}，不能签发审批`, { planId: plan.id });
    }
    const live = this.liveApproval(plan.id);
    if (live) throw err('E_APPROVAL_INVALID', '该计划已有在途审批；请使用现有 approval_id 或等待其过期', { planId: plan.id });
    const at = nowIso();
    const id = `apr_${uuidv7()}`;
    this.db.run(
      `INSERT INTO approval (id, plan_id, plan_hash, approved_by, channel, approved_at, expires_at, max_uses)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      plan.id,
      plan.planHash,
      input.approvedBy ?? 'local_cli',
      input.channel,
      at,
      isoPlusMs(at, input.ttlMs ?? 30 * 60 * 1000),
      input.maxUses ?? 1,
    );
    this.db.run("UPDATE onboarding_plan SET status = 'approved' WHERE id = ?", plan.id);
    return { approval: this.requireApproval(id) };
  }

  liveApproval(planId: string): ApprovalRecord | null {
    const row = this.db.get('SELECT * FROM approval WHERE plan_id = ? AND revoked_at IS NULL', planId);
    return row ? mapApproval(row) : null;
  }

  requireApproval(id: string): ApprovalRecord {
    const row = this.db.get('SELECT * FROM approval WHERE id = ?', id);
    if (!row) throw err('E_APPROVAL_INVALID', `审批不存在: ${id}`);
    return mapApproval(row);
  }

  /**
   * 消费一次性审批：校验存在、绑定计划、哈希一致、未撤销、未过期、未用尽。
   * 任一失败抛对应 E_APPROVAL_*，并保持 uses 不变（失败不消耗）。
   */
  consumeApproval(approvalId: string, planId: string, planHash: string, now: string = nowIso()): ApprovalRecord {
    this.checkWritable();
    const apr = this.requireApproval(approvalId);
    if (apr.planId !== planId) {
      throw err('E_APPROVAL_INVALID', '审批与计划不匹配', { approvalId, expectedPlan: apr.planId });
    }
    if (apr.planHash !== planHash) {
      throw err('E_PLAN_TAMPERED', '计划哈希与审批不一致：计划在批准后被修改', { approvalId });
    }
    if (apr.revokedAt) throw err('E_APPROVAL_INVALID', '审批已被撤销');
    if (apr.expiresAt <= now) throw err('E_APPROVAL_EXPIRED', `审批已于 ${apr.expiresAt} 过期`);
    if (apr.uses >= apr.maxUses) throw err('E_APPROVAL_REPLAY', '审批已使用（一次性凭证不可重放）');
    this.db.run('UPDATE approval SET uses = uses + 1 WHERE id = ?', approvalId);
    return this.requireApproval(approvalId);
  }

  revokeApproval(approvalId: string): void {
    this.db.run("UPDATE approval SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL", nowIso(), approvalId);
  }
}

function mapPlan(r: Record<string, unknown>): PlanRecord {
  let archives: string[] = [];
  try {
    const v = JSON.parse((r.source_archive_ids as string) ?? '[]') as unknown;
    if (Array.isArray(v)) archives = v.map(String);
  } catch {
    archives = [];
  }
  return {
    id: r.id as string,
    planHash: r.plan_hash as string,
    scopeId: r.scope_id as string,
    status: r.status as PlanStatus,
    sourceArchiveIds: archives,
    itemCount: Number(r.item_count),
    proposedBy: r.proposed_by as string,
    modelProvider: (r.model_provider as string | null) ?? null,
    createdAt: r.created_at as string,
    expiresAt: r.expires_at as string,
    appliedAt: (r.applied_at as string | null) ?? null,
  };
}

function mapOp(r: Record<string, unknown>): PlanOpRecord {
  let mergedFrom: string[] = [];
  try {
    const v = JSON.parse((r.merged_from as string) ?? '[]') as unknown;
    if (Array.isArray(v)) mergedFrom = v.map(String);
  } catch {
    mergedFrom = [];
  }
  return {
    id: r.id as string,
    planId: r.plan_id as string,
    opIndex: Number(r.op_index),
    opType: r.op_type as PlanOpType,
    targetMemoryId: (r.target_memory_id as string | null) ?? null,
    targetExpectedRevision: (r.target_expected_revision as string | null) ?? null,
    itemId: (r.item_id as string | null) ?? null,
    content: (r.content as string | null) ?? null,
    contentHash: (r.content_hash as string | null) ?? null,
    scopeId: (r.scope_id as string | null) ?? null,
    kind: (r.kind as MemoryKind | null) ?? null,
    reason: (r.reason as string | null) ?? null,
    mergedFrom,
    idempotencyKey: r.idempotency_key as string,
    status: r.status as PlanOpRecord['status'],
    appliedAt: (r.applied_at as string | null) ?? null,
    error: (r.error as string | null) ?? null,
  };
}

function mapApproval(r: Record<string, unknown>): ApprovalRecord {
  return {
    id: r.id as string,
    planId: r.plan_id as string,
    planHash: r.plan_hash as string,
    approvedBy: r.approved_by as ApprovalRecord['approvedBy'],
    channel: r.channel as string,
    approvedAt: r.approved_at as string,
    expiresAt: r.expires_at as string,
    revokedAt: (r.revoked_at as string | null) ?? null,
    maxUses: Number(r.max_uses),
    uses: Number(r.uses),
  };
}
