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
import { contentHash } from '../core/hash.js';
import { scopeAllowsUpstream, scopeAllowsRead } from '../core/scope.js';
import { searchMemories, SearchInput, SearchOutput } from '../retrieval/search.js';
import { exportData, ExportInput, ExportOutput } from '../retrieval/export.js';
import { registerDefaultHandlers, runOnce, RunOnceSummary } from '../jobs/worker.js';
import { getRemoteStore } from '../jobs/remote.js';
import { scanText } from '../core/secrets.js';
import { importSnapshot, ImportOutcome } from '../onboarding/import.js';
import { assignBatch, batchProgress, nextBatchChunk, markItemPromoted, BatchProgress, BatchChunkItem } from '../onboarding/batches.js';
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
  };
  remote: 'not_configured';
  model: 'not_configured';
  problems: string[];
  notes: string[];
}

export class AppService {
  private constructor(public readonly store: CairnStore) {
    registerDefaultHandlers();
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

  addMemory(input: AddMemoryInput): MemoryRecord {
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
    if (input.sensitivity === 'sensitive' && scope.syncPolicy !== 'local_only') {
      throw err('E_VALIDATION', 'sensitive 记忆必须使用 local_only 作用域（device-local / project-device / 自定义 local_only）');
    }
    const ctx = this.caller;
    const memory = store.memories.add(
      {
        kind,
        content: input.content,
        scopeId: scope.id,
        authority,
        createdBy: ctx.agentId === 'cli' ? 'cli' : `mcp:${ctx.agentId}`,
        sourceAgent: input.sourceAgent ?? ctx.agentId,
        sourceSessionId: input.sourceSessionId ?? null,
        evidence: input.evidence,
        expiresAt: input.expiresAt ?? null,
        sensitivity: input.sensitivity ?? 'normal',
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
    store.audit.record('memory', 'added', { type: 'memory', id: memory.id }, { kind, authority, scopeId: scope.id });
    return memory;
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

  showMemory(id: string): MemoryDetail {
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
  proposeCandidate(input: { content: string; kind?: MemoryKind; evidence?: EvidenceInput[]; sourceSessionId?: string | null }): MemoryRecord {
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
      },
      ctx.deviceId,
    );
    store.audit.record('memory', 'candidate_proposed', { type: 'memory', id: m.id }, { kind: m.kind });
    return m;
  }

  // -------------------------------------------------------------------------
  // 检索 / 导出
  // -------------------------------------------------------------------------

  search(input: SearchInput): SearchOutput {
    return searchMemories(this.store, input);
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
    notes.push('模型未配置（本变更无模型路径）；云端未配置（remote=not_configured）。核心功能不依赖二者。');

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
      },
      remote: 'not_configured',
      model: 'not_configured',
      problems,
      notes,
    };
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
         AND NOT EXISTS (SELECT 1 FROM audit_event a WHERE a.category='onboarding' AND a.action='item_promoted'
                         AND json_extract(a.detail,'$.itemId') = i.id)
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

  /** 本地可信审批通道（CLI approve）：展示差异后由用户在终端执行。 */
  approve(planId: string, opts: { ttlMs?: number } = {}): { approvalId: string; expiresAt: string; itemCount: number } {
    const store = this.store;
    store.assertWritable();
    store.plans.expireStale();
    const plan = store.plans.requireById(planId);
    if (plan.status !== 'awaiting_approval') {
      throw err('E_APPROVAL_INVALID', `计划状态为 ${plan.status}，只有 awaiting_approval 可批准`);
    }
    const { approval } = store.plans.issueApproval({ planId, channel: 'cli', ttlMs: opts.ttlMs });
    store.audit.record('approval', 'issued_via_cli', { type: 'approval', id: approval.id }, { planId, planHash: plan.planHash.slice(0, 16) });
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
