import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openStore, CairnStore } from '../../src/store/open.js';
import { makeTestHome, cleanupTestHome } from '../helpers.js';
import { err } from '../../src/core/errors.js';

function withStore(fn: (store: CairnStore) => void): void {
  const home = makeTestHome();
  const store = openStore({ home });
  try {
    fn(store);
  } finally {
    store.close();
    cleanupTestHome(home);
  }
}

function setupMemoryStore() {
  const home = makeTestHome();
  const store = openStore({ home });
  const scope = store.scopes.resolvePreset('personal-global');
  return { store, scope, cleanup: () => { store.close(); cleanupTestHome(home); } };
}

test('记忆：显式新增为 active，导入/推断保持候选', () => {
  const { store, scope, cleanup } = setupMemoryStore();
  try {
    const m1 = store.memories.add(
      { kind: 'preference', content: '用户偏好中文回复', scopeId: scope.id, authority: 'user_explicit', createdBy: 'cli:test' },
      store.identity.deviceId,
    );
    assert.equal(m1.status, 'active');
    assert.equal(m1.authority, 'user_explicit');
    assert.ok(m1.currentRevisionId);

    const m2 = store.memories.add(
      { kind: 'preference', content: '好像喜欢深色主题', scopeId: scope.id, authority: 'agent_inferred', createdBy: 'agent:test' },
      store.identity.deviceId,
    );
    assert.equal(m2.status, 'candidate', '推断只能是候选');

    const m3 = store.memories.add(
      { kind: 'fact', content: '导入的旧记忆', scopeId: scope.id, authority: 'imported_unverified', createdBy: 'import' },
      store.identity.deviceId,
    );
    assert.equal(m3.status, 'candidate', '导入未验证保持候选');

    const active = store.memories.list({ scopeId: scope.id, status: 'active' });
    assert.equal(active.length, 1);
  } finally {
    cleanup();
  }
});

test('记忆：instruction 只能来自用户（DB CHECK 兜底）', () => {
  const { store, scope, cleanup } = setupMemoryStore();
  try {
    assert.throws(
      () =>
        store.memories.add(
          { kind: 'instruction', content: 'x', scopeId: scope.id, authority: 'agent_inferred', createdBy: 'a' },
          store.identity.deviceId,
        ),
      /instruction/,
    );
  } finally {
    cleanup();
  }
});

test('记忆：更正形成新修订且历史不可无痕修改（supersedes 链）', () => {
  const { store, scope, cleanup } = setupMemoryStore();
  try {
    const m = store.memories.add(
      { kind: 'fact', content: '部署端口是 8080', scopeId: scope.id, authority: 'user_explicit', createdBy: 'cli' },
      store.identity.deviceId,
    );
    const rev1 = m.currentRevisionId!;
    const r1 = store.memories.revise(m.id, '部署端口改为 9090', { reason: '用户更正', author: 'cli' }, store.identity.deviceId);
    assert.equal(r1.revision.seq, 2);
    assert.deepEqual(r1.revision.parentRevisionIds, [rev1]);
    assert.equal(r1.memory.content, '部署端口改为 9090');
    assert.equal(r1.memory.status, 'active');

    // 历史修订仍可查，内容不变
    const revs = store.memories.revisions(m.id);
    assert.equal(revs.length, 2);
    assert.equal(revs[0]!.content, '部署端口是 8080');
    assert.equal(revs[0]!.id, rev1);

    // 乐观锁：expected 不匹配拒绝
    assert.throws(
      () =>
        store.memories.revise(
          m.id,
          '并发修改',
          { author: 'x', expectedCurrentRevisionId: rev1 },
          store.identity.deviceId,
        ),
      (e: unknown) => err('E_TARGET_CHANGED', '').code === (e as { code: string }).code,
    );
  } finally {
    cleanup();
  }
});

test('记忆：遗忘生成可审计 tombstone 且退出活动列表', () => {
  const { store, scope, cleanup } = setupMemoryStore();
  try {
    const m = store.memories.add(
      { kind: 'fact', content: '临时事实', scopeId: scope.id, authority: 'user_explicit', createdBy: 'cli' },
      store.identity.deviceId,
    );
    store.memories.forget(m.id, '用户要求遗忘', 'cli');
    const after = store.memories.require(m.id);
    assert.equal(after.status, 'tombstoned');
    const t = store.memories.getTombstone(m.id);
    assert.ok(t);
    assert.equal(t!.forgottenBy, 'cli');
    assert.equal(t!.contentHash, m.contentHash);
    assert.equal(store.memories.list({ scopeId: scope.id, status: 'active' }).length, 0);
    // 遗忘后不可修改
    assert.throws(() => store.memories.revise(m.id, 'x', { author: 'cli' }, store.identity.deviceId), /遗忘/);
  } finally {
    cleanup();
  }
});

test('记忆：规范化内容去重查找', () => {
  const { store, scope, cleanup } = setupMemoryStore();
  try {
    const m = store.memories.add(
      { kind: 'fact', content: '构建使用 pnpm', scopeId: scope.id, authority: 'user_explicit', createdBy: 'cli' },
      store.identity.deviceId,
    );
    const dup = store.memories.findByContentHash(scope.id, m.contentHash);
    assert.equal(dup?.id, m.id);
    // 空白差异不影响规范化哈希
    const m2 = store.memories.add(
      { kind: 'fact', content: '构建使用  pnpm ', scopeId: scope.id, authority: 'user_explicit', createdBy: 'cli' },
      store.identity.deviceId,
    );
    assert.equal(m2.contentHash, m.contentHash, '空白规范化后同哈希');
  } finally {
    cleanup();
  }
});

test('记忆：FTS trigram 索引随写入更新，中文三字以上可命中', () => {
  const { store, scope, cleanup } = setupMemoryStore();
  try {
    store.memories.add(
      { kind: 'fact', content: '项目的备份策略是每日增量', scopeId: scope.id, authority: 'user_explicit', createdBy: 'cli' },
      store.identity.deviceId,
    );
    const hits = store.db.all(
      `SELECT m.id FROM memory_fts f JOIN memory m ON m.rowid = f.rowid WHERE memory_fts MATCH ?`,
      '"备份策略"',
    );
    assert.equal(hits.length, 1, 'trigram 三字中文命中');
  } finally {
    cleanup();
  }
});
