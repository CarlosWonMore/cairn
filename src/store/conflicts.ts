import { CairnDb } from './db.js';
import { err } from '../core/errors.js';
import { uuidv7 } from '../core/ids.js';
import { nowIso } from '../core/time.js';
import { RevisionRecord } from '../core/types.js';
import { WriteGuardMixin } from './write-guard.js';

/**
 * 冲突队列（任务 3.4）：并发修订不做字段级 LWW，
 * 保留双方与共同祖先证据；检索明确标记未解决状态。
 */

export type ConflictStatus = 'open' | 'resolved_keep_a' | 'resolved_keep_b' | 'resolved_keep_both' | 'resolved_manual';

export interface ConflictRow {
  id: string;
  memoryId: string;
  baseRevisionId: string | null;
  revisionAId: string;
  revisionBId: string;
  detectedAt: string;
  status: ConflictStatus;
  resolvedAt: string | null;
  resolutionNote: string | null;
}

export class ConflictRepository extends WriteGuardMixin {
  constructor(private readonly db: CairnDb) {
    super();
  }

  /**
   * 记录并发冲突：双方修订必须存在且同属一个 memory。
   * 同一对修订重复记录幂等（UNIQUE 约束）。
   */
  record(input: { memoryId: string; baseRevisionId?: string | null; revisionAId: string; revisionBId: string }): { conflict: ConflictRow; created: boolean } {
    this.checkWritable();
    if (input.revisionAId === input.revisionBId) throw err('E_VALIDATION', '冲突双方不能是同一修订');
    for (const rid of [input.revisionAId, input.revisionBId]) {
      const rev = this.db.get('SELECT memory_id FROM memory_revision WHERE id = ?', rid);
      if (!rev) throw err('E_NOT_FOUND', `修订不存在: ${rid}`);
      if (rev.memory_id !== input.memoryId) throw err('E_VALIDATION', '冲突修订必须属于同一记忆');
    }
    const existing = this.db.get(
      'SELECT * FROM conflict WHERE memory_id = ? AND ((revision_a_id = ? AND revision_b_id = ?) OR (revision_a_id = ? AND revision_b_id = ?))',
      input.memoryId,
      input.revisionAId,
      input.revisionBId,
      input.revisionBId,
      input.revisionAId,
    );
    if (existing) return { conflict: mapConflict(existing), created: false };
    const id = uuidv7();
    this.db.run(
      `INSERT INTO conflict (id, memory_id, base_revision_id, revision_a_id, revision_b_id, detected_at, status)
       VALUES (?, ?, ?, ?, ?, ?, 'open')`,
      id,
      input.memoryId,
      input.baseRevisionId ?? null,
      input.revisionAId,
      input.revisionBId,
      nowIso(),
    );
    // 记忆进入 conflicted 状态（检索层负责明确标记）
    this.db.run("UPDATE memory SET status = 'conflicted', updated_at = ? WHERE id = ? AND status = 'active'", nowIso(), input.memoryId);
    return { conflict: this.requireById(id), created: true };
  }

  requireById(id: string): ConflictRow {
    const row = this.db.get('SELECT * FROM conflict WHERE id = ?', id);
    if (!row) throw err('E_NOT_FOUND', `冲突不存在: ${id}`);
    return mapConflict(row);
  }

  /** 检测祖先关系：shared base 且互不为祖先 → 并发冲突。 */
  isConcurrent(revA: RevisionRecord, revB: RevisionRecord, baseId: string | null): boolean {
    if (revA.memoryId !== revB.memoryId) return false;
    const inA = baseId != null && revA.parentRevisionIds.includes(baseId);
    const inB = baseId != null && revB.parentRevisionIds.includes(baseId);
    if (inA && inB) return true;
    // 双方各自基于同一祖先的新修订，但互相不在对方历史中
    const aAncestry = this.ancestryOf(revA.id);
    const bAncestry = this.ancestryOf(revB.id);
    return !aAncestry.has(revB.id) && !bAncestry.has(revA.id);
  }

  ancestryOf(revisionId: string, seen = new Set<string>()): Set<string> {
    if (seen.has(revisionId)) return seen;
    seen.add(revisionId);
    const row = this.db.get('SELECT parent_revision_ids FROM memory_revision WHERE id = ?', revisionId);
    if (!row) return seen;
    try {
      const parents = JSON.parse((row.parent_revision_ids as string) ?? '[]') as string[];
      for (const p of parents) this.ancestryOf(p, seen);
    } catch {
      /* 空历史 */
    }
    return seen;
  }

  listOpen(memoryId?: string): ConflictRow[] {
    if (memoryId) {
      return this.db.all("SELECT * FROM conflict WHERE status = 'open' AND memory_id = ? ORDER BY detected_at", memoryId).map(mapConflict);
    }
    return this.db.all("SELECT * FROM conflict WHERE status = 'open' ORDER BY detected_at").map(mapConflict);
  }

  countOpen(): number {
    return Number(this.db.scalar("SELECT COUNT(*) AS n FROM conflict WHERE status = 'open'") ?? 0);
  }

  /**
   * 解决冲突。keep_both：以指定内容新建当前修订（双方证据保留在 conflict 行）；
   * keep_a/keep_b：指定修订成为当前；manual：仅标记，不动当前修订。
   */
  resolve(input: { conflictId: string; resolution: Exclude<ConflictStatus, 'open'>; note?: string; currentRevisionId?: string }): ConflictRow {
    this.checkWritable();
    const conflict = this.requireById(input.conflictId);
    if (conflict.status !== 'open') throw err('E_CONFLICT_STATE', `冲突已解决: ${conflict.status}`);
    this.db.transaction(() => {
      this.db.run('UPDATE conflict SET status = ?, resolved_at = ?, resolution_note = ? WHERE id = ?', input.resolution, nowIso(), input.note ?? null, conflict.id);
      if (input.resolution !== 'resolved_manual' && input.currentRevisionId) {
        this.db.run("UPDATE memory SET status = 'active', current_revision_id = ?, updated_at = ? WHERE id = ?", input.currentRevisionId, nowIso(), conflict.memoryId);
      }
    });
    return this.requireById(conflict.id);
  }
}

function mapConflict(r: Record<string, unknown>): ConflictRow {
  return {
    id: r.id as string,
    memoryId: r.memory_id as string,
    baseRevisionId: (r.base_revision_id as string | null) ?? null,
    revisionAId: r.revision_a_id as string,
    revisionBId: r.revision_b_id as string,
    detectedAt: r.detected_at as string,
    status: r.status as ConflictStatus,
    resolvedAt: (r.resolved_at as string | null) ?? null,
    resolutionNote: (r.resolution_note as string | null) ?? null,
  };
}
