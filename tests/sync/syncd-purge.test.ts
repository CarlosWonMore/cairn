import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RemoteStore } from '../../src/jobs/remote.js';
import { SyncdRemoteStore } from '../../src/sync/syncd-store.js';
import { uploadRemoteBackup, listRemoteBackups } from '../../src/sync/backup-store.js';
import { generateVaultKeys, saveKeys } from '../../src/sync/cryptoutil.js';
import { saveVaultConfig, VaultConfig } from '../../src/sync/vault.js';
import { AppService } from '../../src/interfaces/app-service.js';
import { err } from '../../src/core/errors.js';
import { sha256Hex } from '../../src/core/hash.js';
import { makeTestHome, cleanupTestHome } from '../helpers.js';
import { cliEntry } from '../spawn-target.js';

/**
 * add-syncd-purge：受限的备份对象删除。
 * 红线是「永远不能删同步链（chunk / manifest）」——服务端白名单是唯一防线，
 * 所以服务端用例都直接断言「被拒 + 文件仍在」，不只断言状态码。
 */

const SERVER = join(process.cwd(), 'syncd', 'cairn-syncd.mjs');

interface ServerHandle {
  baseUrl: string;
  token: string;
  /** 直接看落盘文件是否真的被删——只验 HTTP 状态码不够。 */
  dataDir: string;
  stop(): Promise<void>;
}

async function startSyncd(): Promise<ServerHandle> {
  const dataDir = mkdtempSync(join(tmpdir(), 'syncd-purge-'));
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
    dataDir,
    stop: () =>
      new Promise<void>((r) => {
        child.on('close', () => {
          try {
            rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 });
          } catch {
            /* best effort */
          }
          r();
        });
        child.kill();
      }),
  };
}

async function req(
  baseUrl: string,
  token: string,
  method: string,
  path: string,
  body?: Buffer,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: Buffer }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...headers },
    body: body ? Buffer.from(body) : undefined,
  });
  return { status: res.status, body: Buffer.from(await res.arrayBuffer()) };
}

function diskPath(dataDir: string, topLevel: string, key: string): string {
  return join(dataDir, topLevel, ...key.split('/'));
}

function countEnc(dir: string): number {
  if (!existsSync(dir)) return 0;
  let n = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) n += countEnc(join(dir, e.name));
    else if (e.name.endsWith('.enc')) n++;
  }
  return n;
}

// ---------------------------------------------------------------------------
// 服务端：DELETE /chunks/<key>
// ---------------------------------------------------------------------------

test('DELETE：备份对象删除成功，落盘文件消失且 list 不再包含', async () => {
  const s = await startSyncd();
  try {
    const key = 'vaults/v1/backups/dev1/cairn-backup-1.db-abc.enc';
    await req(s.baseUrl, s.token, 'PUT', `/chunks/${encodeURIComponent(key)}`, Buffer.from('sealed-backup'));
    const full = diskPath(s.dataDir, 'chunks', key);
    assert.ok(existsSync(full), '前置：文件已落盘');

    const del = await req(s.baseUrl, s.token, 'DELETE', `/chunks/${encodeURIComponent(key)}`);
    assert.equal(del.status, 200);
    assert.equal(existsSync(full), false, '落盘文件已删除');
    const g = await req(s.baseUrl, s.token, 'GET', `/chunks/${encodeURIComponent(key)}`);
    assert.equal(g.status, 404, '下载 404');
    const l = await req(s.baseUrl, s.token, 'GET', `/list?prefix=${encodeURIComponent('vaults/v1/backups/')}`);
    assert.deepEqual((JSON.parse(l.body.toString('utf8')) as { keys: string[] }).keys, [], 'list 不再包含它');
  } finally {
    await s.stop();
  }
});

test('红线：DELETE 同步链 chunk 一律 403，文件原样保留且可下载', async () => {
  const s = await startSyncd();
  try {
    const key = 'vaults/v1/personal-global/devices/d1/chunks/1-abc.bin';
    const body = Buffer.from('chunk-bytes-甲乙丙');
    await req(s.baseUrl, s.token, 'PUT', `/chunks/${encodeURIComponent(key)}`, body);
    const full = diskPath(s.dataDir, 'chunks', key);

    const del = await req(s.baseUrl, s.token, 'DELETE', `/chunks/${encodeURIComponent(key)}`);
    assert.equal(del.status, 403, '同步链 chunk 必须被拒绝');
    assert.ok(existsSync(full), '文件仍在');
    const g = await req(s.baseUrl, s.token, 'GET', `/chunks/${encodeURIComponent(key)}`);
    assert.equal(g.status, 200);
    assert.deepEqual(g.body, body, '内容逐字节未变');
    const l = await req(s.baseUrl, s.token, 'GET', `/list?prefix=${encodeURIComponent('vaults/v1/')}`);
    assert.ok((JSON.parse(l.body.toString('utf8')) as { keys: string[] }).keys.includes(key), 'list 仍包含');
  } finally {
    await s.stop();
  }
});

test('DELETE：manifest 不开放删除（404 落到既有分支），文件仍在', async () => {
  const s = await startSyncd();
  try {
    const key = 'vaults/v1/personal-global/devices/d1/manifest.json';
    await req(s.baseUrl, s.token, 'PUT', `/manifests/${encodeURIComponent(key)}`, Buffer.from('sealed-manifest'), {
      'x-cairn-generation': '1',
    });
    const full = diskPath(s.dataDir, 'manifests', key);

    const del = await req(s.baseUrl, s.token, 'DELETE', `/manifests/${encodeURIComponent(key)}`);
    assert.equal(del.status, 404, 'DELETE 不进入 manifest 分支');
    assert.ok(existsSync(full), 'manifest 文件仍在');
    const g = await req(s.baseUrl, s.token, 'GET', `/manifests/${encodeURIComponent(key)}`);
    assert.equal(g.status, 200, '仍可下载');

    // 路径看起来像备份的 manifest 也不放行（先判 /chunks/ 前缀）
    await req(s.baseUrl, s.token, 'PUT', `/manifests/${encodeURIComponent('vaults/v1/backups/dev1/m.json')}`, Buffer.from('m'), {
      'x-cairn-generation': '1',
    });
    const fake = await req(s.baseUrl, s.token, 'DELETE', `/manifests/${encodeURIComponent('vaults/v1/backups/dev1/m.json')}`);
    assert.equal(fake.status, 404);
    assert.ok(existsSync(diskPath(s.dataDir, 'manifests', 'vaults/v1/backups/dev1/m.json')), '文件仍在');
  } finally {
    await s.stop();
  }
});

test('DELETE：路径穿越与非法字符被 400 拒绝，数据目录外无影响', async () => {
  const s = await startSyncd();
  try {
    // 数据目录父目录的哨兵：任何穿越成功都会先删掉它
    const sentinelName = `cairn-escape-${process.pid}.txt`;
    const sentinel = join(s.dataDir, '..', sentinelName);
    writeFileSync(sentinel, 'keep-me');
    try {
      for (const raw of [
        `chunks/../../${sentinelName}`,
        'chunks/vaults/v1/backups/../..%2Fescape.enc',
        'chunks/vaults/v1/backups/a%00b.enc',
        'chunks/vaults/v1/backups/a b.enc',
      ]) {
        const r = await req(s.baseUrl, s.token, 'DELETE', `/chunks/${encodeURIComponent(raw)}`);
        assert.equal(r.status, 400, `拒绝非法 key: ${raw}`);
      }
      assert.ok(existsSync(sentinel), '数据目录外文件未受影响');
    } finally {
      rmSync(sentinel, { force: true });
    }
  } finally {
    await s.stop();
  }
});

test('DELETE：不存在的备份对象返回 200（幂等，与 OBS deleteObject 一致）', async () => {
  const s = await startSyncd();
  try {
    const key = 'vaults/v1/backups/dev1/never-uploaded.enc';
    const first = await req(s.baseUrl, s.token, 'DELETE', `/chunks/${encodeURIComponent(key)}`);
    assert.equal(first.status, 200);
    const second = await req(s.baseUrl, s.token, 'DELETE', `/chunks/${encodeURIComponent(key)}`);
    assert.equal(second.status, 200, '重复删除仍成功');
  } finally {
    await s.stop();
  }
});

// ---------------------------------------------------------------------------
// 客户端：deleteObject 语义 + 保留策略
// ---------------------------------------------------------------------------

test('客户端 deleteObject：删备份成功；删结构对象（403）抛 E_FORBIDDEN；旧版 404 识别为不支持', async () => {
  const s = await startSyncd();
  try {
    const store = new SyncdRemoteStore({ baseUrl: s.baseUrl, token: s.token, prefix: 'vaults/v1/' });
    const backupKey = 'backups/dev1/cairn-backup-1.db-abc.enc';
    const sealed = Buffer.from('sealed');
    await store.putImmutable(backupKey, sealed, sha256Hex(sealed));
    await store.deleteObject(backupKey);
    assert.equal(await store.getObject(backupKey), null, '删后下载为 null');

    await assert.rejects(
      () => store.deleteObject('personal-global/devices/d1/chunks/1-abc.bin'),
      (e: { code?: string }) => e.code === 'E_FORBIDDEN',
      '删结构对象是调用方 bug：抛错',
    );

    // 旧版 syncd：没有 DELETE 路由 → 404 → syncd_delete_unsupported（供上层降级）
    const legacyFetch = (async () => new Response('not found', { status: 404 })) as unknown as typeof fetch;
    const legacy = new SyncdRemoteStore({ baseUrl: 'http://legacy.invalid', token: 't' }, legacyFetch);
    await assert.rejects(
      () => legacy.deleteObject('backups/dev1/x.enc'),
      (e: { message?: string }) => e.message === 'syncd_delete_unsupported',
      '404 不能当成功（否则会静默假装已清）',
    );
  } finally {
    await s.stop();
  }
});

function newDevice(): { service: AppService; home: string; keys: ReturnType<typeof generateVaultKeys> } {
  const home = makeTestHome('cairn-purge-dev-');
  const service = AppService.open(home);
  const keys = generateVaultKeys();
  saveKeys(`${home.replace(/\\/g, '/')}/data`, keys);
  return { service, home, keys };
}

test('保留策略在 syncd 后端真正生效：keep=2 上传 3 份 → 实际只剩 2', async () => {
  const s = await startSyncd();
  const a = newDevice();
  try {
    const store = new SyncdRemoteStore({ baseUrl: s.baseUrl, token: s.token, prefix: `vaults/${a.keys.vaultId}/` });
    const vault: VaultConfig = { vaultId: a.keys.vaultId, provider: 'syncd', syncd: { baseUrl: s.baseUrl }, createdAt: new Date().toISOString() };
    const names: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await uploadRemoteBackup(a.service.store, store, vault, { keep: 2 });
      names.push(r.name);
      assert.equal(r.pruneWarning, null, `第 ${i + 1} 次上传：支持删除，无降级警告`);
      await new Promise((res) => setTimeout(res, 5)); // 名字内嵌毫秒时间戳，拉开顺序
    }
    const left = await listRemoteBackups(store, a.service.store.identity.deviceId);
    assert.equal(left.length, 2, '列举只剩保留份数');
    assert.ok(!left.some((x) => x.name === names[0]), '被淘汰的是最旧一份');
    // 服务端物理层：落盘 .enc 也只剩 2 个（不是只从 list 里消失）
    assert.equal(countEnc(join(s.dataDir, 'chunks', 'vaults', a.keys.vaultId, 'backups')), 2);
  } finally {
    a.service.close();
    cleanupTestHome(a.home);
    await s.stop();
  }
});

/** 有 deleteObject 但实际不支持（旧版 syncd）的远端：保留策略必须降级而不是假装成功。 */
class UnsupportedDeleteRemote implements RemoteStore {
  readonly configured = true;
  objects = new Map<string, Uint8Array>();

  async getObject(key: string): Promise<Uint8Array | null> {
    return this.objects.get(key) ?? null;
  }
  async putImmutable(key: string, bytes: Uint8Array, _hash: string): Promise<void> {
    this.objects.set(key, bytes);
  }
  async list(prefix: string): Promise<{ keys: string[] }> {
    return { keys: [...this.objects.keys()].filter((k) => k.startsWith(prefix)) };
  }
  async getManifest(): Promise<Uint8Array | null> {
    return null;
  }
  async putManifest(): Promise<void> {
    return;
  }
  async deleteObject(_key: string): Promise<void> {
    throw err('E_IO', 'syncd_delete_unsupported', { status: 404 });
  }
}

test('旧版 syncd：保留策略降级为 pruneWarning，不假装已清理', async () => {
  const a = newDevice();
  try {
    const remote = new UnsupportedDeleteRemote();
    const vault: VaultConfig = { vaultId: a.keys.vaultId, provider: 'syncd', syncd: { baseUrl: 'http://unused.invalid' }, createdAt: new Date().toISOString() };
    await uploadRemoteBackup(a.service.store, remote, vault, { keep: 1 });
    await new Promise((res) => setTimeout(res, 5));
    const second = await uploadRemoteBackup(a.service.store, remote, vault, { keep: 1 });

    assert.ok(second.pruneWarning?.includes('不支持删除'), `降级提示要明说不支持：${second.pruneWarning}`);
    assert.deepEqual(second.pruned, [], '不能把没删掉的记成已淘汰');
    assert.equal(remote.objects.size, 2, '两份对象都还在（上传成功、删除未生效）');
  } finally {
    a.service.close();
    cleanupTestHome(a.home);
  }
});

// ---------------------------------------------------------------------------
// CLI e2e：backup --purge-remote（真实本地 syncd）
// ---------------------------------------------------------------------------

function runCli(home: string, args: string[], env: Record<string, string>): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const target = cliEntry();
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [...target.loader, target.file, '--home', home, ...args], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (c) => (stdout += String(c)));
    p.stderr.on('data', (c) => (stderr += String(c)));
    p.on('close', (code) => resolve({ code, stdout, stderr }));
    p.on('error', reject);
  });
}

test('CLI e2e：backup --purge-remote 删除单个对象；不存在时明确报错', async () => {
  const s = await startSyncd();
  const home = makeTestHome('cairn-purge-cli-');
  try {
    const seed = AppService.open(home);
    seed.addMemory({ content: 'purge CLI 验证内容' });
    const keys = generateVaultKeys();
    saveKeys(`${home.replace(/\\/g, '/')}/data`, keys);
    saveVaultConfig(`${home.replace(/\\/g, '/')}/data`, { vaultId: keys.vaultId, provider: 'syncd', syncd: { baseUrl: s.baseUrl } });
    seed.close();

    const env = { CAIRN_SYNCD_TOKEN: s.token };
    const up = await runCli(home, ['--json', 'backup', '--upload'], env);
    assert.equal(up.code, 0, up.stderr);
    const upBody = JSON.parse(up.stdout) as { name: string; key: string };

    const purge = await runCli(home, ['--json', 'backup', '--purge-remote', upBody.name], env);
    assert.equal(purge.code, 0, purge.stderr);
    const purgeBody = JSON.parse(purge.stdout) as { deleted: boolean; name: string; key: string; sealedBytes: number };
    assert.equal(purgeBody.deleted, true);
    assert.equal(purgeBody.key, upBody.key);
    assert.ok(purgeBody.sealedBytes > 0, '删除前拿到了对象大小');
    assert.match(purge.stderr, /将删除远端备份对象/, '删前打印对象名与大小');

    const ls = await runCli(home, ['--json', 'backup', '--list-remote'], env);
    assert.equal(ls.code, 0, ls.stderr);
    assert.equal((JSON.parse(ls.stdout) as { total: number }).total, 0, '远端已清零');

    const again = await runCli(home, ['backup', '--purge-remote', upBody.name], env);
    assert.notEqual(again.code, 0, '对象不存在时报错（不是静默成功）');
    assert.match(again.stderr, /远端没有本设备的备份对象/, '错误信息明确');
  } finally {
    cleanupTestHome(home);
    await s.stop();
  }
});
