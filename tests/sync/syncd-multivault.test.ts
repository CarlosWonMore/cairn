import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeTestHome, cleanupTestHome } from '../helpers.js';
import { openStore, CairnStore } from '../../src/store/open.js';
import { generateVaultKeys, saveKeys, exportRecoveryMaterial, importRecoveryMaterial } from '../../src/sync/cryptoutil.js';
import { SyncdRemoteStore } from '../../src/sync/syncd-store.js';
import { syncPush } from '../../src/sync/push.js';
import { syncPull } from '../../src/sync/pull.js';
import { VaultConfig } from '../../src/sync/vault.js';

/**
 * 第三轮验证 P1 回归：同一 syncd 上存在【另一个 vault】时，本 vault 的
 * pull 必须照常工作（vault 段并入键空间后互不可见；外加 pull 对不可解密
 * manifest 的降级路径在 protocol.test.ts 单独覆盖）。
 * 用真实服务器子进程 + 真实 SyncdRemoteStore（带 vaults/<id>/ 前缀）。
 */

const SERVER = join(process.cwd(), 'syncd', 'cairn-syncd.mjs');

interface ServerHandle {
  baseUrl: string;
  token: string;
  stop(): Promise<void>;
}

async function startSyncd(): Promise<ServerHandle> {
  const dataDir = mkdtempSync(join(tmpdir(), 'syncd-mv-'));
  const token = `tok_${Math.random().toString(36).slice(2)}`;
  const port = 21000 + Math.floor(Math.random() * 20000);
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

interface Device {
  store: CairnStore;
  home: string;
  keys: ReturnType<typeof generateVaultKeys>;
}

function newDevice(): Device {
  const home = makeTestHome();
  const store = openStore({ home });
  const keys = generateVaultKeys();
  saveKeys(join(home, 'data'), keys);
  return { store, home, keys };
}

function vaultCfg(keys: ReturnType<typeof generateVaultKeys>): VaultConfig {
  return { vaultId: keys.vaultId, provider: 'syncd', syncd: { baseUrl: 'unused' }, createdAt: new Date().toISOString() };
}

function remoteFor(s: ServerHandle, keys: ReturnType<typeof generateVaultKeys>): SyncdRemoteStore {
  // 与 orchestrate.buildRemoteStore 相同的前缀构造
  return new SyncdRemoteStore({ baseUrl: s.baseUrl, token: s.token, prefix: `vaults/${keys.vaultId}/` });
}

test('syncd 多 vault：另一 vault 的设备存在时，本 vault push/pull 照常', async () => {
  const s = await startSyncd();
  const a = newDevice(); // vault 1 设备 A
  const c = newDevice(); // vault 2 设备 C（干扰源）
  const homeB = makeTestHome();
  const storeB = openStore({ home: homeB });
  saveKeys(join(homeB, 'data'), importRecoveryMaterial(exportRecoveryMaterial(a.keys)));
  try {
    // vault 2 先推送（制造"同一服务器上存在别的 vault"的状态）
    const scopeC = c.store.scopes.resolvePreset('personal-global');
    const mC = c.store.memories.add({ kind: 'fact', content: '另一个 vault 的记忆', scopeId: scopeC.id, authority: 'user_explicit', createdBy: 'cli' }, c.store.identity.deviceId);
    c.store.outbox.enqueue({ jobType: 'sync_upstream', scopeId: scopeC.id, entityType: 'memory', entityId: mC.id, idempotencyKey: 'c1' });
    const pushedC = await syncPush(c.store, remoteFor(s, c.keys), vaultCfg(c.keys));
    assert.ok(pushedC && pushedC.publishedChunks.length >= 1, 'vault 2 已在服务器上留有对象');

    // vault 1 设备 A 推送
    const scopeA = a.store.scopes.resolvePreset('personal-global');
    const mA = a.store.memories.add({ kind: 'fact', content: '本 vault 的记忆甲', scopeId: scopeA.id, authority: 'user_explicit', createdBy: 'cli' }, a.store.identity.deviceId);
    a.store.outbox.enqueue({ jobType: 'sync_upstream', scopeId: scopeA.id, entityType: 'memory', entityId: mA.id, idempotencyKey: 'a1' });
    await syncPush(a.store, remoteFor(s, a.keys), vaultCfg(a.keys));

    // vault 1 设备 B 拉取：不得因 vault 2 的存在而失败（修复前 auth_tag_invalid）
    const pulled = await syncPull(storeB, remoteFor(s, a.keys), vaultCfg(a.keys));
    assert.equal(pulled.totalApplied, 1, 'B 正常拉到 A 的记忆');
    const found = storeB.memories.list({ status: 'active' });
    assert.equal(found.length, 1);
    assert.equal(found[0]!.content, '本 vault 的记忆甲');
    // vault 2 的内容对 B 不可见
    assert.equal(storeB.memories.list({ status: 'active' }).some((m) => m.content.includes('另一个 vault')), false);
    // 再 pull 幂等
    const pulled2 = await syncPull(storeB, remoteFor(s, a.keys), vaultCfg(a.keys));
    assert.equal(pulled2.totalApplied, 0);
  } finally {
    a.store.close();
    c.store.close();
    storeB.close();
    cleanupTestHome(a.home);
    cleanupTestHome(c.home);
    cleanupTestHome(homeB);
    await s.stop();
  }
});
