import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { CairnDb } from './db.js';
import { err, CairnError } from '../core/errors.js';
import { nowIso } from '../core/time.js';
import { uuidv7 } from '../core/ids.js';

/**
 * 设备身份（spec memory-store：防克隆）。
 * device.json 保存在数据目录，与数据库分离；整目录克隆会复制同一身份。
 * 打开时比对 DB 内 instance_nonce：不一致 → 判定克隆，暂停旧身份写入。
 */

export interface DeviceIdentityFile {
  deviceId: string;
  instanceNonce: string;
  createdAt: string;
}

export interface DeviceRow {
  id: string;
  label: string | null;
  instanceNonce: string;
  enrollment: 'pending' | 'active' | 'suspended' | 'revoked';
  enrolledAt: string;
  suspendedReason: string | null;
}

const IDENTITY_FILE = 'device.json';

export function identityPath(dataDir: string): string {
  return join(dataDir, IDENTITY_FILE);
}

export function loadIdentity(dataDir: string): DeviceIdentityFile | null {
  const p = identityPath(dataDir);
  if (!existsSync(p)) return null;
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8')) as DeviceIdentityFile;
    if (typeof parsed.deviceId !== 'string' || typeof parsed.instanceNonce !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function createIdentity(dataDir: string): DeviceIdentityFile {
  mkdirSync(dataDir, { recursive: true });
  const identity: DeviceIdentityFile = {
    deviceId: `dev_${uuidv7()}`,
    instanceNonce: randomBytes(16).toString('hex'),
    createdAt: nowIso(),
  };
  writeFileSync(identityPath(dataDir), JSON.stringify(identity, null, 2), 'utf8');
  return identity;
}

export function loadOrCreateIdentity(dataDir: string): DeviceIdentityFile {
  return loadIdentity(dataDir) ?? createIdentity(dataDir);
}

export function getDeviceRow(db: CairnDb, deviceId: string): DeviceRow | null {
  const row = db.get('SELECT * FROM device WHERE id = ?', deviceId);
  return row ? mapDevice(row) : null;
}

function mapDevice(r: Record<string, unknown>): DeviceRow {
  return {
    id: r.id as string,
    label: (r.label as string | null) ?? null,
    instanceNonce: r.instance_nonce as string,
    enrollment: r.enrollment as DeviceRow['enrollment'],
    enrolledAt: r.enrolled_at as string,
    suspendedReason: (r.suspended_reason as string | null) ?? null,
  };
}

export function registerDevice(db: CairnDb, identity: DeviceIdentityFile, label?: string): DeviceRow {
  const existing = getDeviceRow(db, identity.deviceId);
  if (existing) return existing;
  db.run(
    'INSERT INTO device (id, label, instance_nonce, enrollment, enrolled_at) VALUES (?, ?, ?, ?, ?)',
    identity.deviceId,
    label ?? null,
    identity.instanceNonce,
    'active',
    nowIso(),
  );
  return getDeviceRow(db, identity.deviceId)!;
}

export interface CloneCheckResult {
  /** true：身份与库一致，可正常写入。 */
  ok: boolean;
  /** 克隆证据：库中 nonce 与身份文件不一致（整目录复制）。 */
  cloned: boolean;
  device: DeviceRow | null;
}

export function checkCloneState(db: CairnDb, identity: DeviceIdentityFile): CloneCheckResult {
  const device = getDeviceRow(db, identity.deviceId);
  if (!device) return { ok: true, cloned: false, device: null };
  const cloned = device.instanceNonce !== identity.instanceNonce;
  return { ok: !cloned && device.enrollment === 'active', cloned, device };
}

/**
 * 克隆恢复：为当前副本生成全新设备身份并注册（旧身份保留为 suspended 证据）。
 * 作用域收窄语义：旧设备产生的历史上行不会被撤回，由文档明确提示。
 */
export function reEnrollDevice(db: CairnDb, dataDir: string): { old: DeviceIdentityFile; identity: DeviceIdentityFile; device: DeviceRow } {
  const old = loadIdentity(dataDir);
  if (!old) throw err('E_DEVICE_SUSPENDED', '没有可重新登记的旧身份');
  // 旧身份若还在库中且 nonce 一致，标记 suspended（克隆源暂停写入）
  const oldRow = getDeviceRow(db, old.deviceId);
  db.transaction(() => {
    if (oldRow && oldRow.instanceNonce === old.instanceNonce && oldRow.enrollment === 'active') {
      db.run(
        "UPDATE device SET enrollment = 'suspended', suspended_reason = 're-enrolled: identity cloned or re-registered' WHERE id = ?",
        old.deviceId,
      );
    }
  });
  const backup = join(dataDir, `device.json.backup-${Date.now()}`);
  if (existsSync(identityPath(dataDir))) {
    try {
      renameSync(identityPath(dataDir), backup);
    } catch {
      /* 备份失败不阻塞重新登记 */
    }
  }
  const identity = createIdentity(dataDir);
  const device = registerDevice(db, identity);
  return { old, identity, device };
}

/** 写路径守卫：克隆或暂停状态下拒绝新写入（读不受影响）。 */
export function assertWritable(check: CloneCheckResult): void {
  if (check.cloned) {
    throw err('E_DEVICE_CLONED', '检测到设备目录被克隆：旧身份写入已暂停；请运行 device re-enroll 生成独立身份', {
      deviceId: check.device?.id,
    });
  }
  if (check.device && check.device.enrollment === 'suspended') {
    throw err('E_DEVICE_SUSPENDED', '设备处于暂停状态；请运行 device re-enroll 或恢复 enrollment');
  }
  if (check.device && check.device.enrollment === 'revoked') {
    throw err('E_DEVICE_SUSPENDED', '设备登记已被吊销');
  }
}

export function isDeviceClonedError(e: unknown): e is CairnError {
  return e instanceof CairnError && (e.code === 'E_DEVICE_CLONED' || e.code === 'E_DEVICE_SUSPENDED');
}
