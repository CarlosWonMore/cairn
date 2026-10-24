import { DatabaseSync } from 'node:sqlite';
import { err, isCairnError } from '../core/errors.js';

/**
 * node:sqlite 适配层（design D2）：所有数据库访问经过本类，
 * 集中处理 WAL、外键、忙超时与事务，保留未来替换驱动的边界。
 * 统一约定：SQL 全部使用位置参数 ?；undefined 一律映射为 null。
 */

export interface OpenDbOptions {
  readOnly?: boolean;
  busyTimeoutMs?: number;
}

export class CairnDb {
  private txDepth = 0;

  private constructor(
    public readonly raw: DatabaseSync,
    public readonly path: string,
  ) {}

  static open(path: string, opts: OpenDbOptions = {}): CairnDb {
    let raw: DatabaseSync;
    try {
      raw = new DatabaseSync(path, { readOnly: opts.readOnly ?? false });
    } catch (e) {
      throw err('E_IO', `无法打开数据库 ${path}: ${(e as Error).message}`);
    }
    raw.exec(`PRAGMA busy_timeout = ${opts.busyTimeoutMs ?? 5000}`);
    if (!opts.readOnly) {
      raw.exec('PRAGMA journal_mode = WAL');
      raw.exec('PRAGMA foreign_keys = ON');
      raw.exec('PRAGMA synchronous = NORMAL');
    } else {
      raw.exec('PRAGMA foreign_keys = ON');
    }
    return new CairnDb(raw, path);
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  prepare(sql: string) {
    return this.raw.prepare(sql);
  }

  get(sql: string, ...params: unknown[]): Record<string, unknown> | undefined {
    return this.raw.prepare(sql).all(...params.map(toParam))[0] as Record<string, unknown> | undefined;
  }

  all(sql: string, ...params: unknown[]): Record<string, unknown>[] {
    return this.raw.prepare(sql).all(...params.map(toParam)) as Record<string, unknown>[];
  }

  run(sql: string, ...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint } {
    return this.raw.prepare(sql).run(...params.map(toParam)) as {
      changes: number | bigint;
      lastInsertRowid: number | bigint;
    };
  }

  /** 读值便捷方法：单行单列。 */
  scalar(sql: string, ...params: unknown[]): unknown {
    const row = this.get(sql, ...params);
    if (row == null) return undefined;
    const keys = Object.keys(row);
    return keys.length > 0 ? row[keys[0] as string] : undefined;
  }

  /**
   * 事务：BEGIN IMMEDIATE 立即取写锁，配合 busy_timeout 产生可重试等待而非死锁。
   * 嵌套调用转 SAVEPOINT；异常时回滚并重抛（业务错误保持原类型）。
   */
  transaction<T>(fn: () => T): T {
    if (this.txDepth > 0) {
      const sp = `sp_${this.txDepth}`;
      this.exec(`SAVEPOINT ${sp}`);
      this.txDepth++;
      try {
        const out = fn();
        this.txDepth--;
        this.exec(`RELEASE ${sp}`);
        return out;
      } catch (e) {
        this.txDepth--;
        this.exec(`ROLLBACK TO ${sp}`);
        this.exec(`RELEASE ${sp}`);
        throw e;
      }
    }
    this.exec('BEGIN IMMEDIATE');
    this.txDepth = 1;
    try {
      const out = fn();
      this.txDepth = 0;
      this.exec('COMMIT');
      return out;
    } catch (e) {
      this.txDepth = 0;
      this.exec('ROLLBACK');
      if (isSqliteBusy(e)) {
        throw err('E_DB_LOCKED', '数据库写入忙超时，请稍后重试', { sqlite: (e as Error).message });
      }
      throw e;
    }
  }

  get inTransaction(): boolean {
    return this.txDepth > 0;
  }

  integrityCheck(): boolean {
    const row = this.get('PRAGMA integrity_check');
    return row != null && String(Object.values(row)[0]) === 'ok';
  }

  foreignKeyCheck(): { table: string; rowid: unknown; parent: string; fkid: unknown }[] {
    return this.all('PRAGMA foreign_key_check') as unknown as {
      table: string;
      rowid: unknown;
      parent: string;
      fkid: unknown;
    }[];
  }

  close(): void {
    this.raw.close();
  }
}

type SqlParam = null | number | bigint | string | Uint8Array;

function toParam(p: unknown): SqlParam {
  if (p === undefined || p === null) return null;
  if (typeof p === 'boolean') return p ? 1 : 0;
  if (typeof p === 'string' || typeof p === 'number' || typeof p === 'bigint') return p;
  if (p instanceof Uint8Array) return p;
  throw err('E_INTERNAL', `不支持的 SQL 参数类型: ${typeof p}`);
}

function isSqliteBusy(e: unknown): boolean {
  const msg = (e as Error).message ?? '';
  return /SQLITE_BUSY|database is locked/i.test(msg) || (isCairnError(e) && e.code === 'E_DB_LOCKED');
}
