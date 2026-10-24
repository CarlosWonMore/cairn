import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openStore, CairnStore } from '../../src/store/open.js';
import { exportData, ExportDoc, ExportOutput } from '../../src/retrieval/export.js';
import { AddMemoryInput } from '../../src/core/types.js';
import { isCairnError } from '../../src/core/errors.js';
import { sha256Hex } from '../../src/core/hash.js';
import { makeTestHome, cleanupTestHome } from '../helpers.js';

// ---------------------------------------------------------------------------
// 合成数据：全部使用 makeTestHome 合成目录与合成记忆。
// ---------------------------------------------------------------------------

interface ExportCtx {
  store: CairnStore;
  ids: {
    personal: string;
    projA: string;
    projB: string;
    dev1: string;
    m1: string;
    m2: string;
    projAMem: string;
    projBMem: string;
    dev1Mem: string;
    cand: string;
    forgotten: string;
    superseded: string;
  };
  qp: { deviceId: string; agentId: string };
  qa: { deviceId: string; agentId: string; projectId: string };
  qb: { deviceId: string; agentId: string; projectId: string };
  qDev1: { deviceId: string; agentId: string };
  cleanup: () => void;
}

function setupExportStore(): ExportCtx {
  const home = makeTestHome();
  const store = openStore({ home });
  const dev = store.identity.deviceId;
  const personal = store.scopes.resolvePreset('personal-global');
  const projA = store.scopes.resolvePreset('project-global', { projectId: 'proj-a', projectName: '项目A' });
  const projB = store.scopes.resolvePreset('project-global', { projectId: 'proj-b', projectName: '项目B' });
  const dev1 = store.scopes.resolvePreset('device-local', { deviceId: 'device-1' });

  const add = (scopeId: string, content: string, opts: Partial<AddMemoryInput> = {}): string =>
    store.memories.add(
      { kind: 'fact', content, scopeId, authority: 'user_explicit', createdBy: 'test', ...opts },
      dev,
    ).id;

  // m1：带证据 + 一次修订 + 一条关系
  const m1Rec = store.memories.add({
    kind: 'decision',
    content: '部署端口是 8080',
    scopeId: personal.id,
    authority: 'user_explicit',
    createdBy: 'test',
    evidence: [{ evidenceKind: 'user_statement', trustLevel: 'user_supplied', locator: 'session-1#m12' }],
  }, dev);
  store.memories.revise(m1Rec.id, '部署端口改为 9090', { reason: '用户更正', author: 'cli:test' }, dev);
  const m1 = m1Rec.id;
  const m2 = add(personal.id, 'sqlite 备份脚本说明', { kind: 'procedure' });
  store.memories.addRelation(m1, m2, 'related_to');

  const projAMem = add(projA.id, '项目A 的结构化检索配置');
  const projBMem = add(projB.id, '项目B 的私有部署参数');
  const dev1Mem = add(dev1.id, 'device-1 专用缓存配置');
  const cand = add(personal.id, '导入的未验证条目', { authority: 'imported_unverified' });

  // 遗忘：正文必须退出导出
  const forgottenRec = store.memories.add({ kind: 'fact', content: '内部部署流程说明书第九版', scopeId: personal.id, authority: 'user_explicit', createdBy: 'test' }, dev);
  store.memories.forget(forgottenRec.id, '用户要求遗忘', 'cli:test');

  // superseded：直接置状态（真实来源是修订链应用，测试用 SQL 构造等价 fixture）
  const superseded = add(personal.id, '旧端口约定 8080 已废弃');
  store.db.run("UPDATE memory SET status = 'superseded' WHERE id = ?", superseded);

  return {
    store,
    ids: {
      personal: personal.id, projA: projA.id, projB: projB.id, dev1: dev1.id,
      m1, m2, projAMem, projBMem, dev1Mem, cand, forgotten: forgottenRec.id, superseded,
    },
    qp: { deviceId: dev, agentId: 'agent-any' },
    qa: { deviceId: 'device-x', agentId: 'agent-x', projectId: 'proj-a' },
    qb: { deviceId: 'device-x', agentId: 'agent-x', projectId: 'proj-b' },
    qDev1: { deviceId: 'device-1', agentId: 'agent-any' },
    cleanup: () => {
      store.close();
      cleanupTestHome(home);
    },
  };
}

function withCtx(fn: (ctx: ExportCtx) => void): void {
  const ctx = setupExportStore();
  try {
    fn(ctx);
  } finally {
    ctx.cleanup();
  }
}

function parseDoc(out: ExportOutput): ExportDoc {
  return JSON.parse(out.payload) as ExportDoc;
}

// ---------------------------------------------------------------------------
// JSON 形态
// ---------------------------------------------------------------------------

test('导出：JSON 顶层形态（format/version/exportedAt/scopes/memories/tombstones）', () => {
  withCtx(({ store, ids, qp }) => {
    const doc = parseDoc(exportData(store, { query: qp, format: 'json' }));
    assert.equal(doc.format, 'cairn-export');
    assert.equal(doc.version, 1);
    assert.ok(typeof doc.exportedAt === 'string' && doc.exportedAt.length > 0);
    assert.ok(Array.isArray(doc.scopes));
    assert.ok(Array.isArray(doc.memories));
    assert.ok(Array.isArray(doc.tombstones));

    const scopeInfo = doc.scopes.find((s) => s.id === ids.personal);
    assert.ok(scopeInfo !== undefined);
    assert.equal(scopeInfo.preset, 'personal-global');
    assert.equal(scopeInfo.syncPolicy, 'encrypted');
    assert.equal(scopeInfo.projectId, null);
    assert.equal(scopeInfo.deviceId, 'all');
    assert.equal(scopeInfo.agentId, 'all');

    const m1 = doc.memories.find((m) => m.id === ids.m1);
    assert.ok(m1 !== undefined);
    // 全部字段 + revisions/evidence/relations
    for (const key of ['id', 'ownerId', 'kind', 'content', 'scopeId', 'status', 'authority', 'contentHash', 'createdAt', 'updatedAt'] as const) {
      assert.ok(key in m1, `memory 条目必须包含字段 ${key}`);
    }
    assert.ok(Array.isArray(m1.revisions));
    assert.ok(Array.isArray(m1.evidence));
    assert.ok(Array.isArray(m1.relations));
  });
});

test('导出：遗忘后 memories[] 无该条、tombstones[] 有且无正文', () => {
  withCtx(({ store, ids, qp }) => {
    const out = exportData(store, { query: qp, format: 'json' });
    const doc = parseDoc(out);
    assert.ok(!doc.memories.some((m) => m.id === ids.forgotten), '被遗忘记忆不得出现在 memories[]');
    assert.equal(doc.tombstones.length, 1);
    const t = doc.tombstones[0];
    assert.ok(t !== undefined);
    assert.equal(t.memoryId, ids.forgotten);
    assert.equal(t.forgottenBy, 'cli:test');
    assert.equal(t.reason, '用户要求遗忘');
    assert.ok(typeof t.forgottenAt === 'string' && t.forgottenAt.length > 0);
    const mem = store.memories.get(ids.forgotten);
    assert.ok(mem != null && t.contentHash === mem.contentHash, 'tombstone 携带内容哈希用于审计');
    assert.ok(!('content' in t), 'tombstone 绝不携带正文');
    assert.ok(!out.payload.includes('内部部署流程说明书'), '导出全文不得出现被遗忘正文');
  });
});

test('导出：修订历史包含在导出中', () => {
  withCtx(({ store, ids, qp }) => {
    const doc = parseDoc(exportData(store, { query: qp, format: 'json' }));
    const m1 = doc.memories.find((m) => m.id === ids.m1);
    assert.ok(m1 !== undefined);
    assert.equal(m1.revisions.length, 2);
    assert.equal(m1.revisions[1]?.seq, 2);
    assert.equal(m1.revisions[1]?.content, '部署端口改为 9090');
    assert.equal(m1.revisions[1]?.reason, '用户更正');
  });
});

test('导出：证据包含在导出中且信任级别保留', () => {
  withCtx(({ store, ids, qp }) => {
    const doc = parseDoc(exportData(store, { query: qp, format: 'json' }));
    const m1 = doc.memories.find((m) => m.id === ids.m1);
    assert.ok(m1 !== undefined);
    assert.equal(m1.evidence.length, 1);
    const ev = m1.evidence[0];
    assert.ok(ev !== undefined);
    assert.equal(ev.evidenceKind, 'user_statement');
    assert.equal(ev.trustLevel, 'user_supplied');
    assert.equal(ev.locator, 'session-1#m12');
  });
});

test('导出：关系包含在导出中', () => {
  withCtx(({ store, ids, qp }) => {
    const doc = parseDoc(exportData(store, { query: qp, format: 'json' }));
    const m1 = doc.memories.find((m) => m.id === ids.m1);
    assert.ok(m1 !== undefined);
    assert.equal(m1.relations.length, 1);
    const rel = m1.relations[0];
    assert.ok(rel !== undefined);
    assert.equal(rel.relationType, 'related_to');
    assert.equal(rel.toMemoryId, ids.m2);
  });
});

test('导出：scopeIds 白名单过滤生效', () => {
  withCtx(({ store, ids, qDev1 }) => {
    const out = exportData(store, { query: qDev1, format: 'json', scopeIds: [ids.dev1] });
    const doc = parseDoc(out);
    assert.equal(out.counts.memories, 1);
    assert.deepEqual(doc.memories.map((m) => m.id), [ids.dev1Mem]);

    const out2 = exportData(store, { query: qDev1, format: 'json', scopeIds: [ids.personal] });
    const doc2 = parseDoc(out2);
    assert.ok(doc2.memories.every((m) => m.scopeId === ids.personal), '白名单外的设备作用域不得出现');
    assert.ok(!doc2.memories.some((m) => m.id === ids.dev1Mem));
  });
});

test('导出：scopeIds 传不存在的 id → E_NOT_FOUND', () => {
  withCtx(({ store, qp }) => {
    assert.throws(
      () => exportData(store, { query: qp, format: 'json', scopeIds: ['no-such-scope'] }),
      (e: unknown) => isCairnError(e) && e.code === 'E_NOT_FOUND',
    );
  });
});

test('导出：项目 A 身份导出不含项目 B 与设备本地内容', () => {
  withCtx(({ store, ids, qa }) => {
    const out = exportData(store, { query: qa, format: 'json' });
    const doc = parseDoc(out);
    const exportIds = doc.memories.map((m) => m.id);
    assert.ok(exportIds.includes(ids.projAMem));
    assert.ok(!exportIds.includes(ids.projBMem), '项目 B 记忆不得出现在项目 A 身份的导出中');
    assert.ok(!exportIds.includes(ids.dev1Mem));
    assert.ok(!out.payload.includes('项目B 的私有部署参数'), '正文零泄漏');
  });
});

test('导出：statuses 默认只含 active；candidate 显式请求才出现', () => {
  withCtx(({ store, ids, qp }) => {
    const doc = parseDoc(exportData(store, { query: qp, format: 'json' }));
    const exportIds = doc.memories.map((m) => m.id);
    assert.ok(!exportIds.includes(ids.cand), 'candidate 默认不导出');
    assert.ok(exportIds.includes(ids.m1));

    const out2 = exportData(store, { query: qp, format: 'json', statuses: ['candidate'] });
    const doc2 = parseDoc(out2);
    assert.deepEqual(doc2.memories.map((m) => m.id), [ids.cand]);
    assert.equal(doc2.memories[0]?.authority, 'imported_unverified', '不得伪装成用户确认权威');
  });
});

test('导出：superseded 记忆既不入 memories[] 也不入 tombstones[]', () => {
  withCtx(({ store, ids, qp }) => {
    const out = exportData(store, { query: qp, format: 'json' });
    const doc = parseDoc(out);
    assert.ok(!doc.memories.some((m) => m.id === ids.superseded));
    assert.ok(doc.tombstones.every((t) => t.memoryId !== ids.superseded), 'superseded 不是遗忘，不得进入 tombstones');
    assert.ok(!out.payload.includes('旧端口约定 8080 已废弃'), 'superseded 正文零泄漏');
  });
});

// ---------------------------------------------------------------------------
// Markdown 形态
// ---------------------------------------------------------------------------

test('导出：markdown 含 cairn managed export 头与记忆正文', () => {
  withCtx(({ store, ids, qp }) => {
    const out = exportData(store, { query: qp, format: 'markdown' });
    assert.ok(out.payload.startsWith('# cairn managed export'), '文件头必须注明 cairn managed export');
    assert.ok(out.payload.includes('sqlite 备份脚本说明'), '正文保留');
    assert.ok(out.payload.includes('部署端口改为 9090'), '修订正文保留');
    assert.ok(out.payload.includes('## Scope personal-global'), '按作用域分组');
    assert.ok(out.payload.includes(ids.m2), '记忆 id 可追溯');
  });
});

test('导出：markdown tombstone 区块只含哈希与审计字段', () => {
  withCtx(({ store, ids, qp }) => {
    const out = exportData(store, { query: qp, format: 'markdown' });
    assert.ok(out.payload.includes('## Forgotten memories (tombstones)'));
    assert.ok(out.payload.includes(`contentHash=`));
    assert.ok(!out.payload.includes('内部部署流程说明书'), '正文零泄漏');
  });
});

// ---------------------------------------------------------------------------
// 导入档案附带
// ---------------------------------------------------------------------------

test('导出：includeArchives 只附带 scan_state=clean 条目', () => {
  withCtx(({ store, qp }) => {
    const archive = store.archives.createArchive({
      batchId: 'batch-1',
      sourceKind: 'markdown',
      sourceLocator: '/tmp/notes.md',
      byteSize: 120,
      contentHash: sha256Hex('notes'),
      snapshotPath: 'snapshots/notes',
      parser: 'markdown-v1',
    }).archive;
    store.archives.addItem({ archiveId: archive.id, itemIndex: 0, content: '干净的导入条目', scanState: 'clean' });
    store.archives.addItem({ archiveId: archive.id, itemIndex: 1, content: '被拦截的导入条目', scanState: 'blocked' });

    const out = exportData(store, { query: qp, format: 'json', includeArchives: true });
    const doc = parseDoc(out);
    assert.ok(Array.isArray(doc.archives));
    assert.equal(doc.archives?.length, 1);
    const a = doc.archives?.[0];
    assert.ok(a !== undefined);
    assert.equal(a.id, archive.id);
    assert.equal(a.batchId, 'batch-1');
    assert.equal(a.parser, 'markdown-v1');
    assert.equal(a.items.length, 1, 'blocked 条目不得附带');
    assert.equal(a.items[0]?.content, '干净的导入条目');
    assert.equal(a.items[0]?.itemIndex, 0);
    assert.equal(out.counts.archives, 1);
    assert.ok(!out.payload.includes('被拦截的导入条目'), 'blocked 正文零泄漏');
  });
});

test('导出：默认不附带 archives（includeArchives 缺省）', () => {
  withCtx(({ store, qp }) => {
    const archive = store.archives.createArchive({
      batchId: 'batch-2',
      sourceKind: 'jsonl',
      sourceLocator: '/tmp/notes.jsonl',
      byteSize: 60,
      contentHash: sha256Hex('notes2'),
      snapshotPath: 'snapshots/notes2',
      parser: 'jsonl-v1',
    }).archive;
    store.archives.addItem({ archiveId: archive.id, itemIndex: 0, content: '条目内容', scanState: 'clean' });

    const out = exportData(store, { query: qp, format: 'json' });
    const doc = parseDoc(out);
    assert.equal(doc.archives, undefined, '缺省时不得出现 archives 键');
    assert.equal(out.counts.archives, undefined);
  });
});

// ---------------------------------------------------------------------------
// 幂等与计数
// ---------------------------------------------------------------------------

test('导出：同一记忆 contentHash 两次导出稳定，且与库字段一致', () => {
  withCtx(({ store, ids, qp }) => {
    const doc1 = parseDoc(exportData(store, { query: qp, format: 'json' }));
    const doc2 = parseDoc(exportData(store, { query: qp, format: 'json' }));
    const h1 = doc1.memories.find((m) => m.id === ids.m1)?.contentHash;
    const h2 = doc2.memories.find((m) => m.id === ids.m1)?.contentHash;
    assert.ok(h1 != null && h1.length > 0);
    assert.equal(h1, h2, '两次导出哈希一致（重复导入幂等基础）');
    assert.equal(h1, store.memories.get(ids.m1)?.contentHash);
  });
});

test('导出：counts 与导出数组一致', () => {
  withCtx(({ store, qp }) => {
    const out = exportData(store, { query: qp, format: 'json' });
    const doc = parseDoc(out);
    assert.equal(out.counts.memories, doc.memories.length);
    assert.equal(out.counts.revisions, doc.memories.reduce((acc, m) => acc + m.revisions.length, 0));
    assert.equal(out.counts.evidence, doc.memories.reduce((acc, m) => acc + m.evidence.length, 0));
    assert.ok(out.counts.memories > 0, '必须有非零导出（合成数据齐全）');
    assert.ok(out.counts.revisions > 1);
  });
});

// ---------------------------------------------------------------------------
// 非法输入
// ---------------------------------------------------------------------------

test('导出：format 非法 → E_VALIDATION', () => {
  withCtx(({ store, qp }) => {
    assert.throws(
      () => exportData(store, { query: qp, format: 'html' as never }),
      (e: unknown) => isCairnError(e) && e.code === 'E_VALIDATION',
    );
  });
});

test('导出：statuses 含 tombstoned / superseded → E_VALIDATION', () => {
  withCtx(({ store, qp }) => {
    assert.throws(
      () => exportData(store, { query: qp, format: 'json', statuses: ['active', 'tombstoned'] }),
      (e: unknown) => isCairnError(e) && e.code === 'E_VALIDATION',
    );
    assert.throws(
      () => exportData(store, { query: qp, format: 'json', statuses: ['superseded'] }),
      (e: unknown) => isCairnError(e) && e.code === 'E_VALIDATION',
    );
  });
});

test('导出：exportData 只读（不改动记忆行）', () => {
  withCtx(({ store, ids, qp }) => {
    const before = store.memories.get(ids.m1);
    exportData(store, { query: qp, format: 'json' });
    exportData(store, { query: qp, format: 'markdown' });
    const after = store.memories.get(ids.m1);
    assert.deepEqual(after, before, '导出不得写库');
  });
});
