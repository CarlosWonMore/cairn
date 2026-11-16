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

// ---------------------------------------------------------------------------
// v8：用 reheld 审计回填 origin_device_id（真机对端 24 条 revived 副本）
// ---------------------------------------------------------------------------

const V7_AT = '2026-11-10T00:00:00.000Z';

/** 造一份 v7 库（只跑到 7），库里有本项目域与一条可直接对账的记忆行。 */
function openV7(home: string): CairnDb {
  const db = CairnDb.open(dbPath(home));
  runMigrations(db, MIGRATIONS.filter((m) => m.version <= 7));
  assert.equal(schemaVersion(db), 7, '前置：停在 v7（此时 origin 还未回填）');
  db.run('INSERT INTO space (id, name, space_kind, created_at) VALUES (?,?,?,?)', 'sp_personal', 'personal', 'personal', V7_AT);
  db.run(
    `INSERT INTO scope (id, space_id, preset, scope_kind, sync_policy, read_policy, retention_policy, projection_policy, created_at)
     VALUES ('scp_personal','sp_personal','personal-global','personal','encrypted','all_agents','permanent','none', ?)`,
    V7_AT,
  );
  return db;
}

function legacyMemory(db: CairnDb, id: string, originDeviceId: string | null): void {
  db.run(
    `INSERT INTO memory (id, owner_id, kind, content, normalized_content, scope_id, status, authority,
       observed_at, content_hash, origin_device_id, created_by, created_at, updated_at)
     VALUES (?, 'local-user', 'fact', ?, ?, 'scp_personal', 'active', 'user_explicit', ?, ?, ?, 'cli', ?, ?)`,
    id,
    `正文 ${id}`,
    `正文 ${id}`,
    V7_AT,
    `hash_${id}`,
    originDeviceId,
    V7_AT,
    V7_AT,
  );
}

function reheldAudit(db: CairnDb, id: string, memoryId: string, from: string): void {
  db.run(
    `INSERT INTO audit_event (id, at, category, action, subject_type, subject_id, detail)
     VALUES (?, ?, 'sync', 'project_reheld', 'memory', ?, ?)`,
    id,
    V7_AT,
    memoryId,
    JSON.stringify({ from, seq: 7 }),
  );
}

test('v8 存量回填：origin 未知的 revive 副本按 reheld 审计的 from 补归属', () => {
  const home = makeTestHome();
  try {
    const db = openV7(home);
    legacyMemory(db, 'mem_retro', null);
    reheldAudit(db, 'audit_retro', 'mem_retro', 'dev_publisher');

    const r = runMigrations(db);

    assert.deepEqual(r.applied, [8]);
    assert.equal(r.currentVersion, 8);
    assert.equal(String(db.get('SELECT origin_device_id AS d FROM memory WHERE id = ?', 'mem_retro')?.d), 'dev_publisher');
    db.close();
  } finally {
    cleanupTestHome(home);
  }
});

test('v8 迁移不误伤：没有 reheld 审计的保持 NULL，已有归属不被审计覆盖', () => {
  const home = makeTestHome();
  try {
    const db = openV7(home);
    legacyMemory(db, 'mem_clean', null); // 无审计
    legacyMemory(db, 'mem_keep', 'dev_existing'); // 已有归属 + 别人的 reheld 审计
    reheldAudit(db, 'audit_keep', 'mem_keep', 'dev_other');

    runMigrations(db);

    assert.equal(db.get('SELECT origin_device_id AS d FROM memory WHERE id = ?', 'mem_clean')?.d ?? null, null, '无证据不猜');
    assert.equal(String(db.get('SELECT origin_device_id AS d FROM memory WHERE id = ?', 'mem_keep')?.d), 'dev_existing', '归属是溯源事实，不被覆盖');
    db.close();
  } finally {
    cleanupTestHome(home);
  }
});
