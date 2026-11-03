/**
 * 操作审计（add-operation-audit）：store 层。
 *
 * 锁死四条：list 过滤与上限、pruneOperations 只清 operation 过期行
 * （治理类目豁免）、审计配置解析（env > config.json > 默认，非法回落）、
 * 复合索引存在（category, at）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { openStore, CairnStore } from '../../src/store/open.js';
import { readAuditConfig } from '../../src/store/audit.js';
import { makeTestHome, cleanupTestHome } from '../helpers.js';

function withStore(fn: (store: CairnStore, home: string) => void): void {
  const home = makeTestHome();
  const store = openStore({ home });
  try {
    fn(store, home);
  } finally {
    store.close();
    cleanupTestHome(home);
  }
}

test('操作审计：list 按 category/action/since 过滤，limit 默认 50、上限 200', () => {
  withStore((store) => {
    for (let i = 0; i < 3; i++) {
      store.audit.record('operation', 'memory_search', undefined, { candidates: i });
    }
    store.audit.record('memory', 'added', { type: 'memory', id: 'm1' }, {});

    const all = store.audit.list({ category: 'operation' });
    assert.equal(all.length, 3, '只取 operation 类目');
    assert.ok(all.every((r) => r.category === 'operation'));

    const byAction = store.audit.list({ action: 'memory_search' });
    assert.equal(byAction.length, 3);

    store.audit.record('operation', 'memory_get', { type: 'memory', id: 'm1' }, {});
    const gets = store.audit.list({ action: 'memory_get' });
    assert.equal(gets.length, 1);
    assert.equal(gets[0]!.subjectId, 'm1');

    // since：取未来时间点之后 → 空；当前时间之前 → 全部
    const future = new Date(Date.now() + 60_000).toISOString();
    assert.equal(store.audit.list({ category: 'operation', since: future }).length, 0);
    const past = new Date(Date.now() - 60_000).toISOString();
    assert.equal(store.audit.list({ category: 'operation', since: past }).length, 4);

    // limit 上限 200：请求 500 也只回 200
    for (let i = 0; i < 210; i++) store.audit.record('operation', 'memory_search', undefined, { i });
    assert.equal(store.audit.list({ category: 'operation', limit: 500 }).length, 200);
    assert.equal(store.audit.list({ category: 'operation', limit: 2 }).length, 2);
  });
});

test('操作审计：pruneOperations 只清过期 operation 行，治理类目豁免', () => {
  withStore((store) => {
    // 直接插入可回填时间的行：一条 40 天前的 operation、一条新的 operation、一条 40 天前的治理行
    const old = new Date(Date.now() - 40 * 24 * 3600 * 1000).toISOString();
    store.db.run(
      "INSERT INTO audit_event (id, at, category, action, subject_type, subject_id, detail) VALUES ('op-old', ?, 'operation', 'memory_search', NULL, NULL, '{}')",
      old,
    );
    store.audit.record('operation', 'memory_search', undefined, { fresh: true });
    store.db.run(
      "INSERT INTO audit_event (id, at, category, action, subject_type, subject_id, detail) VALUES ('gov-old', ?, 'memory', 'added', 'memory', 'm2', '{}')",
      old,
    );

    const deleted = store.audit.pruneOperations(30);
    assert.equal(deleted, 1, '只删一条过期 operation');
    const rows = store.db.all("SELECT id FROM audit_event").map((r) => r.id as string);
    assert.ok(rows.includes('op-old') === false, '过期 operation 已删');
    assert.ok(rows.includes('gov-old'), '过期治理行豁免');
    assert.equal(store.audit.list({ category: 'operation' }).length, 1, '新 operation 保留');
  });
});

test('操作审计：复合索引 (category, at) 存在', () => {
  withStore((store) => {
    const idx = store.db
      .all("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='audit_event'")
      .map((r) => r.name as string);
    assert.ok(idx.includes('audit_category_at'), `实际索引: ${idx.join(',')}`);
  });
});

test('审计配置：env > config.json > 默认；非法值回落默认', () => {
  const home = makeTestHome();
  const prevOps = process.env['CAIRN_AUDIT_OPERATIONS'];
  const prevDays = process.env['CAIRN_AUDIT_RETENTION_DAYS'];
  try {
    // 默认
    delete process.env['CAIRN_AUDIT_OPERATIONS'];
    delete process.env['CAIRN_AUDIT_RETENTION_DAYS'];
    assert.deepEqual(readAuditConfig(home), { operations: true, retentionDays: 30 });

    // config.json
    writeFileSync(join(home, 'config.json'), JSON.stringify({ audit: { operations: false, retentionDays: 90 } }), 'utf8');
    assert.deepEqual(readAuditConfig(home), { operations: false, retentionDays: 90 });

    // env 覆盖 config.json
    process.env['CAIRN_AUDIT_OPERATIONS'] = 'true';
    process.env['CAIRN_AUDIT_RETENTION_DAYS'] = '7';
    assert.deepEqual(readAuditConfig(home), { operations: true, retentionDays: 7 });

    // 非法值回落默认（不抛）
    process.env['CAIRN_AUDIT_RETENTION_DAYS'] = '-5';
    assert.equal(readAuditConfig(home).retentionDays, 30);
    process.env['CAIRN_AUDIT_RETENTION_DAYS'] = 'abc';
    assert.equal(readAuditConfig(home).retentionDays, 30);
    writeFileSync(join(home, 'config.json'), 'not-json', 'utf8');
    delete process.env['CAIRN_AUDIT_OPERATIONS'];
    delete process.env['CAIRN_AUDIT_RETENTION_DAYS'];
    assert.deepEqual(readAuditConfig(home), { operations: true, retentionDays: 30 }, '坏 config.json 回落默认');
  } finally {
    if (prevOps === undefined) delete process.env['CAIRN_AUDIT_OPERATIONS']; else process.env['CAIRN_AUDIT_OPERATIONS'] = prevOps;
    if (prevDays === undefined) delete process.env['CAIRN_AUDIT_RETENTION_DAYS']; else process.env['CAIRN_AUDIT_RETENTION_DAYS'] = prevDays;
    cleanupTestHome(home);
  }
});
