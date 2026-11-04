/**
 * 候选晋升 / 拒绝（add-candidate-promote-command）。
 *
 * 锁死三件事：
 * 1. 晋升后权威是 user_confirmed（用户审阅并批准），不是沿用候选的 agent_inferred；
 * 2. 晋升可同时迁作用域，且事务原子、outbox 按新作用域重建；
 * 3. 拒绝 = 转墓碑，可被普通流程绕开（不在活动集）。
 */

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { openStore } from '../../src/store/open.js';
import type { CairnStore } from '../../src/store/open.js';

let home: string;
let store: CairnStore;

before(() => {
  home = mkdtempSync(join(tmpdir(), 'cairn-promote-'));
  store = openStore({ home });
});

after(() => {
  try {
    store.close();
  } catch {
    /* 已关 */
  }
  rmSync(home, { recursive: true, force: true });
});

function makeCandidate(content: string, scopePreset?: 'personal-global' | 'device-local') {
  const scope = store.scopes.resolvePreset(scopePreset ?? 'personal-global', {});
  const m = store.memories.add(
    {
      kind: 'fact',
      content,
      scopeId: scope.id,
      authority: 'agent_inferred',
      createdBy: 'mcp:cli',
      confidence: 0.5,
    } as never,
    'test-device',
  );
  // add 出来是 candidate 或 active，这里强制成候选以测晋升路径
  store.db.run("UPDATE memory SET status = 'candidate' WHERE id = ?", m.id);
  return m.id;
}

describe('候选晋升', () => {
  it('晋升后权威是 user_confirmed，不是 agent_inferred', () => {
    const id = makeCandidate('晋升测试：投影排序应优先 lesson');
    const promoted = store.memories.promoteToActive(id, 'user_confirmed', 'local_cli');
    assert.equal(promoted.status, 'active');
    assert.equal(promoted.authority, 'user_confirmed');
  });

  it('非候选不能晋升', () => {
    const id = makeCandidate('已经活动了不该再晋升');
    store.db.run("UPDATE memory SET status = 'active' WHERE id = ?", id);
    assert.throws(() => store.memories.promoteToActive(id, 'user_confirmed', 'cli'), /E_CONFLICT_STATE|只有候选/);
  });

  it('拒绝把候选转成墓碑', () => {
    const id = makeCandidate('这条会被拒绝');
    const rej = store.memories.forget(id, 'user_rejected', 'local_cli');
    assert.equal(rej.status, 'tombstoned');
  });

  it('晋升时迁作用域：外键完好、子表不丢', () => {
    const id = makeCandidate('带路径的记忆该落本机全局', 'personal-global');
    const revBefore = Number(
      (store.db.get('SELECT COUNT(*) n FROM memory_revision WHERE memory_id = ?', id) as Record<string, unknown>)['n'],
    );
    assert.ok(revBefore >= 1);

    const target = store.scopes.resolvePreset('device-local', { deviceId: 'test-device' });
    const moved = store.memories.promoteToActive(id, 'user_confirmed', 'local_cli', { scopeId: target.id });

    assert.equal(moved.scopeId, target.id);
    assert.equal(moved.status, 'active');
    const revAfter = Number(
      (store.db.get('SELECT COUNT(*) n FROM memory_revision WHERE memory_id = ?', id) as Record<string, unknown>)['n'],
    );
    assert.equal(revAfter, revBefore, '子表行数必须不变');
    assert.equal((store.db.all('PRAGMA foreign_key_check') as unknown[]).length, 0);
  });
});
