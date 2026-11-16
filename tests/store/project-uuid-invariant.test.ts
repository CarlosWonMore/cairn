import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { AppService } from '../../src/interfaces/app-service.js';
import { isUuid, uuidv7 } from '../../src/core/ids.js';
import { makeTestHome, cleanupTestHome } from '../helpers.js';

/**
 * 项目身份形态不变式（fix-project-id-uuid-invariant）：
 * 2026-11-16 真实库事故——旧构建会话把路径当 projectId 写穿 store 层，
 * 产出路径键孤儿行（project/space/scope 三表各一行），sync pull 枚举到
 * `project/<路径>` 键被 syncd 整体 400 拒绝。本文件锁定：
 * 闸 1（validateScopeSpec）/ 闸 2（ensureProject）/ doctor 只读检出。
 */

/** 三张身份表的行数快照：拒绝路径必须零新增。 */
function identityRowCounts(service: AppService) {
  const n = (sql: string) => Number(service.store.db.get(sql)!['n']);
  return {
    project: n('SELECT COUNT(*) AS n FROM project'),
    projectSpace: n("SELECT COUNT(*) AS n FROM space WHERE space_kind = 'project'"),
    projectScope: n("SELECT COUNT(*) AS n FROM scope WHERE scope_kind = 'project'"),
  };
}

test('isUuid 合同：合法 uuidv7 通过，路径与自由文本拒绝', () => {
  assert.equal(isUuid(uuidv7()), true);
  assert.equal(isUuid('01a1daf8-a232-769f-82e3-6c4da78985d4'), true);
  assert.equal(isUuid('D:/Project/AI MemoryGLM'), false);
  assert.equal(isUuid('project/01a1daf8-a232-769f-82e3-6c4da78985d4'), false);
  assert.equal(isUuid(''), false);
});

test('闸1：路径作 projectId 被预设解析层拒绝，三表零新增', () => {
  const home = makeTestHome('cairn-uuid-gate1-');
  const service = AppService.open(home);
  try {
    const before = identityRowCounts(service);
    assert.throws(
      () => service.store.scopes.resolvePreset('project-global', { projectId: 'D:/某项目' }),
      /UUID 形态/,
    );
    assert.deepEqual(identityRowCounts(service), before, '拒绝路径不得在三表留下任何行');
  } finally {
    service.close();
    cleanupTestHome(home);
  }
});

test('闸1 不影响合法身份：uuidv7 正常落位，指纹复用不重复建行', () => {
  const home = makeTestHome('cairn-uuid-ok-');
  const service = AppService.open(home);
  try {
    const pid = uuidv7();
    const s1 = service.store.scopes.resolvePreset('project-global', { projectId: pid });
    const after1 = identityRowCounts(service);
    assert.deepEqual(after1, { project: 1, projectSpace: 1, projectScope: 1 });
    const s2 = service.store.scopes.resolvePreset('project-global', { projectId: pid });
    assert.equal(s2.id, s1.id, '相同身份命中同一作用域行（指纹复用）');
    assert.deepEqual(identityRowCounts(service), after1, '幂等命中不新增行');
  } finally {
    service.close();
    cleanupTestHome(home);
  }
});

test('闸2：绕过预设解析直调项目行落库，路径键同样被拒', () => {
  const home = makeTestHome('cairn-uuid-gate2-');
  const service = AppService.open(home);
  try {
    const before = identityRowCounts(service);
    assert.throws(
      () => service.store.scopes.ensureProject('D:/某项目', 'D:/某项目'),
      /UUID 形态/,
    );
    assert.deepEqual(identityRowCounts(service), before, '第二道闸同样零新增');
  } finally {
    service.close();
    cleanupTestHome(home);
  }
});

/** 复刻 2026-11-16 真实事故：路径键孤儿三行（project / space / scope 各一）。 */
function injectOrphanRows(service: AppService): void {
  const db = service.store.db;
  db.run(
    "INSERT INTO project (id, name, aliases, created_at) VALUES ('D:/某项目', 'D:/某项目', '[]', '2026-11-16T08:29:03.934Z')",
  );
  const spaceId = uuidv7();
  db.run(
    'INSERT INTO space (id, name, space_kind, project_id, created_at) VALUES (?, ?, ?, ?, ?)',
    spaceId,
    'D:/某项目',
    'project',
    'D:/某项目',
    '2026-11-16T08:29:03.934Z',
  );
  db.run(
    `INSERT INTO scope (id, space_id, preset, scope_kind, project_id, device_id, agent_id, read_allowlist,
       sync_policy, read_policy, retention_policy, projection_policy, sensitivity, ttl_days, builtin, created_at)
     VALUES (?, ?, 'project-global', 'project', 'D:/某项目', 'all', 'all', '[]',
       'encrypted', 'all_agents', 'permanent', 'none', 'normal', NULL, 1, '2026-11-16T08:29:03.934Z')`,
    uuidv7(),
    spaceId,
  );
}

test('doctor：注入的畸形项目身份行被显式报告（三表各一），且 doctor 全程只读', () => {
  const home = makeTestHome('cairn-uuid-doctor-');
  const service = AppService.open(home);
  try {
    injectOrphanRows(service);
    const digest = () =>
      createHash('sha256').update(readFileSync(service.store.paths.dbPath)).digest('hex');
    const before = digest();

    const d = service.doctor();
    const hits = d.problems.filter((p) => p.includes('项目身份形态异常'));
    assert.equal(hits.length, 3, `project/space/scope 各报一行，实际 problems: ${JSON.stringify(d.problems)}`);
    assert.ok(
      hits.some((p) => p.includes('project') && p.includes('D:/某项目')),
      `必须含表名与行标识: ${JSON.stringify(hits)}`,
    );

    assert.equal(digest(), before, 'doctor 检出必须是只读扫描');
  } finally {
    service.close();
    cleanupTestHome(home);
  }
});

test('doctor：健康库（含合法项目身份行）不产生项目身份问题项', () => {
  const home = makeTestHome('cairn-uuid-healthy-');
  const service = AppService.open(home);
  try {
    service.store.scopes.resolvePreset('project-global', { projectId: uuidv7() });
    const d = service.doctor();
    const hits = d.problems.filter((p) => p.includes('项目身份形态异常'));
    assert.deepEqual(hits, [], '合法 uuidv7 行不得被误报');
  } finally {
    service.close();
    cleanupTestHome(home);
  }
});
