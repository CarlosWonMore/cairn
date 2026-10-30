import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../../src/store/index.js';
import type { CairnStore } from '../../src/store/index.js';
import { makeTestHome, cleanupTestHome } from '../helpers.js';
import { findDuplicate, findDuplicateByHash } from '../../src/governance/dedup.js';
import { contentHash } from '../../src/core/hash.js';

function setup() {
  const home = makeTestHome('cairn-dedup-');
  const store = openStore({ home });
  const personal = store.scopes.resolvePreset('personal-global', {});
  const device = store.scopes.resolvePreset('device-local', { deviceId: store.identity.deviceId });
  return {
    store,
    personalId: personal.id,
    deviceId: device.id,
    cleanup() {
      store.close();
      cleanupTestHome(home);
    },
  };
}

function write(store: CairnStore, scopeId: string, content: string, authority: 'user_explicit' | 'agent_inferred' = 'user_explicit'): string {
  return store.memories.add(
    { kind: 'fact', content, scopeId, authority, createdBy: 'test' },
    store.identity.deviceId,
  ).id;
}

test('同作用域同正文 → 命中', () => {
  const s = setup();
  try {
    const id = write(s.store, s.personalId, '生产环境数据库端口是 5433');
    const hit = findDuplicate(s.store.db, s.personalId, '生产环境数据库端口是 5433');
    assert.ok(hit);
    assert.equal(hit.memoryId, id);
    assert.equal(hit.status, 'active');
  } finally {
    s.cleanup();
  }
});

test('空白与换行差异仍判为同一条（规范化后比较）', () => {
  const s = setup();
  try {
    write(s.store, s.personalId, '生产环境数据库端口是 5433');
    const hit = findDuplicate(s.store.db, s.personalId, '  生产环境数据库端口是\t5433  \n');
    assert.ok(hit, '压缩空白与去首尾后应命中');
  } finally {
    s.cleanup();
  }
});

test('不同作用域各自独立：跨作用域不算重复', () => {
  const s = setup();
  try {
    write(s.store, s.personalId, '我的常用编辑器是 Zed');
    assert.equal(findDuplicate(s.store.db, s.deviceId, '我的常用编辑器是 Zed'), null);
  } finally {
    s.cleanup();
  }
});

test('archived 不算重复（归档是保留，不是退出活动集）', () => {
  const s = setup();
  try {
    const id = write(s.store, s.personalId, '构建命令是 pnpm build');
    s.store.memories.archive(id);
    assert.equal(findDuplicate(s.store.db, s.personalId, '构建命令是 pnpm build'), null, '重新记下同一件事是恢复意图');
  } finally {
    s.cleanup();
  }
});

test('tombstoned 不算重复（遗忘之后可以重新记）', () => {
  const s = setup();
  try {
    const id = write(s.store, s.personalId, '临时约定：本周冻结主干');
    s.store.memories.forget(id, '内容已过期', 'user');
    assert.equal(findDuplicate(s.store.db, s.personalId, '临时约定：本周冻结主干'), null);
  } finally {
    s.cleanup();
  }
});

test('candidate 命中且状态如实返回', () => {
  const s = setup();
  try {
    const id = write(s.store, s.personalId, 'Agent 推断：该服务默认超时 30 秒', 'agent_inferred');
    const hit = findDuplicate(s.store.db, s.personalId, 'Agent 推断：该服务默认超时 30 秒');
    assert.ok(hit);
    assert.equal(hit.memoryId, id);
    assert.equal(hit.status, 'candidate');
  } finally {
    s.cleanup();
  }
});

test('同时存在 active 与 candidate 时优先返回 active', () => {
  const s = setup();
  try {
    const content = '发布流程第一步是冻结主干分支';
    const candId = write(s.store, s.personalId, content, 'agent_inferred');
    const activeId = write(s.store, s.personalId, content, 'user_explicit');
    const hit = findDuplicate(s.store.db, s.personalId, content);
    assert.equal(hit?.memoryId, activeId, '应优先并入已经生效的那一条');
    assert.notEqual(hit?.memoryId, candId);
  } finally {
    s.cleanup();
  }
});

test('findDuplicateByHash 与 findDuplicate 结论一致', () => {
  const s = setup();
  try {
    const content = '接口约定：错误一律走 error.code';
    const id = write(s.store, s.personalId, content);
    const byContent = findDuplicate(s.store.db, s.personalId, content);
    const byHash = findDuplicateByHash(s.store.db, s.personalId, contentHash(content));
    assert.equal(byContent?.memoryId, id);
    assert.equal(byHash?.memoryId, id);
  } finally {
    s.cleanup();
  }
});

test('空内容直接拒绝，不返回"无重复"这种会被误读的结论', () => {
  const s = setup();
  try {
    assert.throws(() => findDuplicate(s.store.db, s.personalId, '   \n\t '), /E_VALIDATION|不能为空|为空/);
  } finally {
    s.cleanup();
  }
});

test('索引存在：memory_scope_content 是唯一以 (scope_id, content_hash) 为键的索引', () => {
  const s = setup();
  try {
    const rows = s.store.db.all("PRAGMA index_list('memory')");
    const names = rows.map((r) => String(r.name));
    assert.ok(names.includes('memory_scope_content'), `缺少去重索引，实际：${names.join(', ')}`);
    const cols = s.store.db.all("PRAGMA index_info('memory_scope_content')").map((r) => String(r.name));
    assert.deepEqual(cols, ['scope_id', 'content_hash']);
    // 必须是非唯一：唯一索引会与 keep_both 冲突（design D4）
    const entry = rows.find((r) => String(r.name) === 'memory_scope_content')!;
    assert.equal(Number(entry.unique), 0, '去重索引不得为 UNIQUE');
  } finally {
    s.cleanup();
  }
});
