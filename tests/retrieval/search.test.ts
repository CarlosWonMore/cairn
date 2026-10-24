import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openStore, CairnStore } from '../../src/store/open.js';
import { searchMemories, SearchOutput } from '../../src/retrieval/search.js';
import { AddMemoryInput } from '../../src/core/types.js';
import { isCairnError } from '../../src/core/errors.js';
import { isoPlusMs, nowIso } from '../../src/core/time.js';
import { makeTestHome, cleanupTestHome } from '../helpers.js';

// ---------------------------------------------------------------------------
// 合成数据：全部使用 makeTestHome 合成目录与合成记忆，不触真实数据。
// ---------------------------------------------------------------------------

interface SearchCtx {
  store: CairnStore;
  ids: {
    personal: string;
    projA: string;
    projB: string;
    agentA: string;
    agentB: string;
    dev1: string;
    dev2: string;
    zhou: string;
    backupA: string;
    en: string;
    agentMem: string;
    dev1Mem: string;
    backupP: string;
    sqliteP: string;
    mixP: string;
    cand: string;
    imp: string;
    expired: string;
    future: string;
    conflict: string;
    wildcard: string;
  };
  qa: { deviceId: string; agentId: string; projectId: string };
  qb: { deviceId: string; agentId: string; projectId: string };
  qp: { deviceId: string; agentId: string };
  qAgentA: { deviceId: string; agentId: string };
  qAgentB: { deviceId: string; agentId: string };
  qDev1: { deviceId: string; agentId: string };
  qDev2: { deviceId: string; agentId: string };
  cleanup: () => void;
}

function setupSearchStore(): SearchCtx {
  const home = makeTestHome();
  const store = openStore({ home });
  const dev = store.identity.deviceId;
  const personal = store.scopes.resolvePreset('personal-global');
  const projA = store.scopes.resolvePreset('project-global', { projectId: 'proj-a', projectName: '项目A' });
  const projB = store.scopes.resolvePreset('project-global', { projectId: 'proj-b', projectName: '项目B' });
  const agentA = store.scopes.resolvePreset('agent-private', { agentId: 'agent-alpha' });
  const agentB = store.scopes.resolvePreset('agent-private', { agentId: 'agent-beta' });
  const dev1 = store.scopes.resolvePreset('device-local', { deviceId: 'device-1' });
  const dev2 = store.scopes.resolvePreset('device-local', { deviceId: 'device-2' });

  const add = (scopeId: string, content: string, opts: Partial<AddMemoryInput> = {}): string =>
    store.memories.add({ kind: 'fact', content, scopeId, authority: 'user_explicit', createdBy: 'test', ...opts }, dev).id;

  const zhou = add(projA.id, '部署结构化检索服务需要 trigram 索引');
  const backupA = add(projA.id, '数据库需要每日备份');
  const en = add(projB.id, 'sqlite deployment guide with backup scripts');
  const agentMem = add(agentA.id, 'agent alpha 私有备忘：结构化索引');
  const dev1Mem = add(dev1.id, 'device-1 本地专用缓存配置备份');
  const backupP = add(personal.id, '每日备份重要数据到本地磁盘');
  const sqliteP = add(personal.id, 'sqlite 数据库版本管理约定');
  const mixP = add(personal.id, 'sqlite 备份脚本示例');
  const cand = add(personal.id, '候选：偏好深色主题', { authority: 'agent_inferred' });
  const imp = add(personal.id, '导入的未验证事实：旧备份策略', { authority: 'imported_unverified' });
  const expired = add(personal.id, '已过期的临时令牌记录', { expiresAt: isoPlusMs(nowIso(), -86_400_000) });
  const future = add(personal.id, '长期有效的部署约定', { expiresAt: isoPlusMs(nowIso(), 86_400_000) });
  const wildcard = add(personal.id, '100% 完成度通配符测试');

  // 冲突记忆：rev1 与 rev2 并发冲突 → status='conflicted' + open conflict
  const confRec = store.memories.add(
    { kind: 'fact', content: '线上数据库连接串配置', scopeId: personal.id, authority: 'user_explicit', createdBy: 'test' },
    dev,
  );
  const rev1 = confRec.currentRevisionId!;
  const revised = store.memories.revise(confRec.id, '线上数据库连接串改用 IPv4', { author: 'test' }, dev);
  store.conflicts.record({ memoryId: confRec.id, revisionAId: rev1, revisionBId: revised.revision.id });

  const qa = { deviceId: 'device-x', agentId: 'agent-x', projectId: 'proj-a' };
  const qb = { deviceId: 'device-x', agentId: 'agent-x', projectId: 'proj-b' };
  const qp = { deviceId: dev, agentId: 'agent-any' };
  const qAgentA = { deviceId: 'device-x', agentId: 'agent-alpha' };
  const qAgentB = { deviceId: 'device-x', agentId: 'agent-beta' };
  const qDev1 = { deviceId: 'device-1', agentId: 'agent-any' };
  const qDev2 = { deviceId: 'device-2', agentId: 'agent-any' };

  return {
    store,
    ids: {
      personal: personal.id, projA: projA.id, projB: projB.id, agentA: agentA.id, agentB: agentB.id,
      dev1: dev1.id, dev2: dev2.id, zhou, backupA, en, agentMem, dev1Mem, backupP, sqliteP, mixP,
      cand, imp, expired, future, conflict: confRec.id, wildcard,
    },
    qa, qb, qp, qAgentA, qAgentB, qDev1, qDev2,
    cleanup: () => {
      store.close();
      cleanupTestHome(home);
    },
  };
}

function withCtx(fn: (ctx: SearchCtx) => void): void {
  const ctx = setupSearchStore();
  try {
    fn(ctx);
  } finally {
    ctx.cleanup();
  }
}

function resultIds(out: SearchOutput): string[] {
  return out.results.map((r) => r.memory.id).sort();
}

// ---------------------------------------------------------------------------
// 检索通道
// ---------------------------------------------------------------------------

test('检索：三字中文查询走 fts 通道命中', () => {
  withCtx(({ store, ids, qa }) => {
    const out = searchMemories(store, { text: '结构化检索', query: qa });
    assert.equal(out.degraded, false);
    assert.equal(out.matchedBy, 'fts');
    assert.deepEqual(resultIds(out), [ids.zhou]);
    assert.equal(out.results[0]?.matchedBy, 'fts');
    assert.ok(out.results[0] !== undefined && out.results[0].score > 0, 'score 必须 > 0');
    assert.equal(out.results[0]?.expired, false);
    assert.equal(out.results[0]?.unverifiableImport, false);
  });
});

test('检索：两字中文查询（备份）走有界 LIKE 回退命中（spec 场景）', () => {
  withCtx(({ store, ids, qa }) => {
    const out = searchMemories(store, { text: '备份', query: qa });
    assert.equal(out.degraded, false, '按设计走 LIKE，不算降级');
    assert.equal(out.matchedBy, 'like');
    assert.ok(resultIds(out).includes(ids.backupA), 'spec 场景：包含“备份”的项目记忆必须命中');
    for (const r of out.results) {
      assert.ok(r.memory.content.includes('备份'), '所有命中都必须真实包含查询词');
      assert.equal(r.matchedBy, 'like');
      assert.ok(r.score > 0);
    }
  });
});

test('检索：中英混合查询同时命中两条记忆（mixed 通道）', () => {
  withCtx(({ store, ids, qp }) => {
    const out = searchMemories(store, { text: '备份 sqlite', query: qp });
    assert.equal(out.degraded, false);
    assert.equal(out.matchedBy, 'mixed');
    assert.deepEqual(resultIds(out), [ids.backupP, ids.mixP, ids.sqliteP].sort());
  });
});

test('检索：拉丁词走 fts 命中（子串匹配，无需分词模型）', () => {
  withCtx(({ store, ids, qp }) => {
    const out = searchMemories(store, { text: 'sqlite', query: qp });
    assert.equal(out.matchedBy, 'fts');
    assert.deepEqual(resultIds(out), [ids.mixP, ids.sqliteP].sort());
    for (const r of out.results) {
      assert.equal(r.matchedBy, 'fts');
      assert.ok(r.score > 0);
    }
  });
});

// ---------------------------------------------------------------------------
// 作用域隔离（负向：零结果零泄漏）
// ---------------------------------------------------------------------------

test('检索：项目 A 身份查不到项目 B 记忆，项目 B 身份查不到项目 A 记忆', () => {
  withCtx(({ store, ids, qa, qb }) => {
    const outB = searchMemories(store, { text: '结构化检索', query: qb });
    assert.equal(outB.results.length, 0, '项目 B 身份查询项目 A 专属词必须零结果');

    const outA = searchMemories(store, { text: 'deployment', query: qa });
    assert.equal(outA.results.length, 0, '项目 A 身份查询项目 B 专属词必须零结果');

    // 数据确实存在：项目 B 自己的身份可命中，证明零结果来自隔离而非缺数据
    const outSelf = searchMemories(store, { text: 'deployment', query: qb });
    assert.deepEqual(resultIds(outSelf), [ids.en]);
  });
});

test('检索：agent-private 记忆对其他 agent 不可见', () => {
  withCtx(({ store, ids, qAgentA, qAgentB }) => {
    const visible = searchMemories(store, { text: '结构化索引', query: qAgentA });
    assert.deepEqual(resultIds(visible), [ids.agentMem]);

    const blocked = searchMemories(store, { text: '结构化索引', query: qAgentB });
    assert.equal(blocked.results.length, 0, 'allowlist 之外的 agent 不得看到 agent-private 记忆');

    const blocked2 = searchMemories(store, { text: '私有', query: qAgentB });
    assert.equal(blocked2.results.length, 0);
  });
});

test('检索：device-local 记忆对其他 deviceId 不可见', () => {
  withCtx(({ store, ids, qDev1, qDev2 }) => {
    const visible = searchMemories(store, { text: '缓存', query: qDev1 });
    assert.deepEqual(resultIds(visible), [ids.dev1Mem]);

    const blocked = searchMemories(store, { text: '缓存', query: qDev2 });
    assert.equal(blocked.results.length, 0, '其他设备不得看到 device-local 记忆');
  });
});

test('检索：scopeIds 传不存在的 id → E_NOT_FOUND', () => {
  withCtx(({ store, qa }) => {
    assert.throws(
      () => searchMemories(store, { text: '备份', query: qa, scopeIds: ['scope-does-not-exist'] }),
      (e: unknown) => isCairnError(e) && e.code === 'E_NOT_FOUND',
    );
  });
});

test('检索：scopeIds 白名单在 SQL 层前置过滤', () => {
  withCtx(({ store, ids, qDev1 }) => {
    const onlyDev1 = searchMemories(store, { text: '备份', query: qDev1, scopeIds: [ids.dev1] });
    assert.deepEqual(resultIds(onlyDev1), [ids.dev1Mem]);

    const onlyPersonal = searchMemories(store, { text: '备份', query: qDev1, scopeIds: [ids.personal] });
    assert.deepEqual(resultIds(onlyPersonal), [ids.backupP, ids.mixP].sort());
  });
});

// ---------------------------------------------------------------------------
// 状态语义
// ---------------------------------------------------------------------------

test('检索：默认只返回 active，candidate 不出现', () => {
  withCtx(({ store, ids, qp }) => {
    const out = searchMemories(store, { text: '备份', query: qp });
    assert.deepEqual(resultIds(out), [ids.backupP, ids.mixP].sort());
    for (const r of out.results) {
      assert.equal(r.memory.status, 'active');
      assert.notEqual(r.memory.id, ids.imp, '未验证导入（candidate）不得混入默认结果');
    }
  });
});

test('检索：statuses 显式含 candidate 时可见，imported_unverified 必须标记 unverifiableImport', () => {
  withCtx(({ store, ids, qp }) => {
    const out = searchMemories(store, { text: '备份', query: qp, statuses: ['active', 'candidate'] });
    const imp = out.results.find((r) => r.memory.id === ids.imp);
    assert.ok(imp !== undefined, '显式请求 candidate 时未验证导入可见');
    assert.equal(imp.unverifiableImport, true, 'imported_unverified 不得伪装成用户确认事实');
    assert.equal(imp.memory.authority, 'imported_unverified');

    const inferred = searchMemories(store, { text: '偏好', query: qp, statuses: ['candidate'] });
    const cand = inferred.results.find((r) => r.memory.id === ids.cand);
    assert.ok(cand !== undefined);
    assert.equal(cand.unverifiableImport, false, 'agent_inferred 候选不属于未验证导入');
  });
});

test('检索：过期记忆默认排除', () => {
  withCtx(({ store, qp }) => {
    const out = searchMemories(store, { text: '令牌', query: qp });
    assert.equal(out.results.length, 0, '过期记忆默认不出现');
  });
});

test('检索：includeExpired=true 时过期记忆出现且 expired=true，未过期记忆 expired=false', () => {
  withCtx(({ store, ids, qp }) => {
    const out = searchMemories(store, { text: '令牌', query: qp, includeExpired: true });
    assert.deepEqual(resultIds(out), [ids.expired]);
    assert.equal(out.results[0]?.expired, true);

    const outFuture = searchMemories(store, { text: '部署约定', query: qp, includeExpired: true });
    const future = outFuture.results.find((r) => r.memory.id === ids.future);
    assert.ok(future !== undefined);
    assert.equal(future.expired, false);
  });
});

test('检索：open 冲突记忆在显式 statuses 下返回并带 conflictId', () => {
  withCtx(({ store, ids, qp }) => {
    const out = searchMemories(store, { text: '连接串', query: qp, statuses: ['active', 'conflicted'] });
    assert.deepEqual(resultIds(out), [ids.conflict]);
    const hit = out.results[0];
    assert.ok(hit !== undefined);
    assert.equal(hit.memory.status, 'conflicted');
    assert.ok(hit.conflictId != null && hit.conflictId.length > 0, 'conflicted 命中必须携带未解决冲突 id');
  });
});

test('检索：conflicted 记忆默认（仅 active）不出现', () => {
  withCtx(({ store, qp }) => {
    const out = searchMemories(store, { text: '连接串', query: qp });
    assert.equal(out.results.length, 0);
  });
});

// ---------------------------------------------------------------------------
// 非法输入：安全失败
// ---------------------------------------------------------------------------

test('检索：空文本与纯空白 → E_VALIDATION', () => {
  withCtx(({ store, qp }) => {
    assert.throws(
      () => searchMemories(store, { text: '', query: qp }),
      (e: unknown) => isCairnError(e) && e.code === 'E_VALIDATION',
    );
    assert.throws(
      () => searchMemories(store, { text: '   \n\t ', query: qp }),
      (e: unknown) => isCairnError(e) && e.code === 'E_VALIDATION',
    );
  });
});

test('检索：超过 512 字符 → E_VALIDATION（512 恰好合法）', () => {
  withCtx(({ store, qp }) => {
    assert.throws(
      () => searchMemories(store, { text: 'a'.repeat(513), query: qp }),
      (e: unknown) => isCairnError(e) && e.code === 'E_VALIDATION',
    );
    assert.doesNotThrow(() => searchMemories(store, { text: 'a'.repeat(512), query: qp }));
  });
});

test('检索：statuses 含 tombstoned / superseded / 未知值 → E_VALIDATION', () => {
  withCtx(({ store, qp }) => {
    for (const bad of ['tombstoned', 'superseded', 'bogus'] as const) {
      assert.throws(
        () => searchMemories(store, { text: '备份', query: qp, statuses: ['active', bad as never] }),
        (e: unknown) => isCairnError(e) && e.code === 'E_VALIDATION',
        `statuses 含 ${bad} 必须拒绝`,
      );
    }
  });
});

test('检索：limit / timeoutMs 非法 → E_VALIDATION；limit 超上限被钳制', () => {
  withCtx(({ store, qp }) => {
    assert.throws(
      () => searchMemories(store, { text: '备份', query: qp, limit: 0 }),
      (e: unknown) => isCairnError(e) && e.code === 'E_VALIDATION',
    );
    assert.throws(
      () => searchMemories(store, { text: '备份', query: qp, timeoutMs: 0 }),
      (e: unknown) => isCairnError(e) && e.code === 'E_VALIDATION',
    );
    assert.doesNotThrow(() => searchMemories(store, { text: '备份', query: qp, limit: 1000 }), 'limit 超上限应钳制到 100 而非报错');
  });
});

// ---------------------------------------------------------------------------
// 降级：索引不可用
// ---------------------------------------------------------------------------

test('降级：DROP TABLE memory_fts 后仍返回正确结果且 degraded=true', () => {
  withCtx(({ store, ids, qp }) => {
    store.db.exec('DROP TABLE memory_fts');
    const out = searchMemories(store, { text: 'sqlite', query: qp });
    assert.equal(out.degraded, true, '索引缺失必须标记 degraded');
    assert.equal(out.matchedBy, 'like');
    assert.deepEqual(resultIds(out), [ids.mixP, ids.sqliteP].sort());
    for (const r of out.results) assert.equal(r.matchedBy, 'like');
  });
});

test('降级：索引损坏时无匹配词返回空集，绝不退化为返回全部记忆', () => {
  withCtx(({ store, ids, qp }) => {
    store.db.exec('DROP TABLE memory_fts');
    const out = searchMemories(store, { text: '不存在的词组', query: qp });
    assert.equal(out.degraded, true);
    assert.equal(out.results.length, 0, '无命中必须返回空集，而不是全量记忆');
  });
});

test('降级：索引缺失时两字中文查询仍正常（设计内 LIKE 通道，degraded=false）', () => {
  withCtx(({ store, ids, qp }) => {
    store.db.exec('DROP TABLE memory_fts');
    const out = searchMemories(store, { text: '备份', query: qp });
    assert.equal(out.degraded, false, '无 FTS 词的两字查询本身就走 LIKE，不算降级');
    assert.equal(out.matchedBy, 'like');
    assert.deepEqual(resultIds(out), [ids.backupP, ids.mixP].sort());
  });
});

// ---------------------------------------------------------------------------
// 边界与安全
// ---------------------------------------------------------------------------

test('检索：limit 截断结果数量', () => {
  withCtx(({ store, ids, qp }) => {
    for (const content of ['待办事项一', '待办事项二', '待办事项三']) {
      store.memories.add({ kind: 'fact', content, scopeId: ids.personal, authority: 'user_explicit', createdBy: 'test' }, store.identity.deviceId);
    }
    const out = searchMemories(store, { text: '事项', query: qp, limit: 2 });
    assert.equal(out.results.length, 2);
    assert.ok(out.elapsedMs >= 0);
  });
});

test('检索：searchMemories 只读（不更新 last_used_at）', () => {
  withCtx(({ store, ids, qa }) => {
    searchMemories(store, { text: '结构化检索', query: qa });
    searchMemories(store, { text: 'trigram', query: qa });
    const after = store.memories.get(ids.zhou);
    assert.ok(after != null && after.lastUsedAt === null, '检索不得写库；last_used 更新交给调用方');
  });
});

test('检索：LIKE/FTS 通配符作为查询词安全返回空集（不匹配全表）', () => {
  withCtx(({ store, qp }) => {
    // 库里存在含 % 的内容，证明空结果来自安全转义/分词而不是没数据
    const withPercent = searchMemories(store, { text: '%', query: qp });
    assert.equal(withPercent.results.length, 0, '% 查询必须返回空集（M0 q18 负向场景）');

    const withUnderscore = searchMemories(store, { text: '_', query: qp });
    assert.equal(withUnderscore.results.length, 0, '单字符词被丢弃，返回空集');
  });
});

test('检索：单字 CJK 查询返回空集（设计边界：不进入任何通道）', () => {
  withCtx(({ store, qp }) => {
    const out = searchMemories(store, { text: '查', query: qp });
    assert.equal(out.results.length, 0);
    assert.equal(out.degraded, false);
  });
});

test('检索：timeoutMs 预算下 LIKE 通道有界返回', () => {
  withCtx(({ store, ids, qp }) => {
    const out = searchMemories(store, { text: '备份', query: qp, timeoutMs: 1000 });
    assert.ok(Array.isArray(out.results));
    assert.deepEqual(resultIds(out), [ids.backupP, ids.mixP].sort());
    assert.ok(out.elapsedMs < 5000, '有界通道必须快速返回');
  });
});
