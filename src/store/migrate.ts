import { CairnDb } from './db.js';
import {
  MIGRATION_001_CORE,
  MIGRATION_002_SEARCH,
  MIGRATION_003_DEDUP,
  MIGRATION_004_KIND_LESSON,
  MIGRATION_005_MEMORY_IMPORTANCE_USAGE,
  MIGRATION_006_OUTBOX_SCOPE_EXIT,
} from './schema.js';
import { err } from '../core/errors.js';

export interface Migration {
  version: number;
  name: string;
  sql: string;
  /**
   * 在 `BEGIN` **之前**执行的 pragma 语句。
   *
   * 存在的唯一原因：SQLite 的 `PRAGMA foreign_keys` 在事务内是 **no-op**。
   * 重建被外键引用的表时必须先关掉外键，否则 `DROP TABLE` 会级联删光子表数据
   * （实测：子表 1 行变 0 行，而 `PRAGMA foreign_key_check` 仍报干净——静默丢数据）。
   */
  preTransactionPragma?: string[];
  /** 在 `COMMIT` **之后**执行的 pragma 语句（用于把 pre 的改动恢复回去）。 */
  postTransactionPragma?: string[];
}

/** 按版本排列；version 写入 PRAGMA user_version。 */
export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: 'core_v1', sql: MIGRATION_001_CORE },
  { version: 2, name: 'search_v1', sql: MIGRATION_002_SEARCH },
  { version: 3, name: 'dedup_v1', sql: MIGRATION_003_DEDUP },
  {
    version: 4,
    name: 'kind_lesson',
    sql: MIGRATION_004_KIND_LESSON,
    // 重建被 8 个表外键引用的 memory 表：外键必须在 BEGIN 之前关掉
    // （事务内设置 foreign_keys 是 no-op），否则 DROP 会级联删光子表数据。
    preTransactionPragma: ['PRAGMA foreign_keys = OFF'],
    postTransactionPragma: ['PRAGMA foreign_keys = ON'],
  },
  { version: 5, name: 'importance_usage', sql: MIGRATION_005_MEMORY_IMPORTANCE_USAGE },
  {
    version: 6,
    name: 'outbox_scope_exit',
    sql: MIGRATION_006_OUTBOX_SCOPE_EXIT,
    // 重建 outbox_job（job_type CHECK 加 sync_scope_exit）：出向 FK 引用 scope，
    // 同 004 的纪律——外键在 BEGIN 之前关掉，否则 DROP 旧表可能级联出问题。
    preTransactionPragma: ['PRAGMA foreign_keys = OFF'],
    postTransactionPragma: ['PRAGMA foreign_keys = ON'],
  },
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
 * 并发安全：BEGIN IMMEDIATE 取到写锁【之后】重读版本号，
 * 多进程同时打开同一新库时只有一方真正建表，另一方幂等跳过。
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
      let appliedThis = false;
      // 事务外的前置 pragma：foreign_keys 必须在 BEGIN 之前设置才生效。
      for (const pragma of m.preTransactionPragma ?? []) db.exec(pragma);
      db.transaction(() => {
        // 持写锁后重读：并发进程可能已在本事务排队期间完成该迁移
        const current = currentVersion(db);
        if (m.version <= current) return;
        db.exec(m.sql);
        setVersion(db, m.version);
        appliedThis = true;
      });
      // 事务外的后置 pragma：把 pre 阶段改掉的设置恢复。**成功失败都要跑**，
      // 否则一次迁移失败会让连接停在外键关闭状态，后续写入失去约束。
      for (const pragma of m.postTransactionPragma ?? []) db.exec(pragma);
      if (appliedThis) {
        applied.push(m.version);
        v = m.version;
      } else {
        v = Math.max(v, m.version);
      }
    } catch (e) {
      // 失败路径同样恢复 pragma，再做错误包装。
      try {
        for (const pragma of m.postTransactionPragma ?? []) db.exec(pragma);
      } catch {
        // 恢复失败不掩盖原始错误：原始错误更能说明问题。
      }
      throw err('E_MIGRATION_FAILED', `迁移 ${m.version} (${m.name}) 失败: ${(e as Error).message}`, {
        version: m.version,
        name: m.name,
      });
    }
  }
  return { applied, currentVersion: v };
}

export { currentVersion as schemaVersion };
