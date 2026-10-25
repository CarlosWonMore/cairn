import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeTestHome, cleanupTestHome } from '../helpers.js';

/**
 * ECS syncd 合同测试（任务 3.1）：chunk 幂等、manifest 代次 CAS、Bearer 鉴权。
 * 服务器以子进程启动（零依赖 .mjs），数据目录与 token 随机。
 */

const SERVER = join(process.cwd(), 'syncd', 'cairn-syncd.mjs');

interface ServerHandle {
  baseUrl: string;
  token: string;
  stop(): Promise<void>;
}

async function startSyncd(): Promise<ServerHandle> {
  const dataDir = mkdtempSync(join(tmpdir(), 'syncd-data-'));
  const token = `tok_${Math.random().toString(36).slice(2)}`;
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, CAIRN_SYNCD_PORT: String(port), CAIRN_SYNCD_HOST: '127.0.0.1', CAIRN_SYNCD_TOKEN: token, CAIRN_SYNCD_DATA: dataDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (c) => (out += String(c)));
  child.stderr.on('data', (c) => (out += String(c)));
  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 10000;
  for (;;) {
    if (out.includes('listening on')) break;
    if (Date.now() > deadline) throw new Error(`syncd 启动超时: ${out}`);
    await new Promise((r) => setTimeout(r, 50));
  }
  return {
    baseUrl,
    token,
    stop: () =>
      new Promise<void>((r) => {
        child.on('close', () => {
          try {
            require('node:fs').rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 });
          } catch { /* best effort */ }
          r();
        });
        child.kill();
      }),
  };
}

async function req(baseUrl: string, token: string, method: string, path: string, body?: Buffer, headers: Record<string, string> = {}): Promise<{ status: number; body: Buffer }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...headers },
    body: body ? Buffer.from(body) : undefined,
  });
  return { status: res.status, body: Buffer.from(await res.arrayBuffer()) };
}

test('syncd：chunk 上传幂等 + 下载往返 + 404', async () => {
  const s = await startSyncd();
  try {
    const key = 'vlt/spaces/personal-global/devices/d1/chunks/1-abc.bin';
    const body = Buffer.from('chunk-bytes-甲乙丙');
    const p1 = await req(s.baseUrl, s.token, 'PUT', `/chunks/${encodeURIComponent(key)}`, body);
    assert.equal(p1.status, 200);
    const p2 = await req(s.baseUrl, s.token, 'PUT', `/chunks/${encodeURIComponent(key)}`, body);
    assert.equal(p2.status, 200, '同 key 同体幂等');
    const g = await req(s.baseUrl, s.token, 'GET', `/chunks/${encodeURIComponent(key)}`);
    assert.equal(g.status, 200);
    assert.deepEqual(g.body, body, '往返逐字节一致');
    const missing = await req(s.baseUrl, s.token, 'GET', `/chunks/${encodeURIComponent('vlt/x/devices/d9/chunks/9-none.bin')}`);
    assert.equal(missing.status, 404);
  } finally {
    await s.stop();
  }
});

test('syncd：manifest 代次 CAS（回退 409，推进 200）', async () => {
  const s = await startSyncd();
  try {
    const key = 'vlt/spaces/personal-global/devices/d1/manifest.json';
    const gen = (n: number) => Buffer.from(JSON.stringify({ generation: n, headSeq: n * 10 }));
    const p1 = await req(s.baseUrl, s.token, 'PUT', `/manifests/${encodeURIComponent(key)}`, gen(1), { 'x-cairn-generation': '1' });
    assert.equal(p1.status, 200);
    const regress = await req(s.baseUrl, s.token, 'PUT', `/manifests/${encodeURIComponent(key)}`, gen(1), { 'x-cairn-generation': '1' });
    assert.equal(regress.status, 409, '同代次拒绝');
    const advance = await req(s.baseUrl, s.token, 'PUT', `/manifests/${encodeURIComponent(key)}`, gen(2), { 'x-cairn-generation': '2' });
    assert.equal(advance.status, 200, '代次推进成功');
    const regress2 = await req(s.baseUrl, s.token, 'PUT', `/manifests/${encodeURIComponent(key)}`, gen(1), { 'x-cairn-generation': '1' });
    assert.equal(regress2.status, 409, '推进后回退拒绝');
    const g = await req(s.baseUrl, s.token, 'GET', `/manifests/${encodeURIComponent(key)}`);
    assert.equal(JSON.parse(g.body.toString('utf8')).generation, 2);
    const noGen = await req(s.baseUrl, s.token, 'PUT', `/manifests/${encodeURIComponent(key)}`, gen(3), {});
    assert.equal(noGen.status, 400, '缺代次头拒绝');
  } finally {
    await s.stop();
  }
});

test('syncd：Bearer 鉴权与路径穿越防护', async () => {
  const s = await startSyncd();
  try {
    const noAuth = await req(s.baseUrl, 'wrong-token', 'GET', '/healthz');
    assert.equal(noAuth.status, 401);
    const ok = await req(s.baseUrl, s.token, 'GET', '/healthz');
    assert.equal(ok.status, 200);
    const traversal = await req(s.baseUrl, s.token, 'GET', `/chunks/${encodeURIComponent('../../etc/passwd')}`);
    assert.equal(traversal.status, 400, '穿越 key 拒绝');
  } finally {
    await s.stop();
  }
});

void makeTestHome;
