import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openStore, CairnStore } from '../../src/store/open.js';
import { AppService } from '../../src/interfaces/app-service.js';
import { addAlias, listProjects, resolveProject } from '../../src/store/projects.js';
import { makeTestHome, cleanupTestHome } from '../helpers.js';

/**
 * 项目身份仓储合同（add-stable-project-identity tasks 2.6）：
 * 命中/新建、别名冲突拒绝、追加别名不改记忆归属、list 严格只读。
 */

async function withStore(fn: (store: CairnStore) => Promise<void> | void): Promise<void> {
  const home = makeTestHome();
  const store = openStore({ home });
  try {
    await fn(store);
  } finally {
    store.close();
    cleanupTestHome(home);
  }
}

test('resolveProject：首次解析新建 UUID，再次解析命中同一项目', async () => {
  await withStore((store) => {
    const first = resolveProject(store.db, 'https://github.com/o/r.git', { name: '仓库 R' });
    assert.equal(first.created, true);
    assert.equal(first.name, '仓库 R');
    assert.match(first.projectId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    assert.ok(!first.projectId.includes('github'), 'id 不得由路径派生');

    // ssh 写法等价命中；命中时不覆盖原显示名
    const second = resolveProject(store.db, 'git@github.com:o/r.git', { name: '改名尝试' });
    assert.equal(second.created, false);
    assert.equal(second.projectId, first.projectId);
    assert.equal(second.name, '仓库 R');
    assert.equal(second.matchedAlias, first.matchedAlias);
    assert.equal(listProjects(store.db).length, 1, '等价写法不得产生第二个项目');
  });
});

test('resolveProject：不校验路径存在性（跨设备解析同一项目）', async () => {
  await withStore((store) => {
    const r = resolveProject(store.db, 'Z:/definitely/not/on/this/device');
    assert.equal(r.created, true, '本机不存在的路径仍可解析');
    assert.equal(r.matchedAlias, 'Z:/definitely/not/on/this/device');
  });
});

test('addAlias：为已有项目追加第二别名后两个路径解析到同一 id', async () => {
  await withStore((store) => {
    const a = resolveProject(store.db, 'D:/Neusoft/Project');
    const added = addAlias(store.db, a.projectId, 'E:/Work/Same');
    assert.equal(added.added, true);
    assert.deepEqual(added.aliases, ['D:/Neusoft/Project', 'E:/Work/Same']);

    const b = resolveProject(store.db, 'E:\\Work\\Same\\');
    assert.equal(b.created, false);
    assert.equal(b.projectId, a.projectId);
    assert.deepEqual(listProjects(store.db).map((p) => p.aliases.length), [2]);

    // 重复追加同一别名是幂等的，不写第二份（只统一盘符，目录名大小写原样）
    assert.equal(addAlias(store.db, a.projectId, 'e:/Work/Same').added, false);
    assert.deepEqual(listProjects(store.db)[0]!.aliases, ['D:/Neusoft/Project', 'E:/Work/Same']);
  });
});

test('addAlias：别名属于其他项目时拒绝且两边数据都不变', async () => {
  await withStore((store) => {
    const p1 = resolveProject(store.db, 'https://github.com/o/one.git');
    const p2 = resolveProject(store.db, 'https://github.com/o/two.git');
    const before = listProjects(store.db);

    assert.throws(
      () => addAlias(store.db, p2.projectId, 'https://github.com/o/one.git'),
      (e: unknown) => {
        const err = e as { code?: string; details?: Record<string, unknown> };
        assert.equal(err.code, 'E_CONFLICT_STATE');
        assert.equal(err.details?.['ownerProjectId'], p1.projectId, '冲突信息必须报告归属');
        return true;
      },
    );
    assert.deepEqual(listProjects(store.db), before, '被拒绝时不得修改任何项目行');
  });
});

test('addAlias：追加别名不改变已有记忆的项目归属', async () => {
  const home = makeTestHome();
  const service = AppService.open(home);
  try {
    const p = resolveProject(service.store.db, 'https://github.com/o/r.git');
    service.addMemory({
      content: '项目级记忆：构建用 pnpm',
      kind: 'fact',
      scope: { preset: 'project-global', projectId: p.projectId, projectName: 'R' },
    });
    const snapshot = () =>
      service.store.db.all(
        'SELECT m.id, m.scope_id AS scopeId, s.project_id AS projectId FROM memory m JOIN scope s ON s.id = m.scope_id ORDER BY m.id',
      );
    const before = snapshot();
    assert.equal(before.length, 1);
    assert.equal(before[0]!['projectId'], p.projectId);

    addAlias(service.store.db, p.projectId, 'D:/work/r');

    assert.deepEqual(snapshot(), before, '记忆与作用域的项目归属必须原样');
    assert.equal(listProjects(service.store.db)[0]!.aliases.length, 2);
  } finally {
    service.close();
    cleanupTestHome(home);
  }
});

test('listProjects：严格只读，调用前后项目行数与时间戳均不变', async () => {
  await withStore((store) => {
    resolveProject(store.db, 'https://github.com/o/r.git');
    const before = store.db.all('SELECT * FROM project ORDER BY id');
    const listed = listProjects(store.db);
    assert.equal(listed.length, 1);
    assert.deepEqual(store.db.all('SELECT * FROM project ORDER BY id'), before, 'list 不得触发新建或写入');
    assert.deepEqual(listProjects(store.db), listed);
  });
});
