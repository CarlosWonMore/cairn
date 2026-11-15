import { CairnStore } from '../store/open.js';
import { RemoteStore } from '../jobs/remote.js';
import { err } from '../core/errors.js';
import {
  ChunkMeta,
  ManifestDoc,
  SyncEvent,
  manifestKey,
  unpackChunk,
} from './events.js';
import { deriveSpaceKey, loadKeys, decryptObject } from './cryptoutil.js';
import { VaultConfig, PERSONAL_SPACE_KEY, isPreserveSpaceKey, syncableChains } from './vault.js';
import { applyEvents, ApplyOutcome } from './apply.js';

/**
 * 同步拉取（design D4 + add-cloud-preserve-mode D2/tasks 3.1）：
 * 拉取范围 = syncableChains()——个人链恒在；保管模式开启时加本设备保管链。
 * 他人保管链对象完全不被下载（前缀隔离：`preserve/<别的设备>/` 不在任何列举范围内）。
 * 每条链：列举其他设备 → 读 manifest（密文）→ 按 headSeq 对本地游标取差量 chunk
 * → 解密 → 按事件序幂等应用 → 推进游标（单事务）。中断可重入：游标只在一个
 * chunk 全部事件应用成功后推进。
 */

export interface PullDeviceResult {
  deviceId: string;
  /** 事件链空间键（个人链或保管链）。 */
  spaceKey: string;
  headSeq: number;
  appliedBefore: number;
  outcome: ApplyOutcome | null;
  waited: number;
  /** 该设备被跳过的原因（外来 vault / 密文不可解密），不致命。 */
  skippedReason?: string;
}

export interface PullResult {
  devices: PullDeviceResult[];
  totalApplied: number;
}

export function pullCursorKey(spaceKey: string, remoteDevice: string): string {
  return `sync_pull:${spaceKey}:${remoteDevice}`;
}

function getCursor(store: CairnStore, spaceKey: string, remoteDevice: string): number {
  const row = store.db.get('SELECT value FROM meta WHERE key = ?', pullCursorKey(spaceKey, remoteDevice));
  return Number(row?.value ?? 0);
}

function setCursor(store: CairnStore, spaceKey: string, remoteDevice: string, seq: number): void {
  const key = pullCursorKey(spaceKey, remoteDevice);
  const existing = store.db.get('SELECT value FROM meta WHERE key = ?', key);
  if (existing) {
    store.db.run('UPDATE meta SET value = ? WHERE key = ?', String(seq), key);
  } else {
    store.db.run('INSERT INTO meta (key, value) VALUES (?, ?)', key, String(seq));
  }
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

/** 解密单个 chunk 并还原事件（含完整性校验）。 */
function decryptChunk(sealed: Uint8Array, vaultKey: Uint8Array, vaultId: string, spaceKey: string, meta: ChunkMeta, deviceId: string): SyncEvent[] {
  const plain = decryptObject(sealed, deriveSpaceKey(vaultKey, spaceKey), {
    vaultId,
    spaceId: spaceKey,
    kind: 'chunk',
    objectId: meta.key,
  });
  return unpackChunk(plain, deviceId, meta);
}

function chunkObjectKey(spaceKey: string, meta: ChunkMeta): string {
  return `${spaceKey}/${meta.key}`;
}

export async function syncPull(store: CairnStore, remote: RemoteStore, vault: VaultConfig): Promise<PullResult> {
  store.assertWritable();
  const keys = loadKeys(store.paths.dataDir);
  if (!keys) throw err('E_VALIDATION', '未找到 vault 密钥（keys.json）；请先 cairn vault init-remote 或导入恢复材料');
  const myDevice = store.identity.deviceId;

  const results: PullDeviceResult[] = [];
  let totalApplied = 0;
  for (const spaceKey of syncableChains(vault, myDevice)) {
    // 个人链：消费链上全部设备的 manifest（含自己——找回场景）；
    // 保管链：单写者，只有自己的 manifest。
    const sourceDeviceIds = isPreserveSpaceKey(spaceKey) ? [myDevice] : await listRemoteDevices(remote, spaceKey, myDevice);
    for (const deviceId of sourceDeviceIds) {
      const r = await pullFromDevice(store, remote, vault, keys, spaceKey, deviceId);
      if (r) {
        results.push(r);
        totalApplied += r.appliedBefore;
      }
    }
  }
  void manifestKey;
  return { devices: results, totalApplied };
}

/**
 * 发现某条链上的远端设备：列举 <spaceKey>/devices/<id>/manifest.json。
 * 包含自己（add-cloud-preserve-mode 找回场景）：本地数据目录丢失后，个人链与保管链
 * 的恢复都靠重放自己的 manifest。游标机制保证幂等且增量——健康设备首次自拉取
 * 只是「全部跳过 + 游标推进到头」，之后每轮只看新增。
 */
async function listRemoteDevices(remote: RemoteStore, spaceKey: string, _myDevice: string): Promise<string[]> {
  const listing = await remote.list(`${spaceKey}/devices/`);
  const manifestSuffix = '/manifest.json';
  const deviceIds = new Set<string>();
  for (const k of listing.keys) {
    if (!k.endsWith(manifestSuffix)) continue;
    const rel = k.slice(`${spaceKey}/devices/`.length);
    const d = rel.slice(0, rel.indexOf('/'));
    if (d) deviceIds.add(d);
  }
  return [...deviceIds];
}

async function pullFromDevice(
  store: CairnStore,
  remote: RemoteStore,
  vault: VaultConfig,
  keys: NonNullable<ReturnType<typeof loadKeys>>,
  spaceKey: string,
  deviceId: string,
): Promise<PullDeviceResult | null> {
  const sealed = await remote.getManifest(spaceKey, deviceId);
  if (!sealed) return null; // 该设备在此链上没有 manifest（含健康设备的自链）：无行可报
  if (!(sealed instanceof Uint8Array)) throw err('E_VALIDATION', '远端 manifest 不是字节对象');
  // 第三轮验证 P1：外来 vault / 密钥不匹配的 manifest 解密必然失败——
  // 降级为跳过 + 审计（不是密钥损坏，不能让本 vault 的同步停摆）
  let manifest: ManifestDoc;
  try {
    manifest = decryptManifestDoc(sealed, keys.vaultKey, vault.vaultId, spaceKey, deviceId);
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === 'E_VALIDATION') {
      store.audit.record('sync', 'manifest_skipped', { type: 'system', id: deviceId }, { reason: 'foreign_vault_or_undecryptable', spaceKey });
      return { deviceId, spaceKey, headSeq: 0, appliedBefore: 0, outcome: null, waited: 0, skippedReason: 'foreign_vault_or_undecryptable' };
    }
    throw e;
  }
  const cursor = getCursor(store, spaceKey, deviceId);
  if (manifest.headSeq <= cursor) {
    return { deviceId, spaceKey, headSeq: manifest.headSeq, appliedBefore: 0, outcome: null, waited: 0 };
  }
  // 取 (cursor, headSeq] 覆盖的 chunk
  const chunks: ChunkMeta[] = manifest.chunks.filter((c) => c.seqTo > cursor && c.seqFrom <= manifest.headSeq).sort((a, b) => a.seqFrom - b.seqFrom);
  const events: SyncEvent[] = [];
  let chunkSkip = false;
  for (const meta of chunks) {
    const sealedChunk = await remote.getObject(chunkObjectKey(spaceKey, meta));
    if (!sealedChunk) {
      // chunk 缺失（上传中断于 manifest 之前的孤儿引用）：跳过该 chunk，游标不越过它
      store.audit.record('sync', 'chunk_missing', { type: 'system', id: meta.key }, { device: deviceId, spaceKey });
      break;
    }
    try {
      events.push(...decryptChunk(sealedChunk, keys.vaultKey, vault.vaultId, spaceKey, meta, deviceId));
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'E_VALIDATION') {
        // 单个 chunk 不可解密（外来/损坏）：跳过该设备本轮，不拖垮整链
        store.audit.record('sync', 'chunk_skipped', { type: 'system', id: meta.key }, { device: deviceId, spaceKey, reason: 'undecryptable' });
        chunkSkip = true;
        break;
      }
      throw e;
    }
  }
  if (chunkSkip) {
    return { deviceId, spaceKey, headSeq: manifest.headSeq, appliedBefore: 0, outcome: null, waited: 0, skippedReason: 'undecryptable_chunk' };
  }
  // 按序应用（物化过滤在 applyEvent 内按链角色执行）
  events.sort((a, b) => a.seq - b.seq);
  const { outcome, waitEvents } = applyEvents(store, events, spaceKey);
  // 游标推进到最后一个成功应用的事件序（等待依赖的事件不推进——下次重试）
  let appliedThrough = cursor;
  for (const ev of events) {
    if (waitEvents.some((w) => w.seq === ev.seq && w.memoryId === ev.memoryId)) break;
    appliedThrough = ev.seq;
  }
  if (appliedThrough > cursor) setCursor(store, spaceKey, deviceId, appliedThrough);
  const applied = (outcome?.applied ?? 0) + (outcome?.tombstoned ?? 0) + (outcome?.conflicted ?? 0) + (outcome?.scopeExited ?? 0);
  return {
    deviceId,
    spaceKey,
    headSeq: manifest.headSeq,
    appliedBefore: applied,
    outcome,
    waited: waitEvents.length,
  };
}
