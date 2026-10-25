import { mkdirSync, existsSync, openSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { CairnDb, isRetryableSqliteError } from './db.js';
import { runMigrations, schemaVersion, MIGRATIONS } from './migrate.js';
import { ScopeRepository } from './scopes.js';
import { MemoryRepository } from './memories.js';
import { ImportArchiveRepository } from './archives.js';
import { PlanRepository } from './plans.js';
import { OutboxRepository } from './outbox.js';
import { ManagedBlockRepository, DeviceInstallationRepository } from './blocks.js';
import { ConflictRepository } from './conflicts.js';
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
  conflicts: ConflictRepository;
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
  const readOnly = opts.readOnly ?? false;
  if (!readOnly) {
    firstCreatorOrWait(paths.dbPath);
  }
  // 冷启动竞态有界重试（第二轮独立验证 P1）：多进程同时首建同一库时，
  // 迁移后紧跟的 meta/device 写入可能撞上 SQLITE_READONLY/_BUSY；
  // busy_timeout 不吸收 READONLY，必须关闭连接重开重试。
  const maxAttempts = 5;
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const db = CairnDb.open(paths.dbPath, { readOnly });
    try {
      if (!opts.skipMigrations) {
        runMigrations(db);
        // meta 记录库创建信息（幂等；只读连接跳过写入）
        if (!readOnly) {
          db.run("INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_created_at', ?)", nowIso());
        }
      }
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
      return assembleStore(db, paths, identity, cloneCheck, readOnly);
    } catch (e) {
      lastError = e as Error;
      db.close();
      if (attempt < maxAttempts && isRetryableSqliteError(e)) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * attempt);
        continue;
      }
      throw e;
    }
  }
  throw lastError ?? err('E_IO', `无法打开数据库 ${paths.dbPath}`, { attempts: maxAttempts });
}

/**
 * 首建抢占（第二轮验证报告建议 3）：库文件不存在时以 O_EXCL 抢占创建，
 * 抢到的进程负责建库；未抢到的进程等待库就绪（迁移完成）后再打开。
 * 消除"4 个进程同时迁移同一新库"的争用面。
 */
function firstCreatorOrWait(dbPath: string): void {
  if (existsSync(dbPath)) return;
  try {
    closeSync(openSync(dbPath, 'wx'));
    return; // 本进程是首建者
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw err('E_IO', `创建数据库文件失败 ${dbPath}: ${(e as Error).message}`);
    }
  }
  // 未抢到：等待首建者完成迁移（schema 就绪）
  const deadline = Date.now() + 15_000;
  for (;;) {
    if (Date.now() > deadline) {
      throw err('E_DB_LOCKED', `等待数据库就绪超时 ${dbPath}（首建者可能已失败）`);
    }
    if (existsSync(dbPath)) {
      let probe: CairnDb | null = null;
      try {
        probe = CairnDb.open(dbPath, { readOnly: true, busyTimeoutMs: 500 });
        const v = schemaVersion(probe);
        probe.close();
        probe = null;
        if (v >= MIGRATIONS.length) return;
      } catch {
        probe?.close();
      }
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  }
}

function assembleStore(
  db: CairnDb,
  paths: CairnPaths,
  identity: DeviceIdentityFile,
  initialCheck: CloneCheckResult,
  readOnly: boolean,
): CairnStore {
  const cloneState: { check: CloneCheckResult } = { check: initialCheck };
  const writeGuard = (): void => assertWritable(cloneState.check);
  const audit = new AuditLog(db);
  const scopes = new ScopeRepository(db);
  const memories = new MemoryRepository(db);
  const archives = new ImportArchiveRepository(db);
  const plans = new PlanRepository(db);
  const outbox = new OutboxRepository(db, audit);
  const blocks = new ManagedBlockRepository(db);
  const installations = new DeviceInstallationRepository(db);
  const conflicts = new ConflictRepository(db);
  for (const repo of [scopes, memories, archives, plans, outbox, blocks, installations, conflicts]) {
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
    conflicts,
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
}

export { schemaVersion };
