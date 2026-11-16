import { CairnStore } from '../store/open.js';
import { RemoteStore } from '../jobs/remote.js';
import { err } from '../core/errors.js';
import { sha256Hex } from '../core/hash.js';
import { nowIso } from '../core/time.js';
import {
  ChunkMeta,
  ManifestDoc,
  SyncEvent,
  SyncScopeDescriptor,
  SyncScopeExitPayload,
  SyncUpsertPayload,
  emptyManifest,
  nextManifest,
  packChunk,
  validateUpsertEvent,
} from './events.js';
import { deriveSpaceKey, loadKeys, encryptObject, decryptObject } from './cryptoutil.js';
import {
  VaultConfig,
  PERSONAL_SPACE_KEY,
  isPreserveSpaceKey,
  preserveSpaceKey,
  projectSpaceKey,
  projectIdFromSpaceKey,
  isPreserveScopePreset,
} from './vault.js';
import { ScopeRow } from '../core/scope.js';

/**
 * 同步推送（design D2 + add-cloud-preserve-mode D2/D4）：
 * outbox 的 sync_upstream / sync_preserve / sync_scope_exit 任务 → 事件 → chunk（加密）
 * → manifest（单写者，headSeq 防回退）。事件按内容哈希链组织。
 *
 * 按链分组发布（tasks 2.4）：个人链（personal-global）、项目链（project/<projectId>）
 * 与保管链（preserve/<deviceId>）各自 chunk / manifest / 代次。路由判定：
 * - sync_upstream + personal-global 记忆 → 个人链；
 * - 记忆作用域为 project-global（带 projectId）→ 项目链（与保管模式无关）；
 * - sync_preserve + 保管链承载作用域 → 保管链；
 * - 其余一律「完成 + 审计 sync_job_unroutable」——静默完成分支已消灭（tasks 2.3）：
 *   不可路由任务 MUST 完成并写审计，MUST NOT 产生远端事件。
 *
 * 关闭模式下设备限定内容由 outbox 层物理排除（触发器 + route.ts 双重检查），
 * 打包层对个人链再按 scope 过滤一次（spec：打包前物理排除）。
 * 失败只留下可重试状态：推送异常时已领取任务复位为 pending（spec agent-interfaces）。
 */

const MAX_EVENTS_PER_CHUNK = 200;
const MAX_CHUNK_BYTES = 512 * 1024;

function spaceSeqKey(spaceKey: string): string {
  return `sync_seq:${spaceKey}`;
}

function pushedRevisionKey(spaceKey: string, memoryId: string): string {
  return `sync_pushed:${spaceKey}:${memoryId}`;
}

export interface ChainPushResult {
  spaceKey: string;
  /** personal = 个人链；preserve = 本设备保管链；project = 项目链。 */
  role: 'personal' | 'preserve' | 'project';
  publishedChunks: ChunkMeta[];
  headSeq: number;
  eventCount: number;
  /** 该链完成的任务数（含事件为空被幂等完成的）。 */
  jobs: number;
}

export interface PushResult {
  publishedChunks: ChunkMeta[];
  headSeq: number;
  eventCount: number;
  jobs: number;
  /** 按链分列（tasks 2.4）；单链场景与顶层字段一致。 */
  chains: ChainPushResult[];
  /** 因不可路由而完成并审计的任务数（add-cloud-preserve-mode：消灭静默完成）。 */
  unroutable: number;
}

/** chunk 对象的远端相对 key：`<spaceKey>/devices/<dev>/chunks/<seq>-<hash>.bin`。 */
function chunkObjectKey(spaceKey: string, meta: ChunkMeta): string {
  return `${spaceKey}/${meta.key}`;
}

interface PendingJob {
  id: string;
  entityId: string;
  /** 完整任务行才带 payload；worker preclaim 路径会传入。op=scope_exit / force 用于控制事件。 */
  payload?: Record<string, unknown>;
  /** 任务类型（路由判定用）；worker preclaim 路径由调用方传入。 */
  jobTypeHint?: string;
}

/**
 * 从作用域行构造事件的作用域描述符（D3）。项目名取 project.name（显示名的权威出处），
 * 项目行缺失时回落 space.name（物化端重建项目行用）。
 */
function scopeDescriptor(store: CairnStore, scope: ScopeRow): SyncScopeDescriptor {
  const d: SyncScopeDescriptor = { preset: scope.preset };
  if (scope.projectId) {
    d.projectId = scope.projectId;
    const projectRow = store.db.get('SELECT name FROM project WHERE id = ?', scope.projectId);
    const spaceRow = projectRow ? null : store.db.get('SELECT name FROM space WHERE id = ?', scope.spaceId);
    const name = projectRow?.name ?? spaceRow?.name;
    if (name) d.spaceName = String(name);
  }
  if (scope.deviceId && scope.deviceId !== 'all') d.deviceId = scope.deviceId;
  return d;
}

interface ChainEvents {
  events: SyncEvent[];
  doneJobIds: string[];
}

/** 构建单链事件。payload 为当前修订快照；scope_exit 生成控制事件。 */
function buildEventsForChain(
  store: CairnStore,
  device: string,
  spaceKey: string,
  role: 'personal' | 'preserve' | 'project',
  jobs: PendingJob[],
  auditUnroutable: (job: PendingJob, reason: string) => void,
): ChainEvents {
  const events: SyncEvent[] = [];
  const doneJobIds: string[] = [];
  const personalScope = store.scopes.resolvePreset('personal-global');
  if (role === 'personal' && personalScope.syncPolicy !== 'encrypted') {
    throw err('E_FORBIDDEN', 'personal-global 作用域不是 encrypted；拒绝上行（物理排除语义）');
  }
  const chainProjectId = role === 'project' ? projectIdFromSpaceKey(spaceKey) : null;
  for (const job of jobs) {
    // 迁出通知任务（add-scope-migration）：独立的 sync_scope_exit jobType，
    // 生成控制事件而非修订内容。fromSpace 固化于入队时（D4）：只发到来源链。
    if (job.payload?.['op'] === 'scope_exit') {
      const fromSpace = typeof job.payload['fromSpace'] === 'string' ? String(job.payload['fromSpace']) : PERSONAL_SPACE_KEY;
      if (fromSpace !== spaceKey) {
        // 该迁出的来源链不是本链：留给对应链处理（目前迁出只发生在个人链）。
        continue;
      }
      const mem = store.memories.get(job.entityId);
      const pushedRow = store.db.get('SELECT value FROM meta WHERE key = ?', pushedRevisionKey(spaceKey, job.entityId));
      let lastHash: string | null = pushedRow ? String(pushedRow.value) : null;
      let knownHashes: string[] = [];
      if (mem) {
        knownHashes = store.memories.revisions(mem.id).map((r) => r.contentHash);
        lastHash = lastHash ?? mem.contentHash;
      } else {
        const t = store.memories.getTombstone(job.entityId);
        lastHash = lastHash ?? t?.contentHash ?? '';
      }
      const payload: SyncScopeExitPayload = { lastContentHash: lastHash ?? '', knownHashes };
      // 终态作用域（tasks 2.3 / D5）：取记忆【当前】作用域——迁移后即目的地。
      // 记忆已不存在（纯墓碑场景）时省略该字段。
      if (mem) {
        const destinationScope = store.scopes.getById(mem.scopeId);
        if (destinationScope) payload.terminalScope = scopeDescriptor(store, destinationScope);
      }
      events.push({ deviceId: device, seq: 0, type: 'scope_exit', memoryId: job.entityId, occurredAt: nowIso(), payload });
      doneJobIds.push(job.id);
      continue;
    }
    const mem = store.memories.get(job.entityId);
    if (!mem) {
      // 记忆已不存在：作为 tombstone 传播；对端按内容哈希血统对齐
      const hashRow = store.db.get('SELECT content_hash FROM tombstone WHERE memory_id = ? ORDER BY forgotten_at DESC LIMIT 1', job.entityId);
      events.push({
        deviceId: device,
        seq: 0,
        type: 'memory_tombstone',
        memoryId: job.entityId,
        occurredAt: nowIso(),
        payload: { lastContentHash: (hashRow?.content_hash as string) ?? '', knownHashes: hashRow ? [(hashRow.content_hash as string)] : [] },
      });
      doneJobIds.push(job.id);
      continue;
    }
    const memScope = store.scopes.getById(mem.scopeId);
    if (role === 'personal') {
      // 打包层物理排除（spec：打包前排除）+ 消灭静默完成（tasks 2.3）：
      // 非个人链记忆的任务不可路由 → 完成 + 审计（旧实现是静默完成，27 条迁移事故的根源）。
      if (!memScope || memScope.preset !== 'personal-global') {
        auditUnroutable(job, `memory_scope_not_personal:${memScope?.preset ?? 'unknown'}`);
        doneJobIds.push(job.id);
        continue;
      }
    } else if (role === 'project') {
      // 项目链只承载 project-global，且必须是本链的项目（tasks 2.2 物理排除断言）。
      if (!memScope || memScope.preset !== 'project-global' || !chainProjectId || memScope.projectId !== chainProjectId) {
        auditUnroutable(job, `memory_scope_not_project_chain:${memScope?.preset ?? 'unknown'}`);
        doneJobIds.push(job.id);
        continue;
      }
    } else {
      // 保管链：只承载保管链作用域；描述符取自当前作用域（D3）。
      if (!memScope || !isPreserveScopePreset(memScope.preset)) {
        auditUnroutable(job, `memory_scope_not_preservable:${memScope?.preset ?? 'unknown'}`);
        doneJobIds.push(job.id);
        continue;
      }
    }
    if (mem.status === 'tombstoned') {
      const knownHashes = store.memories.revisions(mem.id).map((r) => r.contentHash);
      const t = store.memories.getTombstone(mem.id);
      events.push({
        deviceId: device,
        seq: 0,
        type: 'memory_tombstone',
        memoryId: mem.id,
        occurredAt: nowIso(),
        payload: { lastContentHash: t?.contentHash ?? mem.contentHash, knownHashes },
      });
      doneJobIds.push(job.id);
      continue;
    }
    const currentRevId = mem.currentRevisionId;
    const pushedRow = store.db.get('SELECT value FROM meta WHERE key = ?', pushedRevisionKey(spaceKey, mem.id));
    const pushedRevId = pushedRow ? (pushedRow.value as string) : null;
    // force（迁回/重迁移重推）：修订未变也要重发一次修订快照，对端据此解除「不再持有」
    // 或按新描述符重新物化。
    const force = job.payload?.['force'] === true;
    if (!currentRevId || (pushedRevId === currentRevId && !force)) {
      // 无当前修订或该修订已推送：幂等完成
      doneJobIds.push(job.id);
      continue;
    }
    const rev = store.memories.requireRevision(currentRevId);
    const parentRow = pushedRevId ? store.db.get('SELECT content_hash FROM memory_revision WHERE id = ?', pushedRevId) : null;
    const payload: SyncUpsertPayload = {
      revisionId: rev.id,
      content: mem.content,
      contentHash: mem.contentHash,
      parentHash: parentRow ? (parentRow.content_hash as string) : null,
      kind: mem.kind,
      authority: mem.authority,
      scopeId: role === 'personal' ? PERSONAL_SPACE_KEY : memScope.preset,
      sensitivity: mem.sensitivity,
      confidence: mem.confidence,
      observedAt: mem.observedAt,
      createdAt: mem.createdAt,
      expiresAt: mem.expiresAt,
      sourceAgent: mem.sourceAgent,
      createdBy: mem.createdBy,
      reason: rev.reason,
      ...(role === 'personal' ? { scope: { preset: 'personal-global' } } : { scope: scopeDescriptor(store, memScope) }),
      ...(force ? { reentry: true } : {}),
    };
    events.push({ deviceId: device, seq: 0, type: 'memory_upsert', memoryId: mem.id, occurredAt: nowIso(), payload });
    doneJobIds.push(job.id);
  }
  return { events, doneJobIds };
}

function assignSeqs(store: CairnStore, spaceKey: string, events: SyncEvent[]): void {
  const key = spaceSeqKey(spaceKey);
  store.db.transaction(() => {
    for (const ev of events) {
      const row = store.db.get('SELECT value FROM meta WHERE key = ?', key);
      const seq = Number(row?.value ?? 0) + 1;
      if (row) {
        store.db.run('UPDATE meta SET value = ? WHERE key = ?', String(seq), key);
      } else {
        store.db.run('INSERT INTO meta (key, value) VALUES (?, ?)', key, String(seq));
      }
      ev.seq = seq;
    }
  });
}

/** 单个 job 的归属：返回目标链空间键；不可路由返回 null。 */
function routeJob(store: CairnStore, job: PendingJob, preserveOn: boolean): { spaceKey: string; role: 'personal' | 'preserve' | 'project' } | null {
  if (job.payload?.['op'] === 'scope_exit') {
    const fromSpace = typeof job.payload['fromSpace'] === 'string' ? String(job.payload['fromSpace']) : PERSONAL_SPACE_KEY;
    if (fromSpace === PERSONAL_SPACE_KEY) return { spaceKey: PERSONAL_SPACE_KEY, role: 'personal' };
    if (isPreserveSpaceKey(fromSpace)) return { spaceKey: fromSpace, role: 'preserve' };
    return null;
  }
  // sync_upstream：按记忆当前作用域路由（入队后可能已迁移；迁移动作会重建 outbox，
  // 这里是防御性兜底）。项目链判定必须排在 sync_preserve 与保管链之前——且
  // **不受 preserveDeviceBound 影响**：这是与保管链的关键差别（tasks 2.1）。
  const mem = store.memories.get(job.entityId);
  const scope = mem ? store.scopes.getById(mem.scopeId) : null;
  if (scope?.preset === 'project-global' && scope.projectId) {
    return { spaceKey: projectSpaceKey(scope.projectId), role: 'project' };
  }
  if (job.jobTypeHint === 'sync_preserve') {
    if (!preserveOn) return null;
    return { spaceKey: preserveSpaceKey(store.identity.deviceId), role: 'preserve' };
  }
  if (scope?.preset === 'personal-global') return { spaceKey: PERSONAL_SPACE_KEY, role: 'personal' };
  if (scope && isPreserveScopePreset(scope.preset) && preserveOn) {
    return { spaceKey: preserveSpaceKey(store.identity.deviceId), role: 'preserve' };
  }
  return null;
}

export async function syncPush(store: CairnStore, remote: RemoteStore, vault: VaultConfig, opts: { maxJobs?: number; preclaimedJobs?: PendingJob[] } = {}): Promise<PushResult | null> {
  store.assertWritable();
  const preserveOn = vault.preserveDeviceBound === true;
  const jobs: PendingJob[] = opts.preclaimedJobs
    ?? store.outbox
      .claimReady(opts.maxJobs ?? 200)
      .filter((j) => j.jobType === 'sync_upstream' || j.jobType === 'sync_scope_exit' || j.jobType === 'sync_preserve')
      .map((j) => ({ id: j.id, entityId: j.entityId, payload: j.payload, jobTypeHint: j.jobType }));
  if (jobs.length === 0) return null;
  try {
    return await pushClaimed(store, remote, vault, jobs, preserveOn);
  } catch (e) {
    // 失败复位：已领取任务回到 pending（可重试状态），错误照常抛出
    if (!opts.preclaimedJobs) {
      for (const j of jobs) {
        store.db.run("UPDATE outbox_job SET status = 'pending', updated_at = ? WHERE id = ? AND status = 'running'", nowIso(), j.id);
      }
    }
    throw e;
  }
}

async function pushClaimed(store: CairnStore, remote: RemoteStore, vault: VaultConfig, jobs: PendingJob[], preserveOn: boolean): Promise<PushResult> {
  const device = store.identity.deviceId;
  const keys = loadKeys(store.paths.dataDir);
  if (!keys) throw err('E_VALIDATION', '未找到 vault 密钥（keys.json）；请先 cairn vault init-remote');

  const counts = { unroutable: 0 };
  const auditUnroutable = (job: PendingJob, reason: string): void => {
    counts.unroutable++;
    store.audit.record('sync', 'sync_job_unroutable', { type: 'memory', id: job.entityId }, {
      jobId: job.id,
      jobType: job.jobTypeHint ?? null,
      reason,
    });
  };

  // 按目标链分组；不可路由任务立即完成 + 审计（MUST NOT 产生远端事件）
  const byChain = new Map<string, { role: 'personal' | 'preserve' | 'project'; jobs: PendingJob[] }>();
  const doneDirectly: string[] = [];
  for (const job of jobs) {
    const target = routeJob(store, job, preserveOn);
    if (!target) {
      auditUnroutable(job, preserveOn ? 'no_route_for_job' : 'preserve_mode_off_or_scope_not_routable');
      doneDirectly.push(job.id);
      continue;
    }
    const entry = byChain.get(target.spaceKey) ?? { role: target.role, jobs: [] };
    entry.jobs.push(job);
    byChain.set(target.spaceKey, entry);
  }
  for (const id of doneDirectly) store.outbox.markDone(id);

  const chains: ChainPushResult[] = [];
  for (const [spaceKey, entry] of byChain) {
    const { events, doneJobIds } = buildEventsForChain(store, device, spaceKey, entry.role, entry.jobs, auditUnroutable);
    // 【顺序纪律】先发布后 markDone（单链时代的既有契约：推送异常时已领取任务
    // 必须回到 pending 可重试）。markDone 提前会让「发布失败」把任务永久卡在
    // done——本地认为已上传、远端没有对象，且 catch 的 running 复位救不回来
    // （2026-11-15 真实库实测踩中：48 个保管链任务 done 而远端 0 对象）。
    const chainResult = await publishChain(store, remote, vault, keys, device, spaceKey, events);
    for (const id of doneJobIds) store.outbox.markDone(id);
    chains.push({ spaceKey, role: entry.role, jobs: entry.jobs.length, ...chainResult });
  }

  const publishedChunks = chains.flatMap((c) => c.publishedChunks);
  return {
    publishedChunks,
    headSeq: publishedChunks.length > 0 ? Math.max(...publishedChunks.map((c) => c.seqTo)) : 0,
    eventCount: chains.reduce((n, c) => n + c.eventCount, 0),
    jobs: jobs.length,
    chains,
    unroutable: counts.unroutable,
  };
}

/** 单链发布：分配序号 → chunk → manifest（既有单链逻辑参数化）。 */
async function publishChain(
  store: CairnStore,
  remote: RemoteStore,
  vault: VaultConfig,
  keys: NonNullable<ReturnType<typeof loadKeys>>,
  device: string,
  spaceKey: string,
  events: SyncEvent[],
): Promise<{ publishedChunks: ChunkMeta[]; headSeq: number; eventCount: number }> {
  if (events.length > 0) {
    assignSeqs(store, spaceKey, events);
    for (const ev of events) {
      if (ev.type === 'memory_upsert') validateUpsertEvent(ev);
    }
  }
  const spaceKeyBytes = deriveSpaceKey(keys.vaultKey, spaceKey);

  // 读自身 manifest（密文，AAD 绑定逻辑标识）
  let current: ManifestDoc = emptyManifest(vault.vaultId, spaceKey, device);
  const sealedManifest = await remote.getManifest(spaceKey, device);
  if (sealedManifest) {
    if (!(sealedManifest instanceof Uint8Array)) throw err('E_VALIDATION', '远端 manifest 不是字节对象');
    current = decryptManifestDoc(sealedManifest, keys.vaultKey, vault.vaultId, spaceKey, device);
  }

  const publishedChunks: ChunkMeta[] = [];
  for (let i = 0; i < events.length; i += MAX_EVENTS_PER_CHUNK) {
    const batch = events.slice(i, i + MAX_EVENTS_PER_CHUNK);
    let packed = packChunk(device, batch);
    while (packed.plaintext.byteLength > MAX_CHUNK_BYTES && batch.length > 1) {
      batch.splice(Math.ceil(batch.length / 2));
      packed = packChunk(device, batch);
    }
    const { plaintext, meta } = packed;
    if (meta.seqTo <= current.headSeq) continue; // 该序列段已发布（幂等重推）
    const sealed = encryptObject(plaintext, spaceKeyBytes, {
      vaultId: vault.vaultId,
      spaceId: spaceKey,
      kind: 'chunk',
      objectId: meta.key,
    });
    // hash 参数 = 传输字节（密文）的哈希；内容寻址的明文哈希在 key 中
    await remote.putImmutable(chunkObjectKey(spaceKey, meta), sealed, sha256Hex(Buffer.from(sealed)));
    publishedChunks.push(meta);
  }

  if (publishedChunks.length > 0) {
    const next = nextManifest(current, publishedChunks);
    const sealedNext = encryptObject(Buffer.from(JSON.stringify(next), 'utf8'), spaceKeyBytes, {
      vaultId: vault.vaultId,
      spaceId: spaceKey,
      kind: 'manifest',
      objectId: `manifest.json|${device}`,
    });
    await remote.putManifest(spaceKey, device, new Uint8Array(sealedNext), next.generation);
    store.db.transaction(() => {
      for (const ev of events) {
        if (ev.type !== 'memory_upsert' || !ev.payload || !('revisionId' in ev.payload)) continue;
        const k = pushedRevisionKey(spaceKey, ev.memoryId);
        const existing = store.db.get('SELECT value FROM meta WHERE key = ?', k);
        if (existing) {
          store.db.run('UPDATE meta SET value = ? WHERE key = ?', ev.payload.revisionId, k);
        } else {
          store.db.run('INSERT INTO meta (key, value) VALUES (?, ?)', k, ev.payload.revisionId);
        }
      }
    });
  }

  return { publishedChunks, headSeq: publishedChunks.length > 0 ? Math.max(...publishedChunks.map((c) => c.seqTo)) : current.headSeq, eventCount: events.length };
}

function decryptManifestDoc(sealed: Uint8Array, vaultKey: Uint8Array, vaultId: string, spaceKey: string, device: string): ManifestDoc {
  const plain = decryptObject(sealed, deriveSpaceKey(vaultKey, spaceKey), {
    vaultId,
    spaceId: spaceKey,
    kind: 'manifest',
    objectId: `manifest.json|${device}`,
  });
  const doc = JSON.parse(Buffer.from(plain).toString('utf8')) as ManifestDoc;
  if (doc.vaultId !== vaultId || doc.spaceKey !== spaceKey || doc.deviceId !== device) {
    throw err('E_VALIDATION', 'manifest 身份字段与寻址不一致');
  }
  return doc;
}
