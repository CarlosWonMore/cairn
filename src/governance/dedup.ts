import { err } from '../core/errors.js';
import { contentHash as contentHashOf, normalizeContent } from '../core/hash.js';
import type { CairnDb } from '../store/db.js';

/**
 * 内容去重（design D3）：写入、计划生成、计划应用三个时机共用这一处判定。
 *
 * 分三份写是错的——越界条件会各自漂移，最后出现"写入时认为重复、晋升时认为不重复"
 * 这种事后无法解释的状态。
 *
 * 判定只认"在活动集里的"记忆：`active` 与 `candidate`。
 * - `tombstoned` / `superseded` 是明确退出活动集的历史，不算重复，否则"遗忘之后再记同一条"
 *   会被静默吞掉；
 * - `archived` 不算重复：归档的语义是"不活跃但仍保留"，用户重新记下同一件事是恢复意图。
 */

export type DuplicateKind = 'active' | 'candidate';

export interface DuplicateHit {
  memoryId: string;
  scopeId: string;
  contentHash: string;
  status: DuplicateKind;
}

export function findDuplicateByHash(db: CairnDb, scopeId: string, hash: string): DuplicateHit | null {
  const row = db.get(
    `SELECT id, scope_id, content_hash, status FROM memory
      WHERE scope_id = ? AND content_hash = ? AND status IN ('active','candidate')
      ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, updated_at DESC
      LIMIT 1`,
    scopeId,
    hash,
  ) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    memoryId: row.id as string,
    scopeId: row.scope_id as string,
    contentHash: row.content_hash as string,
    status: row.status as DuplicateKind,
  };
}

export function findDuplicate(db: CairnDb, scopeId: string, content: string): DuplicateHit | null {
  if (normalizeContent(content).length === 0) {
    throw err('E_VALIDATION', '内容为空，无法判定重复');
  }
  return findDuplicateByHash(db, scopeId, contentHashOf(content));
}
