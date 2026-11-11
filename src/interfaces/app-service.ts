import {
  openStore,
  CairnStore,
} from '../store/index.js';
import { ScopeRow } from '../core/scope.js';
import { schemaVersion } from '../store/migrate.js';
import {
  MemoryRecord,
  MemoryKind,
  Authority,
  RevisionRecord,
  EvidenceRecord,
  EvidenceInput,
  MEMORY_KINDS,
} from '../core/types.js';
import { err, ExitCode } from '../core/errors.js';
import { readAuditConfig, AuditConfig, AuditDetail } from '../store/audit.js';
import { contentHash } from '../core/hash.js';
import { scopeAllowsUpstream, scopeAllowsRead } from '../core/scope.js';
import { searchMemories, SearchInput, SearchOutput } from '../retrieval/search.js';
import { exportData, ExportInput, ExportOutput } from '../retrieval/export.js';
import { registerDefaultHandlers, runOnce, RunOnceSummary } from '../jobs/worker.js';
import { getRemoteStore } from '../jobs/remote.js';
import { scanText } from '../core/secrets.js';
import { loadVaultConfig } from '../sync/vault.js';
import { loadKeys, exportRecoveryMaterial, importRecoveryMaterial, saveKeys } from '../sync/cryptoutil.js';
import { nowIso } from '../core/time.js';
import { syncContext, initRemote, syncPush, syncPull, registerSyncWorker, buildRemoteStore, SyncContext, PERSONAL_SPACE_KEY } from '../sync/orchestrate.js';
import { findUpstreamGap, backfillUpstream, BackfillReport } from '../sync/backfill.js';
import { importSnapshot, ImportOutcome } from '../onboarding/import.js';
import {
  addAnnotation as storeAnnotation,
  addAnnotationsBatch as storeAnnotationsBatch,
  readAnnotations as storeReadAnnotations,
  resolveAnnotation as storeResolveAnnotation,
  countOpenAnnotations,
  type AnnotationQuery,
  type AnnotationRecord,
  type AnnotationView,
  type BatchAnnotateResult,
} from './console/annotations.js';
import { findDuplicate } from '../governance/dedup.js';
import { decideWrite, describeJudgement, Judgement, WriteAction } from '../onboarding/judgement.js';
import { assignBatch, batchProgress, nextBatchChunk, markItemPromoted, listSkippedItems, promotedPredicate, BatchProgress, BatchChunkItem } from '../onboarding/batches.js';
import type { SkippedItem } from '../onboarding/batches.js';
import { proposePlan, ProposedItem } from '../governance/propose.js';
import { applyPlan, ApplyReport } from '../governance/apply.js';
import { discoverSources, SourceCandidate } from '../onboarding/discover.js';
import { PlanRecord } from '../store/plans.js';
import { ImportSourceKind } from '../store/archives.js';

/**
 * CLI 与 MCP 共用的应用服务（design D1）：记忆规则只在这里实现一次。
 * 秘密扫描在写入前执行；作用域由 store 层策略统一判定；
 * 上行任务与本地写入同事务边界，失败只留下可重试状态。
 */

export interface ScopeSelection {
  scopeId?: string;
  preset?: 'personal-global' | 'project-global' | 'device-local' | 'project-device' | 'agent-private' | 'session-ephemeral';
  projectId?: string;
  projectName?: string;
  agentId?: string;
  ttlDays?: number;
}

export interface AddMemoryInput {
  content: string;
  kind?: MemoryKind;
  authority?: Authority;
  sensitivity?: 'normal' | 'sensitive';
  expiresAt?: string | null;
  sourceAgent?: string | null;
  sourceSessionId?: string | null;
  evidence?: EvidenceInput[];
  scope?: ScopeSelection;
}

/**
 * 写入结果。`action` 说明实际发生了什么——调用方不该靠"有没有拿到 id"来猜
 * 自己是新建了一条、并入了旧的一条、还是被判断拦下了。
 */
export interface AddMemoryOutcome {
  action: WriteAction;
  basis: string;
  /** `skip` 为 null；其余为实际落库或被并入/晋升的记忆。 */
  memory: MemoryRecord | null;
  /** `merge` / `promote_candidate` 指向命中的既有记忆。 */
  duplicateOf: string | null;
}

export interface CallerContext {
  deviceId: string;
  agentId: string;
  /** user = 本地 CLI（数据主权者，全库可见）；agent = MCP 调用方（受作用域约束）。 */
  channel: 'user' | 'agent';
}

export interface MemoryDetail {
  memory: MemoryRecord;
  revisions: RevisionRecord[];
  evidence: EvidenceRecord[];
  relations: { id: string; fromMemoryId: string; toMemoryId: string; relationType: string }[];
  openConflicts: { id: string; revisionAId: string; revisionBId: string; detectedAt: string }[];
  tombstone: { reason: string | null; forgottenBy: string; forgottenAt: string } | null;
  scope: ScopeRow;
}

export interface DoctorReport {
  ok: boolean;
  home: string;
  schemaVersion: number;
  device: { id: string; enrollment: string; cloned: boolean };
  db: { integrity: string; foreignKeyViolations: number };
  fts: { ok: boolean; note: string };
  counts: {
    memoryByStatus: Record<string, number>;
    importArchives: number;
    importItems: { total: number; clean: number; blocked: number };
    plansByStatus: Record<string, number>;
    outboxByStatus: Record<string, number>;
    openConflicts: number;
    /** 作用域允许上行但没有过任何 sync_upstream 任务的活动记忆数（design D4）。 */
    upstreamGap: number;
  };
  remote: 'not_configured' | 'configured_untested' | 'verified';
  remoteProvider?: string;
  model: 'not_configured';
  problems: string[];
  notes: string[];
}

export class AppService {
  private constructor(public readonly store: CairnStore) {
    // 操作审计配置：打开时读一次（env > config.json > 默认）；改配置重启生效
    this.auditCfg = readAuditConfig(store.paths.home);
    registerDefaultHandlers();
    // vault 已配置时，用真实上行 handler 覆盖诚实失败 handler
    if (loadVaultConfig(store.paths.dataDir)) {
      try {
        const ctx = syncContext(store);
        if (ctx) registerSyncWorker(store, ctx.remote, ctx.vault);
      } catch {
        // 环境变量缺失等：保持诚实失败 handler，doctor 会如实报告
      }
    }
  }

  private readonly auditCfg: AuditConfig;

  /**
   * 操作留痕（add-operation-audit）：读取操作记 `operation` 类目。
   * 写入操作沿用既有 `memory` 类目审计，不在这里重复记录。
   * FAIL-OPEN：审计写入失败只进 stderr，绝不影响业务结果；受 `audit.operations` 开关控制。
   * 摘要纪律：detail 由调用点给白名单计数字段，查询原文/参数/正文永不入审计。
   */
  private recordOperation(action: string, subject: { type?: string; id?: string } | undefined, detail: AuditDetail): void {
    if (!this.auditCfg.operations) return;
    try {
      this.store.audit.record('operation', action, subject, detail);
    } catch (e) {
      console.error(`[cairn] 操作审计写入失败（不影响业务）: ${(e as Error).message}`);
    }
  }

  /** 审计过滤查询（只读；MCP memory_audit 与 CLI cairn audit list 共用）。 */
  auditList(filter: { category?: string; action?: string; since?: string; limit?: number } = {}) {
    return this.store.audit.list(filter);
  }

  static open(home?: string): AppService {
    return new AppService(openStore(home ? { home } : {}));
  }

  close(): void {
    this.store.close();
  }

  get caller(): CallerContext {
    return {
      deviceId: this.store.identity.deviceId,
      agentId: process.env['CAIRN_AGENT_ID'] ?? 'cli',
      channel: process.env['CAIRN_CHANNEL'] === 'agent' ? 'agent' : 'user',
    };
  }

  // -------------------------------------------------------------------------
  // 作用域解析
  // -------------------------------------------------------------------------

  resolveScope(sel: ScopeSelection | undefined): ScopeRow {
    const store = this.store;
    if (sel?.scopeId) {
      return store.scopes.requireById(sel.scopeId);
    }
    const preset = sel?.preset ?? 'personal-global';
    const overrides = {
      ...(sel?.ttlDays != null ? { ttlDays: sel.ttlDays } : {}),
    };
    switch (preset) {
      case 'personal-global':
        return store.scopes.resolvePreset('personal-global', { overrides });
      case 'project-global': {
        if (!sel?.projectId) throw err('E_VALIDATION', 'project-global 需要 --project');
        return store.scopes.resolvePreset('project-global', {
          projectId: sel.projectId,
          projectName: sel.projectName ?? sel.projectId,
          overrides,
        });
      }
      case 'project-device': {
        if (!sel?.projectId) throw err('E_VALIDATION', 'project-device 需要 --project');
        return store.scopes.resolvePreset('project-device', {
          projectId: sel.projectId,
          projectName: sel.projectName ?? sel.projectId,
          deviceId: this.caller.deviceId,
        });
      }
      case 'device-local':
        return store.scopes.resolvePreset('device-local', { deviceId: this.caller.deviceId });
      case 'agent-private': {
        if (!sel?.agentId) throw err('E_VALIDATION', 'agent-private 需要 --agent');
        return store.scopes.resolvePreset('agent-private', { agentId: sel.agentId });
      }
      case 'session-ephemeral':
        return store.scopes.resolvePreset('session-ephemeral', { ttlDays: sel?.ttlDays ?? 7 });
      default: {
        const exhaustive: never = preset;
        throw err('E_VALIDATION', `未知预设 ${String(exhaustive)}`);
      }
    }
  }

  // -------------------------------------------------------------------------
  // 显式记忆生命周期
  // -------------------------------------------------------------------------

  /**
   * 显式写入。判断（`judgement`）是建议不是授权：它只能影响"这条值不值得记"，
   * 敏感度与作用域永远取自写入参数，不取自判断（design D10）。
   *
   * 查重在这里做，因为写入路径的重复不是判断出来的、是对比出来的。
   */
  addMemory(input: AddMemoryInput, opts: { judgement?: Judgement | null } = {}): AddMemoryOutcome {
    const store = this.store;
    store.assertWritable();
    const authority = input.authority ?? 'user_explicit';
    const kind = input.kind ?? 'fact';
    if (!(MEMORY_KINDS as readonly string[]).includes(kind)) {
      throw err('E_VALIDATION', `kind 非法: ${String(kind)}`);
    }
    if (input.content.trim().length === 0) throw err('E_VALIDATION', 'content 不能为空');
    // 秘密扫描：显式写入同样阻断（构想 §12.3），错误只含 masked 摘要
    const scan = scanText(input.content);
    if (!scan.clean) {
      throw scanError(scan);
    }
    const scope = this.resolveScope(input.scope);
    // 敏感度只由写入参数决定：判断里没有这个字段，也无权改它。
    const sensitivity = input.sensitivity ?? 'normal';
    if (sensitivity === 'sensitive' && scope.syncPolicy !== 'local_only') {
      throw err('E_VALIDATION', 'sensitive 记忆必须使用 local_only 作用域（device-local / project-device / 自定义 local_only）');
    }
    const ctx = this.caller;
    const createdBy = ctx.agentId === 'cli' ? 'cli' : `mcp:${ctx.agentId}`;
    const sourceAgent = input.sourceAgent ?? ctx.agentId;

    const judgement = opts.judgement ?? null;
    const duplicate = findDuplicate(store.db, scope.id, input.content);
    const decision = decideWrite({ judgement, duplicate });
    const auditDetail = {
      basis: decision.basis,
      judgement: judgement ? describeJudgement(judgement) : null,
      rationale: judgement?.rationale ?? null,
      duplicateOf: decision.targetMemoryId,
      scopeId: scope.id,
    };

    if (decision.action === 'skip') {
      // 高置信的"不值得记"：不写库，但必须留痕，否则这条路是黑洞。
      store.audit.record('memory', 'write_skipped', undefined, auditDetail);
      return { action: 'skip', basis: decision.basis, memory: null, duplicateOf: null };
    }

    if (decision.action === 'merge') {
      const target = store.memories.require(decision.targetMemoryId!);
      if (target.scopeId !== scope.id) {
        throw err('E_VALIDATION', '并入目标必须与写入作用域相同');
      }
      // 只追加证据与来源，不新建记忆（spec memory-governance）。
      const additions: EvidenceInput[] = input.evidence?.length
        ? input.evidence
        : [{ evidenceKind: 'user_statement', sourceAgent, trustLevel: 'user_supplied' }];
      for (const ev of additions) {
        store.memories.addEvidence(target.id, target.currentRevisionId, ev);
      }
      store.audit.record('memory', 'write_merged', { type: 'memory', id: target.id }, auditDetail);
      enqueueMemoryUpstream(store, target.id, target.scopeId, 'memory_upsert', `memory:${target.id}`);
      return { action: 'merge', basis: decision.basis, memory: store.memories.require(target.id), duplicateOf: target.id };
    }

    if (decision.action === 'promote_candidate') {
      const candidateId = decision.targetMemoryId!;
      // 本次写入自己就不具备晋升权威时，不能把它变成 active——只把证据并回候选。
      if (authority === 'agent_inferred' || authority === 'imported_unverified') {
        const cand = store.memories.require(candidateId);
        for (const ev of input.evidence ?? []) {
          store.memories.addEvidence(cand.id, cand.currentRevisionId, ev);
        }
        store.audit.record('memory', 'write_merged_candidate', { type: 'memory', id: cand.id }, auditDetail);
        return { action: 'candidate', basis: decision.basis, memory: cand, duplicateOf: cand.id };
      }
      const promoted = store.memories.promoteToActive(candidateId, authority, createdBy);
      for (const ev of input.evidence ?? []) {
        store.memories.addEvidence(promoted.id, promoted.currentRevisionId, ev);
      }
      // 与 promoteCandidate() 对齐：晋升即内容对外可见，补一条带修订标识的上行任务。
      enqueueMemoryUpstream(store, promoted.id, promoted.scopeId, 'memory_upsert', `memory:${promoted.id}:rev:${promoted.currentRevisionId ?? ''}`);
      store.audit.record('memory', 'write_promoted_candidate', { type: 'memory', id: promoted.id }, auditDetail);
      return { action: 'promote_candidate', basis: decision.basis, memory: promoted, duplicateOf: promoted.id };
    }

    // insert 与 candidate 都走新建：candidate 是低置信"不值得记"的可逆降级，不是丢弃。
    const memory = store.memories.add(
      {
        kind,
        content: input.content,
        scopeId: scope.id,
        authority: decision.action === 'candidate' ? 'agent_inferred' : authority,
        createdBy,
        sourceAgent,
        sourceSessionId: input.sourceSessionId ?? null,
        evidence: input.evidence,
        expiresAt: input.expiresAt ?? null,
        sensitivity,
      },
      ctx.deviceId,
    );
    if (scopeAllowsUpstream(scope)) {
      store.outbox.enqueue({
        jobType: 'sync_upstream',
        scopeId: scope.id,
        entityType: 'memory',
        entityId: memory.id,
        payload: { op: 'memory_upsert', memoryId: memory.id },
        idempotencyKey: `memory:${memory.id}`,
      });
    }
    const auditAction = decision.action === 'candidate' ? 'added_candidate' : 'added';
    store.audit.record('memory', auditAction, { type: 'memory', id: memory.id }, { ...auditDetail, kind, authority, sensitivity });
    return { action: decision.action, basis: decision.basis, memory, duplicateOf: null };
  }

  reviseMemory(id: string, newContent: string, opts: { reason?: string; expectedCurrentRevisionId?: string } = {}): { memory: MemoryRecord; revision: RevisionRecord } {
    const store = this.store;
    store.assertWritable();
    const mem = store.memories.require(id);
    const scan = scanText(newContent);
    if (!scan.clean) {
      throw err('E_SECRET_DETECTED', '更正内容疑似包含秘密，已阻断', {
        findings: scan.findings.map((f) => ({ kind: f.kind, masked: f.masked })),
      });
    }
    const scope = store.scopes.requireById(mem.scopeId);
    const ctx = this.caller;
    const out = store.memories.revise(
      id,
      newContent,
      { reason: opts.reason ?? '用户更正', author: ctx.agentId, expectedCurrentRevisionId: opts.expectedCurrentRevisionId },
      ctx.deviceId,
    );
    if (scopeAllowsUpstream(scope)) {
      store.outbox.enqueue({
        jobType: 'sync_upstream',
        scopeId: scope.id,
        entityType: 'memory',
        entityId: id,
        payload: { op: 'memory_upsert', memoryId: id },
        idempotencyKey: `memory:${id}:rev:${out.revision.id}`,
      });
    }
    store.audit.record('memory', 'revised', { type: 'memory', id }, { revisionId: out.revision.id });
    return out;
  }

  forgetMemory(id: string, reason: string | null): MemoryRecord {
    const store = this.store;
    store.assertWritable();
    const mem = store.memories.require(id);
    const out = store.memories.forget(id, reason, this.caller.agentId);
    const scope = store.scopes.requireById(mem.scopeId);
    if (scopeAllowsUpstream(scope)) {
      store.outbox.enqueue({
        jobType: 'sync_upstream',
        scopeId: scope.id,
        entityType: 'memory',
        entityId: id,
        payload: { op: 'memory_tombstone', memoryId: id },
        idempotencyKey: `memory:${id}:tombstone`,
      });
    }
    store.audit.record('memory', 'forgotten', { type: 'memory', id }, { reason: reason ?? null });
    return out;
  }

  archiveMemory(id: string): MemoryRecord {
    this.store.assertWritable();
    return this.store.memories.archive(id);
  }

  // -------------------------------------------------------------------------
  // 批注（OpenSpec: add-memory-annotations）
  //
  // 批注是派生数据，只落 console/annotations.json；这里的每个方法都刻意
  // 不触碰记忆正文 / 状态 / 修订链 / outbox（spec「逐条批注」）。
  // -------------------------------------------------------------------------

  annotateMemory(input: { memoryId: string; disposition: string; note?: string }): AnnotationRecord {
    return storeAnnotation(this.store, input);
  }

  annotateBatch(input: { memoryIds: string[]; disposition: string; note?: string }): BatchAnnotateResult {
    return storeAnnotationsBatch(this.store, input);
  }

  listAnnotations(query: AnnotationQuery = {}): AnnotationView[] {
    return storeReadAnnotations(this.store, query);
  }

  resolveAnnotation(input: { id: string; status: string; by?: string }): AnnotationRecord {
    return storeResolveAnnotation(this.store, { id: input.id, status: input.status, by: input.by ?? this.caller.agentId });
  }

  /** 待删清单：只读查询，永不执行删除（删除入口是 `cairn forget --pending`）。 */
  listPendingForget(): AnnotationView[] {
    return storeReadAnnotations(this.store, { disposition: 'pending_forget', status: 'open' });
  }

  /**
   * 候选晋升（add-candidate-promote-command）。
   *
   * 三件必须一起做的事：
   * 1. 权威记为 `user_confirmed`——用户**审阅并批准**了模型推断的内容，
   *    语义上既不是「用户亲口说的」（user_explicit），也不是「模型推断」（agent_inferred）；
   * 2. 可选迁移作用域（含带本机路径的内容落 device-local），与晋升同事务；
   * 3. **按新作用域重建 outbox**——旧作用域下的待同步任务若照发，
   *    会把记忆同步到错误的云端空间（design D2）。
   */
  promoteCandidate(
    id: string,
    opts: { scopePreset?: ScopeSelection['preset']; projectId?: string } = {},
  ): { memory: MemoryRecord; scope: ScopeRow; previousScopeId: string } {
    const store = this.store;
    store.assertWritable();
    const mem = store.memories.require(id);
    if (mem.status !== 'candidate') {
      throw err('E_CONFLICT_STATE', `只有候选可晋升，当前 ${mem.status}`);
    }
    const previousScopeId = mem.scopeId;

    let targetScopeId = mem.scopeId;
    if (opts.scopePreset !== undefined) {
      const sel: ScopeSelection = { preset: opts.scopePreset };
      if (opts.projectId !== undefined) sel.projectId = opts.projectId;
      targetScopeId = this.resolveScope(sel).id;
    }

    const out = store.memories.promoteToActive(id, 'user_confirmed', this.caller.agentId, {
      scopeId: targetScopeId,
    });
    const scope = store.scopes.requireById(out.scopeId);

    // outbox：旧作用域的任务必须作废（否则发到错空间），新作用域按新修订重新入队。
    store.db.run(
      "DELETE FROM outbox_job WHERE entity_type = 'memory' AND entity_id = ? AND status = 'pending'",
      id,
    );
    if (scopeAllowsUpstream(scope)) {
      store.outbox.enqueue({
        jobType: 'sync_upstream',
        scopeId: scope.id,
        entityType: 'memory',
        entityId: id,
        payload: { op: 'memory_upsert', memoryId: id },
        idempotencyKey: `memory:${id}:rev:${out.currentRevisionId ?? ''}`,
      });
    }

    store.audit.record('memory', 'promoted_candidate', { type: 'memory', id }, {
      fromScope: previousScopeId,
      toScope: out.scopeId,
      authority: out.authority,
      channel: 'cli',
      scopeChanged: previousScopeId !== out.scopeId,
    });
    return { memory: out, scope, previousScopeId };
  }

  /**
   * 作用域迁移（add-scope-migration）：active 记忆可改归属，与晋升刻意区分——
   * 不改 status / authority / 正文。同一事务内完成：迁移 scope_id、作废旧 pending
   * 上行任务、按目标作用域重新入队、迁出且曾同步过时排一条迁出通知任务。
   *
   * 安全阀（design D4）：冲突状态拒绝（状态不明确）；墓碑拒绝；缺 projectId 由
   * resolveScope 抛 E_VALIDATION（不静默降级）；user_explicit 需 force（减速带不是禁止）。
   */
  rescopeMemory(
    id: string,
    opts: {
      scopePreset: ScopeSelection['preset'];
      projectId?: string;
      projectName?: string;
      agentId?: string;
      ttlDays?: number;
      force?: boolean;
    },
  ): { memory: MemoryRecord; scope: ScopeRow; previousScopeId: string; willLoseSync: boolean; scopeExitEnqueued: boolean } {
    const store = this.store;
    store.assertWritable();
    const mem = store.memories.require(id);
    if (mem.status === 'conflicted') {
      throw err('E_CONFLICT_STATE', '记忆处于冲突队列中，先解决冲突再迁移');
    }
    if (mem.status === 'tombstoned') {
      throw err('E_CONFLICT_STATE', `墓碑没有作用域可迁移，当前 ${mem.status}`);
    }
    const previousScope = store.scopes.requireById(mem.scopeId);
    const sel: ScopeSelection = { preset: opts.scopePreset };
    if (opts.projectId !== undefined) sel.projectId = opts.projectId;
    if (opts.projectName !== undefined) sel.projectName = opts.projectName;
    if (opts.agentId !== undefined) sel.agentId = opts.agentId;
    if (opts.ttlDays !== undefined) sel.ttlDays = opts.ttlDays;
    const target = this.resolveScope(sel);
    if (target.id === previousScope.id) {
      // 原地迁移：无操作也不留审计（没有发生任何改变）
      return { memory: mem, scope: target, previousScopeId: mem.scopeId, willLoseSync: false, scopeExitEnqueued: false };
    }
    if (mem.authority === 'user_explicit' && opts.force !== true) {
      throw err('E_FORBIDDEN', '用户明确陈述（user_explicit）的记忆迁移会改变可见范围，需要 --force 显式确认');
    }
    const willLoseSync = scopeAllowsUpstream(previousScope) && !scopeAllowsUpstream(target);
    // 「曾同步过」= 该记忆在本空间链上推送过修订（sync_pushed 元数据存在）。
    // 只有这种情况对端才持有副本，迁出才需要通知；从未上行的记忆迁出无人需要知道。
    const wasPushed = store.db.get(
      'SELECT value FROM meta WHERE key = ?',
      `sync_pushed:${PERSONAL_SPACE_KEY}:${id}`,
    ) != null;

    const scopeExitEnqueued = store.db.transaction(() => {
      store.memories.migrateScope(id, target.id, this.caller.agentId);
      // outbox 重建：照抄 promoteCandidate——旧作用域下的待同步任务若照发，
      // 会把记忆同步到错误的云端空间（design D2）。
      store.db.run(
        "DELETE FROM outbox_job WHERE entity_type = 'memory' AND entity_id = ? AND status = 'pending'",
        id,
      );
      if (scopeAllowsUpstream(target)) {
        // 迁入可同步作用域：重新入队。若此前同步过，修订未变会被 push 的幂等检查
        // 跳过、对端永远收不到「重新持有」的信号——因此带 force 让 push 无条件重发
        // 一次修订快照（payload.reentry），对端据此解除「不再持有」标记。
        store.outbox.enqueue({
          jobType: 'sync_upstream',
          scopeId: target.id,
          entityType: 'memory',
          entityId: id,
          payload: { op: 'memory_upsert', memoryId: id, ...(wasPushed ? { force: true } : {}) },
          idempotencyKey: wasPushed ? `memory:${id}:re-entry:${Date.now()}` : `memory:${id}:rev:${mem.currentRevisionId ?? ''}`,
        });
        return false;
      }
      if (scopeAllowsUpstream(previousScope) && wasPushed) {
        // 迁出通知：独立 jobType（不是上行内容任务，spec 要求迁移不产生新的上行任务）。
        // 幂等键带时间戳：迁出→迁回→再迁出的每一轮都要各发一次通知，
        // 固定键会被已完成的历史任务挡住（enqueue 按键去重不分状态）。
        const enq = store.outbox.enqueue({
          jobType: 'sync_scope_exit',
          scopeId: target.id,
          entityType: 'memory',
          entityId: id,
          payload: { op: 'scope_exit', memoryId: id },
          idempotencyKey: `memory:${id}:scope-exit:${Date.now()}`,
        });
        return enq.enqueued;
      }
      return false;
    });

    store.audit.record('memory', 'scope_migrated', { type: 'memory', id }, {
      fromScope: previousScope.id,
      toScope: target.id,
      channel: 'cli',
      willLoseSync,
      scopeExitEnqueued,
      forced: opts.force === true,
    });
    return {
      memory: store.memories.require(id),
      scope: target,
      previousScopeId: previousScope.id,
      willLoseSync,
      scopeExitEnqueued,
    };
  }

  /** 待迁移清单：只读查询，永不执行迁移（执行入口是 `cairn rescope --pending`）。 */
  listPendingRescope(): AnnotationView[] {
    return storeReadAnnotations(this.store, { disposition: 'needs_rescope', status: 'open' });
  }

  /** 拒绝候选：转墓碑（不是物理删除），留审计理由；恢复需显式重做（design D4）。 */
  rejectCandidate(id: string, opts: { reason: string }): { memory: MemoryRecord } {
    const store = this.store;
    store.assertWritable();
    const mem = store.memories.require(id);
    if (mem.status !== 'candidate') {
      throw err('E_CONFLICT_STATE', `只有候选可拒绝，当前 ${mem.status}`);
    }
    const reason = opts.reason.trim();
    if (reason.length === 0) throw err('E_VALIDATION', '拒绝理由不能为空');
    const scan = scanText(reason);
    if (!scan.clean) {
      throw err('E_SECRET_DETECTED', '拒绝理由疑似包含秘密，已阻断', {
        findings: scan.findings.map((f) => ({ kind: f.kind, masked: f.masked })),
      });
    }
    const out = store.memories.forget(id, reason, this.caller.agentId);
    // 与 forgetMemory 同形：拒绝候选同样是墓碑语义，必须同样上行。
    enqueueMemoryUpstream(store, id, mem.scopeId, 'memory_tombstone', `memory:${id}:tombstone`);
    store.audit.record('memory', 'rejected_candidate', { type: 'memory', id }, {
      reason,
      channel: 'cli',
    });
    return { memory: out };
  }

  showMemory(id: string): MemoryDetail {
    const startedAt = Date.now();
    const store = this.store;
    const memory = store.memories.require(id);
    const scope = store.scopes.requireById(memory.scopeId);
    if (this.caller.channel === 'agent') {
      const query = {
        deviceId: this.caller.deviceId,
        agentId: this.caller.agentId,
        projectId: process.env['CAIRN_PROJECT_ID'] ?? null,
      };
      if (!scopeAllowsRead(scope, query)) {
        throw err('E_SCOPE_MISMATCH', '当前调用方无权读取该记忆详情（作用域不匹配）', { memoryId: id });
      }
    }
    this.recordOperation('memory_get', { type: 'memory', id }, { ms: Date.now() - startedAt });
    return {
      memory,
      revisions: store.memories.revisions(id),
      evidence: store.memories.evidence(id),
      relations: store.memories.relationsOf(id),
      openConflicts: store.conflicts.listOpen(id).map((c) => ({
        id: c.id,
        revisionAId: c.revisionAId,
        revisionBId: c.revisionBId,
        detectedAt: c.detectedAt,
      })),
      tombstone: store.memories.getTombstone(id),
      scope,
    };
  }

  /** MCP memory_propose：只生成候选，绝不静默成为高权威活动记忆（memory-governance spec）。 */
  proposeCandidate(input: { content: string; kind?: MemoryKind; evidence?: EvidenceInput[]; sourceSessionId?: string | null; importance?: number }): MemoryRecord {
    const store = this.store;
    store.assertWritable();
    const scan = scanText(input.content);
    if (!scan.clean) {
      throw scanError(scan);
    }
    const scope = this.resolveScope(undefined);
    const ctx = this.caller;
    const m = store.memories.add(
      {
        kind: input.kind ?? 'fact',
        content: input.content,
        scopeId: scope.id,
        authority: 'agent_inferred',
        createdBy: `mcp:${ctx.agentId}`,
        sourceAgent: ctx.agentId,
        sourceSessionId: input.sourceSessionId ?? null,
        evidence: input.evidence,
        importance: input.importance ?? null,
      },
      ctx.deviceId,
    );
    store.audit.record('memory', 'candidate_proposed', { type: 'memory', id: m.id }, {
      kind: m.kind,
      importance: m.importance,
    });
    return m;
  }

  // -------------------------------------------------------------------------
  // 检索 / 导出
  // -------------------------------------------------------------------------

  /**
   * 检索 + 使用信号（add-memory-importance-and-usage-signal）。
   *
   * `incrementUsage` 缺省 true（显式检索），插件自动召回传 false。
   * 只对**实际返回**的命中小心写入——被过滤掉的候选不算「被看到」。
   *
   * 写痕迹失败不得影响检索结果：审计与信号都是旁路，业务不能因它们挂掉。
   */
  search(input: SearchInput, opts: { incrementUsage?: boolean } = {}): SearchOutput {
    const startedAt = Date.now();
    const r = searchMemories(this.store, input);
    const incrementUsage = opts.incrementUsage ?? true;
    try {
      const at = nowIso();
      for (const hit of r.results) this.store.memories.markUsed(hit.memory.id, at, incrementUsage);
    } catch {
      /* 使用信号是旁路：写失败不改检索结果 */
    }
    this.recordOperation('memory_search', undefined, {
      candidates: r.results.length,
      matchedBy: r.matchedBy,
      degraded: r.degraded === true,
      ms: Date.now() - startedAt,
    });
    return r;
  }

  export(input: ExportInput): ExportOutput {
    return exportData(this.store, input);
  }

  findByContent(scopeId: string, text: string): MemoryRecord | null {
    return this.store.memories.findByContentHash(scopeId, contentHash(text));
  }

  // -------------------------------------------------------------------------
  // 后台任务
  // -------------------------------------------------------------------------

  async workerRunOnce(opts: { max?: number; timeoutMs?: number } = {}): Promise<RunOnceSummary> {
    return runOnce(this.store, { remote: getRemoteStore(), ...opts });
  }

  // -------------------------------------------------------------------------
  // 健康检查（任务 5.4：诚实分级，无模型无云端核心可用）
  // -------------------------------------------------------------------------

  doctor(): DoctorReport {
    const store = this.store;
    const problems: string[] = [];
    const notes: string[] = [];
    let integrity = 'unknown';
    try {
      integrity = store.db.integrityCheck() ? 'ok' : 'fail';
      if (integrity !== 'ok') problems.push('数据库完整性检查未通过');
    } catch (e) {
      integrity = 'error';
      problems.push(`完整性检查失败: ${(e as Error).message}`);
    }
    const fkViolations = store.db.foreignKeyCheck().length;
    if (fkViolations > 0) problems.push(`外键违规 ${fkViolations} 处`);

    let ftsOk = false;
    let ftsNote = '';
    try {
      store.db.all("SELECT rowid FROM memory_fts WHERE memory_fts MATCH '\"测试\"' LIMIT 1");
      ftsOk = true;
      ftsNote = 'FTS5 trigram 索引可查询';
    } catch (e) {
      ftsNote = `FTS 索引异常（检索将走有界 LIKE 回退）: ${(e as Error).message}`;
      notes.push('FTS 不可用不影响权威数据；检索自动降级为有界回退');
    }

    if (store.cloneCheck.cloned) {
      problems.push('检测到设备目录克隆：写入已暂停，请运行 device re-enroll');
    }

    const plansByStatus: Record<string, number> = {};
    for (const r of store.db.all('SELECT status, COUNT(*) AS n FROM onboarding_plan GROUP BY status')) {
      plansByStatus[String(r.status)] = Number(r.n);
    }
    const archiveCounts = store.archives.counts();
    // 上行缺口：不是"库坏了"，是可自愈状态——只进 counts 与 notes，绝不进 problems
    // （进 problems 会让 doctor 以非零退出码结束，破坏"健康即 0"语义）。
    const upstreamGap = findUpstreamGap(store).length;
    if (upstreamGap > 0) {
      notes.push(`上行缺口 ${upstreamGap} 条：作用域允许上行但未入队，执行 cairn sync backfill --apply 补齐`);
    }
    // 待办批注：与 upstreamGap 同一条纪律——只进 notes，不进 problems，不改退出码。
    let pendingAnnotations = 0;
    try {
      pendingAnnotations = countOpenAnnotations(store.paths.home);
    } catch {
      pendingAnnotations = 0; // 批注是旁注：读不出来不得影响体检结论
    }
    if (pendingAnnotations > 0) {
      notes.push(`待办批注 ${pendingAnnotations} 条：在 cairn ui 的「批注」里查看；待删项用 cairn forget --pending 处理`);
    }
    // remote 三态：not_configured / configured_untested / verified（首次成功往返后置 verified）
    let remote: DoctorReport['remote'] = 'not_configured';
    let remoteProvider: string | undefined;
    const vault = loadVaultConfig(store.paths.dataDir);
    if (vault) {
      remoteProvider = vault.provider;
      try {
        syncContext(store);
        const okRow = store.db.get("SELECT value FROM meta WHERE key = 'sync_last_ok'");
        remote = okRow ? 'verified' : 'configured_untested';
      } catch (e) {
        notes.push(`远端已配置但当前不可用：${(e as Error).message.slice(0, 120)}`);
        remote = 'configured_untested';
      }
    }
    if (remote === 'not_configured') {
      notes.push('模型未配置（本变更无模型路径）；云端未配置（remote=not_configured）。核心功能不依赖二者。');
    }

    return {
      ok: problems.length === 0,
      home: store.paths.home,
      schemaVersion: schemaVersion(store.db),
      device: { id: store.identity.deviceId, enrollment: store.cloneCheck.device?.enrollment ?? 'unknown', cloned: store.cloneCheck.cloned },
      db: { integrity, foreignKeyViolations: fkViolations },
      fts: { ok: ftsOk, note: ftsNote },
      counts: {
        memoryByStatus: store.memories.countsByStatus(),
        importArchives: archiveCounts.archives,
        importItems: { total: archiveCounts.items, clean: archiveCounts.items - archiveCounts.blockedItems, blocked: archiveCounts.blockedItems },
        plansByStatus,
        outboxByStatus: store.outbox.counts(),
        openConflicts: store.conflicts.countOpen(),
        upstreamGap,
      },
      remote,
      remoteProvider,
      model: 'not_configured',
      problems,
      notes,
    };
  }

  // -------------------------------------------------------------------------
  // 云同步（OpenSpec: add-real-cloud-sync）
  // -------------------------------------------------------------------------

  vaultInitRemote(input: { provider: 'obs' | 'syncd'; obs?: { endpoint: string; bucket: string; prefix: string }; syncd?: { baseUrl: string } }): { vault: ReturnType<typeof loadVaultConfig>; recovery: string } {
    return initRemote(this.store, input);
  }

  vaultStatus(): Record<string, unknown> {
    const vault = loadVaultConfig(this.store.paths.dataDir);
    const keys = vault ? Boolean(loadKeys(this.store.paths.dataDir)) : false;
    return {
      configured: vault != null,
      vaultId: vault?.vaultId ?? null,
      provider: vault?.provider ?? null,
      obs: vault?.obs ?? null,
      syncd: vault?.syncd ?? null,
      keysPresent: keys,
    };
  }

  vaultImportKey(recovery: string): void {
    const keys = importRecoveryMaterial(recovery);
    saveKeys(this.store.paths.dataDir, keys);
    this.store.audit.record('sync', 'keys_imported', { type: 'system', id: keys.vaultId }, {});
  }

  vaultExportKey(): string {
    const keys = loadKeys(this.store.paths.dataDir);
    if (!keys) throw err('E_VALIDATION', '未找到 vault 密钥');
    return exportRecoveryMaterial(keys);
  }

  async syncPushCmd(): Promise<unknown> {
    const ctx = this.requireSyncContext();
    const r = await syncPush(this.store, ctx.remote, ctx.vault);
    if (r && r.publishedChunks.length > 0) this.markSyncOk();
    return r;
  }

  async syncPullCmd(): Promise<unknown> {
    const ctx = this.requireSyncContext();
    const r = await syncPull(this.store, ctx.remote, ctx.vault);
    this.markSyncOk();
    return r;
  }

  /**
   * 冷启动对账（spec cloud-sync「冷启动对账」）：只补本地 outbox，默认只读。
   * 刻意不经过 requireSyncContext —— 未配置云端时同样可用，也不接触任何远端实现。
   */
  syncBackfillCmd(opts: { apply: boolean; limit?: number }): BackfillReport {
    return backfillUpstream(this.store, opts);
  }

  private requireSyncContext(): SyncContext {
    const ctx = syncContext(this.store);
    if (!ctx) throw err('E_VALIDATION', '未配置云端：请先 cairn vault init-remote');
    return ctx;
  }

  private markSyncOk(): void {
    this.store.db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('sync_last_ok', ?)", nowIso());
  }

  status(): Record<string, unknown> {
    const store = this.store;
    const outbox = store.outbox.counts();
    return {
      device: store.identity.deviceId,
      memories: store.memories.countsByStatus(),
      outbox,
      openConflicts: store.conflicts.countOpen(),
    };
  }

  // -------------------------------------------------------------------------
  // 首次初始化：发现 / 导入 / 分批 / 治理计划（任务 4.x / 3.x）
  // -------------------------------------------------------------------------

  /** 元数据发现：只列来源，不读正文（agent-onboarding spec）。 */
  async discover(opts: { homeDir: string; projectRoots?: string[] }): Promise<SourceCandidate[]> {
    return discoverSources({ homeDir: opts.homeDir, projectRoots: opts.projectRoots });
  }

  /** 快照导入：不可变快照 + imported_unverified 档案，源文件不变，重复导入幂等。 */
  async importFromPath(input: { sourcePath: string; agentKind: string; batchId?: string; sourceKind?: ImportSourceKind }): Promise<{ outcome: ImportOutcome; batchId: string }> {
    const store = this.store;
    store.assertWritable();
    // 防回环：受管投影文件不作为导入来源（导出—回读—再导出循环）
    const { readFileSync } = await import('node:fs');
    const { hasCairnMarker } = await import('../projection/markdown.js');
    const text = readFileSync(input.sourcePath, 'utf8');
    if (hasCairnMarker(text)) {
      throw err('E_PROJECTION_LOOP', '来源文件包含本产品受管投影标记；导入它会造成投影回环，已拒绝', { sourcePath: input.sourcePath });
    }
    const outcome = await importSnapshot(store, {
      agentKind: input.agentKind,
      sourcePath: input.sourcePath,
      batchId: input.batchId,
      sourceKind: input.sourceKind,
    });
    const batchId = outcome.batchId ?? assignBatch(store, outcome.reusedArchiveId ?? outcome.archiveId!);
    store.audit.record('import', 'imported_via_service', { type: 'archive', id: outcome.archiveId ?? outcome.reusedArchiveId! }, { batchId });
    return { outcome, batchId };
  }

  /** 活跃批次：最后一个仍有待晋升条目的批次 id。 */
  activeBatchId(): string | null {
    const rows = this.store.db.all(
      `SELECT i.batch_id AS bid, COUNT(*) AS n FROM import_item i
       WHERE i.scan_state = 'clean' AND i.batch_id IS NOT NULL
         AND ${promotedPredicate('i').handledNotExists}
       GROUP BY i.batch_id ORDER BY i.batch_id DESC LIMIT 1`,
    );
    return rows.length > 0 ? String(rows[0]!.bid) : null;
  }

  batchStatus(batchId: string): BatchProgress {
    return batchProgress(this.store, batchId);
  }

  batchChunk(batchId: string, limit: number): BatchChunkItem[] {
    return nextBatchChunk(this.store, batchId, limit);
  }

  /** 某批次的已跳过条目：出队但可查（本次变更的核心取舍）。 */
  batchSkipped(batchId: string, limit?: number): SkippedItem[] {
    return listSkippedItems(this.store, batchId, limit);
  }

  /** 由批次生成治理计划（Agent 建议 → 确定性管线），并标记对应条目来源。 */
  proposeForBatch(input: { batchId?: string; items: ProposedItem[]; proposedBy: string; scope?: ScopeSelection }): {
    plan: PlanRecord;
    planHash: string;
    accepted: number;
    rejected: { itemId?: string; reason: string; findings: { kind: string; masked: string }[] }[];
    duplicates: { itemId?: string; duplicateOfMemoryId: string }[];
  } {
    const store = this.store;
    store.assertWritable();
    const batchId = input.batchId ?? this.activeBatchId();
    if (!batchId) throw err('E_VALIDATION', '没有活跃的导入批次；请先 cairn import');
    const scope = this.resolveScope(input.scope ?? { preset: 'personal-global' });
    const archiveIds = [...new Set(store.db.all('SELECT DISTINCT archive_id AS a FROM import_item WHERE batch_id = ?', batchId).map((r) => String(r.a)))];
    const out = proposePlan(store, {
      scopeId: scope.id,
      items: input.items,
      sourceArchiveIds: archiveIds,
      proposedBy: input.proposedBy,
      scan: scanText,
    });
    store.audit.record('plan', 'proposed_for_batch', { type: 'plan', id: out.plan.id }, { batchId, accepted: out.accepted, rejected: out.rejected.length });
    return { ...out, plan: out.plan, planHash: out.planHash };
  }

  /** 本地可信审批通道（CLI approve / 控制台 webui）：展示差异后由用户签发。 */
  approve(planId: string, opts: { ttlMs?: number; channel?: string } = {}): { approvalId: string; expiresAt: string; itemCount: number } {
    const store = this.store;
    store.assertWritable();
    const channel = opts.channel ?? 'cli';
    store.plans.expireStale();
    const plan = store.plans.requireById(planId);
    if (plan.status !== 'awaiting_approval') {
      throw err('E_APPROVAL_INVALID', `计划状态为 ${plan.status}，只有 awaiting_approval 可批准`);
    }
    const { approval } = store.plans.issueApproval({ planId, channel, ttlMs: opts.ttlMs });
    // 审计动作名携带签发通道：事后能回答"这次批准是在终端还是网页上给的"。
    store.audit.record('approval', `issued_via_${channel}`, { type: 'approval', id: approval.id }, { planId, planHash: plan.planHash.slice(0, 16), channel });
    return { approvalId: approval.id, expiresAt: approval.expiresAt, itemCount: plan.itemCount };
  }

  /** 应用治理计划（消费一次性审批），成功后把批次条目标记为已晋升。 */
  applyPlan(planId: string, approvalId: string): { report: ApplyReport; batchId: string | null } {
    const store = this.store;
    store.assertWritable();
    const plan = store.plans.requireById(planId);
    const report = applyPlan(store, { planId, approvalId, deviceId: this.caller.deviceId, scan: scanText });
    // 批次晋升游标：把成功 add/keep_both/merge 的条目标记为已晋升（audit 即状态）
    for (const r of report.results) {
      if (r.memoryId && r.opIndex != null) {
        const op = store.plans.ops(planId).find((o) => o.opIndex === r.opIndex);
        if (op?.itemId) {
          try {
            markItemPromoted(store, op.itemId, r.memoryId);
          } catch {
            /* 同条目重复晋升已在 batches 层拦截 */
          }
        }
      }
    }
    const archiveIds = plan.sourceArchiveIds;
    const batchRow = archiveIds.length > 0 ? store.db.get('SELECT batch_id AS b FROM import_archive WHERE id = ?', archiveIds[0]) : null;
    return { report, batchId: batchRow ? String(batchRow.b) : null };
  }

  /** 计划差异预览（供 CLI approve 展示；不含正文的统计 + 每操作的类型/目标）。 */
  planSummary(planId: string): unknown {
    const store = this.store;
    const plan = store.plans.requireById(planId);
    const ops = store.plans.ops(planId);
    return {
      plan,
      ops: ops.map((o) => ({
        opIndex: o.opIndex,
        opType: o.opType,
        targetMemoryId: o.targetMemoryId,
        targetExpectedRevision: o.targetExpectedRevision,
        hasContent: o.content != null,
        contentHash: o.contentHash,
        kind: o.kind,
        itemId: o.itemId,
        status: o.status,
        reason: o.reason,
      })),
      counts: {
        add: ops.filter((o) => o.opType === 'add').length,
        merge: ops.filter((o) => o.opType === 'merge').length,
        keep_both: ops.filter((o) => o.opType === 'keep_both').length,
        skip: ops.filter((o) => o.opType === 'skip').length,
      },
    };
  }
}


/**
 * 编排层上行落点（spec cloud-sync「上行入队完备性」）：准入判定复用 `scopeAllowsUpstream`，
 * 作用域不允许上行时静默返回——这是正常结果，不是错误。
 */
function enqueueMemoryUpstream(
  store: CairnStore,
  memoryId: string,
  scopeId: string,
  op: 'memory_upsert' | 'memory_tombstone',
  idempotencyKey: string,
): void {
  const scope = store.scopes.requireById(scopeId);
  if (!scopeAllowsUpstream(scope)) return;
  store.outbox.enqueue({
    jobType: 'sync_upstream',
    scopeId: scope.id,
    entityType: 'memory',
    entityId: memoryId,
    payload: { op, memoryId },
    idempotencyKey,
  });
}

/** 扫描命中错误：秘密优先；仅注入命中 → E_INJECTION_SUSPECTED。均不回显原文。 */
function scanError(scan: ReturnType<typeof scanText>): Error {
  if (scan.findings.length > 0) {
    return err('E_SECRET_DETECTED', '内容疑似包含秘密，已阻断（详情见 masked 摘要，不回显原文）', {
      findings: scan.findings.map((f) => ({ kind: f.kind, masked: f.masked })),
      injectionFindings: scan.injectionFindings.map((f) => ({ kind: f.kind, rule: f.rule })),
    });
  }
  return err('E_INJECTION_SUSPECTED', '内容疑似提示注入指令，已按不可信数据处理并阻断该写入', {
    injectionFindings: scan.injectionFindings.map((f) => ({ kind: f.kind, rule: f.rule })),
  });
}

export { ExitCode };
