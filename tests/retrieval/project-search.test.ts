import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../../src/store/open.js';
import { findProjectByAlias, resolveProject, listProjects } from '../../src/store/projects.js';
import { makeTestHome, cleanupTestHome } from '../helpers.js';

/**
 * add-project-scope-recall D1：检索路径的别名解析是**只查不建**——
 * 未登记返回 null，绝不产生新项目行；登记只走 resolveProject（显式动作）。
 */
test('findProjectByAlias：命中已登记别名返回项目 id；未登记返回 null 且不建项目', () => {
  const home = makeTestHome();
  const store = openStore({ home });
  try {
    const before = listProjects(store.db).length;
    const created = resolveProject(store.db, 'D:\\proj\\alpha');
    assert.equal(created.created, true);

    // 命中：同一路径（归一化后等价写法）
    assert.equal(findProjectByAlias(store.db, 'd:/proj/alpha/'), created.projectId);
    // 未登记：返回 null，且不建项目
    assert.equal(findProjectByAlias(store.db, 'D:\\proj\\beta'), null);
    const after = listProjects(store.db).length;
    assert.equal(after, before + 1, '检索路径只查不建：库内只有一个项目');
  } finally {
    store.close();
    cleanupTestHome(home);
  }
});
