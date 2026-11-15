import { CairnStore } from '../store/open.js';
import { err } from '../core/errors.js';
import { ScopeRow, scopeAllowsUpstream } from '../core/scope.js';
import {
  PERSONAL_SPACE_KEY,
  preserveModeEnabled,
  preserveSpaceKey,
  isPreserveScopePreset,
} from './vault.js';

/**
 * 上行路由的唯一判定点（add-cloud-preserve-mode D4 / spec「上行入队完备性」）。
 *
 * app-service / governance.apply / backfill 全部经这一个函数入队——
 * 路由判断曾在 push 与 enqueue 各写一份的教训（promotedPredicate / firstLine）不允许重演。
 *
 * 路由规则：
 * - personal-global（encrypted + all）→ `sync_upstream` → 个人链；
 * - 保管模式开启 + 设备限定/项目内容 → `sync_preserve` → 本设备保管链（preserve/<deviceId>）；
 * - 其余（device-local OFF / sensitive / agent-private / session-ephemeral）→ 不入队，
 *   这是正常结果不是错误（物理排除语义）。
 *
 * 惯例键（idempotencyKey）由调用方按入口给「基础键」，本函数为保管链任务追加
 * `:preserve` 后缀——同一记忆先上个人链后入保管链时，两个任务必须并存，
 * 复用同键会被 enqueue 的幂等去重挡住。
 */

export type SyncOp = 'memory_upsert' | 'memory_tombstone';

export interface EnqueueRouteResult {
  enqueued: boolean;
  /** 任务实际路由到的链；未入队时为 null。 */
  chain: string | null;
  jobType: 'sync_upstream' | 'sync_preserve' | 'sync_scope_exit' | null;
  reason?: 'scope_excluded' | 'duplicate';
}

export function enqueueMemorySync(
  store: CairnStore,
  input: { memoryId: string; scopeId: string; op: SyncOp; idempotencyKey: string },
): EnqueueRouteResult {
  const scope = store.scopes.requireById(input.scopeId);
  // 个人链内容：encrypted + all 由触发器兜底，应用层不再重复判定
  if (scope.preset === 'personal-global') {
    const r = store.outbox.enqueue({
      jobType: 'sync_upstream',
      scopeId: scope.id,
      entityType: 'memory',
      entityId: input.memoryId,
      payload: { op: input.op, memoryId: input.memoryId },
      idempotencyKey: input.idempotencyKey,
    });
    return { enqueued: r.enqueued, chain: r.enqueued ? PERSONAL_SPACE_KEY : null, jobType: r.enqueued ? 'sync_upstream' : null, reason: r.enqueued ? undefined : 'duplicate' };
  }
  // 保管模式开启：设备限定与项目内容 → 本设备保管链（spec「保管模式下设备限定写入入队」）
  if (isPreserveScopePreset(scope.preset) && preserveModeEnabled(store.paths.dataDir)) {
    const r = store.outbox.enqueue({
      jobType: 'sync_preserve',
      scopeId: scope.id,
      entityType: 'memory',
      entityId: input.memoryId,
      payload: { op: input.op, memoryId: input.memoryId },
      idempotencyKey: `${input.idempotencyKey}:preserve`,
    });
    return { enqueued: r.enqueued, chain: r.enqueued ? preserveSpaceKey(store.identity.deviceId) : null, jobType: r.enqueued ? 'sync_preserve' : null, reason: r.enqueued ? undefined : 'duplicate' };
  }
  // 关闭模式下的 project-global / 自定义加密空间：任务保留入队（延续既有语义），
  // push 侧「不可路由 → 完成 + 审计 sync_job_unroutable」负责收口（spec：
  // 上行任务 MUST 完成并写审计，MUST NOT 产生远端事件）。
  if (scopeAllowsUpstream(scope)) {
    const r = store.outbox.enqueue({
      jobType: 'sync_upstream',
      scopeId: scope.id,
      entityType: 'memory',
      entityId: input.memoryId,
      payload: { op: input.op, memoryId: input.memoryId },
      idempotencyKey: input.idempotencyKey,
    });
    return { enqueued: r.enqueued, chain: null, jobType: r.enqueued ? 'sync_upstream' : null, reason: r.enqueued ? undefined : 'duplicate' };
  }
  // agent-private / session-ephemeral / device-local(OFF)：任何模式都不上云——
  // 静默排除是既有语义的正常结果，不是错误（与旧 addMemory 行为一致，无审计噪音）。
  return { enqueued: false, chain: null, jobType: null, reason: 'scope_excluded' };
}

/**
 * 迁出个人链的迁出任务（tasks 2.1，模式无关）：入队固化 fromSpaceKey=personal，
 * 防 push 延迟期间二次迁移发错链（D4）。调用方必须已确认 previousScope 是个人链
 * 且记忆曾推送过（sync_pushed 元数据存在）。
 */
export function enqueueScopeExit(store: CairnStore, memoryId: string): EnqueueRouteResult {
  const r = store.outbox.enqueue({
    jobType: 'sync_scope_exit',
    scopeId: null,
    entityType: 'memory',
    entityId: memoryId,
    payload: { op: 'scope_exit', memoryId, fromSpace: PERSONAL_SPACE_KEY },
    idempotencyKey: `memory:${memoryId}:scope-exit:${Date.now()}`,
  });
  return { enqueued: r.enqueued, chain: r.enqueued ? PERSONAL_SPACE_KEY : null, jobType: r.enqueued ? 'sync_scope_exit' : null, reason: r.enqueued ? undefined : 'duplicate' };
}

/** 迁入保管链作用域的强制重发任务（rescope 用：内容未变也要按新描述符重发一次）。 */
export function enqueuePreserveResync(store: CairnStore, memoryId: string, scopeId: string): EnqueueRouteResult {
  const scope = store.scopes.requireById(scopeId);
  if (!isPreserveScopePreset(scope.preset)) {
    throw err('E_VALIDATION', `scope 不是保管链承载的作用域: ${scope.preset}`);
  }
  const r = store.outbox.enqueue({
    jobType: 'sync_preserve',
    scopeId: scope.id,
    entityType: 'memory',
    entityId: memoryId,
    payload: { op: 'memory_upsert', memoryId, force: true },
    idempotencyKey: `memory:${memoryId}:preserve-resync:${Date.now()}`,
  });
  return { enqueued: r.enqueued, chain: r.enqueued ? preserveSpaceKey(store.identity.deviceId) : null, jobType: r.enqueued ? 'sync_preserve' : null, reason: r.enqueued ? undefined : 'duplicate' };
}

/** 兼容包装：governance/apply 与 app-service 既有调用形态（作用域不允许上行时静默返回）。 */
export function routeMemoryUpstream(store: CairnStore, memoryId: string, scopeId: string, op: SyncOp, idempotencyKey: string): void {
  enqueueMemorySync(store, { memoryId, scopeId, op, idempotencyKey });
}

/** 作用域是否曾可上行到个人链（迁出判定的既有口径：encrypted + all + personal 预设）。 */
export function isPersonalChainScope(scope: ScopeRow): boolean {
  return scope.preset === 'personal-global' && scope.syncPolicy === 'encrypted' && scope.deviceId === 'all';
}
