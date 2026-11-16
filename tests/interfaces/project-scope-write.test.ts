import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../../src/interfaces/mcp/server.js';
import { AppService } from '../../src/interfaces/app-service.js';
import { openStore } from '../../src/store/open.js';
import { isUuid, uuidv7 } from '../../src/core/ids.js';
import { makeTestHome, cleanupTestHome } from '../helpers.js';

/**
 * 写入路径的项目身份解析（第九批缺陷修复）：
 * `memory_add` / `memory_promote` 的 project_id 与检索共用 resolveProjectArg，
 * 路径别名必须解析成登记过的 UUID，未登记零写入；作用域解析处再兜一道 UUID 形态校验。
 */

interface ToolResult {
  isError?: boolean;
  content: { type: string; text: string }[];
}

function body(r: ToolResult): Record<string, unknown> {
  return JSON.parse(r.content[0]!.text) as Record<string, unknown>;
}

interface Harness {
  client: Client;
  server: ReturnType<typeof createServer>;
  call(name: string, args?: Record<string, unknown>): Promise<ToolResult>;
  close(): Promise<void>;
}

async function start(home: string): Promise<Harness> {
  const server = createServer(home);
  const client = new Client({ name: 'project-scope-write-test', version: '0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client,
    server,
    call: (name, args = {}) => client.callTool({ name, arguments: args }) as Promise<ToolResult>,
    async close() {
      await client.close();
      await server.close();
    },
  };
}

const ALIAS = 'D:\\proj\\alpha-write';

test('memory_add / memory_promote：已登记路径别名解析成 UUID，不生成路径 id 的孤儿作用域', async () => {
  const home = makeTestHome('cairn-proj-write-');
  const h = await start(home);
  let memoryId = '';
  let promotedId = '';
  try {
    const proj = body(await h.call('project_resolve', { path_or_url: ALIAS }));
    const projectId = String(proj['projectId']);
    assert.ok(isUuid(projectId), 'project_resolve 必须返回 UUID');

    // 别名（大小写/尾斜杠不同，走归一化）必须解析成同一 UUID
    const added = body(
      await h.call('memory_add', {
        content: '写入别名解析：部署窗口每周四晚十点',
        scope_preset: 'project-global',
        project_id: 'd:/proj/alpha-write/',
      }),
    );
    memoryId = String(added['id']);

    promotedId = String(body(await h.call('memory_propose', { content: '晋升别名解析：发布前先冻结变更窗口' }))['id']);
    await h.call('memory_promote', { id: promotedId, scope_preset: 'project-global', project_id: 'd:/proj/alpha-write/' });
  } finally {
    await h.close();
  }

  const store = openStore({ home });
  try {
    for (const id of [memoryId, promotedId]) {
      const mem = store.db.get('SELECT scope_id FROM memory WHERE id = ?', id);
      assert.ok(mem, `记忆 ${id} 应已写入`);
      const scope = store.db.get('SELECT project_id, preset FROM scope WHERE id = ?', String(mem['scope_id']));
      assert.equal(scope?.['preset'], 'project-global');
      const projectId = String(scope?.['project_id']);
      assert.ok(isUuid(projectId), `scope.project_id 必须是 UUID，实得 ${projectId}`);
      assert.notEqual(projectId, 'd:/proj/alpha-write/', '不得再把路径当 projectId');
      assert.ok(store.db.get('SELECT id FROM project WHERE id = ?', projectId), 'scope 必须挂在已登记项目上');
    }
    assert.equal(
      store.db.all("SELECT id FROM scope WHERE project_id LIKE '%proj%' OR project_id LIKE '/%'").length,
      0,
      '不得存在路径形态的 project_id 作用域',
    );
  } finally {
    store.close();
    cleanupTestHome(home);
  }
});

test('memory_add：未登记路径别名报 E_NOT_FOUND，且零写入', async () => {
  const home = makeTestHome('cairn-proj-write-');
  const h = await start(home);
  try {
    const before = await h.call('memory_status');
    assert.equal(before.isError, undefined);

    const res = await h.call('memory_add', {
      content: '未登记别名的记忆不应落库',
      scope_preset: 'project-global',
      project_id: 'D:\\proj\\never-registered-write',
    });
    assert.equal(res.isError, true, '未登记别名必须作为工具错误返回');
    const errBody = body(res);
    assert.equal(errBody['code'], 'E_NOT_FOUND');
    assert.match(String(errBody['message']), /project_resolve/, '错误信息指引先走 project_resolve');
  } finally {
    await h.close();
  }

  const store = openStore({ home });
  try {
    assert.equal(store.db.all('SELECT id FROM memory').length, 0, '不得写入记忆');
    assert.equal(store.db.all("SELECT id FROM scope WHERE project_id IS NOT NULL").length, 0, '不得创建项目作用域');
    assert.equal(store.db.all("SELECT id FROM space WHERE space_kind = 'project'").length, 0, '不得创建项目空间');
    assert.equal(store.db.all('SELECT id FROM project').length, 0, '不得登记项目');
  } finally {
    store.close();
    cleanupTestHome(home);
  }
});

test('resolveScope：project-global / project-device 传路径形态 projectId 一律 E_VALIDATION', () => {
  const home = makeTestHome('cairn-proj-write-');
  const svc = AppService.open(home);
  const expectValidation = (e: unknown): boolean =>
    (e as { code?: string }).code === 'E_VALIDATION' && /UUID/.test(String((e as Error).message)) && /project_resolve/.test(String((e as Error).message));
  try {
    assert.throws(() => svc.resolveScope({ preset: 'project-global', projectId: 'D:/some/path' }), expectValidation);
    assert.throws(() => svc.resolveScope({ preset: 'project-device', projectId: 'D:/some/path' }), expectValidation);
    // 合法 UUID 不受影响
    assert.equal(svc.resolveScope({ preset: 'project-global', projectId: uuidv7() }).preset, 'project-global');
  } finally {
    svc.close();
    cleanupTestHome(home);
  }
});

test('memory_add：合法 UUID 行为与从前一致', async () => {
  const home = makeTestHome('cairn-proj-write-');
  const projectId = uuidv7();
  const h = await start(home);
  let memoryId = '';
  try {
    const added = body(
      await h.call('memory_add', { content: '合法 UUID 直接使用', scope_preset: 'project-global', project_id: projectId }),
    );
    assert.equal(added['action'], 'insert');
    memoryId = String(added['id']);
  } finally {
    await h.close();
  }

  const store = openStore({ home });
  try {
    const mem = store.db.get('SELECT scope_id FROM memory WHERE id = ?', memoryId);
    const scope = store.db.get('SELECT project_id FROM scope WHERE id = ?', String(mem?.['scope_id']));
    assert.equal(scope?.['project_id'], projectId, 'UUID 原样作为 project_id');
  } finally {
    store.close();
    cleanupTestHome(home);
  }
});
