import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { openStore, CairnStore } from '../../src/store/open.js';
import { makeTestHome, cleanupTestHome } from '../helpers.js';
import { importSnapshot } from '../../src/onboarding/import.js';
import { assignBatch } from '../../src/onboarding/batches.js';
import { startConsoleServer, ConsoleServerHandle } from '../../src/interfaces/console/server.js';

const TOKEN = 'a'.repeat(64);
const NORMAL_TEXT = '构建命令是 pnpm build，产物目录 dist';
const SENSITIVE_TEXT = '我的家庭住址是某某路 12 号 3 单元，仅本人可见';

interface Ctx {
  home: string;
  store: CairnStore;
  batchId: string;
  /** 批次里可用的干净条目，用于构造真实计划（空计划会被 E_PLAN_INVALID 拒掉）。 */
  cleanItems: Array<{ itemId: string; content: string }>;
  cleanup(): void;
}

async function setup(): Promise<Ctx> {
  const home = makeTestHome('cairn-server-');
  const store = openStore({ home });
  const scope = store.scopes.resolvePreset('personal-global', {});
  const local = store.scopes.resolvePreset('device-local', { deviceId: store.identity.deviceId });
  store.memories.add(
    { kind: 'fact', content: NORMAL_TEXT, scopeId: scope.id, authority: 'user_explicit', createdBy: 'cli' },
    store.identity.deviceId,
  );
  store.memories.add(
    {
      kind: 'fact',
      content: SENSITIVE_TEXT,
      scopeId: local.id,
      authority: 'user_explicit',
      createdBy: 'cli',
      sensitivity: 'sensitive',
    },
    store.identity.deviceId,
  );
  const dir = join(home, 'sources');
  mkdirSync(dir, { recursive: true });
  const p = join(dir, 'one.md');
  writeFileSync(p, '一条正常快照条目，长度足够用于批次统计。\n\n第二条快照条目，同样是正常的。\n', 'utf8');
  const o = await importSnapshot(store, { agentKind: 'manual', sourcePath: p });
  const archiveId = (o.archiveId ?? o.reusedArchiveId)!;
  const batchId = assignBatch(store, archiveId);
  const cleanItems = store.db
    .all("SELECT id, content FROM import_item WHERE batch_id = ? AND scan_state = 'clean'", batchId)
    .map((r) => ({ itemId: String(r['id']), content: String(r['content']) }));
  store.close();
  const readOnly = openStore({ home, readOnly: true });
  return {
    home,
    store: readOnly,
    batchId,
    cleanItems,
    cleanup() {
      try {
        readOnly.close();
      } catch {
        /* 已关闭 */
      }
      cleanupTestHome(home);
    },
  };
}

interface Served {
  srv: ConsoleServerHandle;
  done(): Promise<void>;
}

/** 每个用例独立起一个服务：端口冲突在并发测试里是最常见的假失败来源。 */
async function serve(ctx: Ctx): Promise<Served> {
  const srv = await startConsoleServer({ home: ctx.home, port: 0, token: TOKEN });
  return {
    srv,
    done: () => srv.close(),
  };
}

function api(srv: ConsoleServerHandle, path: string, init: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = { 'x-cairn-token': TOKEN, ...(init.headers as Record<string, string> | undefined) };
  return fetch(new URL(path, srv.url), { ...init, headers });
}

test('无令牌：401，且不泄漏任何数据', async () => {
  const ctx = await setup();
  const s = await serve(ctx);
  try {
    const r = await fetch(new URL('/api/status', ctx.home && s.srv.url));
    assert.equal(r.status, 401);
    const body = (await r.json()) as { ok: boolean; error: { code: string } };
    assert.equal(body.ok, false);
    assert.equal(body.error.code, 'E_FORBIDDEN');
    assert.equal(JSON.stringify(body).includes(NORMAL_TEXT), false);
  } finally {
    await s.done();
    ctx.cleanup();
  }
});

test('错误令牌：401（长度相同也不放过）', async () => {
  const ctx = await setup();
  const s = await serve(ctx);
  try {
    const r = await fetch(new URL('/api/status', s.srv.url), { headers: { 'x-cairn-token': 'b'.repeat(64) } });
    assert.equal(r.status, 401);
    const r2 = await fetch(new URL('/api/status', s.srv.url), { headers: { 'x-cairn-token': 'b'.repeat(63) } });
    assert.equal(r2.status, 401);
  } finally {
    await s.done();
    ctx.cleanup();
  }
});

/**
 * fetch 规范把 Host 列为禁止由脚本设置的请求头，undici 会静默忽略它，
 * 所以"伪造 Host"必须走裸 http.request —— 这也正是攻击者真实会做的事。
 */
function rawGet(port: number, path: string, headers: Record<string, string>): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, method: 'GET', headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('非回环 Host：403 —— 即便令牌正确（防 DNS rebinding）', async () => {
  const ctx = await setup();
  const s = await serve(ctx);
  try {
    const evil = await rawGet(s.srv.port, '/api/status', { host: 'evil.example.com', 'x-cairn-token': TOKEN });
    assert.equal(evil.status, 403, 'Host 判定必须早于其它一切');
    const ok = await rawGet(s.srv.port, '/api/status', { host: `localhost:${s.srv.port}`, 'x-cairn-token': TOKEN });
    assert.equal(ok.status, 200, 'localhost 等价回环，应放行');
    const loopback = await rawGet(s.srv.port, '/api/status', {
      host: `127.0.0.1:${s.srv.port}`,
      'x-cairn-token': TOKEN,
    });
    assert.equal(loopback.status, 200);
  } finally {
    await s.done();
    ctx.cleanup();
  }
});

test('跨站 Origin：403（含 Sec-Fetch-Site: cross-site）', async () => {
  const ctx = await setup();
  const s = await serve(ctx);
  try {
    const bad = await api(s.srv, '/api/status', { headers: { origin: 'http://evil.example.com' } });
    assert.equal(bad.status, 403);
    const crossSite = await api(s.srv, '/api/status', { headers: { 'sec-fetch-site': 'cross-site' } });
    assert.equal(crossSite.status, 403);
    const same = await api(s.srv, '/api/status', { headers: { origin: s.srv.url.replace(/\/$/, '') } });
    assert.equal(same.status, 200);
  } finally {
    await s.done();
    ctx.cleanup();
  }
});

test('安全响应头：no-store + CSP default-src none', async () => {
  const ctx = await setup();
  const s = await serve(ctx);
  try {
    const r = await api(s.srv, '/api/status');
    const cc = r.headers.get('cache-control') ?? '';
    assert.ok(cc.includes('no-store'), `必须是 no-store，实际 ${cc}`);
    const csp = r.headers.get('content-security-policy') ?? '';
    assert.ok(csp.includes("default-src 'none'"), `CSP 应锁死外部资源，实际 ${csp}`);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  } finally {
    await s.done();
    ctx.cleanup();
  }
});

test('首页：HTTP 模式下不含内联模型（模型由 API 拉取），但含视图骨架', async () => {
  const ctx = await setup();
  const s = await serve(ctx);
  try {
    const r = await api(s.srv, '/');
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.ok(html.includes('<!DOCTYPE html>'));
    assert.ok(html.includes('cairn'));
    assert.equal(html.includes('id="cairn-model"'), false, 'HTTP 模式模型通过 /api 获取，不复用静态导出的内联块');
    assert.ok(html.includes('localStorage') || html.includes('sessionStorage'), '应通过会话令牌交换持久化，而非每次带 query');
  } finally {
    await s.done();
    ctx.cleanup();
  }
});

test('只读端点全量可用：9 个 GET 均 200 且结构完整', async () => {
  const ctx = await setup();
  const s = await serve(ctx);
  try {
    const paths = [
      '/api/status',
      '/api/scopes',
      '/api/memories?mode=full&redact=0',
      '/api/archives',
      `/api/batches/${encodeURIComponent(ctx.batchId)}`,
      '/api/plans',
      '/api/reviews',
      '/api/inbox',
      '/api/sync/status',
    ];
    for (const p of paths) {
      const r = await api(s.srv, p);
      assert.equal(r.status, 200, `${p} 应 200，实际 ${r.status}`);
      const body = (await r.json()) as { ok: boolean; data: unknown };
      assert.equal(body.ok, true, `${p} 应返回 ok:true`);
      assert.notEqual(body.data, null, `${p} 的 data 不应为空`);
    }
  } finally {
    await s.done();
    ctx.cleanup();
  }
});

test('记忆详情：不存在 → 404；存在 → 200 且 brief 模式正文被截断', async () => {
  const ctx = await setup();
  const s = await serve(ctx);
  try {
    const notFound = await api(s.srv, '/api/memories/does-not-exist');
    assert.equal(notFound.status, 404);
    const list = (await (await api(s.srv, '/api/memories?mode=full&redact=0')).json()) as {
      data: { memories: Array<{ id: string }> };
    };
    const id = list.data.memories[0]!.id;
    const detail = await api(s.srv, `/api/memories/${encodeURIComponent(id)}?mode=brief&redact=0`);
    assert.equal(detail.status, 200);
    const body = (await detail.json()) as { data: { memory: { content: { text: string | null } } } };
    assert.ok(body.data.memory.content.text != null);
  } finally {
    await s.done();
    ctx.cleanup();
  }
});

test('HTTP 响应默认掩码 sensitive 正文；redact=0 才给明文', async () => {
  const ctx = await setup();
  const s = await serve(ctx);
  try {
    const masked = (await (await api(s.srv, '/api/memories?mode=full')).json()) as {
      data: { memories: Array<{ content: { masked: boolean; text: string | null } }> };
    };
    const sMasked = masked.data.memories.filter((m) => m.content.masked);
    assert.ok(sMasked.length >= 1, '默认应至少掩码一条');
    assert.ok(sMasked.every((m) => m.content.text == null || !m.content.text.includes('某某路')));

    const plain = (await (await api(s.srv, '/api/memories?mode=full&redact=0')).json()) as {
      data: { memories: Array<{ content: { masked: boolean; text: string | null } }> };
    };
    assert.ok(plain.data.memories.some((m) => m.content.text?.includes(SENSITIVE_TEXT)), 'redact=0 应给明文');
  } finally {
    await s.done();
    ctx.cleanup();
  }
});

test('批次不存在：404，而不是空进度', async () => {
  const ctx = await setup();
  const s = await serve(ctx);
  try {
    const r = await api(s.srv, '/api/batches/batch-does-not-exist');
    assert.equal(r.status, 404);
    const body = (await r.json()) as { ok: boolean; error: { code: string } };
    assert.equal(body.error.code, 'E_NOT_FOUND');
  } finally {
    await s.done();
    ctx.cleanup();
  }
});

test('未知 API 路径：404；非 /api 路径：404', async () => {
  const ctx = await setup();
  const s = await serve(ctx);
  try {
    assert.equal((await api(s.srv, '/api/nope')).status, 404);
    assert.equal((await api(s.srv, '/some/file.txt')).status, 404);
  } finally {
    await s.done();
    ctx.cleanup();
  }
});

test('写操作必须 POST：GET 打写端点不产生副作用', async () => {
  const ctx = await setup();
  const s = await serve(ctx);
  try {
    const before = (await (await api(s.srv, '/api/plans')).json()) as { data: { plans: unknown[] } };
    for (const p of ['/api/sync/push', '/api/sync/pull', '/api/reviews/run', '/api/reviews/import']) {
      const r = await api(s.srv, p);
      assert.equal(r.status, 404, `GET ${p} 不应落到写分支`);
    }
    const after = (await (await api(s.srv, '/api/plans')).json()) as { data: { plans: unknown[] } };
    assert.equal(after.data.plans.length, before.data.plans.length, '计划数不应因 GET 改变');
  } finally {
    await s.done();
    ctx.cleanup();
  }
});

test('approve：哈希前缀不符 → 400；前缀正确 → 200 且通道记为 webui', async () => {
  const ctx = await setup();
  const s = await serve(ctx);
  try {
    const created = (await (
      await api(s.srv, '/api/plans', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          batchId: ctx.batchId,
          items: ctx.cleanItems.slice(0, 1).map((i) => ({ itemId: i.itemId, content: i.content, kind: 'fact', opHint: 'add' })),
        }),
      })
    ).json()) as { ok: boolean; data: { plan: { id: string }; planHash: string } };
    assert.equal(created.ok, true, '干净条目应能构造出计划');
    const planId = created.data.plan.id;
    const hash = created.data.planHash;

    const wrong = await api(s.srv, `/api/plans/${encodeURIComponent(planId)}/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ planHashPrefix: 'deadbeef' }),
    });
    assert.equal(wrong.status, 400);
    const body = (await wrong.json()) as { error: { message: string } };
    assert.ok(body.error.message.includes('哈希'), '错误信息应指向哈希核对');

    const empty = await api(s.srv, `/api/plans/${encodeURIComponent(planId)}/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ planHashPrefix: '' }),
    });
    assert.equal(empty.status, 400, '空前缀不得视作通过');

    const ok = await api(s.srv, `/api/plans/${encodeURIComponent(planId)}/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ planHashPrefix: hash.slice(0, 8).toUpperCase() }),
    });
    assert.equal(ok.status, 200, '大小写不敏感，前 8 位匹配即通过');
    const approved = (await ok.json()) as { data: { approvalId: string } };
    assert.ok(approved.data.approvalId.length > 0);

    const audits = ctx.store.db.all(
      `SELECT action FROM audit_event WHERE category='approval' ORDER BY rowid DESC LIMIT 5`,
    );
    assert.ok(
      audits.some((a) => String(a['action']) === 'issued_via_webui'),
      '审批通道必须留痕为 webui，便于事后区分谁在哪签发',
    );
  } finally {
    await s.done();
    ctx.cleanup();
  }
});

test('请求体非法：400 而非 500', async () => {
  const ctx = await setup();
  const s = await serve(ctx);
  try {
    const bad = await api(s.srv, '/api/reviews/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    assert.equal(bad.status, 400);
    const arr = await api(s.srv, '/api/reviews/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '[1,2,3]',
    });
    assert.equal(arr.status, 400, '数组不是合法请求对象');
  } finally {
    await s.done();
    ctx.cleanup();
  }
});

test('日志：只记方法与去 query 的路径，令牌绝不进日志', async () => {
  const ctx = await setup();
  const s = await serve(ctx);
  const captured: string[] = [];
  const original = process.stderr.write.bind(process.stderr);
  (process.stderr as unknown as { write: (chunk: string) => boolean }).write = (chunk: string) => {
    captured.push(String(chunk));
    return true;
  };
  try {
    await fetch(new URL(`/?t=${TOKEN}`, s.srv.url));
    await fetch(new URL(`/api/status?t=${TOKEN}`, s.srv.url));
  } finally {
    (process.stderr as unknown as { write: typeof original }).write = original;
    await s.done();
    ctx.cleanup();
  }
  const logs = captured.join('');
  assert.ok(logs.includes('[cairn-ui] GET /'), `应记录请求行，实际 ${logs}`);
  assert.equal(logs.includes(TOKEN), false, '令牌不得出现在日志中');
  assert.equal(logs.includes('?t='), false, 'query 必须被剔除');
});

test('端口占用：回退到系统分配，且第二个实例不覆盖第一个', async () => {
  const ctx = await setup();
  const first = await startConsoleServer({ home: ctx.home, port: 0, token: TOKEN });
  const second = await startConsoleServer({ home: ctx.home, port: first.port, token: TOKEN });
  try {
    assert.notEqual(second.port, first.port, '被占用的端口应回退，而不是复用');
    assert.equal((await api(first, '/api/status')).status, 200);
    assert.equal((await api(second, '/api/status')).status, 200);
  } finally {
    await first.close();
    await second.close();
    ctx.cleanup();
  }
});

test('close 后端口不再响应', async () => {
  const ctx = await setup();
  const s = await serve(ctx);
  const { port } = s.srv;
  await s.done();
  ctx.cleanup();
  let refused = false;
  try {
    await fetch(`http://127.0.0.1:${port}/api/status`, { headers: { 'x-cairn-token': TOKEN } });
  } catch {
    refused = true;
  }
  assert.equal(refused, true, '关闭后应立即拒绝连接');
});

test('tokenUrl 携带令牌，url 不携带', async () => {
  const ctx = await setup();
  const s = await serve(ctx);
  try {
    assert.ok(s.srv.tokenUrl.includes(`t=${TOKEN}`));
    assert.equal(s.srv.url.includes(TOKEN), false);
    assert.ok(s.srv.url.startsWith('http://127.0.0.1:'));
    assert.equal(s.srv.host, '127.0.0.1', '只绑回环，不存在放开开关');
  } finally {
    await s.done();
    ctx.cleanup();
  }
});

// ---------------------------------------------------------------------------
// 导入工作台接口（任务 4.1 / 4.6）
// ---------------------------------------------------------------------------

test('GET /api/imports：一条导入一行，行数与档案数一致', async () => {
  const ctx = await setup();
  const s = await serve(ctx);
  try {
    const r = await api(s.srv, '/api/imports');
    assert.equal(r.status, 200);
    const body = (await r.json()) as {
      ok: boolean;
      data: { rows: Array<Record<string, unknown>>; groups: Array<Record<string, unknown>> };
    };
    assert.equal(body.ok, true);
    assert.ok(body.data.rows.length >= 1);
    assert.equal(body.data.rows.length, Number(ctx.store.db.scalar('SELECT COUNT(*) FROM import_archive')));
    const row = body.data.rows[0]!;
    for (const k of ['id', 'archiveId', 'batchId', 'sourceLabel', 'importCount', 'lastImportedAt', 'isLatestOfSource', 'items', 'autoRun']) {
      assert.ok(k in row, `行里缺少字段 ${k}`);
    }
    // 来源标识不得带出绝对路径
    assert.equal(JSON.stringify(body.data).includes(ctx.home), false);
  } finally {
    await s.done();
    ctx.cleanup();
  }
});

test('GET /api/policies：无策略为空数组；签发后出现 id 与 8 位哈希前缀', async () => {
  const ctx = await setup();
  const s = await serve(ctx);
  try {
    const empty = (await (await api(s.srv, '/api/policies')).json()) as { ok: boolean; data: unknown[] };
    assert.equal(empty.ok, true);
    assert.deepEqual(empty.data, []);

    const { signPolicy } = await import('../../src/onboarding/policy.js');
    signPolicy(
      ctx.home,
      {
        id: 'web-auto',
        allowedScopes: ['personal-global'],
        maxSensitivity: 'normal',
        requireAiAgreement: false,
        allowCreate: true,
        minConfidence: 0.6,
        note: '页面下拉用',
      },
      { via: 'cli' },
    );

    const list = (await (await api(s.srv, '/api/policies')).json()) as {
      ok: boolean;
      data: Array<Record<string, unknown>>;
    };
    assert.equal(list.data.length, 1);
    assert.equal(list.data[0]!['id'], 'web-auto');
    assert.equal(String(list.data[0]!['policyHashPrefix']).length, 8);
  } finally {
    await s.done();
    ctx.cleanup();
  }
});

test('POST /api/onboarding/auto：未签发策略被拒，且不写库', async () => {
  const ctx = await setup();
  const s = await serve(ctx);
  try {
    const before = Number(ctx.store.db.scalar('SELECT COUNT(*) FROM memory'));
    const r = await api(s.srv, '/api/onboarding/auto', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ policyId: 'no-such-policy' }),
    });
    assert.ok(r.status >= 400 && r.status < 500, `应为 4xx，实际 ${r.status}`);
    const body = (await r.json()) as { ok: boolean; error: { code: string } };
    assert.equal(body.ok, false);
    assert.equal(body.error.code, 'E_NOT_FOUND');
    assert.equal(Number(ctx.store.db.scalar('SELECT COUNT(*) FROM memory')), before, '被拒时不得写库');
  } finally {
    await s.done();
    ctx.cleanup();
  }
});

test('POST /api/onboarding/auto：dry-run 只分档不写库', async () => {
  const ctx = await setup();
  const s = await serve(ctx);
  try {
    const { signPolicy } = await import('../../src/onboarding/policy.js');
    signPolicy(
      ctx.home,
      {
        id: 'web-dry',
        allowedScopes: ['personal-global'],
        maxSensitivity: 'normal',
        requireAiAgreement: false,
        allowCreate: true,
        minConfidence: 0.6,
        note: 'dry',
      },
      { via: 'cli' },
    );
    const before = Number(ctx.store.db.scalar('SELECT COUNT(*) FROM memory'));
    const r = await api(s.srv, '/api/onboarding/auto', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ policyId: 'web-dry', batchId: ctx.batchId, dryRun: true }),
    });
    assert.equal(r.status, 200);
    const body = (await r.json()) as {
      ok: boolean;
      data: { dryRun: boolean; applied: number; balanced: boolean; totalItems: number };
    };
    assert.equal(body.data.dryRun, true);
    assert.equal(body.data.applied, 0);
    assert.equal(body.data.balanced, true);
    assert.ok(body.data.totalItems >= 1);
    assert.equal(Number(ctx.store.db.scalar('SELECT COUNT(*) FROM memory')), before, 'dry-run 必须零写入');
  } finally {
    await s.done();
    ctx.cleanup();
  }
});

test('POST /api/onboarding/revoke：无产物时 tombstoned 为 0，不报错', async () => {
  const ctx = await setup();
  const s = await serve(ctx);
  try {
    const { signPolicy } = await import('../../src/onboarding/policy.js');
    signPolicy(
      ctx.home,
      {
        id: 'web-revoke',
        allowedScopes: ['personal-global'],
        maxSensitivity: 'normal',
        requireAiAgreement: false,
        allowCreate: true,
        minConfidence: 0.6,
        note: 'revoke',
      },
      { via: 'cli' },
    );
    const r = await api(s.srv, '/api/onboarding/revoke', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ policyId: 'web-revoke', batchId: ctx.batchId }),
    });
    assert.equal(r.status, 200);
    const body = (await r.json()) as { ok: boolean; data: { tombstoned: number; memoryIds: string[] } };
    assert.equal(body.data.tombstoned, 0);
    assert.deepEqual(body.data.memoryIds, []);
    // 撤销动作本身要留审计，否则"撤过没撤过"无从查证
    const n = Number(
      ctx.store.db.scalar("SELECT COUNT(*) FROM audit_event WHERE category='policy' AND action='revoked'") ?? 0,
    );
    assert.ok(n >= 1, '撤销必须留审计');
  } finally {
    await s.done();
    ctx.cleanup();
  }
});

test('POST /api/onboarding/revoke：缺 policyId → 400', async () => {
  const ctx = await setup();
  const s = await serve(ctx);
  try {
    const r = await api(s.srv, '/api/onboarding/revoke', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(r.status, 400);
    const body = (await r.json()) as { error: { code: string } };
    assert.equal(body.error.code, 'E_VALIDATION');
  } finally {
    await s.done();
    ctx.cleanup();
  }
});
