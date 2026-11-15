import { CairnStore } from '../store/open.js';
import { SyncEvent, SyncScopeDescriptor, SyncScopeExitPayload, SyncTombstonePayload, SyncUpsertPayload } from './events.js';
import { err } from '../core/errors.js';
import { nowIso } from '../core/time.js';
import { AuditLog } from '../store/audit.js';
import { PERSONAL_SPACE_KEY, isPreserveSpaceKey, isPreserveScopePreset } from './vault.js';
import { ScopeRow } from '../core/scope.js';

/**
 * 拉取应用（design D4 / spec cloud-sync「拉取合并与冲突保留」+ add-cloud-preserve-mode D3）：
 * 事件以内容哈希链对账——已知修订按哈希幂等跳过；parentHash 对齐本地当前修订 → 快进；
 * parentHash 在本地历史中但对不上当前 → 并发，双方保留并入冲突队列；
 * parentHash 完全未知 → 等待依赖（不应用、游标不推进该事件所在链）。
 * tombstone 传播：远端遗忘 → 本地 tombstoned；对已遗忘记忆的迟到 upsert 忽略并审计。
 * scope_exit（add-scope-migration）：远端迁出 → 本地标记「不再持有」（meta 标记 + 归档，
 * 无墓碑不删数据）；带 reentry 标记的迁回重推解除标记；迟到修订按 shadowed 跳过。
 *
 * 物化过滤（add-cloud-preserve-mode tasks 3.2）：
 * - 个人链事件 → 物化为 personal-global（现状不变；旧事件无描述符同样走这条）；
 * - 本设备保管链事件 → 按描述符物化（device-local 归本机、项目内容归本机）；
 *   描述符缺失（防御）→ 按 device-local 处理并审计；
 *   agent-private / session-ephemeral 描述符 → 永不物化（skip + 审计）。
 * - 归属设备：落地时把 event.deviceId 记为 origin_device_id（D8）。
 *
 * 保管链是单写者链（只有本设备写），因此多一条个人链没有的规则：
 * 事件内容哈希命中本地任一历史修订 → 该事件已并入本地历史，跳过（不是等待）。
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

/** 「不再持有」标记：meta 行（不加表列；与 sync_pushed/sync_seq 同一 meta 键空间）。
 * 语义限定为「不再经个人链持有」（保管链内容不在个人链上，标记不覆盖它）。 */
function scopeExitKey(memoryId: string): string {
  return `scope_exit:${memoryId}`;
}

function hasScopeExitMarker(store: CairnStore, memoryId: string): boolean {
  return store.db.get('SELECT value FROM meta WHERE key = ?', scopeExitKey(memoryId)) != null;
}

function clearScopeExitMarker(store: CairnStore, memoryId: string): void {
  store.db.run('DELETE FROM meta WHERE key = ?', scopeExitKey(memoryId));
}

/** 链角色：个人链 / 本设备保管链。其余链在本变更中不存在。 */
type ChainRole = 'personal' | 'preserve';

function chainRole(spaceKey: string): ChainRole {
  if (spaceKey === PERSONAL_SPACE_KEY) return 'personal';
  if (isPreserveSpaceKey(spaceKey)) return 'preserve';
  throw err('E_VALIDATION', `未知同步链: ${spaceKey}`);
}

/**
 * 描述符 → 本地作用域行（find-or-create）。保管链事件的项目作用域会连带
 * find-or-create 项目与空间行（projectId 是跨设备稳定 UUID）；只建结构行，
 * 绝不产生任何 outbox 任务（spec：拉取路径不产生上行）。
 */
function materializeScope(store: CairnStore, role: ChainRole, descriptor: SyncScopeDescriptor | undefined, ownDeviceId: string): ScopeRow {
  if (role === 'personal') {
    return store.scopes.resolvePreset('personal-global');
  }
  const d = descriptor;
  if (!d) {
    // 保管链事件必有描述符（本变更起才有保管链）；缺失属防御路径，按设备限定落位。
    return store.scopes.resolvePreset('device-local', { deviceId: ownDeviceId });
  }
  if (d.preset === 'personal-global') {
    return store.scopes.resolvePreset('personal-global');
  }
  if (!isPreserveScopePreset(d.preset)) {
    // agent-private / session-ephemeral / custom：任何模式都不经云落地
    throw err('E_FORBIDDEN', `保管链事件描述符的作用域不可物化: ${d.preset}`);
  }
  if (d.preset === 'device-local') {
    return store.scopes.resolvePreset('device-local', { deviceId: d.deviceId ?? ownDeviceId });
  }
  // project-global / project-device：projectId 是稳定身份，直接 find-or-create
  const opts = { projectId: d.projectId ?? '', projectName: d.spaceName ?? d.projectId ?? d.preset };
  if (d.preset === 'project-device') {
    return store.scopes.resolvePreset('project-device', { ...opts, deviceId: d.deviceId ?? ownDeviceId });
  }
  return store.scopes.resolvePreset('project-global', opts);
}

export function applyEvent(store: CairnStore, ev: SyncEvent, spaceKey: string, audit: AuditLog): keyof ApplyOutcome {
  const memories = store.memories;
  const role = chainRole(spaceKey);
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
    if (alreadyMarked) return 'skipped'; // 幂等：标记存在即处理过（重复事件不再改动）
    store.db.transaction(() => {
      store.db.run('INSERT INTO meta (key, value) VALUES (?, ?)', scopeExitKey(mem.id), nowIso());
      // 归档只在「当前持有是经个人链」时发生：记忆已落在保管链作用域（自设备重放
      // 先于迁出事件到达）说明本设备仍以别的作用域持有它，只补标记不归档。
      const scope = store.scopes.getById(mem.scopeId);
      if (scope?.preset === 'personal-global') {
        store.db.run("UPDATE memory SET status = 'archived', updated_at = ? WHERE id = ?", nowIso(), mem.id);
      }
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
  const payload = ev.payload as SyncUpsertPayload;
  const descriptor = payload.scope as SyncScopeDescriptor | undefined;

  // 物化作用域（提前解析：个人链固定 personal-global；保管链按描述符）。
  // 保管链描述符不可物化（agent-private 等）→ skip + 审计，绝不落地。
  let matScope: ScopeRow;
  try {
    matScope = materializeScope(store, role, descriptor, store.identity.deviceId);
  } catch (e) {
    if ((e as { code?: string }).code === 'E_FORBIDDEN') {
      audit.record('sync', 'preserve_scope_not_materialized', { type: 'memory', id: ev.memoryId }, {
        from: ev.deviceId,
        seq: ev.seq,
        preset: descriptor?.preset ?? null,
      });
      return 'shadowed';
    }
    throw e;
  }

  if (!mem) {
    // 未知记忆：直接创建（内容哈希完整性在 validateUpsertEvent 已保证）。
    // 归属设备（D8）：记录事件来源设备（个人链事件的 deviceId = 发送设备）。
    memories.add(
      {
        kind: payload.kind,
        content: payload.content,
        scopeId: matScope.id,
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
      ev.deviceId,
    );
    audit.record('sync', 'memory_created_from_remote', { type: 'memory', id: ev.memoryId }, { from: ev.deviceId, seq: ev.seq });
    return 'applied';
  }

  if (mem.status === 'tombstoned') {
    // 迟到的 upsert 不复活已遗忘记忆（保守；§10.2 遗忘与并发编辑进入恢复队列属后续）
    audit.record('sync', 'upsert_shadowed_by_tombstone', { type: 'memory', id: mem.id }, { from: ev.deviceId, seq: ev.seq });
    return 'shadowed';
  }

  const marked = hasScopeExitMarker(store, mem.id);

  // 迁回重推（add-scope-migration）：先解除「不再持有」并恢复活动，再走正常修订链。
  // 内容相同也会走到这里（先解除再判定 skipped），所以对端迁回后即使没有新修订也能重新持有。
  // 重新持有时一并物化回 personal-global（记忆此前被本地迁到别的作用域的场景）。
  if (role === 'personal' && payload.reentry === true && marked) {
    clearScopeExitMarker(store, mem.id);
    if (mem.status === 'archived') {
      store.db.run("UPDATE memory SET status = 'active', updated_at = ? WHERE id = ?", nowIso(), mem.id);
    }
    if (mem.scopeId !== matScope.id) {
      store.memories.migrateScope(mem.id, matScope.id, `sync:${ev.deviceId}`);
    }
    audit.record('sync', 'scope_reheld', { type: 'memory', id: mem.id }, { from: ev.deviceId, seq: ev.seq });
  } else if (role === 'personal' && payload.reentry !== true && marked) {
    // 迁出后的迟到修订：不再作为活动内容呈现，也不解除标记（spec「迁出事件的通知语义」）
    audit.record('sync', 'upsert_shadowed_by_scope_exit', { type: 'memory', id: mem.id }, { from: ev.deviceId, seq: ev.seq });
    return 'shadowed';
  }

  // 保管链 upsert 落在带标记的记忆上：这是自设备重放（恢复场景）——设备仍以
  // 描述符作用域持有它。解除归档并按描述符落位；保留个人链标记（个人链持有确实已离开，
  // 迟到的个人链修订仍应被挡）。
  const reheldFromMarker = role === 'preserve' && marked;
  if (reheldFromMarker) {
    if (mem.status === 'archived') {
      store.db.run("UPDATE memory SET status = 'active', updated_at = ? WHERE id = ?", nowIso(), mem.id);
    }
    if (mem.scopeId !== matScope.id) {
      store.memories.migrateScope(mem.id, matScope.id, `sync:${ev.deviceId}`);
    }
    audit.record('sync', 'preserve_reheld', { type: 'memory', id: mem.id }, { from: ev.deviceId, seq: ev.seq });
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
    // 物化随内容走：保管链事件按描述符落位；个人链事件不动已有落位
    // （本设备主动迁移后的并发修订不该被拉回 personal-global）。
    if (role === 'preserve' && mem.scopeId !== matScope.id) {
      store.memories.migrateScope(mem.id, matScope.id, `sync:${ev.deviceId}`);
    }
    audit.record('sync', 'fast_forwarded', { type: 'memory', id: mem.id }, { from: ev.deviceId, seq: ev.seq });
    return 'applied';
  }

  // 每设备每链的事件序列是单写者的（个人链同样按设备分段）：事件内容已在
  // 本记忆历史中 → 已并入，跳过（不是等待）。自链重放（找回/自拉取）遇到
  // 「本地已是 v2、事件是 v1」的陈旧修订时，等下去只会让游标永远卡住——
  // 2026-11-15 真实库自拉取实测踩中（个人链自游标停在首个陈旧修订）。
  if (payload.contentHash) {
    const known = memories.findRevisionByContentHash(mem.id, payload.contentHash);
    if (known) {
      audit.record('sync', 'stale_event_skipped', { type: 'memory', id: mem.id }, { from: ev.deviceId, seq: ev.seq });
      return 'skipped';
    }
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
