import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { CairnDb } from '../../src/store/db.js';
import { runMigrations, MIGRATIONS, schemaVersion, Migration } from '../../src/store/migrate.js';
import { makeTestHome, cleanupTestHome } from '../helpers.js';

function dbPath(home: string): string {
  const p = join(home, 'data', 'cairn.db');
  mkdirSync(join(home, 'data'), { recursive: true });
  return p;
}

test('迁移：全新库应用全部迁移且幂等', () => {
  const home = makeTestHome();
  try {
    const db = CairnDb.open(dbPath(home));
    const first = runMigrations(db);
    assert.equal(first.currentVersion, MIGRATIONS.length);
    assert.equal(first.applied.length, MIGRATIONS.length);
    const second = runMigrations(db);
    assert.deepEqual(second.applied, []);
    assert.equal(second.currentVersion, MIGRATIONS.length);
    // 关键表存在
    for (const t of ['memory', 'memory_revision', 'scope', 'space', 'device', 'conflict', 'tombstone', 'import_archive', 'import_item', 'onboarding_plan', 'plan_operation', 'approval', 'outbox_job', 'managed_block', 'device_installation', 'audit_event', 'evidence', 'relation', 'project', 'agent']) {
      const n = db.scalar(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name = ?`, t);
      assert.equal(Number(n), 1, `表 ${t} 应存在`);
    }
    // FTS 虚表存在
    const fts = db.scalar(`SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'memory_fts'`);
    assert.equal(Number(fts), 1);
    db.close();
  } finally {
    cleanupTestHome(home);
  }
});

test('迁移：中途失败不留半迁移库，可修复后重跑', () => {
  const home = makeTestHome();
  try {
    const db = CairnDb.open(dbPath(home));
    const broken: Migration[] = [
      { version: 1, name: 'ok', sql: 'CREATE TABLE ok_table (id TEXT);' },
      { version: 2, name: 'broken', sql: 'CREATE TABLE broken (id TEXT; CREATE TABLE blah' },
    ];
    assert.throws(() => runMigrations(db, broken), /E_MIGRATION_FAILED|迁移/);
    assert.equal(schemaVersion(db), 1, '失败迁移后版本停留在 1');
    // 库仍可用，修复后可继续
    const fixed: Migration[] = [
      { version: 1, name: 'ok', sql: 'CREATE TABLE IF NOT EXISTS ok_table (id TEXT);' },
      { version: 2, name: 'fixed', sql: 'CREATE TABLE fixed_table (id TEXT);' },
    ];
    const r = runMigrations(db, fixed);
    assert.deepEqual(r.applied, [2]);
    assert.equal(Number(db.scalar("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='fixed_table'")), 1);
    db.close();
  } finally {
    cleanupTestHome(home);
  }
});

test('迁移：schema 版本高于实现时拒绝打开写入', () => {
  const home = makeTestHome();
  try {
    const db = CairnDb.open(dbPath(home));
    runMigrations(db);
    db.exec('PRAGMA user_version = 99');
    assert.throws(() => runMigrations(db), /高于当前实现/);
    db.close();
  } finally {
    cleanupTestHome(home);
  }
});

test('适配层：事务回滚不残留，嵌套走 SAVEPOINT', () => {
  const home = makeTestHome();
  try {
    const db = CairnDb.open(':memory:');
    runMigrations(db);
    assert.throws(
      () =>
        db.transaction(() => {
          db.run("INSERT INTO space (id, name, space_kind, created_at) VALUES ('s1','p','personal','2026-01-01T00:00:00.000Z')");
          throw new Error('boom');
        }),
      /boom/,
    );
    assert.equal(Number(db.scalar('SELECT COUNT(*) AS n FROM space')), 0, '回滚后无残留');
    // 嵌套：内层回滚不影响外层其余写入
    db.transaction(() => {
      db.run("INSERT INTO space (id, name, space_kind, created_at) VALUES ('s2','p','personal','2026-01-01T00:00:00.000Z')");
      assert.throws(
        () =>
          db.transaction(() => {
            db.run("INSERT INTO space (id, name, space_kind, created_at) VALUES ('s3','p','personal','2026-01-01T00:00:00.000Z')");
            throw new Error('inner');
          }),
        /inner/,
      );
      db.run("INSERT INTO space (id, name, space_kind, created_at) VALUES ('s4','p','personal','2026-01-01T00:00:00.000Z')");
    });
    assert.equal(Number(db.scalar('SELECT COUNT(*) AS n FROM space')), 2);
    db.close();
  } finally {
    cleanupTestHome(home);
  }
});

test('适配层：undefined 参数映射为 null，布尔映射为 0/1', () => {
  const db = CairnDb.open(':memory:');
  db.exec('CREATE TABLE t (a TEXT, b INTEGER)');
  db.run('INSERT INTO t VALUES (?, ?)', undefined, true);
  const row = db.get('SELECT a, b FROM t')!;
  assert.equal(row.a, null);
  assert.equal(Number(row.b), 1);
  db.close();
});
