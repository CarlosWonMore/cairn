import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RemoteStore } from '../../src/jobs/remote.js';
import { generateVaultKeys, saveKeys, deriveBackupKey, deriveSpaceKey, encryptObject, decryptObject } from '../../src/sync/cryptoutil.js';
import { saveVaultConfig, VaultConfig } from '../../src/sync/vault.js';
import { uploadRemoteBackup, listRemoteBackups, restoreRemoteBackup, backupObjectKey } from '../../src/sync/backup-store.js';
import { AppService } from '../../src/interfaces/app-service.js';
import { tableCounts } from '../../src/store/backup.js';
import { openStore } from '../../src/store/open.js';
import { makeTestHome, cleanupTestHome } from '../helpers.js';
import { cliEntry } from '../spawn-target.js';

/**
 * 设备备份通道（add-cloud-backup 任务 1.3–5.5）：
 * 密钥派生跨域、前缀双向隔离、上传不改本地、无 vault 拒绝、
 * 保留策略只删本设备、恢复默认新路径 + 校验失败中止 + 跨设备解不开。
 * 另有一条真实本地 syncd 的 CLI e2e（upload → list → restore → --force）。
 */

class MemRemote implements RemoteStore {
  readonly configured = true;
  objects = new Map<string, Uint8Array>();
  deleted: string[] = [];

  async getObject(key: string): Promise<Uint8Array | null> {
    return this.objects.get(key) ?? null;
  }
  async putImmutable(key: string, bytes: Uint8Array, _hash: string): Promise<void> {
    this.objects.set(key, bytes);
  }
  async list(prefix: string): Promise<{ keys: string[]; nextCursor?: string }> {
    return { keys: [...this.objects.keys()].filter((k) => k.startsWith(prefix)) };
  }
  async getManifest(_space: string, _device: string): Promise<Uint8Array | null> {
    return null;
  }
  async putManifest(_space: string, _device: string, _manifest: unknown, _gen: number): Promise<void> {
    return;
  }
  async deleteObject(key: string): Promise<void> {
    this.objects.delete(key);
    this.deleted.push(key);
  }
}

function vaultFor(keys: ReturnType<typeof generateVaultKeys>): VaultConfig {
  return { vaultId: keys.vaultId, provider: 'syncd', syncd: { baseUrl: 'http://unused.invalid' }, createdAt: new Date().toISOString() };
}

interface Device {
  service: AppService;
  home: string;
  keys: ReturnType<typeof generateVaultKeys>;
}

/** 同一 vault：共享 vaultKey（recovery 材料同一把），deviceId 不同。 */
function newDevice(source?: Device): Device {
  const home = makeTestHome('cairn-bk-');
  const service = AppService.open(home);
  const keys = source ? source.keys : generateVaultKeys();
  saveKeys(`${home.replace(/\\/g, '/')}/data`, keys);
  return { service, home, keys };
}

test('deriveBackupKey：不同 deviceId 不同密钥；备份密文与 chunk 密文不可互换（跨域）', () => {
  const keys = generateVaultKeys();
  const kA = deriveBackupKey(keys.vaultKey, 'dev_aaaa');
  const kB = deriveBackupKey(keys.vaultKey, 'dev_bbbb');
  const kSpace = deriveSpaceKey(keys.vaultKey, 'personal-global');
  assert.notEqual(Buffer.from(kA).toString('hex'), Buffer.from(kB).toString('hex'), '同 vaultKey 不同设备 → 不同备份密钥');
  assert.notEqual(Buffer.from(kA).toString('hex'), Buffer.from(kSpace).toString('hex'), '备份密钥与 space 密钥不同域');

  const plain = new TextEncoder().encode('same content');
  // 备份密文塞进 chunk 的 AAD 解不开；chunk 密文塞进备份的 AAD 也解不开
  const asBackup = encryptObject(plain, kA, { vaultId: keys.vaultId, spaceId: 'backups', kind: 'backup', objectId: 'n1' });
  assert.throws(
    () => decryptObject(asBackup, kA, { vaultId: keys.vaultId, spaceId: 'personal-global', kind: 'chunk', objectId: 'n1' }),
    /auth_tag/,
    '备份密文不能被当 chunk 解开',
  );
  const asChunk = encryptObject(plain, kSpace, { vaultId: keys.vaultId, spaceId: 'personal-global', kind: 'chunk', objectId: 'n1' });
  assert.throws(
    () => decryptObject(asChunk, kA, { vaultId: keys.vaultId, spaceId: 'backups', kind: 'backup', objectId: 'n1' }),
    /auth_tag/,
    'chunk 密文不能被当备份解开',
  );
  // 其他设备的备份密钥解不开本设备的备份
  const sealedForA = encryptObject(plain, kA, { vaultId: keys.vaultId, spaceId: 'backups', kind: 'backup', objectId: 'n2' });
  assert.throws(
    () => decryptObject(sealedForA, kB, { vaultId: keys.vaultId, spaceId: 'backups', kind: 'backup', objectId: 'n2' }),
    /auth_tag/,
    '设备 B 解不开设备 A 的备份（按设备隔离）',
  );
});

test('前缀隔离：同步列举不见备份；备份列举不见 chunk；上传不改本地；远端只见密文', async () => {
  const a = newDevice();
  try {
    const remote = new MemRemote();
    const chunkKey = 'personal-global/devices/dev-x/chunks/1-abc.bin';
    await remote.putImmutable(chunkKey, new Uint8Array([1, 2, 3]), 'h');

    const before = tableCounts(a.service.store.db);
    const r = await uploadRemoteBackup(a.service.store, remote, vaultFor(a.keys), { keep: 5 });
    assert.deepEqual(tableCounts(a.service.store.db), before, '上传后本地逐表行数不变');
    assert.ok(r.key.startsWith('backups/'), '备份走独立前缀');

    const syncView = await remote.list('personal-global/devices/');
    assert.ok(!syncView.keys.some((k) => k.startsWith('backups/')), '同步列举不返回备份对象');
    const bkView = await remote.list('backups/');
    assert.ok(!bkView.keys.includes(chunkKey), '备份列举不返回 chunk');
    assert.equal(bkView.keys.length, 1);

    // 远端只见密文：不含表名 / 记忆正文 / 本机路径
    const raw = Buffer.from(remote.objects.get(r.key)!).toString('latin1');
    assert.ok(!raw.includes('memory_revision'), '密文不含表名');
    assert.ok(!raw.includes('cairn-bk-'), '密文不含本机路径');
    assert.ok(!raw.includes('CREATE TABLE'), '密文不含库结构');
    assert.ok(!raw.includes('备份恢复的原始内容'), '密文不含记忆正文');

    // 真实上传的密文也不能被当 chunk 解开（kind: 'backup' 是 AAD 绑定的一部分）：
    // 同一把备份密钥、只把 AAD 换成 chunk → 必须失败
    const backupKey = deriveBackupKey(a.keys.vaultKey, a.service.store.identity.deviceId);
    assert.throws(
      () =>
        decryptObject(remote.objects.get(r.key)!, backupKey, {
          vaultId: vaultFor(a.keys).vaultId,
          spaceId: 'backups',
          kind: 'chunk',
          objectId: r.name,
        }),
      /auth_tag/,
      '上传的备份密文不能被当 chunk 解开（AAD kind 绑定）',
    );

    // 无 vault 的设备：明确拒绝且远端无新对象
    const noKeyHome = mkdtempSync(join(tmpdir(), 'cairn-nokey-'));
    const noKey = AppService.open(noKeyHome);
    const bareRemote = new MemRemote();
    try {
      await assert.rejects(
        () => uploadRemoteBackup(noKey.store, bareRemote, vaultFor(a.keys), {}),
        (e: { code?: string }) => e.code === 'E_VALIDATION',
      );
      assert.equal(bareRemote.objects.size, 0, '无 vault 时远端无新对象');
    } finally {
      noKey.close();
      cleanupTestHome(noKeyHome);
    }
  } finally {
    a.service.close();
    cleanupTestHome(a.home);
  }
});

test('保留策略：keep=2 三份淘汰最旧；只删本设备，其他设备备份与同步对象不动', async () => {
  const a = newDevice();
  const b = newDevice(a);
  try {
    const remote = new MemRemote();
    const names: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await uploadRemoteBackup(a.service.store, remote, vaultFor(a.keys), { keep: 2 });
      names.push(r.name);
      await new Promise((res) => setTimeout(res, 5)); // 名字内嵌毫秒时间戳，拉开保证顺序可辨
    }
    assert.equal(new Set(names).size, 3, '三份备份对象名互不相同');
    const kept = await listRemoteBackups(remote, a.service.store.identity.deviceId);
    assert.equal(kept.length, 2, '超出保留份数的最旧一份被淘汰');
    assert.ok(!kept.some((k) => k.name === names[0]), '被淘汰的是最旧一份');
    assert.ok(kept.some((k) => k.name === names[2]), '最新一份保留');
    assert.ok(remote.deleted.every((k) => k.includes(a.service.store.identity.deviceId)), '只删本设备前缀');

    // 其他设备的备份 + 同步对象不受影响
    await uploadRemoteBackup(b.service.store, remote, vaultFor(b.keys), {});
    await remote.putImmutable('personal-global/devices/dev-x/chunks/9.bin', new Uint8Array([9]), 'h');
    await uploadRemoteBackup(a.service.store, remote, vaultFor(a.keys), { keep: 2 });
    const bBackups = await listRemoteBackups(remote, b.service.store.identity.deviceId);
    assert.equal(bBackups.length, 1, '设备 B 的备份不受设备 A 清理影响');
    assert.ok(remote.objects.has('personal-global/devices/dev-x/chunks/9.bin'), '事件链对象未被触碰');
  } finally {
    a.service.close();
    b.service.close();
    cleanupTestHome(a.home);
    cleanupTestHome(b.home);
  }
});

test('恢复：默认新路径且当前库不变；密文篡改中止；未知对象名 E_NOT_FOUND；跨设备解不开', async () => {
  const a = newDevice();
  try {
    a.service.addMemory({ content: '备份恢复的原始内容' });
    const remote = new MemRemote();
    const r = await uploadRemoteBackup(a.service.store, remote, vaultFor(a.keys), { keep: 5 });

    const before = tableCounts(a.service.store.db);
    const restored = await restoreRemoteBackup(a.service.store, remote, vaultFor(a.keys), r.name, { toDir: join(a.home, 'restore-out') });
    assert.ok(existsSync(restored.restoredTo), '还原到独立路径');
    assert.equal(restored.verified, true);
    assert.deepEqual(tableCounts(a.service.store.db), before, '恢复过程不动当前库');
    assert.ok(readFileSync(restored.restoredTo).byteLength > 0);

    // 密文篡改 → 解密失败中止，不产生半还原
    const key = backupObjectKey(a.service.store.identity.deviceId, r.name);
    const original = remote.objects.get(key)!;
    const tampered = Uint8Array.from(original);
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 0xff;
    remote.objects.set(key, tampered);
    await assert.rejects(
      () => restoreRemoteBackup(a.service.store, remote, vaultFor(a.keys), r.name, { toDir: join(a.home, 'restore-tamper') }),
      /解密失败|auth_tag/,
    );
    assert.ok(!existsSync(join(a.home, 'restore-tamper')), '解密失败不留半成品目录产物');
    remote.objects.set(key, original);

    // 未知对象名：E_NOT_FOUND（restore 只寻址本设备前缀）
    const unknownName = `cairn-backup-999.db-${'0'.repeat(64)}.enc`;
    await assert.rejects(
      () => restoreRemoteBackup(a.service.store, remote, vaultFor(a.keys), unknownName, {}),
      /E_NOT_FOUND|没有本设备的备份/,
    );

    // 跨设备：B 用自己的密钥材料解不开 A 的备份（按设备隔离）
    const b = newDevice(a);
    try {
      const sealedA = remote.objects.get(key)!;
      const bKey = deriveBackupKey(b.keys.vaultKey, b.service.store.identity.deviceId);
      assert.throws(
        () => decryptObject(sealedA, bKey, { vaultId: vaultFor(b.keys).vaultId, spaceId: 'backups', kind: 'backup', objectId: r.name }),
        /auth_tag/,
        'B 解不开 A 的备份密文',
      );
    } finally {
      b.service.close();
      cleanupTestHome(b.home);
    }
  } finally {
    a.service.close();
    cleanupTestHome(a.home);
  }
});

// ---------------------------------------------------------------------------
// CLI e2e：真实本地 syncd（上传 → 列举 → 恢复到新路径 → --force 覆盖前自动备份）
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

async function startSyncd(): Promise<{ baseUrl: string; token: string; stop(): Promise<void> }> {
  const dataDir = mkdtempSync(join(tmpdir(), 'syncd-bk-data-'));
  const token = `tok_${Math.random().toString(36).slice(2)}`;
  const port = 20000 + Math.floor(Math.random() * 20000);
  const serverFile = join(process.cwd(), 'syncd', 'cairn-syncd.mjs');
  const child = spawn(process.execPath, [serverFile], {
    env: { ...process.env, CAIRN_SYNCD_PORT: String(port), CAIRN_SYNCD_HOST: '127.0.0.1', CAIRN_SYNCD_TOKEN: token, CAIRN_SYNCD_DATA: dataDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout!.on('data', (c) => (out += String(c)));
  child.stderr!.on('data', (c) => (out += String(c)));
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

test('CLI e2e：backup --upload → --list-remote → restore --from-remote（真实本地 syncd）', async () => {
  const syncd = await startSyncd();
  const home = makeTestHome('cairn-bk-cli-');
  try {
    const seed = AppService.open(home);
    seed.addMemory({ content: 'CLI 备份链路验证内容' });
    const keys = generateVaultKeys();
    saveKeys(`${home.replace(/\\/g, '/')}/data`, keys);
    saveVaultConfig(`${home.replace(/\\/g, '/')}/data`, {
      vaultId: keys.vaultId,
      provider: 'syncd',
      syncd: { baseUrl: syncd.baseUrl },
      createdAt: new Date().toISOString(),
    });
    seed.close();

    const env = { CAIRN_SYNCD_TOKEN: syncd.token };
    const up = await runCli(home, ['--json', 'backup', '--upload'], env);
    assert.equal(up.code, 0, up.stderr);
    const upBody = JSON.parse(up.stdout) as { name: string; key: string; pruneWarning: string | null };
    assert.ok(upBody.key.startsWith('backups/'));
    assert.ok(upBody.pruneWarning !== null, 'syncd 无 DELETE 路由：保留策略诚实降级为只列不删');

    const ls = await runCli(home, ['--json', 'backup', '--list-remote'], env);
    assert.equal(ls.code, 0, ls.stderr);
    const lsBody = JSON.parse(ls.stdout) as { total: number; items: { name: string; sealedBytes: number }[] };
    assert.equal(lsBody.total, 1);
    assert.ok(lsBody.items[0]!.sealedBytes > 0, '列出密文字节');

    const rs = await runCli(home, ['--json', 'restore', '--from-remote', upBody.name, '--to', join(home, 'restored-dir')], env);
    assert.equal(rs.code, 0, rs.stderr);
    const rsBody = JSON.parse(rs.stdout) as { restoredTo: string; verified: boolean };
    assert.equal(rsBody.verified, true);
    assert.ok(existsSync(rsBody.restoredTo), '还原到指定目录');
    // 默认恢复不覆盖当前库：当前库还能打开且记忆还在
    const check = openStore({ home, readOnly: true });
    try {
      assert.equal(Number(check.db.scalar('SELECT COUNT(*) AS n FROM memory') ?? 0), 1, '当前库未受影响');
    } finally {
      check.close();
    }

    // --force：覆盖前自动备份当前库，然后覆盖
    const force = await runCli(home, ['--json', 'restore', '--from-remote', upBody.name, '--force'], env);
    assert.equal(force.code, 0, force.stderr);
    const forceBody = JSON.parse(force.stdout) as { overwritten: string; safetyBackup: string };
    assert.ok(forceBody.safetyBackup.includes('pre-restore-'), '覆盖前自动生成了当前库的备份');
    assert.ok(existsSync(forceBody.safetyBackup));
  } finally {
    await syncd.stop();
    cleanupTestHome(home);
  }
});
