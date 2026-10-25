import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RemoteStore } from '../../src/jobs/remote.js';
import { generateVaultKeys, exportRecoveryMaterial, importRecoveryMaterial, saveKeys } from '../../src/sync/cryptoutil.js';
import { VaultConfig } from '../../src/sync/vault.js';
import { syncPush } from '../../src/sync/push.js';
import { syncPull } from '../../src/sync/pull.js';
import { makeTestHome, cleanupTestHome } from '../helpers.js';
import { sha256Hex, normalizeContent } from '../../src/core/hash.js';
import { openStore, CairnStore } from '../../src/store/open.js';
import { decryptObject, deriveSpaceKey } from '../../src/sync/cryptoutil.js';

/**
 * 同步协议核心测试（本地假远端，任务 2.2–2.4 验证）：
 * 复原 / 幂等重推 / 并发冲突 / 遗忘传播 / local_only 打包排除 / 依赖等待。
 */

class MemRemote implements RemoteStore {
  readonly configured = true;
  objects = new Map<string, Uint8Array>();
  manifestGens = new Map<string, number>();

  async getObject(key: string): Promise<Uint8Array | null> {
    return this.objects.get(key) ?? null;
  }

  async putImmutable(key: string, bytes: Uint8Array, hash: string): Promise<void> {
    const prev = this.objects.get(key);
    if (prev && Buffer.from(prev).toString('base64') !== Buffer.from(bytes).toString('base64')) {
      throw new Error(`immutable key overwritten: ${key}`);
    }
    this.objects.set(key, bytes);
    void hash;
  }

  async list(prefix: string): Promise<{ keys: string[]; nextCursor?: string }> {
    return { keys: [...this.objects.keys()].filter((k) => k.startsWith(prefix)) };
  }

  async getManifest(space: string, device: string): Promise<Uint8Array | null> {
    return this.objects.get(`${space}/${device}/manifest.json`) ?? null;
  }

  async putManifest(space: string, device: string, manifest: unknown, expectedGeneration: number): Promise<void> {
    const key = `${space}/${device}/manifest.json`;
    const current = this.manifestGens.get(key) ?? 0;
    if (expectedGeneration <= current) throw new Error(`generation regression: ${expectedGeneration} <= ${current}`);
    this.manifestGens.set(key, expectedGeneration);
    this.objects.set(key, new Uint8Array(manifest as Uint8Array));
  }
}

function vaultFor(keys: ReturnType<typeof generateVaultKeys>): VaultConfig {
  return { vaultId: keys.vaultId, provider: 'syncd', syncd: { baseUrl: 'http://unused.invalid' }, createdAt: new Date().toISOString() };
}

function deviceHome(vaultIdOfKeys?: string): { store: CairnStore; home: string } {
  const home = makeTestHome();
  const store = openStore({ home });
  return { store, home };
}

/** 设备 A：建库 + 密钥 + 写入若干记忆并入队上行任务。 */
function setupDeviceA(memories: string[]): { store: CairnStore; home: string; keys: ReturnType<typeof generateVaultKeys>; ids: string[] } {
  const home = makeTestHome();
  const store = openStore({ home });
  const keys = generateVaultKeys();
  saveKeys(joinDataDir(home), keys);
  const scope = store.scopes.resolvePreset('personal-global');
  const ids = memories.map((content) => {
    const m = store.memories.add({ kind: 'fact', content, scopeId: scope.id, authority: 'user_explicit', createdBy: 'cli' }, store.identity.deviceId);
    store.outbox.enqueue({ jobType: 'sync_upstream', scopeId: scope.id, entityType: 'memory', entityId: m.id, idempotencyKey: `mem:${m.id}` });
    return m.id;
  });
  return { store, home, keys, ids };
}

function joinDataDir(home: string): string {
  return `${home.replace(/\\/g, '/')}/data`;
}

function setupDeviceB(keysA: ReturnType<typeof generateVaultKeys>): { store: CairnStore; home: string } {
  const home = makeTestHome();
  const store = openStore({ home });
  // 用 A 的恢复材料导入同一 vault 身份与密钥
  const keys = importRecoveryMaterial(exportRecoveryMaterial(keysA));
  saveKeys(joinDataDir(home), keys);
  return { store, home };
}

test('协议：push 后 pull 复原（跨设备创建）', async () => {
  const remote = new MemRemote();
  const a = setupDeviceA(['跨设备事实甲', '跨设备事实乙']);
  const vault = vaultFor(a.keys);
  const b = setupDeviceB(a.keys);
  try {
    const pushed = await syncPush(a.store, remote, vault);
    assert.ok(pushed && pushed.eventCount === 2 && pushed.publishedChunks.length >= 1);
    assert.ok(remote.objects.size >= 1);

    const pulled = await syncPull(b.store, remote, vault);
    assert.equal(pulled.totalApplied, 2);
    // B 侧可检索
    const scope = b.store.scopes.resolvePreset('personal-global');
    const found = b.store.memories.list({ scopeId: scope.id, status: 'active' });
    assert.equal(found.length, 2);
    const contents = found.map((m) => m.content).sort();
    assert.deepEqual(contents, ['跨设备事实乙', '跨设备事实甲'].sort());
    // 二次 pull 幂等
    const pulled2 = await syncPull(b.store, remote, vault);
    assert.equal(pulled2.totalApplied, 0);
    cleanupTestHome(a.home);
    cleanupTestHome(b.home);
  } finally {
    a.store.close();
    b.store.close();
  }
});

test('协议：双设备并发修改 → 双方保留并进入冲突队列', async () => {
  const remote = new MemRemote();
  const a = setupDeviceA(['并发基线记忆']);
  const vault = vaultFor(a.keys);
  const b = setupDeviceB(a.keys);
  try {
    await syncPush(a.store, remote, vault);
    await syncPull(b.store, remote, vault);

    // A、B 各自离线修改同一条记忆
    const aMem = a.store.memories.list({ status: 'active' })[0]!;
    a.store.memories.revise(aMem.id, 'A 设备的修改版本', { author: 'a' }, a.store.identity.deviceId);
    const bMem = b.store.memories.list({ status: 'active' })[0]!;
    b.store.memories.revise(bMem.id, 'B 设备的修改版本', { author: 'b' }, b.store.identity.deviceId);

    // A push（A 的修改基于共同祖先）→ B pull → 冲突
    a.store.outbox.enqueue({ jobType: 'sync_upstream', scopeId: a.store.scopes.resolvePreset('personal-global').id, entityType: 'memory', entityId: aMem.id, idempotencyKey: `mem:${aMem.id}:rev2` });
    await syncPush(a.store, remote, vault);
    const pulled = await syncPull(b.store, remote, vault);
    assert.equal(pulled.totalApplied, 1, '冲突记录算一次应用');

    const bConflicted = b.store.memories.list({ status: 'conflicted' });
    assert.equal(bConflicted.length, 1, 'B 侧记忆进入 conflicted 状态');
    assert.equal(bConflicted[0]!.id, bMem.id);
    assert.equal(b.store.conflicts.countOpen(), 1, 'B 侧冲突队列有记录');
    const revs = b.store.memories.revisions(bMem.id);
    const hashes = new Set(revs.map((r) => r.contentHash));
    assert.ok(revs.length >= 3, `B 保留双方修订（≥3：基线+A 版+B 版），实际 ${revs.length}`);
    assert.ok(hashes.size >= 3, '双方内容都存在');
    cleanupTestHome(a.home);
    cleanupTestHome(b.home);
  } finally {
    a.store.close();
    b.store.close();
  }
});

test('协议：遗忘传播（tombstone 跨设备）', async () => {
  const remote = new MemRemote();
  const a = setupDeviceA(['将被遗忘的记忆']);
  const vault = vaultFor(a.keys);
  const b = setupDeviceB(a.keys);
  try {
    await syncPush(a.store, remote, vault);
    await syncPull(b.store, remote, vault);
    assert.equal(b.store.memories.list({ status: 'active' }).length, 1);

    // A 遗忘并推送
    const aMem = a.store.memories.list({ status: 'active' })[0]!;
    a.store.memories.forget(aMem.id, '测试遗忘', 'cli');
    a.store.outbox.enqueue({ jobType: 'sync_upstream', scopeId: a.store.scopes.resolvePreset('personal-global').id, entityType: 'memory', entityId: aMem.id, idempotencyKey: `mem:${aMem.id}:tombstone` });
    await syncPush(a.store, remote, vault);
    const pulled = await syncPull(b.store, remote, vault);
    assert.equal(pulled.totalApplied, 1);
    const bMem = b.store.memories.list({ status: 'tombstoned' });
    assert.equal(bMem.length, 1, 'B 侧该记忆已 tombstoned');
    assert.equal(b.store.memories.list({ status: 'active' }).length, 0);
    cleanupTestHome(a.home);
    cleanupTestHome(b.home);
  } finally {
    a.store.close();
    b.store.close();
  }
});

test('协议：幂等重推（同修订不产生新 chunk 事件）', async () => {
  const remote = new MemRemote();
  const a = setupDeviceA(['幂等重推记忆']);
  const vault = vaultFor(a.keys);
  try {
    const first = await syncPush(a.store, remote, vault);
    assert.ok(first && first.eventCount === 1);
    const objectsAfterFirst = remote.objects.size;
    // 无新任务时 push → null
    const second = await syncPush(a.store, remote, vault);
    assert.equal(second, null);
    assert.equal(remote.objects.size, objectsAfterFirst);
    // 同一修订重复入队 → push 幂等（无新 chunk）
    const mem = a.store.memories.list({ status: 'active' })[0]!;
    a.store.outbox.enqueue({ jobType: 'sync_upstream', scopeId: a.store.scopes.resolvePreset('personal-global').id, entityType: 'memory', entityId: mem.id, idempotencyKey: 'dup' });
    const third = await syncPush(a.store, remote, vault);
    assert.ok(third);
    assert.equal(third.publishedChunks.length, 0, '已推送修订不再产生 chunk');
    assert.equal(remote.objects.size, objectsAfterFirst);
    cleanupTestHome(a.home);
  } finally {
    a.store.close();
  }
});

test('协议：local_only 内容被物理排除（远端解密核查）', async () => {
  const remote = new MemRemote();
  const home = makeTestHome();
  const store = openStore({ home });
  const keys = generateVaultKeys();
  saveKeys(joinDataDir(home), keys);
  try {
    const personal = store.scopes.resolvePreset('personal-global');
    const local = store.scopes.resolvePreset('device-local', { deviceId: store.identity.deviceId });
    const pm = store.memories.add({ kind: 'fact', content: '可以上行的公共记忆', scopeId: personal.id, authority: 'user_explicit', createdBy: 'cli' }, store.identity.deviceId);
    const lm = store.memories.add({ kind: 'fact', content: '设备本机秘密记忆 SECRET-LOCAL-9f3a', scopeId: local.id, authority: 'user_explicit', createdBy: 'cli' }, store.identity.deviceId);
    // local_only 的 sync_upstream 在 outbox 层已被物理排除（enqueue 返回 false），直接构造任务验证打包层过滤
    const r = await syncPush(store, remote, vaultFor(keys), { preclaimedJobs: [
      { id: 'j1', entityId: pm.id },
      { id: 'j2', entityId: lm.id },
    ] });
    assert.ok(r && r.eventCount === 1, `只应打包 1 条，实际 ${r?.eventCount}`);
    // 远端全部对象解密后不含 local_only 正文（chunk 与 manifest 都核查）
    const vault = vaultFor(keys);
    const spacePrefix = `${vault.vaultId}/spaces/personal-global/`;
    let chunkCount = 0;
    for (const [key, bytes] of remote.objects) {
      const rel = key.slice(spacePrefix.length);
      const spaceKeyBytes = deriveSpaceKey(keys.vaultKey, 'personal-global');
      if (rel.endsWith('/manifest.json')) {
        const device = rel.slice('devices/'.length, rel.length - '/manifest.json'.length);
        const manifest = JSON.parse(Buffer.from(decryptObject(bytes, spaceKeyBytes, { vaultId: vault.vaultId, spaceId: 'personal-global', kind: 'manifest', objectId: `manifest.json|${device}` })).toString('utf8')) as { chunks: unknown[] };
        assert.ok(Array.isArray(manifest.chunks));
        continue;
      }
      const plain = decryptObject(bytes, spaceKeyBytes, { vaultId: vault.vaultId, spaceId: 'personal-global', kind: 'chunk', objectId: rel });
      chunkCount++;
      assert.ok(!Buffer.from(plain).toString('utf8').includes('SECRET-LOCAL-9f3a'), '远端 chunk 不含 local_only 正文');
    }
    assert.ok(chunkCount >= 1, '至少核查了一个 chunk');
    cleanupTestHome(home);
  } finally {
    store.close();
  }
});

test('协议：依赖等待（parentHash 未知不应用、游标不推进）', async () => {
  const remote = new MemRemote();
  const a = setupDeviceA(['依赖等待基线']);
  const vault = vaultFor(a.keys);
  const b = setupDeviceB(a.keys);
  try {
    await syncPush(a.store, remote, vault);
    await syncPull(b.store, remote, vault);
    const bMem = b.store.memories.list({ status: 'active' })[0]!;
    const curHash = bMem.contentHash;

    // 构造一个 parentHash 对不上 B 当前内容的事件（模拟：B 还没收到中间修订）
    // 直接在远端放一个"未来的" chunk 事件——parentHash 指向 B 不知道的内容
    const fakeParentHash = 'f'.repeat(64);
    const futureEvent = {
      deviceId: a.store.identity.deviceId,
      seq: 99,
      type: 'memory_upsert' as const,
      memoryId: bMem.id,
      occurredAt: new Date().toISOString(),
      payload: {
        revisionId: 'future-rev',
        content: 'B 尚无祖先的未来修订',
        contentHash: requireHash('B 尚无祖先的未来修订'),
        parentHash: fakeParentHash,
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
    // 手工打包进远端（模拟第三方设备 C 的乱序链）
    const { packChunk } = await import('../../src/sync/events.js');
    const { encryptObject } = await import('../../src/sync/cryptoutil.js');
    const { plaintext, meta } = packChunk(a.store.identity.deviceId, [futureEvent]);
    const objectKey = `${vault.vaultId}/spaces/personal-global/${meta.key}`;
    remote.objects.set(objectKey, encryptObject(plaintext, deriveSpaceKey(a.keys.vaultKey, 'personal-global'), { vaultId: vault.vaultId, spaceId: 'personal-global', kind: 'chunk', objectId: meta.key }));
    // 伪造 C 的 manifest（headSeq 覆盖 seq 99）
    const cDevice = a.store.identity.deviceId; // 复用 A 身份会走游标——改用新设备名
    remote.objects.delete(objectKey);
    const deviceIdC = 'dev-fake-c';
    const ev2 = { ...futureEvent, deviceId: deviceIdC };
    const packed2 = packChunk(deviceIdC, [ev2]);
    const keyC = `${vault.vaultId}/spaces/personal-global/${packed2.meta.key}`;
    remote.objects.set(keyC, encryptObject(packed2.plaintext, deriveSpaceKey(a.keys.vaultKey, 'personal-global'), { vaultId: vault.vaultId, spaceId: 'personal-global', kind: 'chunk', objectId: packed2.meta.key }));
    const manifestC = {
      v: 1, vaultId: vault.vaultId, spaceKey: 'personal-global', deviceId: deviceIdC,
      generation: 1, headSeq: 99, chunks: [packed2.meta], updatedAt: new Date().toISOString(),
    };
    remote.objects.set(`${vault.vaultId}/spaces/personal-global/devices/${deviceIdC}/manifest.json`, encryptObject(Buffer.from(JSON.stringify(manifestC)), deriveSpaceKey(a.keys.vaultKey, 'personal-global'), { vaultId: vault.vaultId, spaceId: 'personal-global', kind: 'manifest', objectId: `manifest.json|${deviceIdC}` }));

    // B pull：事件 parentHash 未知 → waited，内容不得应用
    const pulled = await syncPull(b.store, remote, vault);
    const dev = pulled.devices.find((d) => d.deviceId === deviceIdC)!;
    assert.equal(dev.waited, 1, '事件进入等待依赖');
    assert.equal(b.store.memories.get(bMem.id)!.contentHash, curHash, 'B 内容未被修改');
    // 游标未推进该链：再 pull 仍会重试（这里只断言不崩溃、内容不变）
    await syncPull(b.store, remote, vault);
    assert.equal(b.store.memories.get(bMem.id)!.contentHash, curHash);
    cleanupTestHome(a.home);
    cleanupTestHome(b.home);
  } finally {
    a.store.close();
    b.store.close();
  }
});

function requireHash(text: string): string {
  // 与 events.validateUpsertEvent 一致的规范化内容哈希
  return sha256Hex(normalizeContent(text));
}
