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
 * - 所有"这条还需要处理吗"的判断统一走 promotedPredicate()（审计存在即已晋升）；
 * - 好处：晋升动作本身永远是可审计事件（谁在何时晋升了哪条到哪条记忆），
 *   状态与审计天然一致，且跨会话持久。
 */

const PROMOTED_CATEGORY = 'onboarding';
const PROMOTED_ACTION = 'item_promoted';

/**
 * 「这条导入条目已经晋升过了吗」的唯一出处。
 *
 * 语义刻意只认审计事实：**晋升过就是晋升过**，与目标记忆后来变成 active、
 * archived 还是 tombstoned 无关。
 *
 * 为什么不能跟着记忆状态走：撤销（policy revoke）会把记忆转 tombstone。如果
 * 谓词随之失效，条目就自动回到"待整理"，下一次普通运行会**把用户刚撤销的
 * 记忆重新写回来**——撤销于是变成一次性的，定时任务或续跑都能把它翻掉。
 * 真正的"重做"必须显式：`onboarding auto --redo`（选条目 + 规则层都重新判）。
 *
 * 调用方一律用它，不要自己手写 EXISTS 子句：这个谓词曾经在 6 个文件里各写一遍，
 * 改语义时漏掉任何一处，各处行为就会互相矛盾。
 */
export function promotedPredicate(alias = 'i'): { exists: string; notExists: string } {
  // 允许 console/model.ts 的 %ALIAS% 占位符（它做字符串替换后再拼接）。
  if (alias !== '%ALIAS%' && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) {
    throw err('E_VALIDATION', `非法 SQL 别名: ${alias}`);
  }
  const exists = `EXISTS (
  SELECT 1 FROM audit_event a
   WHERE a.category = '${PROMOTED_CATEGORY}' AND a.action = '${PROMOTED_ACTION}'
     AND json_extract(a.detail, '$.itemId') = ${alias}.id)`;
  return { exists, notExists: `NOT ${exists}` };
}

const { exists: PROMOTED_EXISTS, notExists: PROMOTED_NOT_EXISTS } = promotedPredicate('i');

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
    store.db.scalar(`SELECT COUNT(*) ${where} AND ${PROMOTED_EXISTS}`, batchId),
  );
  const remaining = toCount(
    store.db.scalar(
      `SELECT COUNT(*) ${where} AND i.scan_state = 'clean' AND ${PROMOTED_NOT_EXISTS}`,
      batchId,
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
 *
 * 例外：原目标记忆已被遗忘（tombstone）时允许改挂到新记忆。撤销（policy revoke）
 * 之后再整理必然会走到这里——旧记忆已经不存在，再死守旧映射只会让条目永远卡在
 * "已晋升"。此时追加一条审计，旧的保留在历史里（审计只增不改），判定以新的一条为准。
 *
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
      if (prevMemoryId === memoryId) return; // 幂等：同条目同记忆，不重复记审计
      if (prevMemoryId == null || !isTombstoned(store, prevMemoryId)) {
        throw err('E_CONFLICT_STATE', '条目已晋升到另一条记忆，拒绝重复标记（审计即状态，不允许改写）', {
          itemId,
          promotedMemoryId: prevMemoryId,
        });
      }
      // 原目标已被遗忘 → 视为重新整理，落到下面的追加逻辑。
    }
    store.audit.record(PROMOTED_CATEGORY, PROMOTED_ACTION, { type: 'import_item', id: itemId }, { itemId, memoryId });
  });
}

/**
 * 原晋升目标是否已被遗忘。只认明确的 tombstone：记忆行不存在（脏 id、被硬删的旧数据）
 * 不算"已遗忘"，那种情况下宁可报冲突让人看一眼，也不要猜。
 */
function isTombstoned(store: CairnStore, memoryId: string): boolean {
  const row = store.db.get('SELECT status FROM memory WHERE id = ?', memoryId);
  return row != null && String(row['status']) === 'tombstoned';
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
