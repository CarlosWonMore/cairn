import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { AppService } from '../../src/interfaces/app-service.js';
import { findUpstreamGap, backfillUpstream } from '../../src/sync/backfill.js';
import { PERSONAL_SPACE_KEY } from '../../src/sync/vault.js';
import { makeTestHome, cleanupTestHome } from '../helpers.js';

/**
 * 冷启动对账（spec cloud-sync「冷启动对账」/ design D3）。
 * 钉住：默认只读、幂等、不限制既有 job 状态、设备限定零入队、不碰网络。
 */

function setup() {
  const home = makeTestHome('cairn-backfill-');
  const service = AppService.open(home);
  return {
    service,
    store: service.store,
    cleanup() {
      service.close();
      cleanupTestHome(home);
    },
  };
}

/** 直写存储层造一条"应上行但未入队"的活动记忆：历史遗留缺口的形状。 */
function gapMemory(s: ReturnType<typeof setup>, content: string, preset: 'personal-global' | 'device-local' = 'personal-global'): string {
  const scope = s.service.resolveScope({ preset });
  const m = s.store.memories.add(
    { kind: 'fact', content, scopeId: scope.id, authority: 'user_explicit', createdBy: 'cli' },
    s.service.caller.deviceId,
  );
  return m.id;
}

function outboxSnapshot(store: ReturnType<typeof setup>['store']): { rows: number; digest: string } {
  const rows = store.db.all('SELECT id, payload_hash, status, idempotency_key FROM outbox_job ORDER BY id');
  return { rows: rows.length, digest: createHash('sha256').update(JSON.stringify(rows)).digest('hex') };
}

function syncJobs(store: ReturnType<typeof setup>['store'], memoryId: string) {
  return store.db.all(
    "SELECT * FROM outbox_job WHERE job_type = 'sync_upstream' AND entity_id = ?",
    memoryId,
  );
}

test('dry-run：候选数正确，outbox 行数与内容逐字节不变', () => {
  const s = setup();
  try {
    const a = gapMemory(s, '历史遗漏的偏好一');
    const b = gapMemory(s, '历史遗漏的偏好二');
    const before = outboxSnapshot(s.store);

    const r = backfillUpstream(s.store, { apply: false });

    assert.equal(r.candidates, 2);
    assert.equal(r.enqueued, 0);
    assert.equal(r.existing, 0);
    assert.equal(r.excluded, 0);
    assert.deepEqual([...r.memoryIds].sort(), [a, b].sort());
    assert.deepEqual(outboxSnapshot(s.store), before, 'dry-run 不得写任何 outbox 行');
  } finally {
    s.cleanup();
  }
});

test('--apply 后缺口归零：再次 dry-run 候选为 0，任务形状与 addMemory 一致', () => {
  const s = setup();
  try {
    const id = gapMemory(s, '需要补入队的记忆');
    assert.equal(findUpstreamGap(s.store).length, 1, '前置：存在缺口');

    const r = backfillUpstream(s.store, { apply: true });

    assert.equal(r.candidates, 1);
    assert.equal(r.enqueued, 1);
    assert.deepEqual(r.memoryIds, [id]);
    const rows = syncJobs(s.store, id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.idempotency_key, `memory:${id}`);
    assert.equal(rows[0]!.status, 'pending');
    assert.deepEqual(JSON.parse(String(rows[0]!.payload)), { op: 'memory_upsert', memoryId: id });

    assert.equal(findUpstreamGap(s.store).length, 0, '补齐后缺口应为 0');
    assert.equal(backfillUpstream(s.store, { apply: false }).candidates, 0);
  } finally {
    s.cleanup();
  }
});

test('连续两次 --apply：第二次新增 0，不产生重复任务', () => {
  const s = setup();
  try {
    const id = gapMemory(s, '幂等性测试记忆');

    const first = backfillUpstream(s.store, { apply: true });
    const second = backfillUpstream(s.store, { apply: true });

    assert.equal(first.enqueued, 1);
    assert.equal(second.candidates, 0);
    assert.equal(second.enqueued, 0);
    assert.equal(second.memoryIds.length, 0);
    assert.equal(syncJobs(s.store, id).length, 1, '同一记忆只能有一条 memory:<id> 任务');
  } finally {
    s.cleanup();
  }
});

test('device-local 记忆不计入候选，也不产生任何 outbox 行', () => {
  const s = setup();
  try {
    const localId = gapMemory(s, '只属于本机的内容', 'device-local');
    const globalId = gapMemory(s, '可以上行的内容');

    const r = backfillUpstream(s.store, { apply: true });

    assert.equal(r.candidates, 1);
    assert.deepEqual(r.memoryIds, [globalId]);
    assert.equal(syncJobs(s.store, localId).length, 0, '设备限定内容零入队');
    assert.equal(syncJobs(s.store, globalId).length, 1);
  } finally {
    s.cleanup();
  }
});

test('已有任意状态 sync_upstream 的记忆不算缺口：done 与 dead 都算"管过"', () => {
  const s = setup();
  try {
    const doneId = gapMemory(s, '已成功推送过的记忆');
    const doneJob = s.store.outbox.enqueue({
      jobType: 'sync_upstream',
      scopeId: s.service.resolveScope({ preset: 'personal-global' }).id,
      entityType: 'memory',
      entityId: doneId,
      payload: { op: 'memory_upsert', memoryId: doneId },
      idempotencyKey: `memory:${doneId}`,
    });
    s.store.outbox.markDone(doneJob.job!.id);

    const deadId = gapMemory(s, '重试耗尽而终止的记忆');
    const deadJob = s.store.outbox.enqueue({
      jobType: 'sync_upstream',
      scopeId: s.service.resolveScope({ preset: 'personal-global' }).id,
      entityType: 'memory',
      entityId: deadId,
      payload: { op: 'memory_upsert', memoryId: deadId },
      idempotencyKey: `memory:${deadId}`,
      maxAttempts: 1,
    });
    s.store.outbox.markFailedRetry(deadJob.job!.id, '模拟不可达');
    assert.equal(s.store.outbox.requireById(deadJob.job!.id).status, 'dead', '前置：任务已终止');

    const aliveId = gapMemory(s, '从未入队的记忆');
    const r = backfillUpstream(s.store, { apply: true });

    assert.equal(r.candidates, 1);
    assert.deepEqual(r.memoryIds, [aliveId]);
    assert.equal(syncJobs(s.store, doneId).length, 1);
    assert.equal(syncJobs(s.store, deadId).length, 1);
  } finally {
    s.cleanup();
  }
});

test('--limit 限制单次写入量：候选数报全量，分两轮补齐', () => {
  const s = setup();
  try {
    for (const c of ['批次一', '批次二', '批次三']) gapMemory(s, c);

    const first = backfillUpstream(s.store, { apply: true, limit: 2 });
    assert.equal(first.candidates, 3, '候选数是库中缺口全量');
    assert.equal(first.enqueued, 2, '单次只写 limit 条');
    assert.equal(first.memoryIds.length, 2);

    const second = backfillUpstream(s.store, { apply: true, limit: 2 });
    assert.equal(second.candidates, 1);
    assert.equal(second.enqueued, 1);
    assert.equal(backfillUpstream(s.store, { apply: false }).candidates, 0);
  } finally {
    s.cleanup();
  }
});

test('远端已配置但不可达：--apply 仍成功，且全程零网络调用', () => {
  const s = setup();
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = ((..._args: Parameters<typeof fetch>) => {
    fetchCalls++;
    throw new Error('网络不可用（测试替身）');
  }) as typeof fetch;
  try {
    s.service.vaultInitRemote({ provider: 'syncd', syncd: { baseUrl: 'http://127.0.0.1:1' } });
    assert.equal(s.service.vaultStatus().configured, true, '前置：远端已配置');
    const id = gapMemory(s, '远端不可达时仍需补入队的记忆');

    const r = s.service.syncBackfillCmd({ apply: true });

    assert.equal(r.enqueued, 1);
    assert.equal(syncJobs(s.store, id).length, 1);
    assert.equal(fetchCalls, 0, 'backfill 不得发起任何网络请求');
  } finally {
    globalThis.fetch = originalFetch;
    s.cleanup();
  }
});

// ---------------------------------------------------------------------------
// 项目链缺口（add-cross-device-project-sync 5.1 / 5.2）
// ---------------------------------------------------------------------------

function addInScope(s: ReturnType<typeof setup>, content: string, scopeId: string): string {
  return s.store.memories.add(
    { kind: 'fact', content, scopeId, authority: 'user_explicit', createdBy: 'cli' },
    s.service.caller.deviceId,
  ).id;
}

test('三链分列：项目内容计入 chains.project（sync_upstream），设备限定计入 chains.preserve（sync_preserve）', () => {
  const s = setup();
  try {
    const projectId = '12121212-1212-4212-8212-121212121212';
    const projectScope = s.service.resolveScope({ preset: 'project-global', projectId, projectName: 'bf-project' });
    const deviceScope = s.service.resolveScope({ preset: 'device-local' });
    const projectDeviceScope = s.service.resolveScope({ preset: 'project-device', projectId, projectName: 'bf-project' });
    const pg = addInScope(s, '直写的项目内容', projectScope.id);
    const dl = addInScope(s, '直写的本机内容', deviceScope.id);
    const pd = addInScope(s, '直写的项目本机内容', projectDeviceScope.id);

    // 关闭保管模式：项目内容仍是缺口（它始终走项目链），设备限定不是
    const off = backfillUpstream(s.store, { apply: false });
    assert.equal(off.chains.project.candidates, 1);
    assert.equal(off.chains.personal.candidates, 0);
    assert.equal(off.chains.preserve.candidates, 0);
    assert.deepEqual(off.memoryIds, [pg]);
    assert.equal(off.candidates, 1);

    // 开启保管模式：同一份报告里三链分列；任务类型按链区分
    s.service.vaultInitRemote({ provider: 'syncd', syncd: { baseUrl: 'http://unused.invalid' }, preserveDeviceBound: true });
    const on = backfillUpstream(s.store, { apply: true });
    assert.equal(on.chains.project.candidates, 1);
    assert.equal(on.chains.project.enqueued, 1);
    assert.equal(on.chains.preserve.candidates, 2);
    assert.equal(on.chains.preserve.enqueued, 2);
    assert.equal(on.candidates, 3);

    assert.equal(String(s.store.db.get('SELECT job_type FROM outbox_job WHERE entity_id = ?', pg)?.job_type), 'sync_upstream');
    assert.deepEqual(
      s.store.db.all('SELECT job_type FROM outbox_job WHERE entity_id IN (?, ?)', dl, pd).map((r) => String(r.job_type)).sort(),
      ['sync_preserve', 'sync_preserve'],
      '设备限定与 project-device 都走保管链',
    );

    // 归零 + 幂等：第二次 apply 不新增
    const again = backfillUpstream(s.store, { apply: true });
    assert.equal(again.candidates, 0);
    assert.equal(again.enqueued, 0);
    assert.equal(findUpstreamGap(s.store).length, 0);
    assert.deepEqual(backfillUpstream(s.store, { apply: false }).memoryIds, []);
  } finally {
    s.cleanup();
  }
});

test('doctor / status 按项目链汇报 localSeq / 游标 / pending / gap', () => {  const s = setup();
  try {
    const projectId = '13131313-1313-4313-8313-131313131313';
    s.service.addMemory({ content: '项目链可观测样本', kind: 'fact', scope: { preset: 'project-global', projectId, projectName: 'obs' } });

    const doctor = s.service.doctor();
    const chain = doctor.sync.chains.find((c) => c.spaceKey === `project/${projectId}`);
    assert.ok(chain, 'doctor 按项目链汇报');
    assert.equal(chain!.role, 'project');
    assert.equal(chain!.localSeq, 0);
    assert.deepEqual(chain!.pullCursors, {});
    assert.equal(chain!.pendingJobs, 1, '项目链的待处理任务');
    assert.equal(chain!.gap, 0);

    const status = s.service.status() as {
      sync: { chains: Record<string, { localSeq: number; pendingJobs: number; gap: number; pullCursors: Record<string, number> }> };
    };
    assert.ok(status.sync.chains[`project/${projectId}`], 'status 含同一条项目链');
    assert.equal(status.sync.chains[`project/${projectId}`]!.pendingJobs, 1);
    assert.equal(status.sync.chains[PERSONAL_SPACE_KEY]!.pendingJobs, 0, '项目任务不得算进个人链');
  } finally {
    s.cleanup();
  }
});

// ---------------------------------------------------------------------------
// 接收方副本不是上行缺口（2026-11-16 真机对端 upstreamGap=27）
// ---------------------------------------------------------------------------

/** 直写一条「接收来的副本」：归属设备是发布方，不是本机。 */
function receivedInScope(s: ReturnType<typeof setup>, content: string, scopeId: string, originDeviceId: string): string {
  return s.store.memories.add(
    { kind: 'fact', content, scopeId, authority: 'user_explicit', createdBy: 'cli' },
    s.service.caller.deviceId,
    originDeviceId,
  ).id;
}

test('对照：本机创建的项目记忆仍是缺口，接收来的副本不是（origin 条件不是一刀切排除）', () => {
  const s = setup();
  try {
    const projectId = '17171717-1717-4717-8717-171717171717';
    const scope = s.service.resolveScope({ preset: 'project-global', projectId, projectName: '缺口对照项目' });
    const own = addInScope(s, '本机创建的项目内容', scope.id);
    const received = receivedInScope(s, '从对端拉下来的项目内容', scope.id, 'dev_peer_origin');

    assert.equal(
      String(s.store.db.get('SELECT origin_device_id FROM memory WHERE id = ?', own)!.origin_device_id),
      s.service.caller.deviceId,
      '前置：本机创建的记忆归属本机',
    );
    assert.deepEqual(
      findUpstreamGap(s.store).filter((g) => g.chain === 'project').map((g) => g.memoryId),
      [own],
      '接收副本没有本链推送证据，但也不是本机发布的——不得计入缺口',
    );
    assert.equal(backfillUpstream(s.store, { apply: false }).chains.project.candidates, 1);
    assert.equal(s.store.db.all('SELECT id FROM outbox_job WHERE entity_id = ?', received).length, 0, '接收副本零入队');
  } finally {
    s.cleanup();
  }
});

test('origin_device_id IS NULL 的历史记忆仍算缺口（NULL 视为可能由本机创建）', () => {
  const s = setup();
  try {
    const projectId = '18181818-1818-4818-8818-181818181818';
    const projectScope = s.service.resolveScope({ preset: 'project-global', projectId, projectName: '历史项目' });
    const historicalProject = addInScope(s, '没有归属设备的历史项目内容', projectScope.id);
    const historicalPersonal = addInScope(s, '没有归属设备的历史个人内容', s.service.resolveScope({ preset: 'personal-global' }).id);
    s.store.db.run('UPDATE memory SET origin_device_id = NULL WHERE id IN (?, ?)', historicalProject, historicalPersonal);

    const gaps = findUpstreamGap(s.store);
    assert.deepEqual(gaps.filter((g) => g.chain === 'project').map((g) => g.memoryId), [historicalProject]);
    assert.deepEqual(gaps.filter((g) => g.chain === 'personal').map((g) => g.memoryId), [historicalPersonal]);
  } finally {
    s.cleanup();
  }
});

/**
 * 真实形状（2026-11-16 真机 27 条）：记忆先在 personal-global 推送成功（done 的
 * sync_upstream + `sync_pushed:personal-global:<id>`），随后迁入项目 P。当年项目链
 * 还不存在，迁入那次 push 是**不可路由完成**（记 sync_job_unroutable 后 markDone）——
 * 于是这条记忆有 done 的上行任务，却从未发布到项目链。
 */
function legacyMigratedToProject(s: ReturnType<typeof setup>, projectId: string): { id: string; projectScopeId: string } {
  const personalScope = s.service.resolveScope({ preset: 'personal-global' });
  const id = addInScope(s, '先推个人链再迁入项目的内容', personalScope.id);
  const personalJob = s.store.outbox.enqueue({
    jobType: 'sync_upstream',
    scopeId: personalScope.id,
    entityType: 'memory',
    entityId: id,
    payload: { op: 'memory_upsert', memoryId: id },
    idempotencyKey: `memory:${id}`, // 与 addMemory 同键：真机上这条键已被旧任务永久占用
  });
  s.store.outbox.markDone(personalJob.job!.id);
  s.store.db.run('INSERT INTO meta (key, value) VALUES (?, ?)', `sync_pushed:${PERSONAL_SPACE_KEY}:${id}`, 'rev-personal');

  s.service.rescopeMemory(id, { scopePreset: 'project-global', projectId, projectName: 'bf-project', force: true });
  const projectScopeId = s.service.resolveScope({ preset: 'project-global', projectId, projectName: 'bf-project' }).id;
  const legacy = s.store.outbox.enqueue({
    jobType: 'sync_upstream',
    scopeId: projectScopeId,
    entityType: 'memory',
    entityId: id,
    payload: { op: 'memory_upsert', memoryId: id },
    idempotencyKey: `memory:${id}:rev:legacy`, // 当年的不可路由任务；换键只为避开唯一约束
  });
  s.store.outbox.markDone(legacy.job!.id);
  return { id, projectScopeId };
}

test('从个人链迁入项目的记忆仍算项目链缺口：done 的旧上行任务不等于本链已推送', () => {
  const s = setup();
  try {
    const projectId = '14141414-1414-4414-8414-141414141414';
    const { id, projectScopeId } = legacyMigratedToProject(s, projectId);
    assert.equal(s.store.db.all('SELECT id FROM outbox_job WHERE entity_id = ?', id).length, 3, '前置：两条 done 上行 + 一条待发迁出');

    const gaps = findUpstreamGap(s.store);
    assert.deepEqual(
      gaps.filter((g) => g.chain === 'project'),
      [{ memoryId: id, scopeId: projectScopeId, chain: 'project', projectId }],
      '本链无推送证据 → 项目链缺口（修复前这里候选为 0）',
    );
    assert.deepEqual(gaps.filter((g) => g.chain === 'personal'), [], '迁出后不再是个人链缺口');
  } finally {
    s.cleanup();
  }
});

test('迁入项目的记忆 --apply 后入队到本项目链，再 dry-run 归 0', () => {
  const s = setup();
  try {
    const projectId = '14141414-1414-4414-8414-141414141415';
    const { id, projectScopeId } = legacyMigratedToProject(s, projectId);

    const r = backfillUpstream(s.store, { apply: true });
    assert.equal(r.chains.project.candidates, 1);
    assert.equal(r.chains.project.enqueued, 1, 'memory:<id> 已被旧任务占用，项目任务必须用独立键');
    assert.equal(r.chains.project.existing, 0);

    const pending = s.store.db.all(
      `SELECT j.scope_id AS scopeId, s.preset AS preset, s.project_id AS projectId
       FROM outbox_job j JOIN scope s ON s.id = j.scope_id
       WHERE j.entity_id = ? AND j.job_type = 'sync_upstream' AND j.status = 'pending'`,
      id,
    );
    assert.equal(pending.length, 1);
    assert.deepEqual(
      { scopeId: String(pending[0]!.scopeId), preset: String(pending[0]!.preset), projectId: String(pending[0]!.projectId) },
      { scopeId: projectScopeId, preset: 'project-global', projectId },
      '任务路由到本项目链',
    );

    assert.equal(findUpstreamGap(s.store).length, 0, '在途任务即视为已处理（不改证据也幂等）');
    assert.equal(backfillUpstream(s.store, { apply: false }).candidates, 0);
  } finally {
    s.cleanup();
  }
});

test('负对照：已推送过本项目链的记忆不出现在候选', () => {
  const s = setup();
  try {
    const projectId = '16161616-1616-4616-8616-161616161616';
    const scope = s.service.resolveScope({ preset: 'project-global', projectId, projectName: 'bf-project' });
    const id = addInScope(s, '确实已发布到项目链的内容', scope.id);
    s.store.db.run('INSERT INTO meta (key, value) VALUES (?, ?)', `sync_pushed:project/${projectId}:${id}`, 'rev-1');

    assert.deepEqual(findUpstreamGap(s.store), [], '本链有推送证据 → 不是缺口');
    const r = backfillUpstream(s.store, { apply: true });
    assert.equal(r.candidates, 0);
    assert.equal(s.store.db.all('SELECT id FROM outbox_job WHERE entity_id = ?', id).length, 0, '零入队');
  } finally {
    s.cleanup();
  }
});

