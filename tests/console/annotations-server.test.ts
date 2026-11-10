import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppService } from '../../src/interfaces/app-service.js';
import { startConsoleServer, ConsoleServerHandle } from '../../src/interfaces/console/server.js';
import { annotationsPath } from '../../src/interfaces/console/annotations.js';
import { existsSync } from 'node:fs';
import { makeTestHome, cleanupTestHome } from '../helpers.js';

/**
 * 控制台批注端点（local-console spec 任务 5.1）：
 * GET 读批注（只读连接即可），POST 单条/批量写 annotations.json；
 * pending_forget 不改变记忆状态；秘密批注被拒且不落盘。
 */

const TOKEN = 'c'.repeat(64);
const FAKE_AWS_ID = 'AKIAIOSFODNN7EXAMPLE';

interface Ctx {
  home: string;
  ids: string[];
  srv: ConsoleServerHandle;
  cleanup(): Promise<void>;
}

async function setup(): Promise<Ctx> {
  const home = makeTestHome('cairn-annot-srv-');
  const svc = AppService.open(home);
  const ids = [
    svc.addMemory({ content: '控制台批注第一条：构建命令是 pnpm build。' }).memory!.id,
    svc.addMemory({ content: '控制台批注第二条：产物目录是 dist。' }).memory!.id,
  ];
  svc.close();
  const srv = await startConsoleServer({ home, port: 0, token: TOKEN });
  return {
    home,
    ids,
    srv,
    async cleanup() {
      await srv.close();
      cleanupTestHome(home);
    },
  };
}

function api(ctx: Ctx, path: string, init: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = { 'x-cairn-token': TOKEN, ...(init.headers as Record<string, string> | undefined) };
  return fetch(new URL(path, ctx.srv.url), { ...init, headers });
}

function post(ctx: Ctx, body: unknown): Promise<Response> {
  return api(ctx, '/api/annotations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('POST 单条 → GET 读回；记忆正文与状态不变', async () => {
  const ctx = await setup();
  try {
    const before = (await (await api(ctx, `/api/memories/${encodeURIComponent(ctx.ids[0]!)}?mode=full&redact=0`)).json()) as {
      data: { memory: { content: { text: string }; status: string; revisionCount: number } };
    };

    const r = await post(ctx, { memoryId: ctx.ids[0], disposition: 'needs_edit', note: '日期需要核对' });
    assert.equal(r.status, 200);
    const body = (await r.json()) as { ok: boolean; data: { succeeded: number; failed: unknown[]; annotations: { id: string }[] } };
    assert.equal(body.data.succeeded, 1);
    assert.equal(body.data.failed.length, 0);
    assert.ok(body.data.annotations[0]!.id.startsWith('ann_'));

    const list = (await (await api(ctx, `/api/annotations?memory=${encodeURIComponent(ctx.ids[0]!)}&status=open`)).json()) as {
      data: { total: number; items: Array<Record<string, unknown>> };
    };
    assert.equal(list.data.total, 1);
    assert.equal(list.data.items[0]!['disposition'], 'needs_edit');
    assert.equal(list.data.items[0]!['note'], '日期需要核对');
    assert.equal(list.data.items[0]!['memoryStatus'], 'active');

    // 空串是"未选择"（下拉默认项），不得当成过滤值把所有批注筛掉
    const unfiltered = (await (await api(ctx, '/api/annotations?status=&disposition=&memory=')).json()) as {
      data: { total: number };
    };
    assert.equal(unfiltered.data.total, 1, '空过滤值应等价于不过滤');

    const after = (await (await api(ctx, `/api/memories/${encodeURIComponent(ctx.ids[0]!)}?mode=full&redact=0`)).json()) as {
      data: { memory: { content: { text: string }; status: string; revisionCount: number } };
    };
    assert.equal(after.data.memory.content.text, before.data.memory.content.text);
    assert.equal(after.data.memory.status, 'active');
    assert.equal(after.data.memory.revisionCount, before.data.memory.revisionCount);
  } finally {
    await ctx.cleanup();
  }
});

test('POST 批量：不存在的 id 记为失败，其余成功并分别计数', async () => {
  const ctx = await setup();
  try {
    const r = await post(ctx, {
      memoryIds: [ctx.ids[0], 'mem_nope', ctx.ids[1]],
      disposition: 'can_delete',
      note: '这批都过期了',
    });
    assert.equal(r.status, 200);
    const body = (await r.json()) as {
      data: { succeeded: number; failed: Array<{ memoryId: string; code: string }> };
    };
    assert.equal(body.data.succeeded, 2);
    assert.equal(body.data.failed.length, 1);
    assert.equal(body.data.failed[0]!.memoryId, 'mem_nope');
    assert.equal(body.data.failed[0]!.code, 'E_NOT_FOUND');

    const list = (await (await api(ctx, '/api/annotations?disposition=can_delete')).json()) as {
      data: { total: number };
    };
    assert.equal(list.data.total, 2);
  } finally {
    await ctx.cleanup();
  }
});

test('POST pending_forget：只是标记，GET 显示记忆仍为活动状态', async () => {
  const ctx = await setup();
  try {
    const r = await post(ctx, { memoryId: ctx.ids[0], disposition: 'pending_forget', note: '可以删了' });
    assert.equal(r.status, 200);
    const detail = (await (await api(ctx, `/api/memories/${encodeURIComponent(ctx.ids[0]!)}?mode=full&redact=0`)).json()) as {
      data: { memory: { status: string }; tombstone: unknown };
    };
    assert.equal(detail.data.memory.status, 'active');
    assert.equal(detail.data.tombstone, null);

    const list = (await (await api(ctx, '/api/annotations?status=open')).json()) as {
      data: { items: Array<Record<string, unknown>> };
    };
    assert.equal(list.data.items[0]!['memoryStatus'], 'active', '界面据此显示"尚未删除"');
  } finally {
    await ctx.cleanup();
  }
});

test('秘密批注：4xx 拒绝，批注文件不存在', async () => {
  const ctx = await setup();
  try {
    const r = await post(ctx, { memoryId: ctx.ids[0], disposition: 'needs_edit', note: `密钥 ${FAKE_AWS_ID}` });
    assert.ok(r.status >= 400 && r.status < 500, `应为 4xx，实际 ${r.status}`);
    const body = (await r.json()) as { ok: boolean; error: { code: string } };
    assert.equal(body.ok, false);
    assert.equal(body.error.code, 'E_SECRET_DETECTED');
    assert.equal(JSON.stringify(body).includes(FAKE_AWS_ID), false, '错误不得回显原文');
    assert.equal(existsSync(annotationsPath(ctx.home)), false);
    const list = (await (await api(ctx, '/api/annotations')).json()) as { data: { total: number } };
    assert.equal(list.data.total, 0);
  } finally {
    await ctx.cleanup();
  }
});

test('GET 打 /api/annotations 不产生副作用（只读连接即可）', async () => {
  const ctx = await setup();
  try {
    const r = await api(ctx, '/api/annotations');
    assert.equal(r.status, 200);
    assert.equal(existsSync(annotationsPath(ctx.home)), false, '纯读取不应创建批注文件');
    assert.equal((await r.json() as { data: { total: number } }).data.total, 0);
  } finally {
    await ctx.cleanup();
  }
});
