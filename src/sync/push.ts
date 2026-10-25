import { CairnStore } from '../store/open.js';
import { RemoteStore } from '../jobs/remote.js';
import { err } from '../core/errors.js';
import { nowIso } from '../core/time.js';
import {
  ChunkMeta,
  ManifestDoc,
  SyncEvent,
  SyncUpsertPayload,
  emptyManifest,
  nextManifest,
  packChunk,
  validateUpsertEvent,
} from './events.js';
import { deriveSpaceKey, loadKeys, encryptObject, decryptObject } from './cryptoutil.js';
import { VaultConfig, PERSONAL_SPACE_KEY } from './vault.js';

/**
 * 同步推送（design D2）：outbox 的 sync_upstream 任务 → 事件 → chunk（加密）
 * → manifest（单写者，headSeq 防回退）。事件按内容哈希链组织；
 * local_only/设备限定内容由 outbox 层物理排除（触发器兜底），
 * 打包层再按 scope 过滤一次（spec：打包前物理排除）。
 */

const MAX_EVENTS_PER_CHUNK = 200;
const MAX_CHUNK_BYTES = 512 * 1024;

function spaceSeqKey(spaceKey: string): string {
  return `sync_seq:${spaceKey}`;
}

function pushedRevisionKey(spaceKey: string, memoryId: string): string {
  return `sync_pushed:${spaceKey}:${memoryId}`;
}

export interface PushResult {
  publishedChunks: ChunkMeta[];
  headSeq: number;
  eventCount: number;
  jobs: number;
}

/** manifest 在远端的 (space, device) 寻址段：`<vaultId>/spaces/<spaceKey>`。 */
export function manifestSpacePath(vaultId: string, spaceKey: string): string {
  return `${vaultId}/spaces/${spaceKey}`;
}

/** chunk 对象的远端相对 key。 */
function chunkObjectKey(vaultId: string, spaceKey: string, meta: ChunkMeta): string {
  return `${manifestSpacePath(vaultId, spaceKey)}/${meta.key}`;
}

interface PendingJob {
  id: string;
  entityId: string;
}

/** 构建事件：只收 encrypted 作用域（personal-global）；payload 为当前修订快照。 */
function buildEvents(store: CairnStore, device: string, jobs: PendingJob[]): { events: SyncEvent[]; doneJobIds: string[] } {
  const events: SyncEvent[] = [];
  const doneJobIds: string[] = [];
  const scope = store.scopes.resolvePreset('personal-global');
  if (scope.syncPolicy !== 'encrypted') {
    throw err('E_FORBIDDEN', 'personal-global 作用域不是 encrypted；拒绝上行（物理排除语义）');
  }
  for (const job of jobs) {
    const mem = store.memories.get(job.entityId);
    if (!mem) {
      // 记忆已不存在：作为 tombstone 传播；对端按内容哈希血统对齐
      const hashRow = store.db.get('SELECT content_hash FROM tombstone WHERE memory_id = ? ORDER BY forgotten_at DESC LIMIT 1', job.entityId);
      events.push({
        deviceId: device, seq: 0, type: 'memory_tombstone', memoryId: job.entityId, occurredAt: nowIso(),
        payload: { lastContentHash: (hashRow?.content_hash as string) ?? '', knownHashes: hashRow ? [(hashRow.content_hash as string)] : [] },
      });
      doneJobIds.push(job.id);
      continue;
    }
    if (mem.scopeId !== scope.id) {
      // 作用域迁移属后续边界：不入本空间链，任务照常完成
      doneJobIds.push(job.id);
      continue;
    }
    if (mem.status === 'tombstoned') {
      // 已知修订哈希清单：对端按血统对齐本地记忆
      const knownHashes = store.memories.revisions(mem.id).map((r) => r.contentHash);
      const t = store.memories.getTombstone(mem.id);
      events.push({
        deviceId: device, seq: 0, type: 'memory_tombstone', memoryId: mem.id, occurredAt: nowIso(),
        payload: { lastContentHash: t?.contentHash ?? mem.contentHash, knownHashes },
      });
      doneJobIds.push(job.id);
      continue;
    }
    const currentRevId = mem.currentRevisionId;
    const pushedRow = store.db.get('SELECT value FROM meta WHERE key = ?', pushedRevisionKey(PERSONAL_SPACE_KEY, mem.id));
    const pushedRevId = pushedRow ? (pushedRow.value as string) : null;
    if (!currentRevId || pushedRevId === currentRevId) {
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
      scopeId: PERSONAL_SPACE_KEY,
      sensitivity: mem.sensitivity,
      confidence: mem.confidence,
      observedAt: mem.observedAt,
      createdAt: mem.createdAt,
      expiresAt: mem.expiresAt,
      sourceAgent: mem.sourceAgent,
      createdBy: mem.createdBy,
      reason: rev.reason,
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

export async function syncPush(store: CairnStore, remote: RemoteStore, vault: VaultConfig, opts: { maxJobs?: number; preclaimedJobs?: { id: string; entityId: string }[] } = {}): Promise<PushResult | null> {
  store.assertWritable();
  const spaceKey = PERSONAL_SPACE_KEY;
  const jobs = opts.preclaimedJobs ?? store.outbox.claimReady(opts.maxJobs ?? 200).filter((j) => j.jobType === 'sync_upstream');
  if (jobs.length === 0) return null;
  const device = store.identity.deviceId;

  const { events, doneJobIds } = buildEvents(store, device, jobs.map((j) => ({ id: j.id, entityId: j.entityId })));
  if (events.length > 0) {
    assignSeqs(store, spaceKey, events);
    for (const ev of events) {
      if (ev.type === 'memory_upsert') validateUpsertEvent(ev);
    }
  }

  const keys = loadKeys(store.paths.dataDir);
  if (!keys) throw err('E_VALIDATION', '未找到 vault 密钥（keys.json）；请先 cairn vault init-remote');
  const spaceKeyBytes = deriveSpaceKey(keys.vaultKey, spaceKey);

  // 读自身 manifest（密文，AAD 绑定逻辑标识）
  const spacePath = manifestSpacePath(vault.vaultId, spaceKey);
  let current: ManifestDoc = emptyManifest(vault.vaultId, spaceKey, device);
  const sealedManifest = await remote.getManifest(`${spacePath}/devices`, device);
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
    await remote.putImmutable(chunkObjectKey(vault.vaultId, spaceKey, meta), sealed, meta.plaintextSha256);
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
    await remote.putManifest(`${spacePath}/devices`, device, new Uint8Array(sealedNext), next.generation);
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

  for (const j of jobs) {
    if (doneJobIds.includes(j.id)) store.outbox.markDone(j.id);
  }

  return {
    publishedChunks,
    headSeq: publishedChunks.length > 0 ? Math.max(...publishedChunks.map((c) => c.seqTo)) : current.headSeq,
    eventCount: events.length,
    jobs: jobs.length,
  };
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

