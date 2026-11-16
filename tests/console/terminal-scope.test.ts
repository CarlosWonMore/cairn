import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openStore, CairnStore } from '../../src/store/open.js';
import { makeTestHome, cleanupTestHome } from '../helpers.js';
import { buildModel, memoryDetail } from '../../src/interfaces/console/model.js';
import { UI_JS } from '../../src/interfaces/console/assets/ui-js.js';
import { AppService } from '../../src/interfaces/app-service.js';

/**
 * 终态作用域展示（add-cross-device-project-sync 第 6 节 / local-console delta spec）：
 * 不再持有副本的终态作用域随装配层下发（列表、详情、静态导出同一模型），
 * 卡片与详情复用既有徽章路径，可翻译文案不进 title。
 */

function seed(store: CairnStore, content: string, terminal?: Record<string, string>): string {
  const scope = store.scopes.resolvePreset('personal-global');
  const mem = store.memories.add(
    { kind: 'fact', content, scopeId: scope.id, authority: 'user_explicit', createdBy: 'cli' },
    store.identity.deviceId,
  );
  if (terminal) {
    store.db.run("UPDATE memory SET status = 'archived' WHERE id = ?", mem.id);
    store.db.run('INSERT INTO meta (key, value) VALUES (?, ?)', `terminal_scope:${mem.id}`, JSON.stringify(terminal));
  }
  return mem.id;
}

test('终态作用域随载荷下发：列表与详情同构，缺省为 null（未知）', () => {
  const home = makeTestHome('cairn-console-terminal-');
  const store = openStore({ home });
  try {
    const projectId = '14141414-1414-4414-8414-141414141414';
    const projectIdMem = seed(store, '终态为项目', { preset: 'project-global', projectId, spaceName: '展示项目' });
    const deviceMem = seed(store, '终态为设备限定', { preset: 'device-local', deviceId: 'dev_owner_7' });
    const unknownMem = seed(store, '旧事件无终态');

    const model = buildModel(store, { mode: 'full', redact: false });
    const byId = new Map(model.memories.map((m) => [m.id, m]));
    assert.deepEqual(byId.get(projectIdMem)!.terminalScope, { preset: 'project-global', projectId, spaceName: '展示项目' });
    assert.equal(byId.get(deviceMem)!.terminalScope!.deviceId, 'dev_owner_7', '设备限定终态带归属设备');
    assert.equal(byId.get(unknownMem)!.terminalScope, null, '缺省 = 未知');
    assert.equal(byId.get(projectIdMem)!.status, 'archived', '不持有副本如实标记');

    // 详情走同一字段（静态导出复用 buildModel，因此天然同构、零请求）
    assert.deepEqual(memoryDetail(store, projectIdMem, { mode: 'full', redact: false }).memory.terminalScope, {
      preset: 'project-global',
      projectId,
      spaceName: '展示项目',
    });
  } finally {
    store.close();
    cleanupTestHome(home);
  }
});

test('cairn show / memory_get：showMemory 带 terminalScope，缺省 null，且不改本地 scope', () => {
  const home = makeTestHome('cairn-show-terminal-');
  const service = AppService.open(home);
  try {
    const projectId = '15151515-1515-4515-8515-151515151515';
    const withTerminal = seed(service.store, '终态为项目', { preset: 'project-global', projectId, spaceName: '展示项目' });
    const plain = seed(service.store, '从未离机的记忆');

    const detail = service.showMemory(withTerminal);
    assert.deepEqual(detail.terminalScope, { preset: 'project-global', projectId, spaceName: '展示项目' });
    assert.equal(detail.scope.preset, 'personal-global', '终态只是展示补充，scope 仍是本地作用域');

    assert.equal(service.showMemory(plain).terminalScope, null, '无终态为 null，不是 undefined');
  } finally {
    service.close();
    cleanupTestHome(home);
  }
});

test('静态页渲染：卡片与详情引用终态字段，且不把可翻译文案写进 title', () => {
  assert.match(UI_JS, /mem\.terminalScope/, '卡片渲染终态作用域');
  assert.match(UI_JS, /本机不再持有/, '展示「本机不再持有」语义');
  assert.match(UI_JS, /d\.memory\.terminalScope/, '详情抽屉渲染终态作用域');
  assert.doesNotMatch(UI_JS, /title:\s*'终态/, '可翻译文案不得由 title 承载');
});
