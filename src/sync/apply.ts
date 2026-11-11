import { CairnStore } from '../store/open.js';
import { SyncEvent, SyncScopeExitPayload, SyncTombstonePayload } from './events.js';
import { err } from '../core/errors.js';
import { contentHash } from '../core/hash.js';
import { nowIso } from '../core/time.js';
import { AuditLog } from '../store/audit.js';

/**
 * 拉取应用（design D4 / spec cloud-sync「拉取合并与冲突保留」）：
 * 事件以内容哈希链对账——已知修订按哈希幂等跳过；parentHash 对齐本地当前修订 → 快进；
 * parentHash 在本地历史中但对不上当前 → 并发，双方保留并入冲突队列；
 * parentHash 完全未知 → 等待依赖（不应用、游标不推进该事件所在链）。
 * tombstone 传播：远端遗忘 → 本地 tombstoned；对已遗忘记忆的迟到 upsert 忽略并审计。
 * scope_exit（add-scope-migration）：远端迁出 → 本地标记「不再持有」（archived + meta 标记，
 * 无墓碑不删数据）；带 reentry 标记的迁回重推解除标记；迟到修订按 shadowed 跳过。
 */

export interface ApplyOutcome {
  applied: number;
  skipped: number;
  conflicted: number;
  waited: number;
  tombstoned: number;
  shadowed: number;
  /** 收到 scope_exit 并标记「不再持有」的条数（add-scope-migration）。 */
  scopeExited: number;
}

/** 「不再持有」标记：meta 行（不加表列；与 sync_pushed/sync_seq 同一 meta 键空间）。 */
function scopeExitKey(memoryId: string): string {
  return `scope_exit:${memoryId}`;
}

function hasScopeExitMarker(store: CairnStore, memoryId: string): boolean {
  return store.db.get('SELECT value FROM meta WHERE key = ?', scopeExitKey(memoryId)) != null;
}

function clearScopeExitMarker(store: CairnStore, memoryId: string): void {
  store.db.run('DELETE FROM meta WHERE key = ?', scopeExitKey(memoryId));
}

export function applyEvent(store: CairnStore, ev: SyncEvent, spaceKey: string, audit: AuditLog): keyof ApplyOutcome {
  const memories = store.memories;
  // 跨设备记忆身份对齐：id 命中 → 直接用；否则按修订内容哈希血统匹配
  // （记忆 id 在各设备本地生成，不可跨设备引用——第一版实现的教训）
  let mem = memories.get(ev.memoryId) ??
    memories.get(matchByLineage(store, ev) ?? '');

  if (ev.type === 'scope_exit') {
    if (!mem) {
      // 未知记忆的迁出通知：无对象可标（与 tombstone_unknown_memory 同姿势，如实审计）
      audit.record('sync', 'scope_exit_unknown_memory', { type: 'memory', id: ev.memoryId }, { from: ev.deviceId, seq: ev.seq });
      return 'shadowed';
    }
    if (mem.status === 'tombstoned') {
      // 本地已遗忘：遗忘比「不再持有」更彻底，标记无意义
      audit.record('sync', 'scope_exit_shadowed_by_tombstone', { type: 'memory', id: mem.id }, { from: ev.deviceId, seq: ev.seq });
      return 'skipped';
    }
    const alreadyMarked = hasScopeExitMarker(store, mem.id);
    if (alreadyMarked && mem.status === 'archived') return 'skipped'; // 幂等：重复事件不再改动
    store.db.transaction(() => {
      // 「本设备不再持有」= meta 标记 + archived 状态：检索不再返回（statuses 默认 active）、
      // 无墓碑记录、不删数据（spec memory-store「迁出事件的通知语义」）。
      if (!alreadyMarked) store.db.run('INSERT INTO meta (key, value) VALUES (?, ?)', scopeExitKey(mem.id), nowIso());
      store.db.run("UPDATE memory SET status = 'archived', updated_at = ? WHERE id = ?", nowIso(), mem.id);
    });
    audit.record('sync', 'scope_exit_applied', { type: 'memory', id: mem.id }, { from: ev.deviceId, seq: ev.seq });
    return 'scopeExited';
  }

  if (ev.type === 'memory_tombstone') {
    if (!mem) {
      // 未知记忆的遗忘：无对象可标（首版边界，如实审计）
      audit.record('sync', 'tombstone_unknown_memory', { type: 'memory', id: ev.memoryId }, { from: ev.deviceId, seq: ev.seq });
      return 'shadowed';
    }
    if (mem.status === 'tombstoned') return 'skipped';
    memories.forget(mem.id, `sync from ${ev.deviceId}#${ev.seq}`, `sync:${ev.deviceId}`);
    audit.record('sync', 'tombstone_propagated', { type: 'memory', id: mem.id }, { from: ev.deviceId, seq: ev.seq });
    return 'tombstoned';
  }

  if (ev.type !== 'memory_upsert') {
    // 未知事件类型（未来版本写入的事件）：跳过 + 审计，游标照常推进——
    // 不能因单个新类型事件卡死整条链（spec memory-store「未知事件降级」）。
    audit.record('sync', 'unknown_event_skipped', { type: 'memory', id: ev.memoryId }, {
      from: ev.deviceId,
      seq: ev.seq,
      eventType: String((ev as { type?: unknown }).type),
    });
    return 'skipped';
  }
  if (!ev.payload || !('content' in ev.payload)) {
    throw err('E_VALIDATION', `upsert 事件缺 upsert payload: ${ev.memoryId}#${ev.seq}`);
  }
  const payload = ev.payload;

  if (!mem) {
    // 未知记忆：直接创建（内容哈希完整性在 validateUpsertEvent 已保证）
    memories.add(
      {
        kind: payload.kind,
        content: payload.content,
        scopeId: scopeScopeId(store, spaceKey),
        authority: payload.authority,
        createdBy: payload.createdBy ?? `sync:${ev.deviceId}`,
        sourceAgent: payload.sourceAgent,
        sourceSessionId: null,
        evidence: [],
        expiresAt: payload.expiresAt,
        sensitivity: payload.sensitivity,
        observedAt: payload.observedAt,
      },
      store.identity.deviceId,
    );
    audit.record('sync', 'memory_created_from_remote', { type: 'memory', id: ev.memoryId }, { from: ev.deviceId, seq: ev.seq });
    return 'applied';
  }

  if (mem.status === 'tombstoned') {
    // 迟到的 upsert 不复活已遗忘记忆（保守；§10.2 遗忘与并发编辑进入恢复队列属后续）
    audit.record('sync', 'upsert_shadowed_by_tombstone', { type: 'memory', id: mem.id }, { from: ev.deviceId, seq: ev.seq });
    return 'shadowed';
  }

  // 迁回重推（add-scope-migration）：先解除「不再持有」并恢复活动，再走正常修订链。
  // 内容相同也会走到这里（先解除再判定 skipped），所以对端迁回后即使没有新修订也能重新持有。
  if (payload.reentry === true && hasScopeExitMarker(store, mem.id)) {
    clearScopeExitMarker(store, mem.id);
    if (mem.status === 'archived') {
      store.db.run("UPDATE memory SET status = 'active', updated_at = ? WHERE id = ?", nowIso(), mem.id);
    }
    audit.record('sync', 'scope_reheld', { type: 'memory', id: mem.id }, { from: ev.deviceId, seq: ev.seq });
  } else if (payload.reentry !== true && hasScopeExitMarker(store, mem.id)) {
    // 迁出后的迟到修订：不再作为活动内容呈现，也不解除标记（spec「迁出事件的通知语义」）
    audit.record('sync', 'upsert_shadowed_by_scope_exit', { type: 'memory', id: mem.id }, { from: ev.deviceId, seq: ev.seq });
    return 'shadowed';
  }

  if (mem.contentHash === payload.contentHash) return 'skipped';

  // 快进：远端事件的父哈希 == 本地当前内容哈希 → 远端是本地历史的孩子
  if (payload.parentHash && payload.parentHash === mem.contentHash) {
    memories.revise(
      mem.id,
      payload.content,
      { reason: `sync from ${ev.deviceId}#${ev.seq}`, author: `sync:${ev.deviceId}` },
      store.identity.deviceId,
    );
    audit.record('sync', 'fast_forwarded', { type: 'memory', id: mem.id }, { from: ev.deviceId, seq: ev.seq });
    return 'applied';
  }

  // 并发：parentHash 能对齐到本地历史（共同祖先）→ 保留双方并入冲突队列
  const ancestor = payload.parentHash ? memories.findRevisionByContentHash(mem.id, payload.parentHash) : null;
  if (payload.parentHash && ancestor) {
    const incoming = memories.insertRemoteRevision(
      mem.id,
      {
        content: payload.content,
        contentHash: payload.contentHash,
        author: `sync:${ev.deviceId}`,
        reason: `remote revision ${payload.revisionId} (parent ${payload.parentHash.slice(0, 12)})`,
        parentLocalRevisionId: mem.currentRevisionId,
        baseRevisionId: ancestor.id,
      },
      store.identity.deviceId,
    );
    const current = memories.require(mem.id);
    if (!current.currentRevisionId) throw err('E_CONFLICT_STATE', '并发合并时缺少当前修订');
    store.conflicts.record({
      memoryId: mem.id,
      baseRevisionId: ancestor.id,
      revisionAId: current.currentRevisionId,
      revisionBId: incoming.id,
    });
    audit.record('sync', 'conflict_recorded', { type: 'memory', id: mem.id }, { from: ev.deviceId, seq: ev.seq });
    return 'conflicted';
  }

  // parentHash 未知（本地无该祖先）→ 等待依赖：不应用、调用方不推进游标
  return 'waited';
}

/**
 * 按内容哈希血统匹配本地记忆：upsert 用 [contentHash, parentHash]，
 * tombstone 用 knownHashes。任一修订哈希命中即同一记忆。
 */
function matchByLineage(store: CairnStore, ev: SyncEvent): string | null {
  if (ev.type === 'memory_upsert' && ev.payload) {
    const p = ev.payload as { contentHash: string; parentHash: string | null };
    const hashes = [p.contentHash, p.parentHash].filter((h): h is string => Boolean(h));
    return store.memories.findMemoryIdByRevisionHashes(hashes);
  }
  if (ev.type === 'memory_tombstone' && ev.payload) {
    const p = ev.payload as SyncTombstonePayload;
    return store.memories.findMemoryIdByRevisionHashes(p.knownHashes ?? []);
  }
  if (ev.type === 'scope_exit' && ev.payload) {
    const p = ev.payload as SyncScopeExitPayload;
    return store.memories.findMemoryIdByRevisionHashes([p.lastContentHash, ...(p.knownHashes ?? [])].filter((h) => h.length > 0));
  }
  return null;
}

function scopeScopeId(store: CairnStore, spaceKey: string): string {
  if (spaceKey !== 'personal-global') {
    throw err('E_VALIDATION', `本变更仅同步 personal-global 空间，收到 ${spaceKey}`);
  }
  return store.scopes.resolvePreset('personal-global').id;
}

/** 批量应用：parentHash 未知的事件保留在返回值中由调用方决定重试；单事件失败不拖垮整批。 */
export function applyEvents(store: CairnStore, events: SyncEvent[], spaceKey: string): { outcome: ApplyOutcome; waitEvents: SyncEvent[] } {
  const audit = store.audit;
  const outcome: ApplyOutcome = { applied: 0, skipped: 0, conflicted: 0, waited: 0, tombstoned: 0, shadowed: 0, scopeExited: 0 };
  const waitEvents: SyncEvent[] = [];
  for (const ev of events) {
    try {
      const r = applyEvent(store, ev, spaceKey, audit);
      outcome[r]++;
      if (r === 'waited') waitEvents.push(ev);
    } catch (e) {
      // 单事件失败：审计并跳过（不推进对它的处理），不中断整批
      audit.record('sync', 'apply_error', { type: 'memory', id: ev.memoryId }, {
        from: ev.deviceId,
        seq: ev.seq,
        error: (e as Error).message.slice(0, 200),
        at: nowIso(),
      });
      outcome.waited++;
      waitEvents.push(ev);
    }
  }
  return { outcome, waitEvents };
}
