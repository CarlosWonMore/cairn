/**
 * 迁移 004（新增 lesson 类型）的完整性测试。
 *
 * 这是本变更唯一的真实风险点：memory 表被 8 个表外键引用，重建时若处理不当
 * 会**静默删光子表数据**（实测过：子表 1 行变 0 行，而 foreign_key_check 仍报干净）。
 * 因此测试必须：
 * 1. 用**有真实子表数据**的库，不是空库；
 * 2. 迁移前后逐表比对行数；
 * 3. 再跑 foreign_key_check 与 integrity_check；
 * 4. 验证 FTS 仍能检索到旧内容。
 */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { CairnDb } from '../../src/store/db.js';
import { runMigrations, schemaVersion, MIGRATIONS } from '../../src/store/migrate.js';
import { MIGRATION_001_CORE } from '../../src/store/schema.js';

let root: string;

function openDb(file: string): CairnDb {
  return CairnDb.open(path.join(root, file));
}

function counts(db: CairnDb): Record<string, number> {
  const tables = ['memory', 'memory_revision', 'evidence', 'relation', 'conflict'];
  const out: Record<string, number> = {};
  for (const t of tables) {
    try {
      out[t] = Number(db.scalar(`SELECT COUNT(*) FROM ${t}`) ?? 0);
    } catch {
      out[t] = -1; // 表不存在
    }
  }
  return out;
}

before(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'cairn-mig4-'));
});

after(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('迁移 004：lesson 类型', () => {
  it('新库上跑到最新版本，lesson 可写入', () => {
    const db = openDb('fresh.db');
    try {
      const r = runMigrations(db);
      assert.equal(r.currentVersion, MIGRATIONS.length);
      db.run("INSERT INTO space (id, name, space_kind, created_at) VALUES ('sp1','personal','personal','2026-01-01')");
      db.run("INSERT INTO scope (id, space_id, preset, scope_kind, device_id, agent_id, sync_policy, read_policy, retention_policy, projection_policy, created_at) VALUES ('s1','sp1','personal-global','personal','all','all','encrypted','all_agents','permanent','none','2026-01-01')");
      db.run(
        `INSERT INTO memory (id, owner_id, kind, content, normalized_content, scope_id, status, authority,`
          + ` observed_at, content_hash, created_by, created_at, updated_at)`
          + ` VALUES ('m1','local-user','lesson','曾经错了','曾经错了','s1','active','user_explicit',`
          + ` '2026-01-01T00:00:00.000Z','h1','test','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z')`,
      );
      assert.equal(Number(db.scalar("SELECT COUNT(*) FROM memory WHERE kind='lesson'")), 1);
    } finally {
      db.close();
    }
  });

  it('从 v1 带数据升级：子表行数不变、外键干净、FTS 可检索', () => {
    const db = openDb('upgrade.db');
    try {
      // 只跑 v1，模拟旧库
      runMigrations(db, [{ version: 1, name: 'core_v1', sql: MIGRATION_001_CORE }]);
      db.run("INSERT INTO space (id, name, space_kind, created_at) VALUES ('sp1','personal','personal','2026-01-01')");
      db.run("INSERT INTO scope (id, space_id, preset, scope_kind, device_id, agent_id, sync_policy, read_policy, retention_policy, projection_policy, created_at) VALUES ('s1','sp1','personal-global','personal','all','all','encrypted','all_agents','permanent','none','2026-01-01')");
      db.run(`INSERT INTO memory (id, owner_id, kind, content, normalized_content, scope_id, status, authority, observed_at, content_hash, created_by, created_at, updated_at) VALUES ('m1','local-user','fact','原始内容','原始内容','s1','active','user_explicit','2026-01-01','h1','test','2026-01-01','2026-01-01')`);
      // 子表数据：memory_revision 通过外键引用 memory
      db.run(`INSERT INTO memory_revision (id, memory_id, seq, parent_revision_ids, content, content_hash, scope_id, status, authority, author, device_id, created_at) VALUES ('r1','m1',1,'[]','原始内容','h1','s1','active','user_explicit','test','dev1','2026-01-01')`);
      db.run(`UPDATE memory SET current_revision_id='r1' WHERE id='m1'`);

      const before = counts(db);
      assert.ok(before.memory >= 1 && before.memory_revision >= 1, 'fixture 必须有真实子表数据');

      const applied = runMigrations(db);
      assert.ok(applied.applied.includes(4), '迁移 4 必须被执行');

      const afterCounts = counts(db);
      assert.deepEqual(afterCounts, before, '逐表行数必须完全一致（静默丢数据的核心断言）');

      const fk = db.all('PRAGMA foreign_key_check');
      assert.deepEqual(fk, [], '外键检查必须干净');

      const integrity = db.scalar('PRAGMA integrity_check');
      assert.equal(String(integrity), 'ok');

      // FTS 必须仍能检索到迁移前的内容
      const hit = db.scalar("SELECT COUNT(*) FROM memory_fts WHERE memory_fts MATCH '原始内容'");
      assert.ok(Number(hit) >= 1, '迁移后旧内容仍应可全文检索');

      // 新类型可写入
      db.run(`INSERT INTO memory (id, owner_id, kind, content, normalized_content, scope_id, status, authority, observed_at, content_hash, created_by, created_at, updated_at) VALUES ('m2','local-user','lesson','教训','教训','s1','active','user_explicit','2026-01-01','h2','test','2026-01-01','2026-01-01')`);
      assert.equal(Number(db.scalar("SELECT COUNT(*) FROM memory WHERE kind='lesson'")), 1);
    } finally {
      db.close();
    }
  });

  it('重复执行幂等：第二次不产生 applied', () => {
    const db = openDb('idem.db');
    try {
      const first = runMigrations(db);
      assert.equal(first.currentVersion, MIGRATIONS.length);
      const second = runMigrations(db);
      assert.deepEqual(second.applied, [], '重复迁移不得再执行');
    } finally {
      db.close();
    }
  });

  it('迁移后外键约束恢复为开启', () => {
    const db = openDb('fkrestore.db');
    try {
      runMigrations(db);
      const row = db.get('PRAGMA foreign_keys') as Record<string, unknown>;
      assert.equal(Number(Object.values(row)[0]), 1, '迁移结束后 foreign_keys 必须为 ON');
    } finally {
      db.close();
    }
  });

  it('索引与触发器已重建', () => {
    const db = openDb('objects.db');
    try {
      runMigrations(db);
      const idx = db.all("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='memory'");
      const names = idx.map((r) => String(r['name']));
      for (const need of ['memory_scope_status', 'memory_kind_status', 'memory_updated', 'memory_hash']) {
        assert.ok(names.includes(need), `索引 ${need} 必须存在`);
      }
      const trg = db.all("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='memory'");
      const tnames = trg.map((r) => String(r['name']));
      for (const need of ['memory_fts_ai', 'memory_fts_ad', 'memory_fts_au']) {
        assert.ok(tnames.includes(need), `触发器 ${need} 必须存在`);
      }
    } finally {
      db.close();
    }
  });
});
