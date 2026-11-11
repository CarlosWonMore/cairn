import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RemoteStore } from '../../src/jobs/remote.js';
import { generateVaultKeys, exportRecoveryMaterial, importRecoveryMaterial, saveKeys } from '../../src/sync/cryptoutil.js';
import { VaultConfig } from '../../src/sync/vault.js';
import { syncPush, syncPull } from '../../src/sync/orchestrate.js';
import { applyEvent, applyEvents } from '../../src/sync/apply.js';
import { AppService } from '../../src/interfaces/app-service.js';
import { makeTestHome, cleanupTestHome } from '../helpers.js';

/**
 * scope_exit 跨设备语义（add-scope-migration 任务 3.5）：
 * 迁出通知跨设备生效、迁出≠遗忘、迁回重推解除标记、迟到修订不复活、
 * 未知事件不阻断、重复推送幂等。全部走真实 AppService → outbox → push/pull 链路。
 */

class MemRemote implements RemoteStore {
  readonly configured = true;
  objects = new Map<string, Uint8Array>();
  manifestGens = new Map<string, number>();

  async getObject(key: string): Promise<Uint8Array | null> {
    return this.objects.get(key) ?? null;
  }
  async putImmutable(key: string, bytes: Uint8Array, _hash: string): Promise<void> {
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

function vaultFor(keys: ReturnType<typeof generateVaultKeys>): VaultConfig {
  return { vaultId: keys.vaultId, provider: 'syncd', syncd: { baseUrl: 'http://unused.invalid' }, createdAt: new Date().toISOString() };
}

interface Device {
  service: AppService;
  home: string;
  keys: ReturnType<typeof generateVaultKeys>;
}

function newDevice(source?: Device): Device {
  const home = makeTestHome();
  const service = AppService.open(home);
  const keys = source
    ? importRecoveryMaterial(exportRecoveryMaterial(source.keys))
    : generateVaultKeys();
  saveKeys(`${home.replace(/\\/g, '/')}/data`, keys);
  return { service, home, keys };
}

function closeAll(...devices: Device[]): void {
  for (const d of devices) {
    d.service.close();
    cleanupTestHome(d.home);
  }
}

test('迁出通知跨设备生效；迁出≠遗忘；迁回重推解除标记', async () => {
  const a = newDevice();
  const b = newDevice(a);
  const c = newDevice(a);
  try {
    const remote = new MemRemote();
    const vault = vaultFor(a.keys);

    // B 写入并推送；A、C 拉到各自本地副本（id 各不相同，靠内容血统对齐）
    const added = b.service.addMemory({ content: '深云同步的部署参数', kind: 'fact' });
    const bId = added.memory!.id;
    await syncPush(b.service.store, remote, vault);
    await syncPull(a.service.store, remote, vault);
    await syncPull(c.service.store, remote, vault);

    const aCopy1 = a.service.store.db.get('SELECT id FROM memory WHERE content = ?', '深云同步的部署参数') as { id: string };
    assert.ok(aCopy1?.id, 'A 应持有副本');

    // C 也推一次自己持有的 v1（真实多设备形态：每个持有者都上行；
    // 这样 C 之后推送 v2 时 parentHash 才有值，upsert 才能被血统对齐而不是被当成新记忆）
    const cSeedId = (c.service.store.db.get('SELECT id FROM memory WHERE content = ?', '深云同步的部署参数') as { id: string }).id;
    const pgC = c.service.store.scopes.resolvePreset('personal-global');
    c.service.store.outbox.enqueue({ jobType: 'sync_upstream', scopeId: pgC.id, entityType: 'memory', entityId: cSeedId, idempotencyKey: 'seed-c-v1' });
    await syncPush(c.service.store, remote, vault);
    await syncPull(a.service.store, remote, vault);

    // B 迁出到 device-local → push scope_exit → A、C 标记不再持有
    b.service.rescopeMemory(bId, { scopePreset: 'device-local', force: true });
    const push1 = await syncPush(b.service.store, remote, vault);
    assert.equal(push1?.eventCount, 1, '迁出通知是一条控制事件');
    await syncPull(a.service.store, remote, vault);
    await syncPull(c.service.store, remote, vault);

    const aRow1 = a.service.store.db.get('SELECT status FROM memory WHERE id = ?', aCopy1.id) as { status: string };
    assert.equal(aRow1.status, 'archived', 'A 收到迁出后标记不再持有（archived）');
    assert.equal(a.service.store.memories.getTombstone(aCopy1.id), null, '迁出≠遗忘：无墓碑记录');
    const searched = await a.service.search({ text: '深云同步', query: { deviceId: 'all', agentId: 'all' } as never });
    assert.equal(searched.results.length, 0, '检索不再返回它');
    const cRow1 = c.service.store.db.get('SELECT status FROM memory WHERE id = ?', (c.service.store.db.get('SELECT id FROM memory WHERE content = ?', '深云同步的部署参数') as { id: string }).id) as { status: string };
    assert.equal(cRow1.status, 'archived', 'C 同样标记不再持有');

    // 迟到修订（C 在收到迁出前的并发编辑流过来的 upsert，无 reentry 标记）：不复活
    const cId = (c.service.store.db.get('SELECT id FROM memory WHERE content = ?', '深云同步的部署参数') as { id: string }).id;
    // C 的副本已 archived；模拟 C 侧把内容改了并推上行（老版本设备不知道迁出语义时的真实形态）
    c.service.store.db.run("UPDATE memory SET status = 'active' WHERE id = ?", cId);
    c.service.reviseMemory(cId, '深云同步的部署参数 v2', { reason: '并发编辑' });
    await syncPush(c.service.store, remote, vault);
    await syncPull(a.service.store, remote, vault);
    const aRow2 = a.service.store.db.get('SELECT status FROM memory WHERE id = ?', aCopy1.id) as { status: string };
    assert.equal(aRow2.status, 'archived', '迟到修订不把已迁出的记忆变回活动内容');

    // B 迁回 personal-global → push（force 重发修订快照，reentry 标记）→ A 重新持有
    b.service.rescopeMemory(bId, { scopePreset: 'personal-global', force: true });
    await syncPush(b.service.store, remote, vault);
    await syncPull(a.service.store, remote, vault);
    const aRow3 = a.service.store.db.get('SELECT status FROM memory WHERE id = ?', aCopy1.id) as { status: string };
    assert.equal(aRow3.status, 'active', '迁回重推解除「不再持有」，内容按正常修订链同步');
    const searched2 = await a.service.search({ text: '深云同步', query: { deviceId: 'all', agentId: 'all' } as never });
    assert.equal(searched2.results.length, 1, '迁回后检索重新返回');

    // 重复推送幂等：B 再排一条迁出（出→入的下一轮），A 再拉——状态一致、无重复记录、不报错
    b.service.rescopeMemory(bId, { scopePreset: 'device-local', force: true });
    await syncPush(b.service.store, remote, vault);
    const pull2 = await syncPull(a.service.store, remote, vault);
    assert.equal(pull2.totalApplied, 1);
    const aRow4 = a.service.store.db.get('SELECT status FROM memory WHERE id = ?', aCopy1.id) as { status: string };
    assert.equal(aRow4.status, 'archived');
    assert.equal(a.service.store.memories.getTombstone(aCopy1.id), null);
  } finally {
    closeAll(a, b, c);
  }
});

test('未知事件类型：跳过 + 审计，不中断整链（游标推进）', () => {
  const home = makeTestHome();
  const service = AppService.open(home);
  try {
    const audit = service.store.audit;
    // 未来版本的事件：类型无法识别
    const unknown = { deviceId: 'dev-x', seq: 1, type: 'scope_reenter_v99', memoryId: 'm1', occurredAt: new Date().toISOString(), payload: null } as never;
    const r = applyEvent(service.store, unknown, 'personal-global', audit);
    assert.equal(r, 'skipped');
    const items = audit.list({ category: 'sync', action: 'unknown_event_skipped' });
    assert.equal(items.length, 1);
    assert.equal(items[0]!.detail['eventType'], 'scope_reenter_v99');

    // 批量应用：未知事件夹在两个正常事件之间，不产生 waitEvent（游标可推进）
    const scope = service.store.scopes.resolvePreset('personal-global');
    const mem = service.store.memories.add({ kind: 'fact', content: '未知事件夹链测试', scopeId: scope.id, authority: 'agent_inferred', createdBy: 'test' }, 'dev-x');
    const events = [
      unknown,
      { deviceId: 'dev-x', seq: 2, type: 'memory_upsert', memoryId: mem.id, occurredAt: new Date().toISOString(), payload: null } as never,
    ];
    const out = applyEvents(service.store, events, 'personal-global');
    assert.equal(out.outcome.skipped, 1);
    assert.equal(out.outcome.waited, 1, 'payload 缺失的已知类型仍按等待处理（完整性优先）');
    assert.ok(
      out.waitEvents.every((w) => w.seq !== 1),
      '未知事件不进等待队列——游标可以推进它，整链不被卡死',
    );
  } finally {
    service.close();
    cleanupTestHome(home);
  }
});

test('重复应用同一 scope_exit 事件：幂等（skipped），不产生重复记录', () => {
  const home = makeTestHome();
  const service = AppService.open(home);
  try {
    const scope = service.store.scopes.resolvePreset('personal-global');
    const mem = service.store.memories.add({ kind: 'fact', content: '幂等测试', scopeId: scope.id, authority: 'agent_inferred', createdBy: 'test' }, 'dev-x');
    const ev = {
      deviceId: 'dev-x',
      seq: 1,
      type: 'scope_exit',
      memoryId: mem.id,
      occurredAt: new Date().toISOString(),
      payload: { lastContentHash: mem.contentHash, knownHashes: [mem.contentHash] },
    } as never;
    const audit = service.store.audit;
    assert.equal(applyEvent(service.store, ev, 'personal-global', audit), 'scopeExited');
    assert.equal(applyEvent(service.store, ev, 'personal-global', audit), 'skipped', '第二次应用是幂等跳过');
    assert.equal(applyEvent(service.store, ev, 'personal-global', audit), 'skipped');
    assert.equal(service.store.memories.require(mem.id).status, 'archived');
    assert.equal(service.store.memories.getTombstone(mem.id), null);
  } finally {
    service.close();
    cleanupTestHome(home);
  }
});
