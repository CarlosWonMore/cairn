import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { AppService } from '../../src/interfaces/app-service.js';
import { makeTestHome, cleanupTestHome } from '../helpers.js';
import { cliEntry } from '../spawn-target.js';

/**
 * `cairn revision`（add-agent-managed-revision 任务 4.6）：
 * apply 退出码、陈旧时退出码 4、拒绝对记忆零影响、批量逐条报告。
 */

function runCli(home: string, args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const target = cliEntry();
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [...target.loader, target.file, '--home', home, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (c) => (stdout += String(c)));
    p.stderr.on('data', (c) => (stderr += String(c)));
    p.on('close', (code) => resolve({ code, stdout, stderr }));
    p.on('error', reject);
  });
}

interface Seed {
  home: string;
  memoryId: string;
  proposalId: string;
  service: AppService;
}

/** 返回时 service 仍开着；用完必须先 close 再 spawn CLI（Windows 句柄）。 */
function seed(): Seed {
  const home = makeTestHome('cairn-rev-cli-');
  const service = AppService.open(home);
  const memoryId = service.addMemory({ content: '原正文：部署入口是 deploy.mjs' }).memory!.id;
  const ann = service.annotateMemory({ memoryId, disposition: 'needs_edit', note: '措辞含糊' });
  const rec = service.proposeRevisionProposal({
    memoryId,
    afterContent: '新正文：部署入口是 scripts/deploy.mjs，先跑 doctor',
    reason: '按批注补全路径',
    annotationId: ann.id,
  });
  return { home, memoryId, proposalId: rec.id, service };
}

test('revision apply：采纳成功（权威 user_confirmed）+ 批注关联可见', async () => {
  const s = seed();
  try {
    s.service.close();
    const r = await runCli(s.home, ['--json', 'revision', 'apply', s.proposalId]);
    assert.equal(r.code, 0, r.stderr);
    const j = JSON.parse(r.stdout) as { applied: number };
    assert.equal(j.applied, 1);

    const svc = AppService.open(s.home);
    try {
      const mem = svc.store.memories.require(s.memoryId);
      assert.equal(mem.authority, 'user_confirmed', '采纳后的权威是人已确认');
      assert.equal(mem.content, '新正文：部署入口是 scripts/deploy.mjs，先跑 doctor');
      const list = svc.listRevisionProposals({ status: 'applied' });
      assert.equal(list.length, 1);
      assert.ok(list[0]!.annotationId!.startsWith('ann_'));
    } finally {
      svc.close();
    }
  } finally {
    cleanupTestHome(s.home);
  }
});

test('revision apply：陈旧提案退出码 4，记忆保持不变', async () => {
  const s = seed();
  try {
    s.service.reviseMemory(s.memoryId, '人事先改了一版', { reason: '人工更正' });
    s.service.close();
    const r = await runCli(s.home, ['--json', 'revision', 'apply', s.proposalId]);
    assert.equal(r.code, 4, `陈旧应退 4，实际 ${r.code}: ${r.stdout}`);

    const svc = AppService.open(s.home);
    try {
      assert.equal(svc.store.memories.require(s.memoryId).content, '人事先改了一版', '陈旧拒绝时记忆不变');
      assert.equal(svc.listRevisionProposals({ status: 'stale' }).length, 1);
    } finally {
      svc.close();
    }
  } finally {
    cleanupTestHome(s.home);
  }
});

test('revision reject：拒绝对记忆零影响，且不再出现在待办', async () => {
  const s = seed();
  try {
    s.service.close();
    const r = await runCli(s.home, ['--json', 'revision', 'reject', s.proposalId, '理由不成立']);
    assert.equal(r.code, 0, r.stderr);

    const svc = AppService.open(s.home);
    try {
      assert.equal(svc.store.memories.require(s.memoryId).content, '原正文：部署入口是 deploy.mjs');
      const rejected = svc.listRevisionProposals({ status: 'rejected' });
      assert.equal(rejected.length, 1);
      assert.equal(rejected[0]!.rejectReason, '理由不成立');
      assert.equal(svc.listRevisionProposals({ status: 'pending' }).length, 0);
    } finally {
      svc.close();
    }
  } finally {
    cleanupTestHome(s.home);
  }
});

test('revision apply --all：批量逐条报告，单条失败不影响其余', async () => {
  const s = seed();
  try {
    // 先采纳种子卡，让待审列表只剩本用例造的两张
    s.service.applyRevisionProposal(s.proposalId);
    const second = s.service.addMemory({ content: '第二条记忆' }).memory!.id;
    const staleId = s.service.proposeRevisionProposal({ memoryId: s.memoryId, afterContent: '会陈旧的正文', reason: 'r' }).id;
    s.service.reviseMemory(s.memoryId, '让人先改掉', { reason: '人工' });
    const okId = s.service.proposeRevisionProposal({ memoryId: second, afterContent: '第二条的新正文', reason: 'r2' }).id;
    s.service.close();

    const r = await runCli(s.home, ['--json', 'revision', 'apply', '--all']);
    assert.equal(r.code, 0, r.stderr);
    const j = JSON.parse(r.stdout) as { applied: number; results: { id: string; ok: boolean; reason?: string }[] };
    assert.equal(j.applied, 1, '1 张成功');
    assert.equal(j.results.length, 2, '2 张都被逐条报告（1 成功 1 失败）');
    assert.ok(j.results.find((x) => x.id === staleId && !x.ok), '陈旧卡如实报告失败');
    assert.ok(j.results.find((x) => x.id === okId && x.ok), '有效卡正常采纳');

    const svc = AppService.open(s.home);
    try {
      assert.equal(svc.store.memories.require(second).content, '第二条的新正文');
    } finally {
      svc.close();
    }
  } finally {
    cleanupTestHome(s.home);
  }
});
