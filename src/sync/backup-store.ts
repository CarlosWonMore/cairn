import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { CairnStore } from '../store/open.js';
import { backupDatabase, verifyBackup } from '../store/backup.js';
import { RemoteStore } from '../jobs/remote.js';
import { err, isCairnError } from '../core/errors.js';
import { sha256Hex } from '../core/hash.js';
import { deriveBackupKey, encryptObject, decryptObject, loadKeys } from './cryptoutil.js';
import { VaultConfig } from './vault.js';

/**
 * 设备备份通道（add-cloud-backup）：与同步事件链互不干扰的整库快照上传。
 *
 * - 前缀隔离：`backups/<deviceId>/...`，与事件链 `<spaceKey>/devices/...` 无交集；
 *   同步 list 只扫空间前缀，备份 list 只扫备份前缀，互不进入对方视野（spec）。
 * - 密钥隔离：deriveBackupKey(vaultKey, deviceId)，与 space 密钥不同域、混入设备维度
 *   ——只有生成备份的设备能解开（spec：按设备隔离）。
 * - 对象名内嵌明文 sha256：恢复时解密后重算比对（Poly1305 之外的第二道快照完整性检查）。
 * - 不进 outbox、不碰本地库状态：上传只是「读库 + 写远端」，失败不影响任何记忆读写。
 */

const BACKUP_PREFIX = 'backups';

/** 备份对象相对 key：`backups/<deviceId>/<name>`（远端实例自带 vault 前缀）。 */
export function backupObjectKey(deviceId: string, name: string): string {
  return `${BACKUP_PREFIX}/${deviceId}/${name}`;
}

export interface RemoteBackupInfo {
  name: string;
  key: string;
  /** 密文字节（list 只有 key，逐个拉一次算大小；份数 ≤10，量级无压力）。 */
  sealedBytes: number;
  /** 从对象名解析的上传时间（名字里带时间戳，不是远端 mtime）。 */
  uploadedAt: string | null;
  /** 内嵌的明文 sha256（恢复时校验用）。 */
  plainSha256: string | null;
}

/**
 * 列举**本设备**的备份：只扫自己的前缀，绝不触碰其他设备或事件链（task 4.3）。
 * 密文字节与时间从对象内容/名字里取——远端 list 只有 key。
 */
export async function listRemoteBackups(remote: RemoteStore, deviceId: string): Promise<RemoteBackupInfo[]> {
  const prefix = `${BACKUP_PREFIX}/${deviceId}/`;
  const { keys } = await remote.list(prefix);
  const out: RemoteBackupInfo[] = [];
  for (const key of keys.sort()) {
    const name = key.slice(prefix.length);
    if (name.length === 0 || name.includes('/')) continue;
    const sealed = await remote.getObject(key);
    if (sealed == null) continue; // 列举与读取之间的窗口（被保留策略删掉）：跳过不报错
    out.push({
      name,
      key,
      sealedBytes: sealed.byteLength,
      uploadedAt: parseBackupName(name).uploadedAt,
      plainSha256: parseBackupName(name).plainSha256,
    });
  }
  return out.sort((a, b) => (a.uploadedAt ?? '') < (b.uploadedAt ?? '') ? 1 : -1);
}

/**
 * 对象名 = `<本地快照文件名>-<plainSha256>.enc`；本地快照文件名自带 `cairn-backup-<ms>`。
 * 名字即元数据：恢复与列举不需要额外的 sidecar 对象。
 */
export function backupObjectName(snapshotFileName: string, plainSha256: string): string {
  return `${snapshotFileName}-${plainSha256}.enc`;
}

function parseBackupName(name: string): { uploadedAt: string | null; plainSha256: string | null } {
  const m = /^(cairn-backup-(\d+)\.db)-([0-9a-f]{64})\.enc$/.exec(name);
  if (!m || !m[2] || !m[3]) return { uploadedAt: null, plainSha256: null };
  return { uploadedAt: new Date(Number(m[2])).toISOString(), plainSha256: m[3] };
}

export interface UploadResult {
  name: string;
  key: string;
  plainBytes: number;
  sealedBytes: number;
  plainSha256: string;
  localSnapshot: { path: string; bytes: number; sha256: string };
  /** 保留清理实际删除的对象（不支持删除的后端为空，且带 pruneWarning）。 */
  pruned: string[];
  pruneWarning: string | null;
}

/**
 * 上传备份：本地一致性快照 → 设备密钥加密 → 独立前缀上传 → 保留清理。
 * 不改本地库状态（VACUUM INTO 是只读快照）；vault 未配置时明确拒绝（不产生弱加密产物）。
 */
export async function uploadRemoteBackup(
  store: CairnStore,
  remote: RemoteStore,
  vault: VaultConfig,
  opts: { keep?: number; targetPath?: string } = {},
): Promise<UploadResult> {
  const device = store.identity.deviceId;
  const keys = loadKeys(store.paths.dataDir);
  if (!keys) {
    throw err('E_VALIDATION', '未找到 vault 密钥（keys.json）；请先 cairn vault init-remote——备份必须端到端加密，不产生明文或弱加密产物');
  }
  // 本地一致性快照（复用既有 backupDatabase：VACUUM INTO + sha256）
  const target = opts.targetPath ?? join(store.paths.backupsDir, `cairn-backup-${Date.now()}.db`);
  const local = backupDatabase(store.db, target);
  const plaintext = readFileSync(local.path);

  const backupKey = deriveBackupKey(keys.vaultKey, device);
  const name = backupObjectName(local.path.split(/[\\/]/).pop() ?? 'cairn-backup.db', local.sha256);
  const key = backupObjectKey(device, name);
  const sealed = encryptObject(plaintext, backupKey, {
    vaultId: vault.vaultId,
    spaceId: BACKUP_PREFIX,
    kind: 'backup',
    objectId: name,
  });
  await remote.putImmutable(key, sealed, sha256Hex(Buffer.from(sealed)));

  // 保留清理：只看本设备前缀；按名字内嵌时间排序（新→旧），超出 keep 的淘汰。
  // 名字解析不出的对象一律不动（不是本机制的产物，删错不可逆），如实警告。
  const keep = Math.max(1, opts.keep ?? 5);
  const pruned: string[] = [];
  let pruneWarning: string | null = null;
  if (typeof remote.deleteObject !== 'function') {
    pruneWarning = '当前远端不支持删除（syncd 无 DELETE 路由），保留策略跳过；超出保留份数的旧备份需手动清理';
  } else {
    const prefix = `${BACKUP_PREFIX}/${device}/`;
    const all = (await remote.list(prefix)).keys;
    const parsed = all.map((k) => ({ key: k, uploadedAt: parseBackupName(k.slice(prefix.length)).uploadedAt }));
    const known = parsed.filter((x) => x.uploadedAt != null).sort((a, b) => (a.uploadedAt! < b.uploadedAt! ? 1 : -1));
    const unknownCount = parsed.length - known.length;
    const victims = known.slice(keep);
    for (const v of victims) {
      try {
        await remote.deleteObject(v.key);
      } catch (e) {
        // 旧版 syncd 的 DELETE 落 404（新版对不存在的备份也回 200）：诚实降级，
        // 不把「没删掉」记进 pruned——spec 要求如实报告「保留策略未生效」。
        if (isCairnError(e) && e.message === 'syncd_delete_unsupported') {
          pruneWarning = '保留策略未生效：远端不支持删除（旧版 syncd 无 DELETE 路由），旧备份仍在，需手动清理';
          break;
        }
        throw e;
      }
      pruned.push(v.key);
    }
    if (unknownCount > 0) {
      pruneWarning = `本设备前缀下有 ${unknownCount} 个名字不符合备份命名规则的对象，保留清理未触碰`;
    }
  }

  return {
    name,
    key,
    plainBytes: plaintext.byteLength,
    sealedBytes: sealed.byteLength,
    plainSha256: local.sha256,
    localSnapshot: { path: local.path, bytes: local.bytes, sha256: local.sha256 },
    pruned,
    pruneWarning,
  };
}

export interface RestoreResult {
  restoredTo: string;
  plainSha256: string;
  verified: boolean;
}

/**
 * 从远端恢复（add-cloud-backup D5）：默认还原到**新路径**，绝不覆盖当前库；
 * 覆盖由调用方（CLI）显式 --force 并先自动备份当前库。
 *
 * 校验链：下载 → 解密（Poly1305 / 设备密钥不匹配即失败）→ 明文 sha256 比对名字内嵌值
 * → verifyBackup（integrity + 可打开为库）→ 落盘。任一步失败中止且不产生半还原。
 */
export async function restoreRemoteBackup(
  store: CairnStore,
  remote: RemoteStore,
  vault: VaultConfig,
  name: string,
  opts: { toDir?: string } = {},
): Promise<RestoreResult> {
  const device = store.identity.deviceId;
  const keys = loadKeys(store.paths.dataDir);
  if (!keys) throw err('E_VALIDATION', '未找到 vault 密钥（keys.json）；无法解密备份');
  const parsed = parseBackupName(name);
  if (parsed.plainSha256 == null) {
    throw err('E_VALIDATION', `备份对象名不合法（期望 <cairn-backup-<ms>.db>-<sha256>.enc）: ${name}`);
  }
  const key = backupObjectKey(device, name);
  const sealed = await remote.getObject(key);
  if (sealed == null) {
    throw err('E_NOT_FOUND', `远端没有本设备的备份对象: ${name}（--list-remote 可查看；其他设备的备份不在此列）`);
  }
  const backupKey = deriveBackupKey(keys.vaultKey, device);
  let plaintext: Uint8Array;
  try {
    plaintext = decryptObject(sealed, backupKey, {
      vaultId: vault.vaultId,
      spaceId: BACKUP_PREFIX,
      kind: 'backup',
      objectId: name,
    });
  } catch {
    throw err('E_VALIDATION', '备份解密失败：密钥材料不匹配或密文已损坏（其他设备的备份在本设备上必然如此）');
  }
  // 明文 sha256 比对（名字内嵌值）：密文层认证之外的第二道快照完整性检查
  const actual = sha256Hex(Buffer.from(plaintext));
  if (actual !== parsed.plainSha256) {
    throw err('E_BACKUP_CORRUPT', '备份明文 sha256 与对象名内嵌值不一致，中止恢复', {
      expected: parsed.plainSha256,
      actual,
    });
  }
  const toDir = opts.toDir ?? join(store.paths.home, `restore-${Date.now()}`);
  mkdirSync(toDir, { recursive: true });
  const restoredPath = join(toDir, 'cairn.db');
  rmSync(restoredPath, { force: true });
  writeFileSync(restoredPath, plaintext);
  // 落盘后按快照明细校验（可打开为库 + integrity）；失败删除半成品并保留现状
  const check = verifyBackup(restoredPath);
  if (!check.ok) {
    rmSync(restoredPath, { force: true });
    throw err('E_BACKUP_CORRUPT', `恢复的快照未通过校验，已删除半成品: ${check.problems.join('; ')}`);
  }
  return { restoredTo: restoredPath, plainSha256: actual, verified: true };
}
