import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RemoteStore } from '../../src/jobs/remote.js';
import { generateVaultKeys, exportRecoveryMaterial, importRecoveryMaterial, saveKeys } from '../../src/sync/cryptoutil.js';
import { VaultConfig, loadVaultConfig, updateVaultConfig, preserveSpaceKey, projectSpaceKey, syncableChains, isPreserveSpaceKey } from '../../src/sync/vault.js';
import { syncPush, syncPull } from '../../src/sync/orchestrate.js';
import { applyEvent } from '../../src/sync/apply.js';
import { enqueueMemorySync } from '../../src/sync/route.js';
import type { SyncScopeDescriptor } from '../../src/sync/events.js';
import { findUpstreamGap, backfillUpstream } from '../../src/sync/backfill.js';
import { AppService } from '../../src/interfaces/app-service.js';
import { openStore, CairnStore } from '../../src/store/open.js';
import { contentHash as contentHashOf } from '../../src/core/hash.js';
import { makeTestHome, cleanupTestHome } from '../helpers.js';

/**
 * 保管模式（add-cloud-preserve-mode）：双模语义、迁出完整性、保管链路由、
 * 物化过滤、backfill 多链、设备找回。全部走真实 AppService → outbox → push/pull 链路
 * （fake backend：内存对象存储，不触网）。
 *
 * 身份纪律：记忆 id 在各设备本地生成、不可跨设备引用——断言一律按内容哈希血统查找。
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

  /** 保管链专查：某链的 manifest 是否存在。 */
  hasManifest(space: string, device: string): boolean {
    return this.objects.has(`${space}/devices/${device}/manifest.json`);
  }

  /** 全部对象字节中是否出现明文片段（密文 + gzip 后不应出现）。 */
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

function newDevice(source?: Device, preserve = false): Device {
  const home = makeTestHome('cairn-preserve-');
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

/** 跨设备身份对齐：按正文内容哈希找本地记忆（id 各设备不同）。 */
function byContent(store: CairnStore, text: string) {
  const id = store.memories.findMemoryIdByRevisionHashes([contentHashOf(text)]);
  return id ? store.memories.get(id) : null;
}

function scopePresetOf(store: CairnStore, memoryId: string): string | null {
  const row = store.db.get('SELECT s.preset AS p FROM memory m JOIN scope s ON s.id = m.scope_id WHERE m.id = ?', memoryId);
  return row ? String(row.p) : null;
}

test('模式开关：vault config 切换 + vaultStatus/doctor/status 如实呈现（默认关闭）', () => {
  const a = newDevice();
  try {
    const dataDir = `${a.home.replace(/\\/g, '/')}/data`;
    assert.equal(loadVaultConfig(dataDir)?.preserveDeviceBound, undefined, '缺省关闭（键不落盘）');
    assert.equal((a.service.vaultStatus() as { preserveDeviceBound: boolean }).preserveDeviceBound, false);
    assert.deepEqual(syncableChains(loadVaultConfig(dataDir)!, a.deviceId), ['personal-global']);

    const r = a.service.vaultConfigPreserve(true);
    assert.equal(r.preserveDeviceBound, true);
    assert.equal((a.service.vaultStatus() as { preserveDeviceBound: boolean }).preserveDeviceBound, true);
    assert.deepEqual(syncableChains(loadVaultConfig(dataDir)!, a.deviceId), ['personal-global', preserveSpaceKey(a.deviceId)]);

    const doctor = a.service.doctor();
    assert.equal(doctor.sync.preserveDeviceBound, true);
    assert.deepEqual(doctor.sync.chains.map((c) => c.role), ['personal', 'preserve']);
    assert.equal(doctor.sync.chains[1]!.spaceKey, preserveSpaceKey(a.deviceId));

    const st = a.service.status() as { sync: { preserveDeviceBound: boolean; chains: Record<string, unknown> } };
    assert.equal(st.sync.preserveDeviceBound, true);
    assert.ok(st.sync.chains[preserveSpaceKey(a.deviceId)]);

    a.service.vaultConfigPreserve(false);
    assert.equal((a.service.vaultStatus() as { preserveDeviceBound: boolean }).preserveDeviceBound, false);
    assert.equal(a.service.doctor().sync.chains.length, 1);
    const audits = a.service.auditList({ action: 'preserve_mode_changed' });
    assert.equal(audits.length, 2, '模式切换落审计');
  } finally {
    closeAll(a);
  }
});

test('迁出完整性（模式无关）：离开个人链必入队 scope_exit 且固化 fromSpace', async () => {
  const a = newDevice();
  try {
    const remote = new MemRemote();
    const vault = vaultFor(a.keys);
    const added = a.service.addMemory({ content: '会被迁移的个人记忆', kind: 'fact' });
    const id = added.memory!.id;
    await syncPush(a.service.store, remote, vault); // 建立 sync_pushed 标记

    // 迁往项目作用域（「可上行」目的地也必须发迁出通知——D4 核心修复）
    const r1 = a.service.rescopeMemory(id, { scopePreset: 'project-global', projectId: '11111111-1111-4111-8111-111111111111', projectName: 'p1', force: true });
    assert.equal(r1.scopeExitEnqueued, true);
    const exitRow = a.service.store.db.get(
      "SELECT payload FROM outbox_job WHERE job_type = 'sync_scope_exit' AND entity_id = ? ORDER BY created_at DESC LIMIT 1",
      id,
    );
    assert.ok(exitRow != null, '迁出任务必须存在');
    assert.equal(JSON.parse(String(exitRow.payload)).fromSpace, 'personal-global', 'fromSpace 必须在入队时固化');

    // 保管链内部的迁移（project → device-local）不再发个人链迁出：记忆已不在个人链
    await syncPush(a.service.store, remote, vault);
    const r2 = a.service.rescopeMemory(id, { scopePreset: 'device-local', force: true });
    assert.equal(r2.scopeExitEnqueued, false, '个人链之外的内迁不重复通知');
    assert.equal(
      a.service.store.db.all("SELECT id FROM outbox_job WHERE job_type = 'sync_scope_exit' AND entity_id = ?", id).length,
      1,
    );

    // 迁回个人链（对端重新持有）后再迁出：重新武装，第二轮迁出照发
    await syncPush(a.service.store, remote, vault);
    const back = a.service.rescopeMemory(id, { scopePreset: 'personal-global', force: true });
    assert.equal(back.scopeExitEnqueued, false, '迁回不发迁出');
    await syncPush(a.service.store, remote, vault);
    const r3 = a.service.rescopeMemory(id, { scopePreset: 'device-local', force: true });
    assert.equal(r3.scopeExitEnqueued, true, '迁回后的再迁出必须再次通知');
    assert.equal(
      a.service.store.db.all("SELECT id FROM outbox_job WHERE job_type = 'sync_scope_exit' AND entity_id = ?", id).length,
      2,
      '迁出→迁回→再迁出的每一轮各一条通知（时间戳幂等键，不互相顶掉）',
    );
  } finally {
    closeAll(a);
  }
});

test('关闭模式：设备限定与 project-device 不入队；项目内容仍上项目链；缺项目身份的孤儿任务不可路由（消灭静默完成）', async () => {
  const a = newDevice(); // 未开启保管模式
  try {
    const remote = new MemRemote();
    const vault = vaultFor(a.keys);
    const projectId = '22222222-2222-4222-8222-222222222222';

    // device-local / project-device 写入：关闭模式下 outbox 无任何行
    const dl = a.service.addMemory({ content: '仅本机的口令提示', kind: 'fact', scope: { preset: 'device-local' } });
    assert.equal(a.service.store.db.all('SELECT id FROM outbox_job WHERE entity_id = ?', dl.memory!.id).length, 0);
    const pd = a.service.addMemory({
      content: '项目设备限定的本机内容',
      kind: 'fact',
      scope: { preset: 'project-device', projectId, projectName: 'p2' },
    });
    assert.equal(a.service.store.db.all('SELECT id FROM outbox_job WHERE entity_id = ?', pd.memory!.id).length, 0, '关闭模式 project-device 不可路由：零任务');

    // project-global 写入：与保管模式无关，仍上项目链（本变更的新语义）
    const pg = a.service.addMemory({
      content: '项目内容 OFF 时代上项目链',
      kind: 'fact',
      scope: { preset: 'project-global', projectId, projectName: 'p2' },
    });
    const r = await syncPush(a.service.store, remote, vault);
    assert.ok(r);
    assert.equal(r!.unroutable, 0, '项目内容可路由（不再是静默完成的黑任务）');
    assert.equal(
      a.service.store.db.get("SELECT status FROM outbox_job WHERE entity_id = ? AND job_type = 'sync_upstream'", pg.memory!.id)?.status,
      'done',
    );
    assert.equal(r!.chains.find((c) => c.spaceKey === projectSpaceKey(projectId))?.eventCount, 1, '关闭模式下项目内容仍上项目链');
    assert.equal(r!.chains.some((c) => isPreserveSpaceKey(c.spaceKey)), false, 'OFF 模式无保管链发布');

    // 缺 projectId 的 project-global（历史/异常行形态）：保留入队，但 push 侧不可路由 →
    // 完成 + 审计 + 零远端事件。原用例的「消灭静默完成」覆盖保留在这个形态上。
    const spaceId = a.service.store.scopes.requireById(pg.memory!.scopeId).spaceId;
    const orphanScopeId = 'scp_orphan_project_global_off';
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
    enqueueMemorySync(a.service.store, { memoryId: orphan.id, scopeId: orphanScopeId, op: 'memory_upsert', idempotencyKey: 'orphan-off' });
    const before = remote.objects.size;
    const r2 = await syncPush(a.service.store, remote, vault);
    assert.ok(r2);
    assert.equal(r2!.unroutable >= 1, true, '不可路由任务必须计数');
    assert.equal(
      a.service.store.db.get("SELECT status FROM outbox_job WHERE entity_id = ? AND job_type = 'sync_upstream'", orphan.id)?.status,
      'done',
      '不可路由任务必须完成（不是永远 pending）',
    );
    assert.equal(a.service.store.db.all("SELECT id FROM audit_event WHERE action = 'sync_job_unroutable'").length >= 1, true);
    assert.equal(remote.objects.size, before, '不可路由任务不得产生远端对象');
  } finally {
    closeAll(a);
  }
});

test('开启模式：设备限定内容密文上云到本设备保管链，事件带归属设备与作用域描述符', async () => {
  const a = newDevice(undefined, true);
  try {
    const remote = new MemRemote();
    const vault = vaultFor(a.keys, true);
    const dl = a.service.addMemory({ content: '保管模式下的本机笔记 XYZQMNR', kind: 'fact', scope: { preset: 'device-local' } });
    const id = dl.memory!.id;

    const job = a.service.store.db.get('SELECT job_type FROM outbox_job WHERE entity_id = ?', id);
    assert.equal(job?.job_type, 'sync_preserve', '开启保管模式后设备限定内容经 sync_preserve 入队');

    const r = await syncPush(a.service.store, remote, vault);
    assert.ok(r);
    const preserveKey = preserveSpaceKey(a.deviceId);
    const chain = r!.chains.find((c) => c.spaceKey === preserveKey);
    assert.ok(chain, 'push 结果按链分列且含保管链');
    assert.ok(chain!.eventCount >= 1);
    assert.ok(remote.hasManifest(preserveKey, a.deviceId), '保管链 manifest 已发布');
    assert.equal(remote.containsPlaintext('XYZQMNR'), false, '明文不出现在任何云端对象');

    // pull 自己的保管链（找回路径的单设备形态）
    const pulled = await syncPull(a.service.store, remote, vault);
    const preservePull = pulled.devices.find((d) => isPreserveSpaceKey(d.spaceKey));
    assert.ok(preservePull, 'pull 范围包含本设备保管链');
    assert.equal(a.service.store.memories.get(id)!.content.includes('XYZQMNR'), true);
  } finally {
    closeAll(a);
  }
});

test('他人保管链不拉取：B 的 pull 不下载 A 的保管链对象', async () => {
  const a = newDevice(undefined, true);
  const b = newDevice(a, false);
  try {
    const remote = new MemRemote();
    await a.service.addMemory({ content: 'A 的本机内容 OTHERSCHAIN', kind: 'fact', scope: { preset: 'device-local' } });
    await syncPush(a.service.store, remote, vaultFor(a.keys, true));
    const objectsBefore = remote.objects.size;

    const pulled = await syncPull(b.service.store, remote, vaultFor(b.keys, false));
    assert.equal(remote.objects.size, objectsBefore, 'B 未下载任何新对象');
    assert.equal(pulled.devices.some((d) => isPreserveSpaceKey(d.spaceKey)), false, 'B 的 pull 范围不含保管链');
    assert.equal(byContent(b.service.store, 'A 的本机内容 OTHERSCHAIN'), null, 'A 的保管链内容不在 B 落地');
  } finally {
    closeAll(a, b);
  }
});

test('双设备全场景：迁移 27 条 → push → B 收迁出通知 → A 重建数据目录 pull 找回', async () => {
  const a = newDevice(undefined, false);
  const b = newDevice(a, false); // B 与 A 同 vault；B 保持关闭（0.6.x 语义）
  try {
    const remote = new MemRemote();
    updateVaultConfig(`${a.home.replace(/\\/g, '/')}/data`, { preserveDeviceBound: true });

    const personalText = '始终在个人链的记忆 KEEPME';
    a.service.addMemory({ content: personalText, kind: 'fact' });
    const migratedTexts: string[] = [];
    for (let i = 0; i < 27; i++) {
      migratedTexts.push(`项目记忆第 ${i} 条 MIGRATE${i}`);
      a.service.addMemory({ content: migratedTexts[i]!, kind: 'fact' });
    }
    const localText = 'A 的本机限定 RECOVERME';
    a.service.addMemory({ content: localText, kind: 'fact', scope: { preset: 'device-local' } });
    await syncPush(a.service.store, remote, vaultFor(a.keys, true));

    // B 拉到 28 条个人内容（B 的本地 id 与 A 不同）
    await syncPull(b.service.store, remote, vaultFor(b.keys, false));
    for (const t of migratedTexts) assert.ok(byContent(b.service.store, t), 'B 已持有（按内容血统对齐）');
    assert.equal(
      b.service.store.db.all("SELECT id FROM outbox_job WHERE job_type IN ('sync_upstream','sync_preserve','sync_scope_exit')").length,
      0,
      '拉取不产生上行任务',
    );

    // A 迁移 27 条到项目作用域并 push：个人链 scope_exit ×27 + 项目链 upsert ×27
    const projectId = '33333333-3333-4333-8333-333333333333';
    for (const t of migratedTexts) {
      const mem = byContent(a.service.store, t)!;
      a.service.rescopeMemory(mem.id, { scopePreset: 'project-global', projectId, projectName: 'migration-test', force: true });
    }
    const push2 = await syncPush(a.service.store, remote, vaultFor(a.keys, true));
    assert.ok(push2);
    const projectChain = push2!.chains.find((c) => c.role === 'project');
    assert.ok(projectChain && projectChain.eventCount >= 27, `项目链应承载 27 条项目内容（实际 ${projectChain?.eventCount ?? 0}）`);
    assert.equal(push2!.chains.some((c) => isPreserveSpaceKey(c.spaceKey)), false, '项目内容不再进保管链');

    // B 拉取：个人链迁出先标记「不再持有」，项目链 upsert 随即解除并落在项目作用域
    const pulledB = await syncPull(b.service.store, remote, vaultFor(b.keys, false));
    assert.ok(pulledB.devices.some((d) => d.spaceKey === projectSpaceKey(projectId)), 'B 通过 project/ 前缀发现项目链');
    for (const t of migratedTexts) {
      const mem = byContent(b.service.store, t)!;
      assert.equal(mem.status, 'active', '项目链 upsert 解除「不再持有」');
      assert.equal(scopePresetOf(b.service.store, mem.id), 'project-global', '落点是项目作用域');
      assert.equal(b.service.store.db.get('SELECT value FROM meta WHERE key = ?', `scope_exit:${mem.id}`), undefined, '标记已清除');
      assert.equal(b.service.store.memories.getTombstone(mem.id), null, '迁出不是遗忘：无墓碑');
    }
    assert.equal(byContent(b.service.store, localText), null, '设备限定内容不在 B 落地');
    assert.equal(byContent(b.service.store, personalText)?.status, 'active', '个人链那条不受影响');

    // 密文核查：全对象无明文
    assert.equal(remote.containsPlaintext('MIGRATE0'), false);
    assert.equal(remote.containsPlaintext('RECOVERME'), false);
    assert.equal(remote.containsPlaintext('KEEPME'), false);

    // A 重建数据目录（deviceId 不变）：删库重开 + pull 找回
    a.service.close();
    const dataDir = join(a.home, 'data');
    for (const f of ['cairn.db', 'cairn.db-wal', 'cairn.db-shm']) rmSync(join(dataDir, f), { force: true });
    assert.equal(existsSync(join(dataDir, 'device.json')), true, '设备身份保留（找回的前提）');
    const service2 = AppService.open(a.home);
    try {
      assert.equal(service2.store.identity.deviceId, a.deviceId, 'deviceId 不变');
      // 重建后 pull：个人链 + 项目链 + 保管链全量重放（无游标）
      const pulled = await syncPull(service2.store, remote, loadVaultConfig(dataDir)!);
      assert.ok(pulled.devices.some((d) => d.spaceKey === projectSpaceKey(projectId)), '项目链也被发现并拉取');
      const total = pulled.devices.reduce((n, d) => n + d.appliedBefore, 0);
      assert.ok(
        total >= 55,
        `个人链（28 upsert + 27 迁出）+ 保管链（1 条设备限定；项目链重放命中本地历史修订不计 applied）恢复（实际 ${total}）`,
      );

      const keep = byContent(service2.store, personalText)!;
      assert.equal(keep.status, 'active', '个人链内容找回');
      assert.equal(keep.originDeviceId, a.deviceId, '归属设备 = 事件来源设备（本机重建场景）');

      const m0 = byContent(service2.store, migratedTexts[0]!)!;
      assert.equal(m0.status, 'active', '保管链重放解除「不再持有」');
      assert.equal(scopePresetOf(service2.store, m0.id), 'project-global', '按描述符物化到项目作用域');
      assert.ok(service2.store.db.get('SELECT id FROM project WHERE id = ?', projectId), '项目行随物化 find-or-create');
      assert.equal(String(service2.store.db.get('SELECT name FROM project WHERE id = ?', projectId)?.name), 'migration-test');

      const rec = byContent(service2.store, localText)!;
      assert.equal(rec.status, 'active', '设备限定内容找回');
      assert.equal(scopePresetOf(service2.store, rec.id), 'device-local');
      assert.equal(rec.originDeviceId, a.deviceId);
    } finally {
      service2.close();
    }
  } finally {
    closeAll(b);
    cleanupTestHome(a.home);
  }
});

test('apply 物化过滤：个人链/描述符缺失/不可物化描述符三态 + 归属设备记录', () => {
  const home = makeTestHome('cairn-mat-');
  const store = openStore({ home });
  try {
    const at = new Date().toISOString();
    const upsert = (memoryId: string, content: string, scope: SyncScopeDescriptor | undefined): Parameters<typeof applyEvent>[1] => ({
      deviceId: 'dev_other',
      seq: 1,
      type: 'memory_upsert',
      memoryId,
      occurredAt: at,
      payload: { revisionId: `r-${memoryId}`, content, contentHash: contentHashOf(content), parentHash: null, kind: 'fact', authority: 'user_explicit', scopeId: 'x', sensitivity: 'normal', confidence: 1, observedAt: at, createdAt: at, expiresAt: null, sourceAgent: null, createdBy: 'x', reason: null, ...(scope ? { scope } : {}) },
    });

    // 个人链事件 → personal-global（现状不变，旧事件无描述符同样走这条）
    const r1 = applyEvent(store, upsert('mm1', '个人链内容', undefined), 'personal-global', store.audit);
    assert.equal(r1, 'applied');
    const m1 = byContent(store, '个人链内容')!;
    assert.equal(m1.originDeviceId, 'dev_other', '归属设备记录事件来源设备');
    assert.equal(scopePresetOf(store, m1.id), 'personal-global');

    // 保管链事件 + project 描述符 → 项目作用域（项目行 find-or-create）
    const r2 = applyEvent(
      store,
      upsert('mm2', '保管链项目内容', { preset: 'project-global', projectId: '44444444-4444-4444-8444-444444444444', spaceName: '物化测试' }),
      'preserve/dev_self',
      store.audit,
    );
    assert.equal(r2, 'applied');
    const m2 = byContent(store, '保管链项目内容')!;
    assert.equal(scopePresetOf(store, m2.id), 'project-global');
    assert.equal(String(store.db.get('SELECT name FROM project WHERE id = ?', '44444444-4444-4444-8444-444444444444')?.name), '物化测试');

    // 保管链事件缺描述符（防御路径）→ device-local
    const r3 = applyEvent(store, upsert('mm3', '无描述符的保管链事件', undefined), 'preserve/dev_self', store.audit);
    assert.equal(r3, 'applied');
    assert.equal(scopePresetOf(store, byContent(store, '无描述符的保管链事件')!.id), 'device-local');

    // 保管链事件描述符为 agent-private → 永不物化
    const r4 = applyEvent(store, upsert('mm4', '不该落地的私有内容', { preset: 'agent-private' }), 'preserve/dev_self', store.audit);
    assert.equal(r4, 'shadowed');
    assert.equal(byContent(store, '不该落地的私有内容'), null, 'agent-private 描述符不落地');
  } finally {
    store.close();
    cleanupTestHome(home);
  }
});

test('backfill 多链：关闭模式非个人全局不进候选；开启模式保管链缺口补齐且幂等', () => {
  const a = newDevice();
  try {
    const dataDir = `${a.home.replace(/\\/g, '/')}/data`;
    const projectScope = a.service.resolveScope({ preset: 'project-global', projectId: '55555555-5555-4555-8555-555555555555', projectName: 'bf' });
    const deviceScope = a.service.resolveScope({ preset: 'device-local' });
    const store = a.service.store;
    const pg = store.memories.add({ kind: 'fact', content: '直写的项目内容', scopeId: projectScope.id, authority: 'user_explicit', createdBy: 'cli' }, a.deviceId);
    const dl = store.memories.add({ kind: 'fact', content: '直写的本机内容', scopeId: deviceScope.id, authority: 'user_explicit', createdBy: 'cli' }, a.deviceId);

    // 关闭模式：两条都不进候选（spec「被排除内容不计入缺口」）
    const off = backfillUpstream(store, { apply: false });
    assert.equal(off.chains.preserve.candidates, 0);
    assert.equal(off.chains.project.candidates, 1, 'project-global 始终计入项目链（与保管模式无关）');
    assert.equal(off.memoryIds.includes(pg.id), true);
    assert.equal(off.memoryIds.includes(dl.id), false);

    // 开启模式：两条都进候选；项目内容走项目链（sync_upstream），设备限定走保管链（sync_preserve）
    updateVaultConfig(dataDir, { preserveDeviceBound: true });
    const on = backfillUpstream(store, { apply: true });
    assert.equal(on.chains.project.candidates, 1, '项目内容计入项目链');
    assert.equal(on.chains.project.enqueued, 1);
    assert.equal(on.chains.preserve.candidates, 1, '保管链只承载设备限定内容');
    assert.equal(on.chains.preserve.enqueued, 1);
    const jobTypes = store.db.all('SELECT job_type FROM outbox_job WHERE entity_id IN (?, ?)', pg.id, dl.id).map((r) => String(r.job_type)).sort();
    assert.deepEqual(jobTypes, ['sync_preserve', 'sync_upstream'], 'project-global 走项目链，device-local 走保管链');
    const again = backfillUpstream(store, { apply: true });
    assert.equal(again.enqueued, 0, '重复应用幂等');
    // 强断言（第二批遗留缺口的收口）：三链口径全归零，项目任务与保管任务分列。
    const remaining = backfillUpstream(store, { apply: false });
    assert.equal(remaining.candidates, 0, '三链口径全归零');
    assert.deepEqual(remaining.memoryIds, [], 'dry-run 不再有候选');
    assert.equal(remaining.chains.project.candidates, 0);
    assert.equal(remaining.chains.preserve.candidates, 0);
    assert.equal(findUpstreamGap(store).length, 0);
    assert.equal(String(store.db.get('SELECT job_type FROM outbox_job WHERE entity_id = ?', pg.id)?.job_type), 'sync_upstream');
    assert.equal(String(store.db.get('SELECT job_type FROM outbox_job WHERE entity_id = ?', dl.id)?.job_type), 'sync_preserve');
  } finally {
    closeAll(a);
  }
});

test('发布失败的任务必须回到 pending（markDone 不得先于 publishChain——真实库 48 任务卡死事故的回归）', async () => {
  const a = newDevice(undefined, true);
  try {
    const vault = vaultFor(a.keys, true);
    a.service.addMemory({ content: '失败注入：个人链任务', kind: 'fact' });
    a.service.addMemory({ content: '失败注入：保管链任务 FAILPUB', kind: 'fact', scope: { preset: 'device-local' } });

    // 保管链 manifest 发布必失败；个人链正常
    const failing = new MemRemote();
    failing.putManifest = async (space: string, device: string, manifest: unknown, gen: number) => {
      if (space.startsWith('preserve/')) throw new Error('injected manifest failure');
      const key = `${space}/devices/${device}/manifest.json`;
      const cur = failing.manifestGens.get(key) ?? 0;
      if (gen <= cur) throw new Error(`generation regression: ${gen} <= ${cur}`);
      failing.manifestGens.set(key, gen);
      failing.objects.set(key, new Uint8Array(manifest as Uint8Array));
    };
    await assert.rejects(() => syncPush(a.service.store, failing, vault));

    // 保管链任务必须可重试（pending），个人链任务正常完成
    const preserveJob = a.service.store.db.get("SELECT status FROM outbox_job WHERE job_type = 'sync_preserve'");
    const personalJob = a.service.store.db.get("SELECT status FROM outbox_job WHERE job_type = 'sync_upstream'");
    assert.equal(preserveJob?.status, 'pending', `保管链发布失败后任务必须回 pending（实际 ${preserveJob?.status}）`);
    assert.equal(personalJob?.status, 'done', '个人链不受同批保管链失败牵连');

    // 修复远端后重推：两条链都发布
    const r = await syncPush(a.service.store, new MemRemote(), vault);
    assert.ok(r!.chains.some((c) => isPreserveSpaceKey(c.spaceKey) && c.eventCount >= 1));
    assert.equal(r!.chains.some((c) => c.spaceKey === 'personal-global' && c.eventCount >= 1), false, '个人链已发布过，重推幂等跳过');
  } finally {
    closeAll(a);
  }
});

test('自链重放的陈旧修订跳过且游标推进（个人链同样适用——真实库自拉取回归）', async () => {
  const a = newDevice();
  const b = newDevice(a);
  try {
    const remote = new MemRemote();
    const text = '自链重放陈旧修订样本';
    const added = a.service.addMemory({ content: text, kind: 'fact' });
    await syncPush(a.service.store, remote, vaultFor(a.keys));
    await syncPull(b.service.store, remote, vaultFor(b.keys));
    // B 本地修订到 v2 并推送（B 的链）；A 的链上 v1 成为陈旧事件
    b.service.reviseMemory(byContent(b.service.store, text)!.id, '自链重放陈旧修订样本（已更正）', { reason: '更正' });

    // A 自拉取自己的链：v1 事件已在本地历史 → 跳过，游标推进到头（不再卡 waited）
    const pulled = await syncPull(a.service.store, remote, vaultFor(a.keys));
    const self = pulled.devices.find((d) => d.deviceId === a.deviceId && d.spaceKey === 'personal-global');
    assert.ok(self, '自链出现在 pull 结果里');
    assert.equal(self!.waited, 0, '陈旧修订不得等待');
    const cursor = a.service.store.db.get("SELECT value FROM meta WHERE key = 'sync_pull:personal-global:' || ?", a.deviceId);
    assert.equal(Number(cursor?.value), self!.headSeq, '自游标推进到 headSeq');
    // 再次自拉取：全量幂等（applied 0）
    const again = await syncPull(a.service.store, remote, vaultFor(a.keys));
    assert.equal(again.devices.find((d) => d.deviceId === a.deviceId)!.appliedBefore, 0, '重复自拉取零应用');
  } finally {
    closeAll(a, b);
  }
});

test('存量迁出通知补发：0.6.x 时代的迁移由对账收敛，对端副本按项目作用域重新持有', async () => {
  const a = newDevice();
  const b = newDevice(a);
  try {
    const remote = new MemRemote();
    // 1) 正常写入并推送（建立 sync_pushed 与对端副本）
    const text = '0.6.x 时代迁移走的项目记忆 LEGACYEXIT';
    const added = a.service.addMemory({ content: text, kind: 'fact' });
    await syncPush(a.service.store, remote, vaultFor(a.keys));
    await syncPull(b.service.store, remote, vaultFor(b.keys));
    assert.ok(byContent(b.service.store, text), '对端已持有');

    // 2) 模拟 0.6.x 旧语义迁移：直改 scope（绕过本变更的 rescope D4 入队）——
    //    事故现场形状：已离开个人链、无任何迁出任务
    const projectId = '66666666-6666-4666-8666-666666666666';
    const projectScope = a.service.resolveScope({ preset: 'project-global', projectId, projectName: 'legacy' });
    a.service.store.memories.migrateScope(added.memory!.id, projectScope.id, 'legacy-sim');

    // 3) 对账发现迁出通知缺口；dry-run 不写
    const dry = backfillUpstream(a.service.store, { apply: false });
    assert.equal(dry.scopeExits.candidates, 1, 'dry-run 报告存量迁出缺口');
    assert.equal(a.service.store.db.all("SELECT id FROM outbox_job WHERE job_type = 'sync_scope_exit'").length, 0, 'dry-run 不写任务');
    const applied = backfillUpstream(a.service.store, { apply: true });
    assert.equal(applied.scopeExits.enqueued, 1);
    const exitJob = a.service.store.db.get("SELECT payload FROM outbox_job WHERE job_type = 'sync_scope_exit' LIMIT 1");
    assert.equal(JSON.parse(String(exitJob!.payload)).fromSpace, 'personal-global', '补发的通知同样固化 fromSpace');

    // 4) 推送后对端收敛：迁出通知让它放开残缺的个人链副本，项目链上行又让它按新作用域重新持有。
    //    项目链存在（2026-11-16 项目链缺口判据修正）后「归档」不再是终态：对端确实应当持有
    //    这条项目内容，缺的只是「不在个人链」这一条事实，由 scope_exit + 项目落点共同表达。
    await syncPush(a.service.store, remote, vaultFor(a.keys));
    await syncPull(b.service.store, remote, vaultFor(b.keys));
    const peerCopy = byContent(b.service.store, text)!;
    assert.equal(peerCopy.status, 'active', '对端按项目链重新持有');
    assert.equal(
      peerCopy.scopeId,
      b.service.resolveScope({ preset: 'project-global', projectId, projectName: 'legacy' }).id,
      '落点是项目作用域，不再留在个人链',
    );
    assert.equal(a.service.store.db.all("SELECT id FROM outbox_job WHERE job_type = 'sync_scope_exit'").length, 1);
    const redry = backfillUpstream(a.service.store, { apply: false });
    assert.equal(redry.scopeExits.candidates, 0, '已有过迁出任务（不论状态）不重复补发');
  } finally {
    closeAll(a, b);
  }
});
