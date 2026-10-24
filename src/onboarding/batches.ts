import { CairnStore } from '../store/open.js';
import { uuidv7 } from '../core/ids.js';
import { err } from '../core/errors.js';

/**
 * 分批与续跑（任务 4.3 / spec agent-onboarding「对话式分批初始化」）：
 *
 * 当前 Agent 只能读取 nextBatchChunk 吐出的批次切片（clean 且未晋升、有界
 * limit）来生成治理建议；markItemPromoted 在真实批准并晋升后打标记。
 * 会话中断后重开库，nextBatchChunk 的游标（已晋升不再返回）与进度都从
 * 持久状态恢复，不重复已应用操作，也不扩大原授权范围。
 *
 * 晋升状态的承载方式（刻意设计：审计即状态）：
 * - schema 已冻结（design Migration Plan），不能给 import_item 加晋升列；
 * - 晋升映射写入 audit_event：category='onboarding'、action='item_promoted'、
 *   subject={type:'import_item', id:itemId}、detail={"itemId","memoryId"}；
 * - batchProgress / nextBatchChunk 用 SQLite json_extract 过滤已晋升条目：
 *     SELECT COUNT(*) FROM audit_event
 *      WHERE category='onboarding' AND action='item_promoted'
 *        AND json_extract(detail,'$.itemId') = ?
 * - 好处：晋升动作本身永远是可审计事件（谁在何时晋升了哪条到哪条记忆），
 *   状态与审计天然一致，且跨会话持久。
 */

const PROMOTED_CATEGORY = 'onboarding';
const PROMOTED_ACTION = 'item_promoted';

/** SQL 谓词（category/action 为模块内常量，batchId/itemId 一律走位置参数）。 */
const PROMOTED_EXISTS = `EXISTS (
  SELECT 1 FROM audit_event a
   WHERE a.category = ? AND a.action = ?
     AND json_extract(a.detail, '$.itemId') = i.id)`;

const PROMOTED_NOT_EXISTS = `NOT EXISTS (
  SELECT 1 FROM audit_event a
   WHERE a.category = ? AND a.action = ?
     AND json_extract(a.detail, '$.itemId') = i.id)`;

export interface BatchProgress {
  batchId: string;
  total: number;
  clean: number;
  blocked: number;
  promoted: number;
  /** clean 且尚未晋升：当前 Agent 还要处理的剩余量（中断续跑的游标语义）。 */
  remaining: number;
}

export interface BatchChunkItem {
  itemId: string;
  archiveId: string;
  content: string;
  sourceRef: string | null;
  contentHash: string;
}

/**
 * 给 archive 未分批（batch_id IS NULL）条目补 batchId；幂等：
 * 档案内已有任何批次号时收敛到既有批次（按 item_index 最早一条），
 * 没有则生成新批次。返回该 archive 条目所属的 batchId。
 */
export function assignBatch(store: CairnStore, archiveId: string): string {
  store.archives.requireById(archiveId); // 不存在 → E_NOT_FOUND
  return store.db.transaction(() => {
    const row = store.db.get(
      'SELECT batch_id FROM import_item WHERE archive_id = ? AND batch_id IS NOT NULL ORDER BY item_index LIMIT 1',
      archiveId,
    );
    const batchId = row != null && row['batch_id'] != null ? String(row['batch_id']) : uuidv7();
    store.db.run(
      'UPDATE import_item SET batch_id = ? WHERE archive_id = ? AND batch_id IS NULL',
      batchId,
      archiveId,
    );
    return batchId;
  });
}

/** 批次进度：按 import_item.scan_state 与晋升审计标记（审计即状态）统计。 */
export function batchProgress(store: CairnStore, batchId: string): BatchProgress {
  const where = 'FROM import_item i WHERE i.batch_id = ?';
  const total = toCount(store.db.scalar(`SELECT COUNT(*) ${where}`, batchId));
  const clean = toCount(store.db.scalar(`SELECT COUNT(*) ${where} AND i.scan_state = 'clean'`, batchId));
  const blocked = toCount(store.db.scalar(`SELECT COUNT(*) ${where} AND i.scan_state = 'blocked'`, batchId));
  const promoted = toCount(
    store.db.scalar(`SELECT COUNT(*) ${where} AND ${PROMOTED_EXISTS}`, batchId, PROMOTED_CATEGORY, PROMOTED_ACTION),
  );
  const remaining = toCount(
    store.db.scalar(
      `SELECT COUNT(*) ${where} AND i.scan_state = 'clean' AND ${PROMOTED_NOT_EXISTS}`,
      batchId,
      PROMOTED_CATEGORY,
      PROMOTED_ACTION,
    ),
  );
  return { batchId, total, clean, blocked, promoted, remaining };
}

/**
 * 下一批待处理切片：scan_state='clean' 且尚未晋升的条目，有界 limit，
 * 供当前 Agent 生成建议。已晋升的条目永不再返回——这就是会话中断续跑的
 * 持久化游标。blocked 条目（秘密/注入命中）在任何情况下都不会进入批次。
 */
export function nextBatchChunk(store: CairnStore, batchId: string, limit: number): BatchChunkItem[] {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw err('E_VALIDATION', 'limit 必须是正整数');
  }
  const rows = store.db.all(
    `SELECT i.id AS id, i.archive_id AS archive_id, i.content AS content,
            i.source_ref AS source_ref, i.content_hash AS content_hash
       FROM import_item i
      WHERE i.batch_id = ? AND i.scan_state = 'clean' AND ${PROMOTED_NOT_EXISTS}
      ORDER BY i.archive_id, i.item_index
      LIMIT ?`,
    batchId,
    PROMOTED_CATEGORY,
    PROMOTED_ACTION,
    limit,
  );
  return rows.map((r) => ({
    itemId: String(r['id']),
    archiveId: String(r['archive_id']),
    content: String(r['content']),
    sourceRef: (r['source_ref'] as string | null) ?? null,
    contentHash: String(r['content_hash']),
  }));
}

/**
 * 晋升标记：真实批准并晋升为正式记忆后调用。写 audit_event
 * （category='onboarding', action='item_promoted'，detail 含 itemId+memoryId）。
 * 幂等：同一 (itemId, memoryId) 重复标记不产生第二条审计；同一 itemId 晋升到
 * 不同 memoryId 视为状态改写，抛 E_CONFLICT_STATE。
 * 调用方契约：只允许对 scan_state='clean' 的条目调用（blocked 条目已被
 * nextBatchChunk 排除在批次之外，活动记忆侧另有 DB 触发器兜底）。
 */
export function markItemPromoted(store: CairnStore, itemId: string, memoryId: string): void {
  store.archives.requireItem(itemId); // 不存在 → E_NOT_FOUND
  if (typeof memoryId !== 'string' || memoryId.trim().length === 0) {
    throw err('E_VALIDATION', 'markItemPromoted 需要 memoryId');
  }
  store.db.transaction(() => {
    const rows = store.db.all(
      "SELECT detail FROM audit_event WHERE category = ? AND action = ? AND json_extract(detail, '$.itemId') = ?",
      PROMOTED_CATEGORY,
      PROMOTED_ACTION,
      itemId,
    );
    if (rows.length > 0) {
      const prevMemoryId = extractMemoryId(rows[0]!['detail']);
      if (prevMemoryId !== memoryId) {
        throw err('E_CONFLICT_STATE', '条目已晋升到另一条记忆，拒绝重复标记（审计即状态，不允许改写）', {
          itemId,
          promotedMemoryId: prevMemoryId,
        });
      }
      return; // 幂等：同条目同记忆，不重复记审计
    }
    store.audit.record(PROMOTED_CATEGORY, PROMOTED_ACTION, { type: 'import_item', id: itemId }, { itemId, memoryId });
  });
}

function extractMemoryId(detail: unknown): string | undefined {
  try {
    const parsed = JSON.parse(String(detail)) as { memoryId?: unknown };
    return typeof parsed.memoryId === 'string' ? parsed.memoryId : undefined;
  } catch {
    return undefined;
  }
}

function toCount(v: unknown): number {
  return Number(v ?? 0);
}
