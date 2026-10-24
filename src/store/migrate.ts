import { CairnDb } from './db.js';
import { MIGRATION_001_CORE, MIGRATION_002_SEARCH } from './schema.js';
import { err } from '../core/errors.js';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

/** 按版本排列；version 写入 PRAGMA user_version。 */
export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: 'core_v1', sql: MIGRATION_001_CORE },
  { version: 2, name: 'search_v1', sql: MIGRATION_002_SEARCH },
];

export interface MigrationResult {
  applied: number[];
  currentVersion: number;
}

function currentVersion(db: CairnDb): number {
  const row = db.get('PRAGMA user_version') as Record<string, unknown> | undefined;
  return row ? Number(Object.values(row)[0]) : 0;
}

function setVersion(db: CairnDb, v: number): void {
  db.exec(`PRAGMA user_version = ${v}`);
}

/**
 * 版本化迁移（任务 1.2）：每个迁移独立事务，失败回滚，
 * 数据库停留在旧版本且可再次执行；绝不留下半迁移库。
 * schema 版本高于已知实现时拒绝打开（防旧代码写新库）。
 */
export function runMigrations(db: CairnDb, migrations: readonly Migration[] = MIGRATIONS): MigrationResult {
  const applied: number[] = [];
  let v = currentVersion(db);
  const latest = migrations.length > 0 ? migrations[migrations.length - 1]!.version : 0;
  if (v > latest) {
    throw err(
      'E_MIGRATION_FAILED',
      `数据库 schema 版本 ${v} 高于当前实现支持的 ${latest}；请升级 Cairn 后再打开该数据目录`,
      { dbVersion: v, supportedVersion: latest },
    );
  }
  for (const m of migrations) {
    if (m.version <= v) continue;
    try {
      db.transaction(() => {
        db.exec(m.sql);
        setVersion(db, m.version);
      });
      applied.push(m.version);
      v = m.version;
    } catch (e) {
      throw err('E_MIGRATION_FAILED', `迁移 ${m.version} (${m.name}) 失败: ${(e as Error).message}`, {
        version: m.version,
        name: m.name,
      });
    }
  }
  return { applied, currentVersion: v };
}

export { currentVersion as schemaVersion };
