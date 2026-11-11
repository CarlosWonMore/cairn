import { CairnDb } from './db.js';
import {
  AddMemoryInput,
  MemoryRecord,
  MemoryKind,
  MemoryStatus,
  Authority,
  EvidenceInput,
  EvidenceRecord,
  RevisionRecord,
  Sensitivity,
  MEMORY_KINDS,
  MEMORY_STATUSES,
  AUTHORITIES,
} from '../core/types.js';
import { err } from '../core/errors.js';
import { uuidv7 } from '../core/ids.js';
import { nowIso } from '../core/time.js';
import { normalizeContent, contentHash as contentHashOf, sha256Hex } from '../core/hash.js';
import { WriteGuardMixin } from './write-guard.js';

/**
 * 记忆仓储（任务 2.1）：显式新增、详情、更正、归档、遗忘与当前修订解析。
 * 更正形成新修订并保留 supersedes 链；历史修订不可无痕修改。
 * 内容哈希基于规范化正文（core/hash），原始正文始终保留。
 */

export interface ReviseOptions {
  reason?: string;
  author: string;
  /** 乐观锁：期望的当前修订 id；不匹配抛 E_TARGET_CHANGED。 */
  expectedCurrentRevisionId?: string;
  expiresAt?: string | null;
  sensitivity?: Sensitivity;
  /**
   * 权威级别覆盖（add-agent-managed-revision D4）：默认保持原权威。
   * 采纳 AI 修订提案时由本地入口传 user_confirmed——内容是 Agent 起草的，
   * 但批准动作来自人；写 agent_inferred 会低估，写 user_explicit 会高估。
   */
  authority?: Authority;
}

export interface MemoryFilter {
  scopeId?: string;
  status?: MemoryStatus;
  statuses?: MemoryStatus[];
  kind?: MemoryKind;
  authority?: Authority;
  sourceImportBatchId?: string;
  limit?: number;
  offset?: number;
}

export class MemoryRepository extends WriteGuardMixin {
  constructor(private readonly db: CairnDb) {
    super();
  }

  add(input: AddMemoryInput, deviceId: string): MemoryRecord {
    this.checkWritable();
    validateMemoryInput(input);
    const id = uuidv7();
    const at = nowIso();
    const normalized = normalizeContent(input.content);
    const hash = contentHashOf(input.content);
    const confidence = input.confidence ?? defaultConfidence(input.authority);
    const sensitivity = input.sensitivity ?? 'normal';

    this.db.transaction(() => {
      this.db.run(
        `INSERT INTO memory (id, owner_id, kind, content, normalized_content, scope_id, status, authority,
           confidence, source_agent, source_session_id, source_import_batch_id, source_message_range,
           observed_at, valid_from, valid_to, expires_at, sensitivity, content_hash, created_by, created_at, updated_at,
           importance, usage_count)
         VALUES (?, 'local-user', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        id,
        input.kind,
        input.content,
        normalized,
        input.scopeId,
        initialStatus(input.authority),
        input.authority,
        confidence,
        input.sourceAgent ?? null,
        input.sourceSessionId ?? null,
        input.sourceImportBatchId ?? null,
        input.sourceMessageRange ?? null,
        input.observedAt ?? at,
        input.validFrom ?? null,
        input.validTo ?? null,
        input.expiresAt ?? null,
        sensitivity,
        hash,
        input.createdBy,
        at,
        at,
        normalizeImportance(input.importance, input.authority),
      );
      const revId = uuidv7();
      this.db.run(
        `INSERT INTO memory_revision (id, memory_id, seq, parent_revision_ids, content, content_hash, scope_id,
           status, authority, author, device_id, reason, created_at)
         VALUES (?, ?, 1, '[]', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        revId,
        id,
        input.content,
        hash,
        input.scopeId,
        initialStatus(input.authority),
        input.authority,
        input.createdBy,
        deviceId,
        null,
        at,
      );
      this.db.run('UPDATE memory SET current_revision_id = ? WHERE id = ?', revId, id);
      this.insertEvidence(id, revId, input.evidence ?? []);
    });
    return this.require(id);
  }

  get(id: string): MemoryRecord | null {
    const row = this.db.get('SELECT * FROM memory WHERE id = ?', id);
    return row ? mapMemory(row) : null;
  }

  require(id: string): MemoryRecord {
    const m = this.get(id);
    if (!m) throw err('E_NOT_FOUND', `记忆不存在: ${id}`);
    return m;
  }

  /**
   * 用户更正（任务 2.1）：新修订 + supersedes 历史；expected 不匹配时
   * 抛 E_TARGET_CHANGED（目标在批准后变化则拒绝过期计划，spec memory-governance）。
   */
  revise(id: string, newContent: string, opts: ReviseOptions, deviceId: string): { memory: MemoryRecord; revision: RevisionRecord } {
    this.checkWritable();
    const mem = this.require(id);
    if (mem.status === 'tombstoned') throw err('E_CONFLICT_STATE', '已遗忘的记忆不能修改');
    const at = nowIso();
    const hash = contentHashOf(newContent);
    return this.db.transaction(() => {
      const cur = this.db.get('SELECT current_revision_id FROM memory WHERE id = ?', id)!;
      const currentRevId = cur.current_revision_id as string | null;
      if (opts.expectedCurrentRevisionId && currentRevId !== opts.expectedCurrentRevisionId) {
        throw err('E_TARGET_CHANGED', '记忆在计划批准后产生了新修订，拒绝基于过期目标应用', {
          memoryId: id,
          expected: opts.expectedCurrentRevisionId,
          actual: currentRevId,
        });
      }
      const seqRow = this.db.get('SELECT MAX(seq) AS s FROM memory_revision WHERE memory_id = ?', id);
      const seq = Number(seqRow?.s ?? 0) + 1;
      const revId = uuidv7();
      const newStatus: MemoryStatus = mem.status === 'conflicted' ? 'conflicted' : 'active';
      const revAuthority = opts.authority ?? mem.authority;
      this.db.run(
        `INSERT INTO memory_revision (id, memory_id, seq, parent_revision_ids, content, content_hash, scope_id,
           status, authority, author, device_id, reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        revId,
        id,
        seq,
        JSON.stringify(currentRevId ? [currentRevId] : []),
        newContent,
        hash,
        mem.scopeId,
        newStatus,
        revAuthority,
        opts.author,
        deviceId,
        opts.reason ?? null,
        at,
      );
      this.db.run(
        `UPDATE memory SET current_revision_id = ?, content = ?, normalized_content = ?, content_hash = ?,
           status = ?, authority = IFNULL(?, authority), expires_at = IFNULL(?, expires_at), sensitivity = IFNULL(?, sensitivity), updated_at = ? WHERE id = ?`,
        revId,
        newContent,
        normalizeContent(newContent),
        hash,
        newStatus,
        opts.authority ?? null,
        opts.expiresAt ?? null,
        opts.sensitivity ?? null,
        at,
        id,
      );
      return { memory: this.require(id), revision: this.requireRevision(revId) };
    });
  }

  /**
   * 候选晋升（真实审批后由治理层调用；agent_inferred/imported 不能静默变 active）。
   *
   * `opts.scopeId`：晋升时一并迁移作用域。候选写入时作用域已固化，而
   * `reviseMemory()` 只改正文不动作用域——晋升是修正它的唯一时机
   * （add-candidate-promote-command D2）。迁移与晋升在同一事务内完成。
   */
  promoteToActive(
    id: string,
    authority: Authority,
    by: string,
    opts: { scopeId?: string } = {},
  ): MemoryRecord {
    this.checkWritable();
    const mem = this.require(id);
    if (mem.status !== 'candidate') throw err('E_CONFLICT_STATE', `只有候选可晋升，当前 ${mem.status}`);
    if (authority === 'agent_inferred' || authority === 'imported_unverified') {
      throw err('E_FORBIDDEN', '不允许把候选晋升回推断/未验证权威');
    }
    // 目标作用域必须真实存在；不存在就 E_NOT_FOUND，不静默落回原作用域。
    if (opts.scopeId !== undefined && opts.scopeId !== mem.scopeId) {
      const exists = this.db.get('SELECT id FROM scope WHERE id = ?', opts.scopeId);
      if (!exists) throw err('E_NOT_FOUND', `作用域不存在: ${opts.scopeId}`);
    }
    const at = nowIso();
    const newScopeId = opts.scopeId ?? mem.scopeId;
    this.db.transaction(() => {
      this.db.run(
        "UPDATE memory SET status = 'active', authority = ?, scope_id = ?, updated_at = ? WHERE id = ?",
        authority,
        newScopeId,
        at,
        id,
      );
      this.db.run(
        'UPDATE memory_revision SET status = ?, authority = ?, scope_id = ? WHERE id = ?',
        'active',
        authority,
        newScopeId,
        mem.currentRevisionId ?? '',
      );
    });
    const out = this.require(id);
    // 外键与子表完整性：迁移后必须复查，否则「晋升成功但子表指向旧作用域」这种
    // 不一致会一路带到投影与同步层（add-candidate-promote-command D2）。
    const fk = this.db.all('PRAGMA foreign_key_check') as unknown[];
    if (fk.length > 0) throw err('E_CONFLICT_STATE', `作用域迁移后外键不完整（${fk.length} 条）`);
    return out;
  }

  /**
   * 作用域迁移（add-scope-migration D1）：只改 scope_id，不改 status / authority / 正文。
   * 与 promoteToActive 刻意分开——晋升的语义是「候选 → 活动 + 改权威」，它同时改三样；
   * 迁移只该改一样。混用会让迁移意外改掉权威级别。
   * 当前修订的 scope_id 一并更新（与 promoteToActive 同姿势）；历史修订保留原作用域作审计痕迹。
   */
  migrateScope(id: string, targetScopeId: string, _by: string): MemoryRecord {
    this.checkWritable();
    const mem = this.require(id);
    if (mem.scopeId === targetScopeId) return mem; // 原地迁移是无操作，不产生修订
    const exists = this.db.get('SELECT id FROM scope WHERE id = ?', targetScopeId);
    if (!exists) throw err('E_NOT_FOUND', `作用域不存在: ${targetScopeId}`);
    const at = nowIso();
    this.db.transaction(() => {
      this.db.run('UPDATE memory SET scope_id = ?, updated_at = ? WHERE id = ?', targetScopeId, at, id);
      this.db.run('UPDATE memory_revision SET scope_id = ? WHERE id = ?', targetScopeId, mem.currentRevisionId ?? '');
    });
    const out = this.require(id);
    // 子表完整性：与 promoteToActive 同姿势，迁移后复查，避免「记忆已迁移但子表指向旧作用域」
    const fk = this.db.all('PRAGMA foreign_key_check') as unknown[];
    if (fk.length > 0) throw err('E_CONFLICT_STATE', `作用域迁移后外键不完整（${fk.length} 条）`);
    return out;
  }

  archive(id: string): MemoryRecord {
    this.require(id);
    this.db.run("UPDATE memory SET status = 'archived', updated_at = ? WHERE id = ?", nowIso(), id);
    return this.require(id);
  }

  /** 遗忘（任务 2.1/2.5）：tombstone 可审计，被遗忘内容退出活动结果与投影。 */
  forget(id: string, reason: string | null, by: string): MemoryRecord {
    this.checkWritable();
    const mem = this.require(id);
    if (mem.status === 'tombstoned') return mem;
    const at = nowIso();
    this.db.transaction(() => {
      this.db.run(
        `INSERT INTO tombstone (id, memory_id, reason, forgotten_by, forgotten_at, content_hash) VALUES (?, ?, ?, ?, ?, ?)`,
        uuidv7(),
        id,
        reason,
        by,
        at,
        mem.contentHash,
      );
      this.db.run("UPDATE memory SET status = 'tombstoned', updated_at = ? WHERE id = ?", at, id);
    });
    return this.require(id);
  }

  getTombstone(memoryId: string): { id: string; reason: string | null; forgottenBy: string; forgottenAt: string; contentHash: string } | null {
    const row = this.db.get('SELECT * FROM tombstone WHERE memory_id = ? ORDER BY forgotten_at DESC LIMIT 1', memoryId);
    if (!row) return null;
    return {
      id: row.id as string,
      reason: (row.reason as string | null) ?? null,
      forgottenBy: row.forgotten_by as string,
      forgottenAt: row.forgotten_at as string,
      contentHash: row.content_hash as string,
    };
  }

  resolveCurrent(id: string): { memory: MemoryRecord; revision: RevisionRecord } | null {
    const mem = this.get(id);
    if (!mem || !mem.currentRevisionId) return null;
    return { memory: mem, revision: this.requireRevision(mem.currentRevisionId) };
  }

  revisions(id: string): RevisionRecord[] {
    return this.db
      .all('SELECT * FROM memory_revision WHERE memory_id = ? ORDER BY seq', id)
      .map(mapRevision);
  }

  requireRevision(revId: string): RevisionRecord {
    const row = this.db.get('SELECT * FROM memory_revision WHERE id = ?', revId);
    if (!row) throw err('E_NOT_FOUND', `修订不存在: ${revId}`);
    return mapRevision(row);
  }

  evidence(memoryId: string): EvidenceRecord[] {
    return this.db.all('SELECT * FROM evidence WHERE memory_id = ? ORDER BY created_at, id', memoryId).map(mapEvidence);
  }

  /** 记忆间关系：supersedes / contradicts / related_to（首版仅三种）。 */
  addRelation(fromMemoryId: string, toMemoryId: string, type: 'supersedes' | 'contradicts' | 'related_to'): string {
    if (fromMemoryId === toMemoryId) throw err('E_VALIDATION', '关系两端不能是同一记忆');
    this.require(fromMemoryId);
    this.require(toMemoryId);
    const existing = this.db.get(
      'SELECT id FROM relation WHERE from_memory_id = ? AND to_memory_id = ? AND relation_type = ?',
      fromMemoryId,
      toMemoryId,
      type,
    );
    if (existing) return existing.id as string;
    const id = uuidv7();
    this.db.run(
      'INSERT INTO relation (id, from_memory_id, to_memory_id, relation_type, created_at) VALUES (?, ?, ?, ?, ?)',
      id,
      fromMemoryId,
      toMemoryId,
      type,
      nowIso(),
    );
    return id;
  }

  relationsOf(memoryId: string): { id: string; fromMemoryId: string; toMemoryId: string; relationType: string }[] {
    return this.db
      .all('SELECT * FROM relation WHERE from_memory_id = ? OR to_memory_id = ?', memoryId, memoryId)
      .map((r) => ({
        id: r.id as string,
        fromMemoryId: r.from_memory_id as string,
        toMemoryId: r.to_memory_id as string,
        relationType: r.relation_type as string,
      }));
  }

  addEvidence(memoryId: string, revisionId: string | null, input: EvidenceInput): EvidenceRecord {
    const id = uuidv7();
    this.db.run(
      `INSERT INTO evidence (id, memory_id, revision_id, evidence_kind, source_agent, session_id, import_archive_id,
         locator, excerpt_hash, trust_level, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      memoryId,
      revisionId,
      input.evidenceKind,
      input.sourceAgent ?? null,
      input.sessionId ?? null,
      input.importArchiveId ?? null,
      input.locator ?? null,
      input.excerptHash ?? null,
      input.trustLevel,
      nowIso(),
    );
    const row = this.db.get('SELECT * FROM evidence WHERE id = ?', id)!;
    return mapEvidence(row);
  }

  list(filter: MemoryFilter = {}): MemoryRecord[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.scopeId) {
      where.push('scope_id = ?');
      params.push(filter.scopeId);
    }
    if (filter.status) {
      where.push('status = ?');
      params.push(filter.status);
    } else if (filter.statuses) {
      where.push(`status IN (${filter.statuses.map(() => '?').join(',')})`);
      params.push(...filter.statuses);
    }
    if (filter.kind) {
      where.push('kind = ?');
      params.push(filter.kind);
    }
    if (filter.authority) {
      where.push('authority = ?');
      params.push(filter.authority);
    }
    if (filter.sourceImportBatchId) {
      where.push('source_import_batch_id = ?');
      params.push(filter.sourceImportBatchId);
    }
    const sql = `SELECT * FROM memory ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY updated_at DESC, id LIMIT ? OFFSET ?`;
    params.push(filter.limit ?? 200, filter.offset ?? 0);
    return this.db.all(sql, ...params).map(mapMemory);
  }

  /** 内容去重查找（同 scope 同规范化哈希）。 */
  findByContentHash(scopeId: string, hash: string): MemoryRecord | null {
    const row = this.db.get(
      "SELECT * FROM memory WHERE scope_id = ? AND content_hash = ? AND status NOT IN ('tombstoned','superseded') ORDER BY updated_at DESC LIMIT 1",
      scopeId,
      hash,
    );
    return row ? mapMemory(row) : null;
  }

  /** 跨设备记忆身份对齐：任一修订内容哈希命中即视为同一记忆（本地 id 不可跨设备引用）。 */
  findMemoryIdByRevisionHashes(hashes: string[]): string | null {
    if (hashes.length === 0) return null;
    const placeholders = hashes.map(() => '?').join(',');
    const row = this.db.get(
      `SELECT memory_id FROM memory_revision WHERE content_hash IN (${placeholders}) LIMIT 1`,
      ...hashes,
    );
    return row ? (row.memory_id as string) : null;
  }

  /** 修订级内容哈希查找（同步对账用：远端事件的 parent_hash 对齐到本地修订）。 */
  findRevisionByContentHash(memoryId: string, hash: string): RevisionRecord | null {
    const row = this.db.get(
      'SELECT * FROM memory_revision WHERE memory_id = ? AND content_hash = ? ORDER BY seq DESC LIMIT 1',
      memoryId,
      hash,
    );
    return row ? mapRevision(row) : null;
  }

  /**
   * 应用远端修订（同步拉取专用）：插入为该记忆的下一条本地修订，
   * 不推进 current_revision_id——推进与否由冲突/快进判定决定
   * （sync 层随后显式 revise 或记录冲突）。
   */
  insertRemoteRevision(memoryId: string, input: {
    content: string;
    contentHash: string;
    author: string;
    reason: string | null;
    parentLocalRevisionId: string | null;
    baseRevisionId: string | null;
  }, deviceId: string): RevisionRecord {
    this.checkWritable();
    const mem = this.require(memoryId);
    const at = nowIso();
    const seqRow = this.db.get('SELECT MAX(seq) AS s FROM memory_revision WHERE memory_id = ?', memoryId);
    const seq = Number(seqRow?.s ?? 0) + 1;
    const revId = uuidv7();
    this.db.run(
      `INSERT INTO memory_revision (id, memory_id, seq, parent_revision_ids, content, content_hash, scope_id,
         status, authority, author, device_id, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
      revId,
      memoryId,
      seq,
      JSON.stringify(input.parentLocalRevisionId ? [input.parentLocalRevisionId] : []),
      input.content,
      input.contentHash,
      mem.scopeId,
      mem.authority,
      input.author,
      deviceId,
      input.reason,
      at,
    );
    void input.baseRevisionId;
    return this.requireRevision(revId);
  }

  countsByStatus(): Record<MemoryStatus, number> {
    const out = Object.fromEntries(MEMORY_STATUSES.map((s) => [s, 0])) as Record<MemoryStatus, number>;
    for (const r of this.db.all('SELECT status, COUNT(*) AS n FROM memory GROUP BY status')) {
      out[r.status as MemoryStatus] = Number(r.n);
    }
    return out;
  }

  /**
   * 记使用信号（add-memory-importance-and-usage-signal D5）。
   *
   * `incrementUsage` 区分两种语义，**这是本变更最容易被改错的地方**：
   * - 自动注入：只写 last_used_at（回答「最近被看到过吗」）
   * - 显式检索：两者都写（回答「被主动要过几次」）
   *
   * 插件是每轮都注入的（2026-11-02 实测 202 次注入 / 6 种内容 / 97% 重复）。
   * 若注入也计 usage_count，「注入频率」会取代「真实需求」决定排序，
   * 形成「被注入过 → 更容易被注入」的正反馈死锁。
   */
  markUsed(id: string, at: string = nowIso(), incrementUsage = false): void {
    if (incrementUsage) {
      this.db.run('UPDATE memory SET last_used_at = ?, usage_count = usage_count + 1 WHERE id = ?', at, id);
    } else {
      this.db.run('UPDATE memory SET last_used_at = ? WHERE id = ?', at, id);
    }
  }

  touchVerified(id: string, at: string = nowIso()): void {
    this.db.run('UPDATE memory SET last_verified_at = ?, updated_at = ? WHERE id = ?', at, at, id);
  }

  private insertEvidence(memoryId: string, revisionId: string, list: EvidenceInput[]): void {
    for (const ev of list) {
      this.addEvidence(memoryId, revisionId, ev);
    }
  }
}

/** authority → 初始状态：显式/确认即 active；推断/导入保持候选（spec memory-governance）。 */
export function initialStatus(authority: Authority): MemoryStatus {
  switch (authority) {
    case 'user_explicit':
    case 'user_confirmed':
      return 'active';
    case 'agent_inferred':
    case 'imported_unverified':
      return 'candidate';
    default: {
      const exhaustive: never = authority;
      throw err('E_VALIDATION', `未知权威级别 ${String(exhaustive)}`);
    }
  }
}

function defaultConfidence(authority: Authority): number {
  switch (authority) {
    case 'user_explicit':
      return 1;
    case 'user_confirmed':
      return 0.9;
    case 'agent_inferred':
      return 0.5;
    case 'imported_unverified':
      return 0.3;
  }
}

/**
 * 重要度归一（add-memory-importance-and-usage-signal D4）。
 *
 * - 缺省 3（「没判断」取中间档，与显式传 3 行为一致）；
 * - 越界抛 E_VALIDATION，**不静默截断**——静默截断会让调用方以为写进去了；
 * - `agent_inferred` 上限 3：模型不得给自主推断的内容自封 4/5 星，
 *   否则它会倾向于认为「我刚写的很重要」，把注入预算挤爆。
 */
export function normalizeImportance(value: number | null | undefined, authority: Authority): number | null {
  if (value == null) return null;
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw err('E_VALIDATION', `importance 必须是 1-5 的整数，收到 ${String(value)}`);
  }
  if (authority === 'agent_inferred' || authority === 'imported_unverified') {
    return Math.min(value, 3);
  }
  return value;
}

/** 注入排序用的有效重要度：NULL 视为 3。 */
export function effectiveImportance(m: { importance: number | null }): number {
  return m.importance ?? 3;
}

export function validateMemoryInput(input: AddMemoryInput): void {
  const problems: string[] = [];
  if (!(MEMORY_KINDS as readonly string[]).includes(input.kind)) problems.push(`kind 非法: ${input.kind}`);
  if (!(AUTHORITIES as readonly string[]).includes(input.authority)) problems.push(`authority 非法: ${input.authority}`);
  if (typeof input.content !== 'string' || input.content.trim().length === 0) problems.push('content 不能为空');
  if (input.content.length > 1_000_000) problems.push('content 超过 1MB 上限');
  if (input.kind === 'instruction' && input.authority !== 'user_explicit' && input.authority !== 'user_confirmed') {
    problems.push('instruction 只能来自 user_explicit / user_confirmed');
  }
  if (input.confidence != null && (input.confidence < 0 || input.confidence > 1)) problems.push('confidence 必须在 [0,1]');
  if (problems.length > 0) throw err('E_VALIDATION', `记忆写入校验失败: ${problems.join('; ')}`, { problems });
}

export function mapMemory(r: Record<string, unknown>): MemoryRecord {
  return {
    id: r.id as string,
    ownerId: r.owner_id as string,
    kind: r.kind as MemoryKind,
    content: r.content as string,
    normalizedContent: r.normalized_content as string,
    scopeId: r.scope_id as string,
    status: r.status as MemoryStatus,
    authority: r.authority as Authority,
    confidence: Number(r.confidence),
    sourceAgent: (r.source_agent as string | null) ?? null,
    sourceSessionId: (r.source_session_id as string | null) ?? null,
    sourceImportBatchId: (r.source_import_batch_id as string | null) ?? null,
    sourceMessageRange: (r.source_message_range as string | null) ?? null,
    observedAt: r.observed_at as string,
    validFrom: (r.valid_from as string | null) ?? null,
    validTo: (r.valid_to as string | null) ?? null,
    lastVerifiedAt: (r.last_verified_at as string | null) ?? null,
    lastUsedAt: (r.last_used_at as string | null) ?? null,
    importance: r.importance == null ? null : Number(r.importance),
    usageCount: Number(r.usage_count ?? 0),
    expiresAt: (r.expires_at as string | null) ?? null,
    sensitivity: r.sensitivity as Sensitivity,
    currentRevisionId: (r.current_revision_id as string | null) ?? null,
    contentHash: r.content_hash as string,
    createdBy: r.created_by as string,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

export function mapRevision(r: Record<string, unknown>): RevisionRecord {
  let parents: string[] = [];
  try {
    const v = JSON.parse((r.parent_revision_ids as string) ?? '[]') as unknown;
    if (Array.isArray(v)) parents = v.map(String);
  } catch {
    parents = [];
  }
  return {
    id: r.id as string,
    memoryId: r.memory_id as string,
    seq: Number(r.seq),
    parentRevisionIds: parents,
    content: r.content as string,
    contentHash: r.content_hash as string,
    scopeId: r.scope_id as string,
    status: r.status as MemoryStatus,
    authority: r.authority as Authority,
    author: r.author as string,
    deviceId: r.device_id as string,
    reason: (r.reason as string | null) ?? null,
    createdAt: r.created_at as string,
  };
}

export function mapEvidence(r: Record<string, unknown>): EvidenceRecord {
  return {
    id: r.id as string,
    memoryId: r.memory_id as string,
    revisionId: (r.revision_id as string | null) ?? null,
    evidenceKind: r.evidence_kind as EvidenceRecord['evidenceKind'],
    sourceAgent: (r.source_agent as string | null) ?? null,
    sessionId: (r.session_id as string | null) ?? null,
    importArchiveId: (r.import_archive_id as string | null) ?? null,
    locator: (r.locator as string | null) ?? null,
    excerptHash: (r.excerpt_hash as string | null) ?? null,
    trustLevel: r.trust_level as EvidenceRecord['trustLevel'],
    createdAt: r.created_at as string,
  };
}

/** 证据摘录只存哈希，不存原文（构想 §8.3）。 */
export function evidenceExcerptHash(excerpt: string): string {
  return sha256Hex(excerpt);
}
