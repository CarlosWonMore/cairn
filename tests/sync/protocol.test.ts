import { test } from 'node:test';
import { gunzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
import { RemoteStore } from '../../src/jobs/remote.js';
import { generateVaultKeys, exportRecoveryMaterial, importRecoveryMaterial, saveKeys, decryptObject, deriveSpaceKey, encryptObject } from '../../src/sync/cryptoutil.js';
import { VaultConfig } from '../../src/sync/vault.js';
import { syncPush } from '../../src/sync/push.js';
import { syncPull } from '../../src/sync/pull.js';
import { packChunk, SyncEvent } from '../../src/sync/events.js';
import { makeTestHome, cleanupTestHome } from '../helpers.js';
import { openStore, CairnStore } from '../../src/store/open.js';
import { sha256Hex, normalizeContent } from '../../src/core/hash.js';

/**
 * 同步协议核心测试（本地假远端，任务 2.2–2.4 验证）：
 * 复原 / 幂等重推 / 并发冲突 / 遗忘传播 / local_only 打包排除 / 依赖等待。
 * 键形态与产品一致：chunk = `<spaceKey>/devices/<dev>/chunks/<seq>-<hash>.bin`，
 * manifest = `<spaceKey>/devices/<dev>/manifest.json`（单写者代次 CAS）。
 */

class MemRemote implements RemoteStore {
  readonly configured = true;
  objects = new Map<string, Uint8Array>();
  manifestGens = new Map<string, number>();

  async getObject(key: string): Promise<Uint8Array | null> {
    return this.objects.get(key) ?? null;
  }

  async putImmutable(key: string, bytes: Uint8Array, _hash: string): Promise<void> {
    const prev = this.objects.get(key);
    if (prev && Buffer.from(prev).toString('base64') !== Buffer.from(bytes).toString('base64')) {
      throw new Error(`immutable key overwritten: ${key}`);
    }
    this.objects.set(key, bytes);
  }

  async list(prefix: string): Promise<{ keys: string[]; nextCursor?: string }> {
    return { keys: [...this.objects.keys()].filter((k) => k.startsWith(prefix)) };
  }

  async getManifest(space: string, device: string): Promise<Uint8Array | null> {
    return this.objects.get(`${space}/devices/${device}/manifest.json`) ?? null;
  }

  async putManifest(space: string, device: string, manifest: unknown, expectedGeneration: number): Promise<void> {
    const key = `${space}/devices/${device}/manifest.json`;
    const current = this.manifestGens.get(key) ?? 0;
    if (expectedGeneration <= current) throw new Error(`generation regression: ${expectedGeneration} <= ${current}`);
    this.manifestGens.set(key, expectedGeneration);
    this.objects.set(key, new Uint8Array(manifest as Uint8Array));
  }
}

function contentHashOf(text: string): string {
  return sha256Hex(normalizeContent(text));
}

function vaultFor(keys: ReturnType<typeof generateVaultKeys>): VaultConfig {
  return { vaultId: keys.vaultId, provider: 'syncd', syncd: { baseUrl: 'http://unused.invalid' }, createdAt: new Date().toISOString() };
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
  saveKeys(`${home.replace(/\\/g, '/')}/data`, keys);
  return { store, home, keys };
}

function deviceFromRecovery(recoverySource: Device): Device {
  const home = makeTestHome();
  const store = openStore({ home });
  const keys = importRecoveryMaterial(exportRecoveryMaterial(recoverySource.keys));
  saveKeys(`${home.replace(/\\/g, '/')}/data`, keys);
  return { store, home, keys };
}

function addMemoryWithJob(store: CairnStore, content: string, idempotencyKey: string): string {
  const scope = store.scopes.resolvePreset('personal-global');
  const m = store.memories.add({ kind: 'fact', content, scopeId: scope.id, authority: 'user_explicit', createdBy: 'cli' }, store.identity.deviceId);
  store.outbox.enqueue({ jobType: 'sync_upstream', scopeId: scope.id, entityType: 'memory', entityId: m.id, idempotencyKey });
  return m.id;
}

/** 手工加密测试对象（AAD objectId 由调用方指定，与放入远端的键一致）。 */
function sealFor(device: Device, plaintext: Uint8Array | Buffer, objectId: string, kind: 'chunk' | 'manifest'): Uint8Array {
  return encryptObject(new Uint8Array(plaintext), deriveSpaceKey(device.keys.vaultKey, 'personal-global'), {
    vaultId: device.keys.vaultId,
    spaceId: 'personal-global',
    kind,
    objectId,
  });
}

test('协议：push 后 pull 复原（跨设备创建）', async () => {
  const remote = new MemRemote();
  const a = newDevice();
  const vault = vaultFor(a.keys);
  const b = deviceFromRecovery(a);
  try {
    addMemoryWithJob(a.store, '跨设备事实甲', 'k1');
    addMemoryWithJob(a.store, '跨设备事实乙', 'k2');
    const pushed = await syncPush(a.store, remote, vault);
    assert.ok(pushed && pushed.eventCount === 2 && pushed.publishedChunks.length >= 1);

    const pulled = await syncPull(b.store, remote, vault);
    assert.equal(pulled.totalApplied, 2);
    const scope = b.store.scopes.resolvePreset('personal-global');
    const found = b.store.memories.list({ scopeId: scope.id, status: 'active' });
    assert.equal(found.length, 2);
    assert.deepEqual(found.map((m) => m.content).sort(), ['跨设备事实乙', '跨设备事实甲'].sort());
    // 二次 pull 幂等
    const pulled2 = await syncPull(b.store, remote, vault);
    assert.equal(pulled2.totalApplied, 0);
  } finally {
    a.store.close();
    b.store.close();
    cleanupTestHome(a.home);
    cleanupTestHome(b.home);
  }
});

test('协议：双设备并发修改 → 双方保留并进入冲突队列', async () => {
  const remote = new MemRemote();
  const a = newDevice();
  const vault = vaultFor(a.keys);
  const b = deviceFromRecovery(a);
  try {
    const memId = addMemoryWithJob(a.store, '并发基线记忆', 'k1');
    await syncPush(a.store, remote, vault);
    await syncPull(b.store, remote, vault);

    // A、B 各自离线修改同一条记忆（内容哈希链同一父）
    a.store.memories.revise(memId, 'A 设备的修改版本', { author: 'a' }, a.store.identity.deviceId);
    const bMem = b.store.memories.list({ status: 'active' })[0]!;
    b.store.memories.revise(bMem.id, 'B 设备的修改版本', { author: 'b' }, b.store.identity.deviceId);

    a.store.outbox.enqueue({ jobType: 'sync_upstream', scopeId: a.store.scopes.resolvePreset('personal-global').id, entityType: 'memory', entityId: memId, idempotencyKey: 'k2' });
    await syncPush(a.store, remote, vault);
    const pulled = await syncPull(b.store, remote, vault);
    assert.equal(pulled.totalApplied, 1, '冲突记录算一次应用');

    const bConflicted = b.store.memories.list({ status: 'conflicted' });
    assert.equal(bConflicted.length, 1, 'B 侧记忆进入 conflicted');
    assert.equal(bConflicted[0]!.id, bMem.id);
    assert.equal(b.store.conflicts.countOpen(), 1, 'B 侧冲突队列有记录');
    const revs = b.store.memories.revisions(bMem.id);
    assert.ok(revs.length >= 3, `B 保留双方修订（≥3：基线+A 版+B 版），实际 ${revs.length}`);
    assert.ok(new Set(revs.map((r) => r.contentHash)).size >= 3, '双方内容都存在');
  } finally {
    a.store.close();
    b.store.close();
    cleanupTestHome(a.home);
    cleanupTestHome(b.home);
  }
});

test('协议：遗忘传播（tombstone 跨设备）', async () => {
  const remote = new MemRemote();
  const a = newDevice();
  const vault = vaultFor(a.keys);
  const b = deviceFromRecovery(a);
  try {
    const memId = addMemoryWithJob(a.store, '将被遗忘的记忆', 'k1');
    await syncPush(a.store, remote, vault);
    await syncPull(b.store, remote, vault);
    assert.equal(b.store.memories.list({ status: 'active' }).length, 1);

    a.store.memories.forget(memId, '测试遗忘', 'cli');
    a.store.outbox.enqueue({ jobType: 'sync_upstream', scopeId: a.store.scopes.resolvePreset('personal-global').id, entityType: 'memory', entityId: memId, idempotencyKey: 'k2' });
    await syncPush(a.store, remote, vault);
    const pulled = await syncPull(b.store, remote, vault);
    assert.equal(pulled.totalApplied, 1);
    assert.equal(b.store.memories.list({ status: 'tombstoned' }).length, 1, 'B 侧该记忆已 tombstoned');
    assert.equal(b.store.memories.list({ status: 'active' }).length, 0);
  } finally {
    a.store.close();
    b.store.close();
    cleanupTestHome(a.home);
    cleanupTestHome(b.home);
  }
});

test('协议：幂等重推（同修订不产生新 chunk 事件）', async () => {
  const remote = new MemRemote();
  const a = newDevice();
  const vault = vaultFor(a.keys);
  try {
    addMemoryWithJob(a.store, '幂等重推记忆', 'k1');
    const first = await syncPush(a.store, remote, vault);
    assert.ok(first && first.eventCount === 1);
    const objectsAfterFirst = remote.objects.size;
    const second = await syncPush(a.store, remote, vault);
    assert.equal(second, null, '无新任务 → null');
    assert.equal(remote.objects.size, objectsAfterFirst);
    // 同一修订重复入队 → push 幂等（无新 chunk）
    const mem = a.store.memories.list({ status: 'active' })[0]!;
    a.store.outbox.enqueue({ jobType: 'sync_upstream', scopeId: a.store.scopes.resolvePreset('personal-global').id, entityType: 'memory', entityId: mem.id, idempotencyKey: 'dup' });
    const third = await syncPush(a.store, remote, vault);
    assert.ok(third);
    assert.equal(third.publishedChunks.length, 0, '已推送修订不再产生 chunk');
    assert.equal(remote.objects.size, objectsAfterFirst);
  } finally {
    a.store.close();
    cleanupTestHome(a.home);
  }
});

test('协议：local_only 内容被物理排除（远端解密核查）', async () => {
  const remote = new MemRemote();
  const a = newDevice();
  const vault = vaultFor(a.keys);
  try {
    const personal = a.store.scopes.resolvePreset('personal-global');
    const local = a.store.scopes.resolvePreset('device-local', { deviceId: a.store.identity.deviceId });
    const pm = a.store.memories.add({ kind: 'fact', content: '可以上行的公共记忆', scopeId: personal.id, authority: 'user_explicit', createdBy: 'cli' }, a.store.identity.deviceId);
    const lm = a.store.memories.add({ kind: 'fact', content: '设备本机秘密记忆 SECRET-LOCAL-9f3a', scopeId: local.id, authority: 'user_explicit', createdBy: 'cli' }, a.store.identity.deviceId);
    // local_only 的上行在 outbox 层已被物理排除；直接构造任务验证打包层二次过滤
    const r = await syncPush(a.store, remote, vault, { preclaimedJobs: [
      { id: 'j1', entityId: pm.id },
      { id: 'j2', entityId: lm.id },
    ] });
    assert.ok(r && r.eventCount === 1, `只应打包 1 条，实际 ${r?.eventCount}`);
    // 远端全部对象解密【并解压】后不含 local_only 正文（chunk 与 manifest 都核查）。
    // chunk 明文是 gzip(JSON)——不解压直接搜恒不命中（第三轮验证 P1 的恒真漏报）。
    const audit = makeRemoteCanaryAudit(remote, a, vault);
    const scan1 = audit('SECRET-LOCAL-9f3a');
    assert.equal(scan1.chunkCount >= 1, true, '至少核查了一个 chunk');
    assert.equal(scan1.hit, false, '远端 chunk 不含 local_only 正文');
  } finally {
    a.store.close();
    cleanupTestHome(a.home);
  }
});

test('协议：泄漏审计反向对照——故意注入 local_only 事件必须被检出（审计不是恒真）', async () => {
  const remote = new MemRemote();
  const a = newDevice();
  const vault = vaultFor(a.keys);
  try {
    // 用与产品完全相同的打包/加密路径，构造一个【含金丝雀】的 chunk 放进远端
    const canary = 'INJECTED-LOCAL-ONLY-c7e9';
    const ev: SyncEvent = {
      deviceId: 'dev-attacker',
      seq: 1,
      type: 'memory_upsert',
      memoryId: 'mem-canary',
      occurredAt: new Date().toISOString(),
      payload: {
        revisionId: 'rev-canary',
        content: `假装被误打包的 local_only 内容 ${canary}`,
        contentHash: contentHashOf(`假装被误打包的 local_only 内容 ${canary}`),
        parentHash: null,
        kind: 'fact',
        authority: 'user_explicit',
        scopeId: 'personal-global',
        sensitivity: 'normal',
        confidence: 1,
        observedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        expiresAt: null,
        sourceAgent: null,
        createdBy: 'test',
        reason: null,
      },
    };
    const packed = packChunk('dev-attacker', [ev]);
    remote.objects.set(`personal-global/${packed.meta.key}`, sealFor(a, packed.plaintext, packed.meta.key, 'chunk'));
    const audit = makeRemoteCanaryAudit(remote, a, vault);
    const scan = audit(canary);
    assert.equal(scan.hit, true, '注入的金丝雀必须被检出——证明审计具备发现泄漏的能力');
    assert.ok(scan.chunkCount >= 1);
  } finally {
    a.store.close();
    cleanupTestHome(a.home);
  }
});

/**
 * 远端金丝雀审计（与 scripts/obs-no-local-leak.mts 同语义）：
 * 解密 + 【gunzip】后搜索。返回命中与否与核查过的 chunk 数。
 */
function makeRemoteCanaryAudit(remote: MemRemote, device: Device, vault: VaultConfig): (canary: string) => { hit: boolean; chunkCount: number } {
  return (canary: string) => {
    const spaceKeyBytes = deriveSpaceKey(device.keys.vaultKey, 'personal-global');
    let hit = false;
    let chunkCount = 0;
    for (const [key, bytes] of remote.objects) {
      const rel = key;
      if (rel.endsWith('/manifest.json')) {
        const dev = rel.slice('personal-global/devices/'.length, rel.length - '/manifest.json'.length);
        const plain = decryptObject(bytes, spaceKeyBytes, { vaultId: vault.vaultId, spaceId: 'personal-global', kind: 'manifest', objectId: `manifest.json|${dev}` });
        if (Buffer.from(plain).toString('utf8').includes(canary)) hit = true;
        continue;
      }
      const plain = decryptObject(bytes, spaceKeyBytes, { vaultId: vault.vaultId, spaceId: 'personal-global', kind: 'chunk', objectId: rel.slice('personal-global/'.length) });
      chunkCount++;
      const unzipped = gunzipSync(Buffer.from(plain));
      if (unzipped.toString('utf8').includes(canary)) hit = true;
    }
    return { hit, chunkCount };
  };
}

test('协议：依赖等待（parentHash 未知不应用、游标不推进）', async () => {
  const remote = new MemRemote();
  const a = newDevice();
  const vault = vaultFor(a.keys);
  const b = deviceFromRecovery(a);
  try {
    const memId = addMemoryWithJob(a.store, '依赖等待基线', 'k1');
    await syncPush(a.store, remote, vault);
    await syncPull(b.store, remote, vault);
    const bMem = b.store.memories.list({ status: 'active' })[0]!;
    const curHash = bMem.contentHash;

    // 伪造设备 C 的乱序链：事件 parentHash 指向 B 不知道的内容
    const deviceIdC = 'dev-fake-c';
    const futureEvent = {
      deviceId: deviceIdC,
      seq: 99,
      type: 'memory_upsert' as const,
      memoryId: bMem.id,
      occurredAt: new Date().toISOString(),
      payload: {
        revisionId: 'future-rev',
        content: 'B 尚无祖先的未来修订',
        contentHash: contentHashOf('B 尚无祖先的未来修订'),
        parentHash: 'f'.repeat(64),
        kind: 'fact' as const,
        authority: 'user_explicit' as const,
        scopeId: 'personal-global',
        sensitivity: 'normal' as const,
        confidence: 1,
        observedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        expiresAt: null,
        sourceAgent: null,
        createdBy: 'test',
        reason: null,
      },
    };
    const packed = packChunk(deviceIdC, [futureEvent]);
    const chunkKey = `personal-global/${packed.meta.key}`;
    remote.objects.set(chunkKey, sealFor(a, packed.plaintext, packed.meta.key, 'chunk'));
    const manifestC = {
      v: 1, vaultId: vault.vaultId, spaceKey: 'personal-global', deviceId: deviceIdC,
      generation: 1, headSeq: 99, chunks: [packed.meta], updatedAt: new Date().toISOString(),
    };
    remote.objects.set(`personal-global/devices/${deviceIdC}/manifest.json`, sealFor(a, Buffer.from(JSON.stringify(manifestC)), `manifest.json|${deviceIdC}`, 'manifest'));

    // B pull：parentHash 未知 → waited，内容不得应用
    const pulled = await syncPull(b.store, remote, vault);
    const dev = pulled.devices.find((d) => d.deviceId === deviceIdC)!;
    assert.equal(dev.waited, 1, '事件进入等待依赖');
    assert.equal(b.store.memories.get(bMem.id)!.contentHash, curHash, 'B 内容未被修改');
    // 重试仍等待（依赖未到达）
    await syncPull(b.store, remote, vault);
    assert.equal(b.store.memories.get(bMem.id)!.contentHash, curHash);
    void memId;
  } finally {
    a.store.close();
    b.store.close();
    cleanupTestHome(a.home);
    cleanupTestHome(b.home);
  }
});
