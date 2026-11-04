import { err } from '../core/errors.js';
import { nowIso } from '../core/time.js';
import type { CairnStore } from '../store/open.js';

/**
 * 长期无用记忆的归档（add-memory-importance-and-usage-signal D7）。
 *
 * 判据：`importance = 1` 且 `COALESCE(last_used_at, created_at)` 超过 `staleDays`。
 *
 * 三条刻意约束：
 * 1. **只归档，不删除**——`archived` 的既有语义就是「不活跃但仍保留」，
 *    用户重新记下同一件事是恢复意图（与 tombstone 的「明确退出」不同）。
 * 2. **只在显式调用时执行**——不挂在写入或检索路径上。自动归档会让
 *    「我写的东西怎么不见了」变成无法解释的现象。
 * 3. **重要性高于最低档的一律不碰**——`importance` 为 NULL（未判断）也不算最低档，
 *    因为「没判断」不等于「不重要」。
 */

export const STALE_IMPORTANCE = 1;
export const DEFAULT_STALE_DAYS = 180;

export interface ArchiveStaleOptions {
  staleDays?: number;
  /** 演练：只报告将要归档的条数，不写库。 */
  dryRun?: boolean;
  nowMs?: number;
}

export interface ArchiveStaleResult {
  archived: number;
  dryRun: boolean;
  staleDays: number;
  ids: string[];
}

export function archiveStaleMemories(store: CairnStore, opts: ArchiveStaleOptions = {}): ArchiveStaleResult {
  const store2 = store;
  store2.assertWritable();
  const staleDays = opts.staleDays ?? DEFAULT_STALE_DAYS;
  if (!Number.isFinite(staleDays) || staleDays <= 0) {
    throw err('E_VALIDATION', `staleDays 必须是正数，收到 ${String(staleDays)}`);
  }
  const nowMs = opts.nowMs ?? Date.now();
  const cutoffIso = new Date(nowMs - staleDays * 86_400_000).toISOString();

  // `importance = 1` 严格相等：NULL 表示未判断，不参与归档。
  const rows = store2.db.all(
    `SELECT id, importance, last_used_at, created_at
       FROM memory
      WHERE status = 'active'
        AND importance = ?
        AND COALESCE(last_used_at, created_at) < ?`,
    STALE_IMPORTANCE,
    cutoffIso,
  ) as Record<string, unknown>[];

  const ids = rows.map((r) => String(r['id']));
  if (opts.dryRun === true || ids.length === 0) {
    return { archived: 0, dryRun: opts.dryRun === true, staleDays, ids };
  }

  const at = nowIso();
  store2.db.transaction(() => {
    for (const r of rows) {
      store2.db.run("UPDATE memory SET status = 'archived', updated_at = ? WHERE id = ?", at, String(r['id']));
      store2.audit.record('memory', 'archived_stale', { type: 'memory', id: String(r['id']) }, {
        reason: 'stale_low_importance',
        importance: Number(r['importance']),
        lastUsedAt: (r['last_used_at'] as string | null) ?? null,
        createdAt: r['created_at'] ?? null,
        staleDays,
      });
    }
  });
  return { archived: ids.length, dryRun: false, staleDays, ids };
}
