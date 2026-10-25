import { gzipSync, gunzipSync } from 'node:zlib';
import { MemoryKind, Authority, Sensitivity } from '../core/types.js';
import { sha256Hex, normalizeContent } from '../core/hash.js';
import { err } from '../core/errors.js';

/**
 * 同步事件模型（design D2 / 构想 §10.1）：每设备每空间的追加事件链。
 * 修订以【内容哈希链】对账（parentHash = 被替换修订的规范化内容哈希），
 * 因为修订 id 在各设备本地生成、不可跨设备引用。
 */

export const SYNC_EVENT_VERSION = 1;

export interface SyncUpsertPayload {
  revisionId: string;
  content: string;
  contentHash: string;
  parentHash: string | null;
  kind: MemoryKind;
  authority: Authority;
  scopeId: string;
  sensitivity: Sensitivity;
  confidence: number;
  observedAt: string;
  createdAt: string;
  expiresAt: string | null;
  sourceAgent: string | null;
  createdBy: string;
  reason: string | null;
}

export interface SyncTombstonePayload {
  /** 遗忘时的内容哈希（tombstone 行记录）。 */
  lastContentHash: string;
  /** 推送端已知的全部修订内容哈希——跨设备记忆身份对齐（本地 id 不可跨设备引用）。 */
  knownHashes: string[];
}

export interface SyncEvent {
  deviceId: string;
  seq: number;
  type: 'memory_upsert' | 'memory_tombstone';
  /** 推送端本地记忆 id；跨设备对账以内容哈希血统为准（见 SyncTombstonePayload）。 */
  memoryId: string;
  occurredAt: string;
  payload: SyncUpsertPayload | SyncTombstonePayload | null;
}

/** 打包前校验：内容哈希必须与正文一致（传输完整性内建于事件）。 */
export function validateUpsertEvent(ev: SyncEvent): void {
  if (ev.type !== 'memory_upsert' || !ev.payload || !('content' in ev.payload)) {
    throw err('E_VALIDATION', `事件 ${ev.memoryId}#${ev.seq} 不是 upsert，无法校验内容哈希`);
  }
  const actual = contentHashOf(ev.payload.content);
  if (actual !== ev.payload.contentHash) {
    throw err('E_VALIDATION', `事件 ${ev.memoryId}#${ev.seq} 内容哈希不一致`, {
      expected: ev.payload.contentHash,
      actual,
    });
  }
}

function contentHashOf(text: string): string {
  return sha256Hex(normalizeContent(text));
}

// ---------------------------------------------------------------------------
// chunk 打包：事件批次 → JSON → gzip → 内容寻址 key
// ---------------------------------------------------------------------------

export interface ChunkMeta {
  key: string;
  seqFrom: number;
  seqTo: number;
  plaintextSha256: string;
  eventCount: number;
}

/** chunk 对象 key（内容寻址：seqFrom + 明文哈希）。 */
export function chunkKey(deviceId: string, seqFrom: number, plaintextSha256: string): string {
  return `devices/${deviceId}/chunks/${seqFrom}-${plaintextSha256}.bin`;
}

export function packChunk(deviceId: string, events: SyncEvent[]): { plaintext: Uint8Array; meta: ChunkMeta } {
  if (events.length === 0) throw err('E_VALIDATION', 'chunk 不能为空');
  const seqs = events.map((e) => e.seq);
  const seqFrom = Math.min(...seqs);
  const seqTo = Math.max(...seqs);
  const doc = { v: SYNC_EVENT_VERSION, deviceId, events };
  const json = Buffer.from(JSON.stringify(doc), 'utf8');
  const plaintext = gzipSync(json);
  const plaintextSha256 = sha256Hex(json);
  return { plaintext, meta: { key: chunkKey(deviceId, seqFrom, plaintextSha256), seqFrom, seqTo, plaintextSha256, eventCount: events.length } };
}

export function unpackChunk(plaintext: Uint8Array, deviceId: string, meta: ChunkMeta): SyncEvent[] {
  const json = gunzipSync(Buffer.from(plaintext));
  const doc = JSON.parse(json.toString('utf8')) as { v: number; deviceId: string; events: SyncEvent[] };
  if (doc.v !== SYNC_EVENT_VERSION) throw err('E_VALIDATION', `chunk 版本不兼容: ${doc.v}`);
  if (doc.deviceId !== deviceId) throw err('E_VALIDATION', `chunk 设备不匹配: ${doc.deviceId} ≠ ${deviceId}`);
  if (sha256Hex(json) !== meta.plaintextSha256) throw err('E_VALIDATION', 'chunk 明文哈希不一致');
  return doc.events;
}

// ---------------------------------------------------------------------------
// manifest：单写者 + headSeq 防回退
// ---------------------------------------------------------------------------

export interface ManifestDoc {
  v: number;
  vaultId: string;
  spaceKey: string;
  deviceId: string;
  generation: number;
  headSeq: number;
  chunks: ChunkMeta[];
  updatedAt: string;
}

export function emptyManifest(vaultId: string, spaceKey: string, deviceId: string): ManifestDoc {
  return { v: SYNC_EVENT_VERSION, vaultId, spaceKey, deviceId, generation: 0, headSeq: 0, chunks: [], updatedAt: new Date(0).toISOString() };
}

/** 新代次校验：headSeq 必须严格推进（单写者自防回退）。 */
export function nextManifest(current: ManifestDoc, addedChunks: ChunkMeta[]): ManifestDoc {
  if (addedChunks.length === 0) throw err('E_VALIDATION', '没有新 chunk 可发布');
  const headSeq = Math.max(current.headSeq, ...addedChunks.map((c) => c.seqTo));
  if (headSeq <= current.headSeq) {
    throw err('E_VALIDATION', `headSeq 不推进：${current.headSeq} → ${headSeq}`);
  }
  return {
    v: SYNC_EVENT_VERSION,
    vaultId: current.vaultId,
    spaceKey: current.spaceKey,
    deviceId: current.deviceId,
    generation: current.generation + 1,
    headSeq,
    chunks: [...current.chunks, ...addedChunks],
    updatedAt: new Date().toISOString(),
  };
}

export function manifestKey(deviceId: string): string {
  return `devices/${deviceId}/manifests/manifest.json`;
}
