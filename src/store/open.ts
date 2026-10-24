import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { CairnDb } from './db.js';
import { runMigrations, schemaVersion } from './migrate.js';
import { ScopeRepository } from './scopes.js';
import { MemoryRepository } from './memories.js';
import { ImportArchiveRepository } from './archives.js';
import { PlanRepository } from './plans.js';
import { OutboxRepository } from './outbox.js';
import { ManagedBlockRepository, DeviceInstallationRepository } from './blocks.js';
import { AuditLog } from './audit.js';
import {
  loadIdentity,
  loadOrCreateIdentity,
  registerDevice,
  checkCloneState,
  assertWritable,
  CloneCheckResult,
  DeviceIdentityFile,
  reEnrollDevice,
} from './device.js';
import { err } from '../core/errors.js';
import { nowIso } from '../core/time.js';

/** Cairn 数据目录布局：~/.cairn（CAIRN_HOME 可重定向；测试一律用合成目录）。 */
export interface CairnPaths {
  home: string;
  dbPath: string;
  dataDir: string;
  snapshotsDir: string;
  backupsDir: string;
}

export function defaultHome(): string {
  return process.env['CAIRN_HOME'] ?? join(homedir(), '.cairn');
}

export function resolvePaths(home: string): CairnPaths {
  const dataDir = join(home, 'data');
  return {
    home,
    dbPath: join(dataDir, 'cairn.db'),
    dataDir,
    snapshotsDir: join(home, 'snapshots'),
    backupsDir: join(home, 'backups'),
  };
}

export function ensureDirs(paths: CairnPaths): void {
  for (const d of [paths.home, paths.dataDir, paths.snapshotsDir, paths.backupsDir]) {
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
  }
}

export interface CairnStore {
  paths: CairnPaths;
  db: CairnDb;
  identity: DeviceIdentityFile;
  cloneCheck: CloneCheckResult;
  scopes: ScopeRepository;
  memories: MemoryRepository;
  archives: ImportArchiveRepository;
  plans: PlanRepository;
  outbox: OutboxRepository;
  blocks: ManagedBlockRepository;
  installations: DeviceInstallationRepository;
  audit: AuditLog;
  /** 写操作前置守卫：克隆/暂停状态抛 E_DEVICE_CLONED / E_DEVICE_SUSPENDED。 */
  assertWritable(): void;
  reEnroll(): ReturnType<typeof reEnrollDevice>;
  close(): void;
}

export interface OpenStoreOptions {
  home?: string;
  readOnly?: boolean;
  /** 跳过迁移（仅特殊诊断用途）。 */
  skipMigrations?: boolean;
}

/**
 * 打开本地权威库：目录准备 → 迁移 → 设备身份与克隆检测 → 仓储装配。
 * 迁移失败绝不进入正常读写（design Migration Plan）。
 */
export function openStore(opts: OpenStoreOptions = {}): CairnStore {
  const paths = resolvePaths(opts.home ?? defaultHome());
  if (!opts.readOnly) ensureDirs(paths);
  if (opts.readOnly && !existsSync(paths.dbPath)) {
    throw err('E_IO', `只读打开失败：数据库不存在 ${paths.dbPath}`);
  }
  const db = CairnDb.open(paths.dbPath, { readOnly: opts.readOnly ?? false });
  try {
    if (!opts.skipMigrations) {
      runMigrations(db);
      // meta 记录库创建信息（幂等；只读连接跳过写入）
      if (!opts.readOnly) {
        db.run("INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_created_at', ?)", nowIso());
      }
    }
    const readOnly = opts.readOnly ?? false;
    const identity = readOnly
      ? loadIdentity(paths.dataDir) ?? { deviceId: 'readonly-unregistered', instanceNonce: '', createdAt: nowIso() }
      : loadOrCreateIdentity(paths.dataDir);
    let cloneCheck = checkCloneState(db, identity);
    if (!readOnly) {
      const device = registerDevice(db, identity);
      if (device.enrollment === 'pending') {
        db.run("UPDATE device SET enrollment = 'active' WHERE id = ?", device.id);
      }
      cloneCheck = checkCloneState(db, identity);
    }
    // 克隆状态持有者：守卫读取最新状态，re-enroll 后更新
    const cloneState: { check: CloneCheckResult } = { check: cloneCheck };
    const writeGuard = (): void => assertWritable(cloneState.check);
    const audit = new AuditLog(db);
    const scopes = new ScopeRepository(db);
    const memories = new MemoryRepository(db);
    const archives = new ImportArchiveRepository(db);
    const plans = new PlanRepository(db);
    const outbox = new OutboxRepository(db, audit);
    const blocks = new ManagedBlockRepository(db);
    const installations = new DeviceInstallationRepository(db);
    for (const repo of [scopes, memories, archives, plans, outbox, blocks, installations]) {
      repo.setWriteGuard(readOnly ? () => { throw err('E_READONLY', '只读连接拒绝写入'); } : writeGuard);
    }
    const store: CairnStore = {
      paths,
      db,
      identity,
      get cloneCheck() {
        return cloneState.check;
      },
      scopes,
      memories,
      archives,
      plans,
      outbox,
      blocks,
      installations,
      audit,
      assertWritable() {
        writeGuard();
      },
      reEnroll() {
        const r = reEnrollDevice(db, paths.dataDir);
        cloneState.check = checkCloneState(db, r.identity);
        return r;
      },
      close() {
        db.close();
      },
    };
    return store;
  } catch (e) {
    db.close();
    throw e;
  }
}

export { schemaVersion };
