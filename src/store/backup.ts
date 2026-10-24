import { mkdirSync, copyFileSync, statSync, rmSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { CairnDb } from './db.js';
import { err } from '../core/errors.js';
import { sha256Hex } from '../core/hash.js';

export interface BackupCounts {
  memory: number;
  memory_revision: number;
  import_archive: number;
  outbox_job: number;
  audit_event: number;
}

export function tableCounts(db: CairnDb): BackupCounts {
  const c = (t: string): number => Number(db.scalar(`SELECT COUNT(*) AS n FROM ${t}`) ?? 0);
  return {
    memory: c('memory'),
    memory_revision: c('memory_revision'),
    import_archive: c('import_archive'),
    outbox_job: c('outbox_job'),
    audit_event: c('audit_event'),
  };
}

/**
 * 一致性备份（任务 1.5）：VACUUM INTO 产出事务一致快照，
 * 不中断并发读写；返回文件字节数与 sha256 供恢复校验。
 */
export function backupDatabase(db: CairnDb, targetPath: string): { path: string; bytes: number; sha256: string; counts: BackupCounts } {
  mkdirSync(dirname(targetPath), { recursive: true });
  rmSync(targetPath, { force: true });
  try {
    db.exec(`VACUUM INTO '${targetPath.replace(/\\/g, '/').replace(/'/g, "''")}'`);
  } catch (e) {
    throw err('E_IO', `备份失败: ${(e as Error).message}`, { targetPath });
  }
  const desc = describeBackupFile(targetPath, db);
  return { path: desc.path, bytes: desc.bytes, sha256: desc.sha256, counts: desc.counts! };
}

export function describeBackupFile(targetPath: string, sourceDb?: CairnDb): { path: string; bytes: number; sha256: string; counts?: BackupCounts } {
  const st = statSync(targetPath);
  if (st.size > HASH_READ_LIMIT) throw err('E_IO', '备份文件超过哈希计算上限', { path: targetPath, bytes: st.size });
  return {
    path: targetPath,
    bytes: st.size,
    sha256: sha256Hex(readFileSync(targetPath)),
    ...(sourceDb ? { counts: tableCounts(sourceDb) } : {}),
  };
}

const HASH_READ_LIMIT = 512 * 1024 * 1024;

/** 恢复校验：打开备份副本只读检查完整性并核对行数。 */
export function verifyBackup(backupPath: string, expected?: Partial<BackupCounts>): { ok: boolean; counts?: BackupCounts; problems: string[] } {
  const problems: string[] = [];
  let db: CairnDb | null = null;
  try {
    try {
      db = CairnDb.open(backupPath, { readOnly: true });
    } catch (e) {
      return { ok: false, problems: [`无法打开备份: ${(e as Error).message}`] };
    }
    let integrityOk = false;
    try {
      integrityOk = db.integrityCheck();
    } catch (e) {
      return { ok: false, problems: [`文件不是有效数据库或已损坏: ${(e as Error).message}`] };
    }
    if (!integrityOk) problems.push('integrity_check 未通过');
    const counts = tableCounts(db);
    for (const [k, v] of Object.entries(expected ?? {})) {
      if (v != null && counts[k as keyof BackupCounts] !== v) {
        problems.push(`${k} 行数不一致: 备份 ${counts[k as keyof BackupCounts]} vs 预期 ${v}`);
      }
    }
    return { ok: problems.length === 0, counts, problems };
  } finally {
    db?.close();
  }
}

/** 从备份恢复：调用方必须已关闭目标数据库；恢复后再次校验。 */
export function restoreFromBackup(backupPath: string, dbPath: string): { restored: true; verification: ReturnType<typeof verifyBackup> } {
  const pre = verifyBackup(backupPath);
  if (!pre.ok) {
    throw err('E_BACKUP_CORRUPT', `备份校验失败，拒绝恢复: ${pre.problems.join('; ')}`, { backupPath });
  }
  mkdirSync(dirname(dbPath), { recursive: true });
  copyFileSync(backupPath, dbPath);
  const post = verifyBackup(dbPath, pre.counts);
  if (!post.ok) {
    throw err('E_BACKUP_CORRUPT', `恢复后校验失败: ${post.problems.join('; ')}`, { dbPath });
  }
  return { restored: true, verification: post };
}
