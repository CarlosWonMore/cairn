import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { RemoteStore } from '../../src/jobs/remote.js';
import {
  generateVaultKeys,
  saveKeys,
  deriveSpaceKey,
  decryptObject,
  exportRecoveryMaterial,
  importRecoveryMaterial,
} from '../../src/sync/cryptoutil.js';
import {
  VaultConfig,
  PERSONAL_SPACE_KEY,
  preserveSpaceKey,
  projectSpaceKey,
  isProjectSpaceKey,
  projectIdFromSpaceKey,
  syncableChains,
} from '../../src/sync/vault.js';
import { syncPush, syncPull } from '../../src/sync/orchestrate.js';
import { unpackChunk, type ManifestDoc, type SyncEvent, type SyncScopeDescriptor } from '../../src/sync/events.js';
import { enqueueMemorySync } from '../../src/sync/route.js';
import { applyEvent, applyEvents } from '../../src/sync/apply.js';
import { findUpstreamGap, findScopeExitGap } from '../../src/sync/backfill.js';
import { openStore, type CairnStore } from '../../src/store/open.js';
import { contentHash as contentHashOf, canonicalJson } from '../../src/core/hash.js';
import { AppService } from '../../src/interfaces/app-service.js';
import { makeTestHome, cleanupTestHome } from '../helpers.js';

/**
 * 项目链 project/<projectId>（add-cross-device-project-sync 第 1、2、3 节）：
 * 链键、入队路由、push 发布、pull 自发现、apply 物化与「不再持有」标记解除。
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

  containsPlaintext(needle: string): boolean {
    for (const bytes of this.objects.values()) {
      if (Buffer.from(bytes).toString('latin1').includes(needle)) return true;
    }
    return false;
  }
}

function vaultFor(keys: ReturnType<typeof generateVaultKeys>, preserve = false): VaultConfig {
  const cfg: VaultConfig = { vaultId: keys.vaultId, provider: 'syncd', syncd: { baseUrl: 'http://unused.invalid' }, createdAt: new Date().toISOString() };
  if (preserve) cfg.preserveDeviceBound = true;
  return cfg;
}

interface Device {
  service: AppService;
  home: string;
  keys: ReturnType<typeof generateVaultKeys>;
  deviceId: string;
}

function newDevice(preserve = false, source?: Device): Device {
  const home = makeTestHome('cairn-project-chain-');
  const service = AppService.open(home);
  const keys = source ? importRecoveryMaterial(exportRecoveryMaterial(source.keys)) : generateVaultKeys();
  saveKeys(`${home.replace(/\\/g, '/')}/data`, keys);
  writeFileSync(join(home, 'data', 'vault.json'), JSON.stringify(vaultFor(keys, preserve), null, 2), 'utf8');
  return { service, home, keys, deviceId: service.store.identity.deviceId };
}

function closeAll(...devices: Device[]): void {
  for (const d of devices) {
    d.service.close();
    cleanupTestHome(d.home);
  }
}

/** 读取某链已发布的事件（解 manifest + chunk），用于断言事件载荷与描述符。 */
function readChainEvents(remote: MemRemote, device: Device, vault: VaultConfig, spaceKey: string): SyncEvent[] {
  const sealedManifest = remote.objects.get(`${spaceKey}/devices/${device.deviceId}/manifest.json`);
  assert.ok(sealedManifest, `链 ${spaceKey} 应有 manifest`);
  const manifest = JSON.parse(
    Buffer.from(
      decryptObject(sealedManifest!, deriveSpaceKey(device.keys.vaultKey, spaceKey), {
        vaultId: vault.vaultId,
        spaceId: spaceKey,
        kind: 'manifest',
        objectId: `manifest.json|${device.deviceId}`,
      }),
    ).toString('utf8'),
  ) as ManifestDoc;
  const events: SyncEvent[] = [];
  for (const meta of manifest.chunks) {
    const sealed = remote.objects.get(`${spaceKey}/${meta.key}`);
    assert.ok(sealed, `链 ${spaceKey} 应有 chunk ${meta.key}`);
    const plain = decryptObject(sealed!, deriveSpaceKey(device.keys.vaultKey, spaceKey), {
      vaultId: vault.vaultId,
      spaceId: spaceKey,
      kind: 'chunk',
      objectId: meta.key,
    });
    events.push(...unpackChunk(plain, device.deviceId, meta));
  }
  return events;
}

test('链键：project/<projectId> 构造、识别、反解；syncableChains 由调用方传入项目列表', () => {  const projectId = '77777777-7777-4777-8777-777777777777';
  const key = projectSpaceKey(projectId);
  assert.equal(key, `project/${projectId}`);
  assert.equal(isProjectSpaceKey(key), true);
  assert.equal(isProjectSpaceKey(PERSONAL_SPACE_KEY), false);
  assert.equal(isProjectSpaceKey(preserveSpaceKey('dev_x')), false);
  assert.equal(projectIdFromSpaceKey(key), projectId);
  assert.equal(projectIdFromSpaceKey('project/'), null, '空 id 不猜');
  assert.equal(projectIdFromSpaceKey(PERSONAL_SPACE_KEY), null);

  const keys = generateVaultKeys();
  assert.deepEqual(syncableChains(vaultFor(keys), 'dev_x'), [PERSONAL_SPACE_KEY]);
  assert.deepEqual(syncableChains(vaultFor(keys, true), 'dev_x', [projectId, 'p2']), [
    PERSONAL_SPACE_KEY,
    `project/${projectId}`,
    'project/p2',
    preserveSpaceKey('dev_x'),
  ], '个人链 + 项目链 + 保管链（模式开启）');
});

test('入队路由：project-global → 项目链 sync_upstream；缺 projectId → 降级保管链并审计', () => {
  const a = newDevice(true);
  try {
    const projectId = '88888888-8888-4888-8888-888888888888';
    const pg = a.service.addMemory({
      content: '项目全局入队样本',
      kind: 'fact',
      scope: { preset: 'project-global', projectId, projectName: '路由测试项目' },
    });
    const job = a.service.store.db.get('SELECT job_type FROM outbox_job WHERE entity_id = ?', pg.memory!.id);
    assert.equal(job?.job_type, 'sync_upstream', '复用 sync_upstream（不新增 jobType）');
    const scopeRow = a.service.store.scopes.requireById(pg.memory!.scopeId);
    assert.equal(scopeRow.projectId, projectId);

    // 同一入口返回的 chain 必须指向项目链——由 enqueueMemorySync 的返回值裁定
    const again = enqueueMemorySync(a.service.store, {
      memoryId: pg.memory!.id,
      scopeId: scopeRow.id,
      op: 'memory_upsert',
      idempotencyKey: 'project-route-probe',
    });
    assert.equal(again.enqueued, true);
    assert.equal(again.chain, projectSpaceKey(projectId));
    assert.equal(again.jobType, 'sync_upstream');

    // project-device（保管模式开启）维持保管链
    const pd = a.service.addMemory({
      content: '项目设备限定入队样本',
      kind: 'fact',
      scope: { preset: 'project-device', projectId, projectName: '路由测试项目' },
    });
    const pdJob = a.service.store.db.get('SELECT job_type FROM outbox_job WHERE entity_id = ?', pd.memory!.id);
    assert.equal(pdJob?.job_type, 'sync_preserve');

    // project-global 缺 projectId：不得静默——降级保管链 + 审计。
    // 正常入口不可能造出该形态（resolvePreset 强制 projectId），这里按约束允许的
    // 历史/异常行形态直写：preset=project-global + scope_kind=custom + project_id NULL。
    const spaceId = scopeRow.spaceId;
    const orphanScopeId = 'scp_orphan_project_global';
    a.service.store.db.run(
      `INSERT INTO scope (id, space_id, preset, scope_kind, project_id, device_id, agent_id, read_allowlist,
         sync_policy, read_policy, retention_policy, projection_policy, sensitivity, ttl_days, builtin, created_at)
       VALUES (?, ?, 'project-global', 'custom', NULL, 'all', 'all', '[]', 'encrypted', 'all_agents',
               'permanent', 'none', 'normal', NULL, 0, ?)`,
      orphanScopeId,
      spaceId,
      new Date().toISOString(),
    );
    const orphan = a.service.store.memories.add(
      { kind: 'fact', content: '缺项目身份的孤儿项目内容', scopeId: orphanScopeId, authority: 'user_explicit', createdBy: 'cli' },
      a.deviceId,
    );
    const degraded = enqueueMemorySync(a.service.store, {
      memoryId: orphan.id,
      scopeId: orphanScopeId,
      op: 'memory_upsert',
      idempotencyKey: 'orphan-project',
    });
    assert.equal(degraded.enqueued, true, '不得丢弃：降级入队');
    assert.equal(degraded.chain, preserveSpaceKey(a.deviceId), '降级到保管链分支');
    assert.equal(degraded.jobType, 'sync_preserve');
    const audits = a.service.auditList({ action: 'sync_job_unroutable' });
    assert.equal(audits.length, 1, '缺 projectId 必须审计，不得静默');
    assert.equal(audits[0]!.detail['reason'], 'project_global_missing_project_id');
  } finally {
    closeAll(a);
  }
});

test('device-local 关闭模式：零任务（与项目内容形成对照）', () => {
  const a = newDevice(false);
  try {
    const dl = a.service.addMemory({ content: '仅本机内容 PROJECTCHAINEDGE', kind: 'fact', scope: { preset: 'device-local' } });
    assert.equal(a.service.store.db.all('SELECT id FROM outbox_job WHERE entity_id = ?', dl.memory!.id).length, 0);
  } finally {
    closeAll(a);
  }
});

test('push 发布：项目内容落在 project/<uuid>/devices/<dev>/...，描述符带 projectId 与项目显示名', async () => {
  const a = newDevice(false); // 关闭保管模式：项目链仍发布（与 device-local 排除对照）
  try {
    const remote = new MemRemote();
    const vault = vaultFor(a.keys);
    const projectId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const text = '项目链发布样本 PROJECTCHAINNEW';
    a.service.addMemory({ content: text, kind: 'fact', scope: { preset: 'project-global', projectId, projectName: '发布测试项目' } });
    a.service.addMemory({ content: '设备限定不该上云 PROJECTCHAINLOCAL', kind: 'fact', scope: { preset: 'device-local' } });

    const r = await syncPush(a.service.store, remote, vault);
    assert.ok(r);
    const chain = r!.chains.find((c) => c.spaceKey === projectSpaceKey(projectId));
    assert.ok(chain, 'push 结果按链分列且含项目链');
    assert.equal(chain!.role, 'project');
    assert.equal(chain!.eventCount, 1);
    assert.equal(r!.chains.some((c) => c.spaceKey.startsWith('preserve/')), false, '关闭模式无保管链');

    assert.ok(remote.objects.has(`project/${projectId}/devices/${a.deviceId}/manifest.json`), '对象位于项目链前缀下');
    assert.equal(
      [...remote.objects.keys()].filter((k) => k.startsWith(`project/${projectId}/devices/${a.deviceId}/chunks/`)).length,
      1,
    );
    assert.equal(remote.containsPlaintext('PROJECTCHAINNEW'), false, '明文不出现在云端对象');
    assert.equal(remote.containsPlaintext('PROJECTCHAINLOCAL'), false);

    const events = readChainEvents(remote, a, vault, projectSpaceKey(projectId));
    assert.equal(events.length, 1);
    const payload = events[0]!.payload as { scopeId: string; scope?: { preset: string; projectId?: string; spaceName?: string } };
    assert.equal(payload.scopeId, 'project-global');
    assert.equal(payload.scope?.preset, 'project-global');
    assert.equal(payload.scope?.projectId, projectId);
    assert.equal(payload.scope?.spaceName, '发布测试项目', 'spaceName 取 project.name');
    assert.equal(a.service.store.db.get("SELECT status FROM outbox_job WHERE job_type = 'sync_upstream'")?.status, 'done');
  } finally {
    closeAll(a);
  }
});

test('push 路由不受保管模式影响：开启模式下项目链与保管链各自发布', async () => {
  const a = newDevice(true);
  try {
    const remote = new MemRemote();
    const vault = vaultFor(a.keys, true);
    const projectId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    a.service.addMemory({ content: '开启模式的项目内容 PROJECTON', kind: 'fact', scope: { preset: 'project-global', projectId, projectName: '开启模式项目' } });
    a.service.addMemory({ content: '开启模式的设备内容 PRESERVEON', kind: 'fact', scope: { preset: 'device-local' } });

    const r = await syncPush(a.service.store, remote, vault);
    assert.ok(r);
    const projectChain = r!.chains.find((c) => c.role === 'project');
    const preserveChain = r!.chains.find((c) => c.role === 'preserve');
    assert.equal(projectChain?.spaceKey, projectSpaceKey(projectId), '项目内容不走保管链');
    assert.equal(preserveChain?.spaceKey, preserveSpaceKey(a.deviceId));
    assert.equal(projectChain!.eventCount, 1);
    assert.equal(preserveChain!.eventCount, 1);
    assert.equal(remote.containsPlaintext('PROJECTON'), false);
  } finally {
    closeAll(a);
  }
});

test('scope_exit 事件携带终态作用域：项目目的地与设备限定目的地', async () => {
  const a = newDevice(false);
  try {
    const remote = new MemRemote();
    const vault = vaultFor(a.keys);
    const toProject = a.service.addMemory({ content: '迁往项目的记忆 EXITPROJ', kind: 'fact' });
    const toDevice = a.service.addMemory({ content: '迁往设备限定的记忆 EXITDEV', kind: 'fact' });
    await syncPush(a.service.store, remote, vault); // 建立 sync_pushed，让迁出有意义

    const projectId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    a.service.rescopeMemory(toProject.memory!.id, { scopePreset: 'project-global', projectId, projectName: '终态项目', force: true });
    a.service.rescopeMemory(toDevice.memory!.id, { scopePreset: 'device-local', force: true });
    await syncPush(a.service.store, remote, vault);

    const events = readChainEvents(remote, a, vault, PERSONAL_SPACE_KEY).filter((e) => e.type === 'scope_exit');
    assert.equal(events.length, 2, '两条迁出各一条控制事件');

    const projectExit = events.find((e) => e.memoryId === toProject.memory!.id)!.payload as {
      terminalScope?: { preset: string; projectId?: string; spaceName?: string };
    };
    assert.equal(projectExit.terminalScope?.preset, 'project-global');
    assert.equal(projectExit.terminalScope?.projectId, projectId);
    assert.equal(projectExit.terminalScope?.spaceName, '终态项目');

    const deviceExit = events.find((e) => e.memoryId === toDevice.memory!.id)!.payload as {
      terminalScope?: { preset: string; deviceId?: string };
    };
    assert.equal(deviceExit.terminalScope?.preset, 'device-local');
    assert.equal(deviceExit.terminalScope?.deviceId, a.deviceId, '设备限定终态携带归属设备');
  } finally {
    closeAll(a);
  }
});

// ---------------------------------------------------------------------------
// 第 2 节补测：项目链物理排除断言（push.ts buildEventsForChain，role === 'project'）
//
// 这条守卫在正常路径上不可达：routeJob 与 buildEventsForChain 都按记忆【当前】作用域
// 判定，同一时刻必然一致。守卫真正防的是「路由完成、构建事件之前作用域被改动」——
// pushClaimed 的结构正是两段之间只隔各链发布的 await。因此借 fake remote 的
// getManifest（个人链发布的首个 await）改一次 memory.scope_id，稳定复现串链。
// ---------------------------------------------------------------------------

/** 按给定顺序领取 outbox 任务：链的发布顺序由返回数组决定（先发的链先触发钩子）。 */
function claimedJobsFor(store: CairnStore, entityIds: string[]) {
  const claimed = store.outbox.claimReady(50);
  return entityIds.map((entityId) => {
    const job = claimed.find((j) => j.entityId === entityId);
    assert.ok(job, `应领取到记忆 ${entityId} 的上行任务`);
    return { id: job!.id, entityId: job!.entityId, payload: job!.payload, jobTypeHint: job!.jobType };
  });
}

/** 个人链发布期间（首个 await）执行一次钩子：模拟构建事件前的作用域改动。 */
class HookedRemote extends MemRemote {
  private fired = false;
  constructor(private readonly hook: () => void) {
    super();
  }
  override async getManifest(space: string, device: string): Promise<Uint8Array | null> {
    if (!this.fired && space === PERSONAL_SPACE_KEY) {
      this.fired = true;
      this.hook();
    }
    return super.getManifest(space, device);
  }
}

test('项目链守卫：路由后记忆改属项目 B → 零事件 + 审计 + 完成任务；同批合法项目记忆照常发布', async () => {
  const a = newDevice(false);
  try {
    const vault = vaultFor(a.keys);
    const projectA = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1';
    const projectB = 'b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1';
    const personal = a.service.addMemory({ content: '同批个人内容 GUARDORDER', kind: 'fact' });
    const bad = a.service.addMemory({
      content: '路由后改属别的项目 GUARDCROSS',
      kind: 'fact',
      scope: { preset: 'project-global', projectId: projectA, projectName: '守卫项目 A' },
    });
    const good = a.service.addMemory({
      content: '合法项目内容 GUARDGOOD',
      kind: 'fact',
      scope: { preset: 'project-global', projectId: projectA, projectName: '守卫项目 A' },
    });

    // 路由时 bad 属于项目 A；个人链发布期间把它指到项目 B 的作用域
    const scopeB = a.service.store.scopes.resolvePreset('project-global', { projectId: projectB, projectName: '守卫项目 B' });
    const jobs = claimedJobsFor(a.service.store, [personal.memory!.id, bad.memory!.id, good.memory!.id]);
    const hooked = new HookedRemote(() => {
      a.service.store.db.run('UPDATE memory SET scope_id = ? WHERE id = ?', scopeB.id, bad.memory!.id);
    });

    const r = await syncPush(a.service.store, hooked, vault, { preclaimedJobs: jobs });
    assert.ok(r);
    assert.equal(r!.unroutable, 1, '只有串链任务不可路由');

    const audits = a.service.auditList({ action: 'sync_job_unroutable' });
    assert.equal(audits.length, 1);
    assert.equal(audits[0]!.detail['reason'], 'memory_scope_not_project_chain:project-global');
    assert.equal(
      String(a.service.store.db.get('SELECT status FROM outbox_job WHERE id = ?', jobs[1]!.id)?.status),
      'done',
      '不可路由任务必须完成，不得滞留',
    );

    const chain = r!.chains.find((c) => c.spaceKey === projectSpaceKey(projectA));
    assert.equal(chain?.eventCount, 1, '本项目链只发布合法记忆那一条事件');
    assert.equal(chain?.jobs, 2);
    const events = readChainEvents(hooked, a, vault, projectSpaceKey(projectA));
    assert.equal(events.length, 1);
    assert.equal(events[0]!.memoryId, good.memory!.id);
    assert.equal(events.some((e) => e.memoryId === bad.memory!.id), false, '串链记忆不得出现在项目链上');
    assert.equal(r!.chains.find((c) => c.spaceKey === projectSpaceKey(projectB)), undefined, 'B 链无任务，不发布');
    assert.equal(r!.chains.find((c) => c.spaceKey === PERSONAL_SPACE_KEY)?.eventCount, 1, '前置：个人链先发布（钩子由此触发）');
  } finally {
    closeAll(a);
  }
});

test('项目链守卫：路由后记忆改成 device-local → 零事件 + 审计 + 完成任务，项目链不产生任何对象', async () => {
  const a = newDevice(false);
  try {
    const vault = vaultFor(a.keys);
    const projectId = 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1';
    const personal = a.service.addMemory({ content: '同批个人内容 GUARDORDER2', kind: 'fact' });
    const bad = a.service.addMemory({
      content: '路由后被改成设备限定 GUARDDEVICE',
      kind: 'fact',
      scope: { preset: 'project-global', projectId, projectName: '守卫项目 C' },
    });

    const deviceScope = a.service.store.scopes.resolvePreset('device-local', { deviceId: a.deviceId });
    const jobs = claimedJobsFor(a.service.store, [personal.memory!.id, bad.memory!.id]);
    const hooked = new HookedRemote(() => {
      a.service.store.db.run('UPDATE memory SET scope_id = ? WHERE id = ?', deviceScope.id, bad.memory!.id);
    });

    const r = await syncPush(a.service.store, hooked, vault, { preclaimedJobs: jobs });
    assert.ok(r);
    assert.equal(r!.unroutable, 1);

    const audits = a.service.auditList({ action: 'sync_job_unroutable' });
    assert.equal(audits.length, 1);
    assert.equal(audits[0]!.detail['reason'], 'memory_scope_not_project_chain:device-local');
    assert.equal(String(a.service.store.db.get('SELECT status FROM outbox_job WHERE id = ?', jobs[1]!.id)?.status), 'done');

    const chain = r!.chains.find((c) => c.spaceKey === projectSpaceKey(projectId));
    assert.equal(chain?.eventCount, 0);
    assert.equal(chain?.jobs, 1);
    assert.equal(hooked.objects.has(`project/${projectId}/devices/${a.deviceId}/manifest.json`), false, '零事件不得写 manifest');
    assert.deepEqual([...hooked.objects.keys()].filter((k) => k.startsWith(`project/${projectId}/`)), [], '项目链前缀下零对象');
    assert.equal(r!.chains.find((c) => c.spaceKey === PERSONAL_SPACE_KEY)?.eventCount, 1, '前置：个人链先发布（钩子由此触发）');
  } finally {
    closeAll(a);
  }
});

// ---------------------------------------------------------------------------
// 第 3 节：pull 自发现 + apply 物化 + 解除「不再持有」标记
// ---------------------------------------------------------------------------

function byContent(store: CairnStore, text: string) {
  const id = store.memories.findMemoryIdByRevisionHashes([contentHashOf(text)]);
  return id ? store.memories.get(id) : null;
}

function presetOf(store: CairnStore, memoryId: string): string | null {
  const row = store.db.get('SELECT s.preset AS p FROM memory m JOIN scope s ON s.id = m.scope_id WHERE m.id = ?', memoryId);
  return row ? String(row.p) : null;
}

function upsertEvent(memoryId: string, content: string, scope?: SyncScopeDescriptor, seq = 1): SyncEvent {
  const at = new Date().toISOString();
  return {
    deviceId: 'dev_peer',
    seq,
    type: 'memory_upsert',
    memoryId,
    occurredAt: at,
    payload: {
      revisionId: `r-${memoryId}-${seq}`,
      content,
      contentHash: contentHashOf(content),
      parentHash: null,
      kind: 'fact',
      authority: 'user_explicit',
      scopeId: scope?.preset ?? 'personal-global',
      sensitivity: 'normal',
      confidence: 1,
      observedAt: at,
      createdAt: at,
      expiresAt: null,
      sourceAgent: null,
      createdBy: 'peer',
      reason: null,
      ...(scope ? { scope } : {}),
    },
  };
}

function exitEvent(memoryId: string, content: string, seq = 2): SyncEvent {
  return {
    deviceId: 'dev_peer',
    seq,
    type: 'scope_exit',
    memoryId,
    occurredAt: new Date().toISOString(),
    payload: { lastContentHash: contentHashOf(content), knownHashes: [contentHashOf(content)] },
  };
}

test('pull 自发现项目链：本地无项目登记的新设备也能拉到项目内容并落在项目作用域（design D3）', async () => {
  const a = newDevice(false);
  const b = newDevice(false, a); // 同一 vault，本地零项目行
  try {
    const remote = new MemRemote();
    const projectId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const text = '冷启动项目内容 DISCOVERPROJECT';
    a.service.addMemory({ content: text, kind: 'fact', scope: { preset: 'project-global', projectId, projectName: '发现项目' } });
    await syncPush(a.service.store, remote, vaultFor(a.keys));

    assert.equal(b.service.store.db.all('SELECT id FROM project').length, 0, 'B 本地没有任何项目登记');
    const pulled = await syncPull(b.service.store, remote, vaultFor(b.keys));
    assert.ok(
      pulled.devices.some((d) => d.spaceKey === projectSpaceKey(projectId)),
      '通过列举 project/ 前缀发现链（本地状态不是唯一来源）',
    );

    const mem = byContent(b.service.store, text)!;
    assert.equal(mem.status, 'active');
    assert.equal(presetOf(b.service.store, mem.id), 'project-global', '落点是项目作用域，不是 personal-global');
    assert.equal(String(b.service.store.db.get('SELECT name FROM project WHERE id = ?', projectId)?.name), '发现项目');
    assert.equal(b.service.store.db.all('SELECT id FROM outbox_job').length, 0, '拉取不产生上行任务');
  } finally {
    closeAll(a, b);
  }
});

test('项目链列举失败：审计 project_chain_list_failed 并跳过，个人链不被阻断', async () => {
  const a = newDevice(false);
  const b = newDevice(false, a);
  try {
    const remote = new MemRemote();
    const text = '列举失败时仍应拉回的个人内容 LISTFAIL';
    a.service.addMemory({ content: text, kind: 'fact' });
    await syncPush(a.service.store, remote, vaultFor(a.keys));

    const flaky = new MemRemote();
    flaky.objects = remote.objects;
    flaky.list = async (prefix: string) => {
      if (prefix.startsWith('project/')) throw new Error('injected project list failure');
      return { keys: [...flaky.objects.keys()].filter((k) => k.startsWith(prefix)) };
    };

    const pulled = await syncPull(b.service.store, flaky, vaultFor(b.keys));
    assert.ok(pulled.devices.some((d) => d.spaceKey === PERSONAL_SPACE_KEY), '个人链照常拉取');
    assert.equal(byContent(b.service.store, text)?.status, 'active', '个人内容不得因项目链列举失败而丢失');
    assert.equal(b.service.store.db.all("SELECT id FROM audit_event WHERE action = 'project_chain_list_failed'").length, 1);
  } finally {
    closeAll(a, b);
  }
});

test('项目链 upsert 解除「不再持有」：恢复活动 + 落在项目作用域 + 清标记 + 审计 project_reheld', () => {
  const home = makeTestHome('cairn-project-reheld-');
  const store = openStore({ home });
  try {
    const text = '迁到项目的记忆 REHELD';
    const projectId = '99999999-9999-4999-8999-999999999999';
    assert.equal(applyEvent(store, upsertEvent('mem_reheld', text), PERSONAL_SPACE_KEY, store.audit), 'applied');
    const memId = byContent(store, text)!.id;
    assert.equal(applyEvent(store, exitEvent(memId, text), PERSONAL_SPACE_KEY, store.audit), 'scopeExited');
    assert.equal(store.memories.require(memId).status, 'archived', '前置：对端已标记不再持有');

    // 项目链上是迁移后的强制重发（内容未变）——必须先解除再判内容哈希
    const r = applyEvent(
      store,
      upsertEvent(memId, text, { preset: 'project-global', projectId, spaceName: '解除标记项目' }, 3),
      projectSpaceKey(projectId),
      store.audit,
    );
    assert.equal(r, 'skipped', '内容未变不新建修订');
    const mem = store.memories.require(memId);
    assert.equal(mem.status, 'active', '归档状态恢复为活动');
    assert.equal(presetOf(store, memId), 'project-global', '按描述符物化到项目作用域');
    assert.equal(store.db.get('SELECT value FROM meta WHERE key = ?', `scope_exit:${memId}`), undefined, '标记必须清除');
    assert.equal(store.db.all("SELECT id FROM audit_event WHERE action = 'project_reheld'").length, 1);
    assert.equal(String(store.db.get('SELECT name FROM project WHERE id = ?', projectId)?.name), '解除标记项目');
  } finally {
    store.close();
    cleanupTestHome(home);
  }
});

test('对照：标记存在时个人链普通 upsert 仍 shadowed（解除按链角色分流，逐字未动）', () => {
  const home = makeTestHome('cairn-project-shadowed-');
  const store = openStore({ home });
  try {
    const text = '个人链迟到修订对照 SHADOWED';
    assert.equal(applyEvent(store, upsertEvent('mem_shadow', text), PERSONAL_SPACE_KEY, store.audit), 'applied');
    const memId = byContent(store, text)!.id;
    assert.equal(applyEvent(store, exitEvent(memId, text), PERSONAL_SPACE_KEY, store.audit), 'scopeExited');

    const r = applyEvent(
      store,
      upsertEvent(memId, '个人链迟到修订对照（新内容）', undefined, 4),
      PERSONAL_SPACE_KEY,
      store.audit,
    );
    assert.equal(r, 'shadowed', '个人链普通 upsert 必须继续被标记挡住');
    assert.equal(store.memories.require(memId).status, 'archived', '不得被拉回活动');
    assert.notEqual(store.db.get('SELECT value FROM meta WHERE key = ?', `scope_exit:${memId}`), undefined, '标记不得被清除');
    assert.equal(store.db.all("SELECT id FROM audit_event WHERE action = 'upsert_shadowed_by_scope_exit'").length, 1);
  } finally {
    store.close();
    cleanupTestHome(home);
  }
});

test('项目链 upsert 命中本地历史修订：skipped 且不重复建行', () => {
  const home = makeTestHome('cairn-project-stale-');
  const store = openStore({ home });
  try {
    const v1 = '项目修订 v1 STALEPROJECT';
    assert.equal(applyEvent(store, upsertEvent('mem_stale', v1), PERSONAL_SPACE_KEY, store.audit), 'applied');
    const memId = byContent(store, v1)!.id;
    store.memories.revise(memId, '项目修订 v2（本地更正）', { reason: '本地更正', author: 'cli' }, store.identity.deviceId);
    const revisionsBefore = store.db.all('SELECT id FROM memory WHERE id = ?', memId).length;

    const projectId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const r = applyEvent(
      store,
      upsertEvent(memId, v1, { preset: 'project-global', projectId, spaceName: '陈旧修订项目' }, 5),
      projectSpaceKey(projectId),
      store.audit,
    );
    assert.equal(r, 'skipped', '已并入本地历史的修订不重复应用');
    assert.equal(store.db.all('SELECT id FROM memory').length, 1, '不得重复建行');
    assert.equal(store.db.all('SELECT id FROM memory WHERE id = ?', memId).length, revisionsBefore);
    assert.equal(store.memories.require(memId).content, '项目修订 v2（本地更正）', '当前修订不被陈旧事件覆盖');
  } finally {
    store.close();
    cleanupTestHome(home);
  }
});

test('项目链事件描述符缺 projectId：skip + 审计 project_scope_not_materialized', () => {
  const home = makeTestHome('cairn-project-noid-');
  const store = openStore({ home });
  try {
    const text = '无项目身份的项目链内容';
    const r = applyEvent(store, upsertEvent('mem_noid', text, { preset: 'project-global' }), 'project/orphan', store.audit);
    assert.equal(r, 'shadowed');
    assert.equal(byContent(store, text), null, '无法确定项目作用域就不落地');
    assert.equal(store.db.all("SELECT id FROM audit_event WHERE action = 'project_scope_not_materialized'").length, 1);
  } finally {
    store.close();
    cleanupTestHome(home);
  }
});

// ---------------------------------------------------------------------------
// 第 4 节：终态作用域（meta 键 terminal_scope:<memoryId>，不加列、不改 schema）
// ---------------------------------------------------------------------------

function exitEventWithTerminal(memoryId: string, content: string, terminalScope: SyncScopeDescriptor, seq = 2): SyncEvent {
  return {
    deviceId: 'dev_peer',
    seq,
    type: 'scope_exit',
    memoryId,
    occurredAt: new Date().toISOString(),
    payload: { lastContentHash: contentHashOf(content), knownHashes: [contentHashOf(content)], terminalScope },
  };
}

function terminalScopeOf(store: CairnStore, memoryId: string): SyncScopeDescriptor | null {
  const row = store.db.get('SELECT value FROM meta WHERE key = ?', `terminal_scope:${memoryId}`);
  return row == null ? null : (JSON.parse(String(row['value'])) as SyncScopeDescriptor);
}

test('终态作用域三态：项目 / 设备限定写入 canonical JSON，旧事件缺省不写', () => {
  const home = makeTestHome('cairn-terminal-scope-');
  const store = openStore({ home });
  try {
    const projectId = 'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0';
    const projectTerminal: SyncScopeDescriptor = { preset: 'project-global', projectId, spaceName: '终态项目' };
    assert.equal(applyEvent(store, upsertEvent('mem_term_proj', '迁往项目 TERMPROJ'), PERSONAL_SPACE_KEY, store.audit), 'applied');
    const projId = byContent(store, '迁往项目 TERMPROJ')!.id;
    assert.equal(applyEvent(store, exitEventWithTerminal(projId, '迁往项目 TERMPROJ', projectTerminal), PERSONAL_SPACE_KEY, store.audit), 'scopeExited');
    const raw = store.db.get('SELECT value FROM meta WHERE key = ?', `terminal_scope:${projId}`)!['value'];
    assert.equal(String(raw), canonicalJson(projectTerminal), 'canonical JSON（键序稳定）');
    assert.deepEqual(terminalScopeOf(store, projId), projectTerminal);
    assert.equal(store.memories.require(projId).status, 'archived');
    assert.equal(presetOf(store, projId), 'personal-global', '终态只用于展示，不迁移本地作用域');

    const deviceTerminal: SyncScopeDescriptor = { preset: 'device-local', deviceId: 'dev_owner_9' };
    assert.equal(applyEvent(store, upsertEvent('mem_term_dev', '迁往设备 TERMDEV'), PERSONAL_SPACE_KEY, store.audit), 'applied');
    const devId = byContent(store, '迁往设备 TERMDEV')!.id;
    assert.equal(applyEvent(store, exitEventWithTerminal(devId, '迁往设备 TERMDEV', deviceTerminal), PERSONAL_SPACE_KEY, store.audit), 'scopeExited');
    assert.deepEqual(terminalScopeOf(store, devId), deviceTerminal);
    assert.equal(terminalScopeOf(store, devId)!.deviceId, 'dev_owner_9', '设备限定终态带归属设备');

    // 旧版本事件（无 terminalScope）：仍标记不再持有，终态留空 = 未知
    assert.equal(applyEvent(store, upsertEvent('mem_term_old', '旧事件 TERMOLD'), PERSONAL_SPACE_KEY, store.audit), 'applied');
    const oldId = byContent(store, '旧事件 TERMOLD')!.id;
    assert.equal(applyEvent(store, exitEvent(oldId, '旧事件 TERMOLD'), PERSONAL_SPACE_KEY, store.audit), 'scopeExited');
    assert.equal(store.memories.require(oldId).status, 'archived');
    assert.equal(terminalScopeOf(store, oldId), null, '缺省不写（展示为未知）');
  } finally {
    store.close();
    cleanupTestHome(home);
  }
});

test('终态作用域随遗忘与重新持有清理（不留下过期展示信息）', () => {
  const home = makeTestHome('cairn-terminal-cleanup-');
  const store = openStore({ home });
  try {
    const projectId = 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1';
    const terminal: SyncScopeDescriptor = { preset: 'project-global', projectId, spaceName: '清理项目' };

    // 遗忘：墓碑 + 终态一并清理
    assert.equal(applyEvent(store, upsertEvent('mem_term_forget', '终态后遗忘 TERMFORGET'), PERSONAL_SPACE_KEY, store.audit), 'applied');
    const forgetId = byContent(store, '终态后遗忘 TERMFORGET')!.id;
    applyEvent(store, exitEventWithTerminal(forgetId, '终态后遗忘 TERMFORGET', terminal), PERSONAL_SPACE_KEY, store.audit);
    assert.ok(terminalScopeOf(store, forgetId), '前置：终态已写入');
    store.memories.forget(forgetId, '测试遗忘', 'cli');
    assert.equal(terminalScopeOf(store, forgetId), null, '遗忘后终态删除');

    // 重新持有（项目链解除标记）：恢复活动，终态不再成立
    assert.equal(applyEvent(store, upsertEvent('mem_term_reheld', '终态后迁回 TERMREHELD'), PERSONAL_SPACE_KEY, store.audit), 'applied');
    const reheldId = byContent(store, '终态后迁回 TERMREHELD')!.id;
    applyEvent(store, exitEventWithTerminal(reheldId, '终态后迁回 TERMREHELD', terminal), PERSONAL_SPACE_KEY, store.audit);
    assert.ok(terminalScopeOf(store, reheldId));
    const r = applyEvent(
      store,
      upsertEvent(reheldId, '终态后迁回 TERMREHELD', { preset: 'project-global', projectId, spaceName: '清理项目' }, 3),
      projectSpaceKey(projectId),
      store.audit,
    );
    assert.equal(r, 'skipped');
    assert.equal(store.memories.require(reheldId).status, 'active');
    assert.equal(terminalScopeOf(store, reheldId), null, '重新持有后终态清除');
  } finally {
    store.close();
    cleanupTestHome(home);
  }
});

// ---------------------------------------------------------------------------
// 对端真机形状（2026-11-16）：接收方副本不是上行缺口 / 解除标记计入 revived
// ---------------------------------------------------------------------------

test('B 从项目链拉下的副本不是上行缺口：origin_device_id 是发布方（真机 upstreamGap=27）', async () => {
  const a = newDevice(false);
  const b = newDevice(false, a);
  try {
    const remote = new MemRemote();
    const projectId = '19191919-1919-4919-8919-191919191911';
    const text = '对端拉取的项目内容 GAPRECEIVE';
    a.service.addMemory({ content: text, kind: 'fact', scope: { preset: 'project-global', projectId, projectName: '缺口接收项目' } });
    await syncPush(a.service.store, remote, vaultFor(a.keys));
    const pulled = await syncPull(b.service.store, remote, vaultFor(b.keys));
    assert.ok(pulled.totalApplied >= 1, '前置：B 确实拉到了这条记忆');

    const mem = byContent(b.service.store, text)!;
    assert.equal(
      String(b.service.store.db.get('SELECT origin_device_id FROM memory WHERE id = ?', mem.id)?.origin_device_id),
      a.deviceId,
      '前置：落地时归属设备记为事件来源设备',
    );
    assert.deepEqual(findUpstreamGap(b.service.store), [], '接收方三条链都无缺口（修复前 project 段恒为 1，自身永不消解）');
    assert.deepEqual(findScopeExitGap(b.service.store), [], '迁出通知段同样不误判：接收副本没有个人链推送证据');

    await syncPull(b.service.store, remote, vaultFor(b.keys));
    assert.deepEqual(findUpstreamGap(b.service.store), [], '重复拉取不新增缺口');
    assert.equal(b.service.store.db.all('SELECT id FROM outbox_job').length, 0, '拉取仍不产生上行任务');
  } finally {
    closeAll(a, b);
  }
});

test('outcome.revived：解除「不再持有」计入 revived，同一次事件仍计入 skipped', () => {
  const home = makeTestHome('cairn-project-revived-');
  const store = openStore({ home });
  try {
    const text = '解除标记计数 REVIVEDCOUNT';
    const projectId = '19191919-1919-4919-8919-191919191912';
    assert.equal(applyEvent(store, upsertEvent('mem_revived', text), PERSONAL_SPACE_KEY, store.audit), 'applied');
    const memId = byContent(store, text)!.id;
    assert.equal(applyEvent(store, exitEvent(memId, text), PERSONAL_SPACE_KEY, store.audit), 'scopeExited');
    assert.equal(store.memories.require(memId).status, 'archived', '前置：已标记不再持有');

    const { outcome } = applyEvents(
      store,
      [upsertEvent(memId, text, { preset: 'project-global', projectId, spaceName: '计数项目' }, 3)],
      projectSpaceKey(projectId),
    );
    assert.equal(outcome.revived, 1, '本次解除标记并恢复活动 1 条');
    assert.equal(outcome.skipped, 1, '既有语义不变：内容未变仍计入 skipped');
    assert.equal(outcome.applied, 0);
    assert.equal(store.memories.require(memId).status, 'active');
  } finally {
    store.close();
    cleanupTestHome(home);
  }
});

function originOf(store: CairnStore, memoryId: string): string | null {
  const row = store.db.get('SELECT origin_device_id AS d FROM memory WHERE id = ?', memoryId);
  return row == null || row.d == null ? null : String(row.d);
}

test('revive 回填：恢复活动的副本 origin 未知 → 记为事件发布方（真机 24 条同形）', () => {
  const home = makeTestHome('cairn-revive-origin-');
  const store = openStore({ home });
  try {
    const text = '被 revive 的副本 REVIVEORIGIN';
    const projectId = '20202020-2020-4020-8020-202020202021';
    assert.equal(applyEvent(store, upsertEvent('mem_revive_origin', text), PERSONAL_SPACE_KEY, store.audit), 'applied');
    const memId = byContent(store, text)!.id;
    // 真机形状：revive 过的副本 origin 缺失（旧代码从不回填）
    store.db.run('UPDATE memory SET origin_device_id = NULL WHERE id = ?', memId);
    assert.equal(applyEvent(store, exitEvent(memId, text), PERSONAL_SPACE_KEY, store.audit), 'scopeExited');
    assert.equal(originOf(store, memId), null, '前置：归属未知');

    assert.equal(
      applyEvent(store, upsertEvent(memId, text, { preset: 'project-global', projectId, spaceName: '回填项目' }, 3), projectSpaceKey(projectId), store.audit),
      'skipped',
      '内容未变仍走 revive 路径（先解除再判哈希）',
    );
    assert.equal(store.memories.require(memId).status, 'active');
    assert.equal(originOf(store, memId), 'dev_peer', 'revive 时回填事件发布方（修复前恒为 NULL）');
  } finally {
    store.close();
    cleanupTestHome(home);
  }
});

test('revive 不覆盖：origin 已有值 A，收到来自 B 的 upsert 后仍是 A', () => {
  const home = makeTestHome('cairn-revive-origin-keep-');
  const store = openStore({ home });
  try {
    const text = '归属已定的副本 REVIVEKEEP';
    const projectId = '20202020-2020-4020-8020-202020202022';
    assert.equal(applyEvent(store, upsertEvent('mem_revive_keep', text), PERSONAL_SPACE_KEY, store.audit), 'applied');
    const memId = byContent(store, text)!.id;
    store.db.run("UPDATE memory SET origin_device_id = 'dev_owner_a' WHERE id = ?", memId);
    assert.equal(applyEvent(store, exitEvent(memId, text), PERSONAL_SPACE_KEY, store.audit), 'scopeExited');

    const fromB = { ...upsertEvent(memId, text, { preset: 'project-global', projectId, spaceName: '不覆盖项目' }, 3), deviceId: 'dev_peer_b' };
    assert.equal(applyEvent(store, fromB, projectSpaceKey(projectId), store.audit), 'skipped');
    assert.equal(store.memories.require(memId).status, 'active');
    assert.equal(originOf(store, memId), 'dev_owner_a', '归属是溯源事实，一经写入不改写');
  } finally {
    store.close();
    cleanupTestHome(home);
  }
});
