/**
 * 宿主配置 plan → apply → doctor → uninstall 测试（tasks 8.2/8.3）。
 *
 * 关键证据点：
 * - plan 零写入（observe 与 router 都断言 mtime+bytes 不变）；
 * - MCP 合并保留未知顶层字段与其他 server，同名外来条目拒绝；
 * - 目标变化 / 签名篡改 → E_TARGET_CHANGED；
 * - apply 幂等；uninstall 恢复原字节；五宿主各跑完整循环。
 */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import {
  applyAgentConfig,
  doctorAgentConfig,
  planAgentConfig,
  planHash,
  planSignature,
  uninstallAgentConfig,
  ROUTER_BLOCK_CONTENT,
} from '../../src/agents/config.js';
import type { AgentConfigPlan } from '../../src/agents/config.js';
import type { AgentKind } from '../../src/agents/adapters.js';
import { isCairnError } from '../../src/core/errors.js';
import { openStore, type CairnStore } from '../../src/store/open.js';
import { hasCairnMarker } from '../../src/projection/markdown.js';

const MCP_CMD: { command: string; args: string[] } = { command: 'cairn-mcp', args: ['--stdio'] };

async function putFile(p: string, content: string): Promise<void> {
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, content, 'utf8');
}

async function readOrNull(p: string): Promise<Buffer | null> {
  try {
    return await readFile(p);
  } catch {
    return null;
  }
}

function forCode(code: string) {
  return (e: unknown): boolean => isCairnError(e) && e.code === code;
}

interface Snapshot {
  bytes: (Buffer | null)[];
  mtimes: (number | null)[];
  entries: string[];
}

async function snapshot(store: CairnStore, paths: string[], dir: string): Promise<Snapshot> {
  const bytes: (Buffer | null)[] = [];
  const mtimes: (number | null)[] = [];
  for (const p of paths) {
    const buf = await readOrNull(p);
    bytes.push(buf);
    if (buf !== null) {
      mtimes.push((await stat(p)).mtimeMs);
    } else {
      mtimes.push(null);
    }
  }
  void store;
  let entries: string[] = [];
  try {
    entries = await readdir(dir, { recursive: true });
  } catch {
    entries = [];
  }
  return { bytes, mtimes, entries };
}

function assertSameSnapshot(before: Snapshot, after: Snapshot, label: string): void {
  for (let i = 0; i < before.bytes.length; i++) {
    const b = before.bytes[i]!;
    const a = after.bytes[i]!;
    if (b === null || a === null) {
      assert.equal(b, a, `${label}: 文件存在性不得变化 (#${i})`);
    } else {
      assert.ok(b.equals(a), `${label}: 文件字节不得变化 (#${i})`);
    }
    assert.equal(before.mtimes[i], after.mtimes[i], `${label}: mtime 不得变化 (#${i})`);
  }
  assert.deepEqual(after.entries, before.entries, `${label}: 目录不得新增/删除文件`);
}

async function applyOk(store: CairnStore, plan: AgentConfigPlan) {
  return applyAgentConfig(store, { plan, signature: planSignature(plan) });
}

describe('planAgentConfig / planHash', () => {
  let root = '';
  let store: CairnStore;
  before(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'cairn-agents-plan-'));
    store = openStore({ home: path.join(root, 'cairn-home') });
  });
  after(async () => {
    store.close();
    await rm(root, { recursive: true, force: true });
  });

  it('observe 模式：零 actions、零写入（bytes+mtime+目录项硬断言）', async () => {
    const home = path.join(root, 'obs', 'home');
    const project = path.join(root, 'obs', 'project');
    const claudeMd = path.join(project, 'CLAUDE.md');
    const mcpJson = path.join(project, '.mcp.json');
    await putFile(claudeMd, '# 项目规则\n\n原有内容\n');
    await putFile(mcpJson, '{"mcpServers":{"other":{"command":"o"}}}\n');
    const snapBefore = await snapshot(store, [claudeMd, mcpJson], project);

    const plan = await planAgentConfig(store, {
      agentKind: 'claude-code',
      homeRoot: home,
      projectRoot: project,
      mode: 'observe',
    });
    assert.deepEqual(plan.actions, [], 'observe 必须零 actions');
    assert.deepEqual(plan.conflicts, []);
    assert.equal(plan.capability, 'fixture-only');
    const snapAfter = await snapshot(store, [claudeMd, mcpJson], project);
    assertSameSnapshot(snapBefore, snapAfter, 'observe plan 不得写任何文件');
  });

  it('router（claude-code）：actions 含 CLAUDE.md 块与 .mcp.json 条目，capability=fixture-only；plan 本身零写入', async () => {
    const home = path.join(root, 'router', 'home');
    const project = path.join(root, 'router', 'project');
    const claudeMd = path.join(project, 'CLAUDE.md');
    const mcpJson = path.join(project, '.mcp.json');
    await putFile(claudeMd, '# 项目规则\n\n原有内容\n');
    await putFile(mcpJson, '{"mcpServers":{"other":{"command":"o"}},"customTop":{"keep":1}}\n');
    const snapBefore = await snapshot(store, [claudeMd, mcpJson], project);

    const plan = await planAgentConfig(store, {
      agentKind: 'claude-code',
      homeRoot: home,
      projectRoot: project,
      mode: 'router',
      mcpCommand: MCP_CMD,
    });
    const types = plan.actions.map((a) => a.type);
    assert.ok(types.includes('write_managed_block'), '必须有块写动作');
    assert.ok(types.includes('write_mcp_config'), '必须有 MCP 写动作');
    assert.equal(plan.capability, 'fixture-only');
    const block = plan.actions.find((a) => a.type === 'write_managed_block')!;
    assert.equal(block.path, claudeMd);
    assert.ok(block.after!.includes(ROUTER_BLOCK_CONTENT));
    assert.ok(block.before!.includes('原有内容'));
    const mcpAction = plan.actions.find((a) => a.type === 'write_mcp_config')!;
    assert.equal(mcpAction.path, mcpJson);
    const snapAfter = await snapshot(store, [claudeMd, mcpJson], project);
    assertSameSnapshot(snapBefore, snapAfter, 'router plan 同样必须零写入');
  });

  it('planHash：确定性、规范化（字段顺序不敏感）、内容敏感；planSignature 为别名', async () => {
    const home = path.join(root, 'hash', 'home');
    const p1 = await planAgentConfig(store, { agentKind: 'cursor', homeRoot: home, mode: 'router' });
    const p2 = await planAgentConfig(store, { agentKind: 'cursor', homeRoot: home, mode: 'router' });
    assert.equal(planHash(p1), planHash(p2), '同一状态重复 plan → 同一哈希');
    assert.equal(planSignature(p1), planHash(p1), 'planSignature 是 planHash 别名');
    const p3 = await planAgentConfig(store, { agentKind: 'cursor', homeRoot: home, mode: 'observe' });
    assert.notEqual(planHash(p1), planHash(p3), '模式不同 → 哈希不同');
    // 规范化：键顺序不同的等价对象哈希一致
    const reordered = { notes: p1.notes, capability: p1.capability, conflicts: p1.conflicts, actions: p1.actions, mode: p1.mode, projectRoot: p1.projectRoot, homeRoot: p1.homeRoot, agentKind: p1.agentKind };
    assert.equal(planHash(p1), planHash(reordered as unknown as AgentConfigPlan), '字段顺序不影响规范化哈希');
  });
});

describe('applyAgentConfig：合并、冲突、目标校验、幂等、卸载', () => {
  let root = '';
  let store: CairnStore;
  before(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'cairn-agents-apply-'));
    store = openStore({ home: path.join(root, 'cairn-home') });
  });
  after(async () => {
    store.close();
    await rm(root, { recursive: true, force: true });
  });

  it('apply：.mcp.json 合法 JSON 且未知顶层字段与其他 server 逐字保留；CLAUDE.md 原有内容保留；有安装记录与审计', async () => {
    const home = path.join(root, 'apply', 'home');
    const project = path.join(root, 'apply', 'project');
    const claudeMd = path.join(project, 'CLAUDE.md');
    const mcpJson = path.join(project, '.mcp.json');
    const originalMd = '# 项目规则\n\n- 原有规则一\n- 原有规则二\n';
    const originalJson = JSON.stringify(
      { mcpServers: { other: { command: 'other-cmd', args: ['-x'] } }, customTopLevel: { keep: true } },
      null,
      2,
    ) + '\n';
    await putFile(claudeMd, originalMd);
    await putFile(mcpJson, originalJson);

    const plan = await planAgentConfig(store, {
      agentKind: 'claude-code',
      homeRoot: home,
      projectRoot: project,
      mode: 'router',
      mcpCommand: MCP_CMD,
    });
    const r = await applyOk(store, plan);
    assert.equal(r.applied.length, 2);
    assert.deepEqual(r.skipped, []);

    const merged = JSON.parse(await readFile(mcpJson, 'utf8')) as Record<string, unknown>;
    assert.deepEqual(merged['mcpServers'], {
      other: { command: 'other-cmd', args: ['-x'] },
      cairn: { command: MCP_CMD.command, args: [...MCP_CMD.args] },
    }, 'cairn 条目加入且既有 server 保留');
    assert.deepEqual(merged['customTopLevel'], { keep: true }, '未知顶层字段保留');

    const mdText = await readFile(claudeMd, 'utf8');
    assert.ok(hasCairnMarker(mdText), 'CLAUDE.md 必须含受管块');
    assert.ok(mdText.startsWith('# 项目规则\n\n- 原有规则一\n- 原有规则二\n\n'), '块外原有内容逐字节保留');

    const inst = store.installations.activeFor('claude-code', home);
    assert.equal(inst.length, 2, '块与 MCP 各一条安装记录');
    assert.ok(inst.every((i) => i.backupPath !== null), '首次应用前都有备份');

    const audit = store.audit.recent(50).filter((e) => e.category === 'config' && e.action === 'applied');
    assert.ok(audit.length >= 2, '必须留审计');
    for (const e of audit) {
      assert.ok(!JSON.stringify(e.detail).includes(ROUTER_BLOCK_CONTENT), '审计不得包含区块正文');
    }
  });

  it('同名外来条目：plan 报冲突且不出 MCP 写动作；apply → E_CONFIG_CONFLICT 且文件未被改动', async () => {
    const home = path.join(root, 'conflict', 'home');
    const project = path.join(root, 'conflict', 'project');
    const claudeMd = path.join(project, 'CLAUDE.md');
    const mcpJson = path.join(project, '.mcp.json');
    await putFile(claudeMd, '# 规则\n');
    const foreignJson = '{"mcpServers":{"cairn":{"command":"evil","args":[]}},"keep":1}\n';
    await putFile(mcpJson, foreignJson);
    const before = await readFile(mcpJson);

    const plan = await planAgentConfig(store, {
      agentKind: 'claude-code',
      homeRoot: home,
      projectRoot: project,
      mode: 'router',
      mcpCommand: MCP_CMD,
    });
    assert.equal(plan.conflicts.length, 1, '必须报告同名外来条目冲突');
    assert.equal(plan.conflicts[0]!.path, mcpJson);
    assert.ok(!plan.actions.some((a) => a.type === 'write_mcp_config'), '冲突时不生成 MCP 写动作');

    await assert.rejects(applyOk(store, plan), forCode('E_CONFIG_CONFLICT'));
    assert.ok((await readFile(mcpJson)).equals(before), '冲突时 MCP 配置一字节都不能动');
    assert.equal(hasCairnMarker(await readFile(claudeMd, 'utf8')), false, '冲突拒绝必须发生在任何写入之前');
  });

  it('目标在计划后变化（块文件）→ E_TARGET_CHANGED', async () => {
    const home = path.join(root, 'changed-block', 'home');
    const project = path.join(root, 'changed-block', 'project');
    const claudeMd = path.join(project, 'CLAUDE.md');
    await putFile(claudeMd, '# v1\n');
    const plan = await planAgentConfig(store, { agentKind: 'claude-code', homeRoot: home, projectRoot: project, mode: 'router' });
    await putFile(claudeMd, '# v1\n\n用户改了一行\n');
    await assert.rejects(applyOk(store, plan), forCode('E_TARGET_CHANGED'));
  });

  it('目标在计划后新出现（MCP 文件 before=null）→ E_TARGET_CHANGED', async () => {
    const home = path.join(root, 'changed-mcp', 'home');
    const project = path.join(root, 'changed-mcp', 'project');
    const claudeMd = path.join(project, 'CLAUDE.md');
    const mcpJson = path.join(project, '.mcp.json');
    await putFile(claudeMd, '# 规则\n');
    const plan = await planAgentConfig(store, {
      agentKind: 'claude-code',
      homeRoot: home,
      projectRoot: project,
      mode: 'router',
      mcpCommand: MCP_CMD,
    });
    await putFile(mcpJson, '{"mcpServers":{}}\n');
    await assert.rejects(applyOk(store, plan), forCode('E_TARGET_CHANGED'));
  });

  it('签名篡改（错误 signature）→ E_TARGET_CHANGED', async () => {
    const home = path.join(root, 'sig', 'home');
    const project = path.join(root, 'sig', 'project');
    const claudeMd = path.join(project, 'CLAUDE.md');
    await putFile(claudeMd, '# 规则\n');
    const plan = await planAgentConfig(store, { agentKind: 'claude-code', homeRoot: home, projectRoot: project, mode: 'router' });
    await assert.rejects(
      applyAgentConfig(store, { plan, signature: '0'.repeat(64) }),
      forCode('E_TARGET_CHANGED'),
    );
    // 计划被改动 → 原签名立即失效
    const tampered = { ...plan, mode: 'observe' as const };
    await assert.rejects(
      applyAgentConfig(store, { plan: tampered, signature: planSignature(plan) }),
      forCode('E_TARGET_CHANGED'),
    );
  });

  it('apply 幂等：连做两次 plan+apply，第二次文件内容逐字节不变且全部 skipped', async () => {
    const home = path.join(root, 'idem', 'home');
    const project = path.join(root, 'idem', 'project');
    const claudeMd = path.join(project, 'CLAUDE.md');
    const mcpJson = path.join(project, '.mcp.json');
    await putFile(claudeMd, '# 幂等\n');
    await putFile(mcpJson, '{"mcpServers":{"other":{"command":"o"}}}\n');

    const p1 = await planAgentConfig(store, { agentKind: 'claude-code', homeRoot: home, projectRoot: project, mode: 'router', mcpCommand: MCP_CMD });
    await applyOk(store, p1);
    const bytes1 = [await readFile(claudeMd), await readFile(mcpJson)];

    const p2 = await planAgentConfig(store, { agentKind: 'claude-code', homeRoot: home, projectRoot: project, mode: 'router', mcpCommand: MCP_CMD });
    const r2 = await applyOk(store, p2);
    assert.equal(r2.applied.length, 0, '第二次不应有任何写入');
    assert.equal(r2.skipped.length, 2, '两个写动作都因内容未变化而跳过');
    const bytes2 = [await readFile(claudeMd), await readFile(mcpJson)];
    assert.ok(bytes1[0]!.equals(bytes2[0]!), '块文件字节不变');
    assert.ok(bytes1[1]!.equals(bytes2[1]!), 'MCP 文件字节不变');
  });

  it('uninstall：apply 后立即卸载 → 两个文件与原始字节完全一致、记录清空、备份清理', async () => {
    const home = path.join(root, 'uninst', 'home');
    const project = path.join(root, 'uninst', 'project');
    const claudeMd = path.join(project, 'CLAUDE.md');
    const mcpJson = path.join(project, '.mcp.json');
    const originalMd = '# 卸载对照\n\n原始说明\n';
    const originalJson = '{"mcpServers":{"keep":{"command":"k"}},"topField":42}\n';
    await putFile(claudeMd, originalMd);
    await putFile(mcpJson, originalJson);

    const plan = await planAgentConfig(store, { agentKind: 'claude-code', homeRoot: home, projectRoot: project, mode: 'router', mcpCommand: MCP_CMD });
    await applyOk(store, plan);
    assert.ok(hasCairnMarker(await readFile(claudeMd, 'utf8')));

    const u = await uninstallAgentConfig(store, { agentKind: 'claude-code', homeRoot: home, projectRoot: project });
    assert.deepEqual(
      u.removed.map((r) => r.path).sort(),
      [claudeMd, mcpJson].sort(),
    );
    assert.ok(u.removed.every((r) => r.restoredOriginal), '未修改文件都应整文件恢复备份');
    assert.equal(await readFile(claudeMd, 'utf8'), originalMd, 'CLAUDE.md 必须与原始字节逐字节一致');
    assert.equal(await readFile(mcpJson, 'utf8'), originalJson, '.mcp.json 必须与原始字节逐字节一致');
    assert.equal(store.installations.activeFor('claude-code', home).length, 0, '安装记录清空');
    assert.equal(store.blocks.listActive(claudeMd).length, 0, '该目标的受管区块记录清空');
    assert.equal(store.blocks.listActive(mcpJson).length, 0);
    assert.equal(await readOrNull(claudeMd + '.cairn-backup'), null, '备份已清理');
    assert.equal(await readOrNull(mcpJson + '.cairn-backup'), null, '备份已清理');
    const evt = store.audit.recent(30).find((e) => e.action === 'removed' && e.category === 'config');
    assert.ok(evt, '卸载必须留审计');
  });

  it('uninstall：用户追加行/新增 server 后 → 只删 cairn 部分，用户内容保留', async () => {
    const home = path.join(root, 'uninst-user', 'home');
    const project = path.join(root, 'uninst-user', 'project');
    const claudeMd = path.join(project, 'CLAUDE.md');
    const mcpJson = path.join(project, '.mcp.json');
    await putFile(claudeMd, '# 用户文档\n');
    await putFile(mcpJson, '{"mcpServers":{"user-srv":{"command":"u"}}}\n');

    const plan = await planAgentConfig(store, { agentKind: 'claude-code', homeRoot: home, projectRoot: project, mode: 'router', mcpCommand: MCP_CMD });
    await applyOk(store, plan);

    await putFile(claudeMd, (await readFile(claudeMd, 'utf8')) + '用户追加的备注\n');
    const userJson = JSON.parse(await readFile(mcpJson, 'utf8')) as Record<string, unknown>;
    (userJson['mcpServers'] as Record<string, unknown>)['user-2'] = { command: 'u2', args: [] };
    userJson['user-top'] = 'keep-me';
    await putFile(mcpJson, JSON.stringify(userJson, null, 2) + '\n');

    const u = await uninstallAgentConfig(store, { agentKind: 'claude-code', homeRoot: home, projectRoot: project });
    assert.ok(u.removed.every((r) => !r.restoredOriginal), '有用户修改时不得整文件覆盖');
    const md = await readFile(claudeMd, 'utf8');
    assert.equal(md, '# 用户文档\n用户追加的备注\n', '块与其安装分隔空行移除，用户行保留');
    assert.equal(hasCairnMarker(md), false);
    const json = JSON.parse(await readFile(mcpJson, 'utf8')) as Record<string, unknown>;
    assert.deepEqual(json['mcpServers'], { 'user-srv': { command: 'u' }, 'user-2': { command: 'u2', args: [] } }, '只删 cairn，其他 server 保留');
    assert.equal(json['user-top'], 'keep-me');
    assert.equal(store.installations.activeFor('claude-code', home).length, 0);
    assert.equal(store.blocks.listActive(claudeMd).length, 0);
  });

  it('uninstall：无安装记录 → 空 removed + 说明 note，不碰任何文件', async () => {
    const home = path.join(root, 'uninst-none', 'home');
    const u = await uninstallAgentConfig(store, { agentKind: 'cursor', homeRoot: home, projectRoot: null });
    assert.deepEqual(u.removed, []);
    assert.ok(u.notes.some((n) => n.includes('没有本产品的安装记录')));
  });

  it('mcp-primary（claude-code）：块 + MCP + 原生记忆手动步骤；capability=blocked', async () => {
    const home = path.join(root, 'primary-cc', 'home');
    const project = path.join(root, 'primary-cc', 'project');
    await putFile(path.join(project, 'CLAUDE.md'), '# 规则\n');
    const plan = await planAgentConfig(store, {
      agentKind: 'claude-code',
      homeRoot: home,
      projectRoot: project,
      mode: 'mcp-primary',
      mcpCommand: MCP_CMD,
    });
    const types = plan.actions.map((a) => a.type);
    assert.ok(types.includes('write_managed_block') && types.includes('write_mcp_config'));
    const manual = plan.actions.filter((a) => a.type === 'manual_step');
    assert.equal(manual.length, 1, 'claude-code 必须有原生记忆手动关闭步骤');
    assert.ok(manual[0]!.after!.includes('CLAUDE_CODE_DISABLE_AUTO_MEMORY'), '手动步骤引用官方公开方式');
    assert.equal(plan.capability, 'blocked', 'mcp-primary 的原生接管如实标 blocked');
    assert.ok(plan.notes.some((n) => n.includes('手动')));
  });

  it('mcp-primary（openclaw）：MCP 路径未公开 → 无 MCP 写动作；notes 明确“不能宣称已接管”', async () => {
    const home = path.join(root, 'primary-oc', 'home');
    await putFile(path.join(home, '.openclaw', 'workspace', 'AGENTS.md'), '# 工作区\n');
    const plan = await planAgentConfig(store, {
      agentKind: 'openclaw',
      homeRoot: home,
      projectRoot: null,
      mode: 'mcp-primary',
      mcpCommand: MCP_CMD,
    });
    assert.ok(!plan.actions.some((a) => a.type === 'write_mcp_config'), '不得写入未公开路径');
    assert.ok(plan.actions.some((a) => a.type === 'write_managed_block'), 'workspace/AGENTS.md 块仍可写');
    assert.ok(plan.actions.some((a) => a.type === 'manual_step'));
    assert.ok(plan.notes.some((n) => n.includes('不能宣称已接管')), '必须声明不能宣称已接管/关闭原生记忆');
    assert.equal(plan.capability, 'blocked');
  });
});

describe('doctorAgentConfig：只读、如实分级', () => {
  let root = '';
  let store: CairnStore;
  before(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'cairn-agents-doctor-'));
    store = openStore({ home: path.join(root, 'cairn-home') });
  });
  after(async () => {
    store.close();
    await rm(root, { recursive: true, force: true });
  });

  it('应用前：configExists=false 如实报告；应用后：cairnEntryPresent=true、blockPresent=true', async () => {
    const home = path.join(root, 'd1', 'home');
    const project = path.join(root, 'd1', 'project');
    await putFile(path.join(project, 'CLAUDE.md'), '# 规则\n');

    const before = await doctorAgentConfig(store, { agentKind: 'claude-code', homeRoot: home, projectRoot: project });
    assert.equal(before.configPath, path.join(project, '.mcp.json'));
    assert.equal(before.configExists, false);
    assert.equal(before.cairnEntryPresent, false);
    assert.equal(before.blockPresent, false, '文件存在但没有 cairn 标记 → false');
    assert.equal(before.capability, 'fixture-only');
    assert.ok(before.notes.some((n) => n.includes('不代表真实宿主')), 'doctor 必须声明能力边界');

    const plan = await planAgentConfig(store, { agentKind: 'claude-code', homeRoot: home, projectRoot: project, mode: 'router', mcpCommand: MCP_CMD });
    await applyOk(store, plan);
    const after = await doctorAgentConfig(store, { agentKind: 'claude-code', homeRoot: home, projectRoot: project });
    assert.equal(after.configExists, true);
    assert.equal(after.cairnEntryPresent, true);
    assert.equal(after.blockPresent, true);
    assert.equal(after.blockPath, path.join(project, 'CLAUDE.md'));
  });

  it('workbuddy/openclaw：MCP blocked；doctor 如实给出路径与分级', async () => {
    const home = path.join(root, 'd2', 'home');
    const wb = await doctorAgentConfig(store, { agentKind: 'workbuddy', homeRoot: home, projectRoot: null });
    assert.equal(wb.configPath, null, 'MCP 路径仍未公开');
    // 2026-11-01 改动：WorkBuddy 记忆落点已由应用代码证实，不再是 blocked。
    assert.equal(wb.blockPath, path.join(home, '.workbuddy', 'memory', 'MEMORY.md'));
    // capability 是「整体最差项」：WorkBuddy 的 MCP 仍 blocked，故整体仍 blocked。
    // 块本身可写这件事由 blockPath/watch blockPresent 表达，不由 capability 表达。
    assert.equal(wb.capability, 'blocked');
    assert.equal(wb.configExists, false);

    const oc = await doctorAgentConfig(store, { agentKind: 'openclaw', homeRoot: home, projectRoot: null });
    assert.equal(oc.configPath, null);
    assert.equal(oc.blockPath, path.join(home, '.openclaw', 'workspace', 'AGENTS.md'));
    assert.equal(oc.capability, 'blocked');
    assert.equal(oc.blockPresent, false);

    await putFile(oc.blockPath!, '# 工作区\n');
    await applyOk(
      store,
      await planAgentConfig(store, { agentKind: 'openclaw', homeRoot: home, projectRoot: null, mode: 'router' }),
    );
    const oc2 = await doctorAgentConfig(store, { agentKind: 'openclaw', homeRoot: home, projectRoot: null });
    assert.equal(oc2.blockPresent, true, 'openclaw 块写入后 doctor 应报告存在');
    assert.equal(oc2.cairnEntryPresent, false, 'MCP blocked，无条目可报告');
  });
});

describe('五宿主全循环：plan → apply → doctor → uninstall', () => {
  let root = '';
  let store: CairnStore;
  before(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'cairn-agents-loop-'));
    store = openStore({ home: path.join(root, 'cairn-home') });
  });
  after(async () => {
    store.close();
    await rm(root, { recursive: true, force: true });
  });

  it('1/5 claude-code：project 作用域全流程字节还原', async () => {
    const home = path.join(root, 'loop-cc', 'home');
    const project = path.join(root, 'loop-cc', 'project');
    const claudeMd = path.join(project, 'CLAUDE.md');
    const mcpJson = path.join(project, '.mcp.json');
    const md0 = '# CLAUDE 原始\n';
    const json0 = '{"mcpServers":{"pre":{"command":"p"}}}\n';
    await putFile(claudeMd, md0);
    await putFile(mcpJson, json0);

    const plan = await planAgentConfig(store, { agentKind: 'claude-code', homeRoot: home, projectRoot: project, mode: 'router', mcpCommand: MCP_CMD });
    assert.equal(plan.agentKind, 'claude-code');
    const r = await applyOk(store, plan);
    assert.equal(r.applied.length, 2);
    const doc = await doctorAgentConfig(store, { agentKind: 'claude-code', homeRoot: home, projectRoot: project });
    assert.equal(doc.cairnEntryPresent, true);
    assert.equal(doc.blockPresent, true);
    const u = await uninstallAgentConfig(store, { agentKind: 'claude-code', homeRoot: home, projectRoot: project });
    assert.ok(u.removed.every((x) => x.restoredOriginal));
    assert.equal(await readFile(claudeMd, 'utf8'), md0, '卸载后 CLAUDE.md 逐字节还原');
    assert.equal(await readFile(mcpJson, 'utf8'), json0, '卸载后 .mcp.json 逐字节还原');
    assert.equal(store.blocks.listActive(claudeMd).length, 0);
    assert.equal(store.installations.activeFor('claude-code', home).length, 0);
  });

  it('2/5 cursor：project .cursor/mcp.json 与 AGENTS.md 全流程', async () => {
    const home = path.join(root, 'loop-cursor', 'home');
    const project = path.join(root, 'loop-cursor', 'project');
    const agentsMd = path.join(project, 'AGENTS.md');
    const mcpJson = path.join(project, '.cursor', 'mcp.json');
    const md0 = '# Cursor 规则\n';
    const json0 = '{"mcpServers":{"existing":{"command":"e"}}}\n';
    await putFile(agentsMd, md0);
    await putFile(mcpJson, json0);

    const plan = await planAgentConfig(store, { agentKind: 'cursor', homeRoot: home, projectRoot: project, mode: 'router', mcpCommand: MCP_CMD });
    assert.equal(plan.actions.find((a) => a.type === 'write_managed_block')!.path, agentsMd);
    assert.equal(plan.actions.find((a) => a.type === 'write_mcp_config')!.path, mcpJson);
    await applyOk(store, plan);
    const merged = JSON.parse(await readFile(mcpJson, 'utf8')) as { mcpServers: Record<string, unknown> };
    assert.ok(merged.mcpServers['cairn'] && merged.mcpServers['existing'], 'cursor 项目级合并正确');
    const u = await uninstallAgentConfig(store, { agentKind: 'cursor', homeRoot: home, projectRoot: project });
    assert.equal(await readFile(agentsMd, 'utf8'), md0);
    assert.equal(await readFile(mcpJson, 'utf8'), json0);
    assert.equal(u.removed.length, 2);
  });

  it('3/5 copilot：.vscode/mcp.json 使用顶层 servers 键，合并保留既有条目', async () => {
    const home = path.join(root, 'loop-copilot', 'home');
    const project = path.join(root, 'loop-copilot', 'project');
    const instructions = path.join(project, '.github', 'copilot-instructions.md');
    const mcpJson = path.join(project, '.vscode', 'mcp.json');
    const md0 = '# Copilot 指南\n';
    const json0 = '{"servers":{"existing":{"command":"e"}},"unknownTop":[1,2]}\n';
    await putFile(instructions, md0);
    await putFile(mcpJson, json0);

    const plan = await planAgentConfig(store, { agentKind: 'copilot', homeRoot: home, projectRoot: project, mode: 'router', mcpCommand: MCP_CMD });
    await applyOk(store, plan);
    const merged = JSON.parse(await readFile(mcpJson, 'utf8')) as Record<string, unknown>;
    const servers = merged['servers'] as Record<string, unknown>;
    assert.ok(servers['cairn'], 'copilot VS Code 顶层键必须是 servers');
    assert.ok(servers['existing'], '既有 server 保留');
    assert.deepEqual(merged['unknownTop'], [1, 2], '未知顶层字段保留');
    assert.ok(hasCairnMarker(await readFile(instructions, 'utf8')));
    const u = await uninstallAgentConfig(store, { agentKind: 'copilot', homeRoot: home, projectRoot: project });
    assert.equal(await readFile(instructions, 'utf8'), md0);
    assert.equal(await readFile(mcpJson, 'utf8'), json0);
    assert.equal(u.removed.length, 2);
  });

  it('4/5 openclaw：MCP blocked 只写 home 工作区块；uninstall 字节还原', async () => {
    const home = path.join(root, 'loop-oc', 'home');
    const agentsMd = path.join(home, '.openclaw', 'workspace', 'AGENTS.md');
    const md0 = '# OpenClaw 工作区\n';
    await putFile(agentsMd, md0);

    const plan = await planAgentConfig(store, { agentKind: 'openclaw', homeRoot: home, projectRoot: null, mode: 'router', mcpCommand: MCP_CMD });
    const writes = plan.actions.filter((a) => a.type !== 'manual_step');
    assert.equal(writes.length, 1, 'MCP blocked：只有块写动作');
    assert.equal(writes[0]!.type, 'write_managed_block');
    assert.equal(plan.capability, 'blocked', '请求了 MCP 但宿主 blocked → 诚实降级');
    await applyOk(store, plan);
    assert.ok(hasCairnMarker(await readFile(agentsMd, 'utf8')));
    const doc = await doctorAgentConfig(store, { agentKind: 'openclaw', homeRoot: home, projectRoot: null });
    assert.equal(doc.blockPresent, true);
    assert.equal(doc.configPath, null);
    const u = await uninstallAgentConfig(store, { agentKind: 'openclaw', homeRoot: home, projectRoot: null });
    assert.equal(await readFile(agentsMd, 'utf8'), md0, 'openclaw 块卸载后逐字节还原');
    assert.equal(u.removed.length, 1);
  });

  it('5/5 workbuddy：MCP blocked 但块可写；plan→apply→doctor→uninstall 全循环', async () => {
    const home = path.join(root, 'loop-wb', 'home');
    const memPath = path.join(home, '.workbuddy', 'memory', 'MEMORY.md');

    const plan = await planAgentConfig(store, { agentKind: 'workbuddy', homeRoot: home, projectRoot: null, mode: 'router', mcpCommand: MCP_CMD });
    const writes = plan.actions.filter((a) => a.type !== 'manual_step');
    assert.equal(writes.length, 1, '只应有块写入（MCP 仍 blocked）');
    assert.equal(writes[0]!.path, memPath);
    assert.equal(plan.capability, 'blocked', 'MCP 仍 blocked 时整体能力按最差项计');

    await applyOk(store, plan);
    const written = await readFile(memPath, 'utf8');
    assert.ok(written.includes('cairn:begin block='), '必须写入受管区块');

    const doc = await doctorAgentConfig(store, { agentKind: 'workbuddy', homeRoot: home, projectRoot: null });
    assert.equal(doc.capability, 'blocked');
    assert.equal(doc.blockPresent, true, '块可写且已写入——与 MCP 的 blocked 是两个维度');

    await uninstallAgentConfig(store, { agentKind: 'workbuddy', homeRoot: home, projectRoot: null });
    const after = await readFile(memPath, 'utf8').catch(() => '');
    assert.ok(!after.includes('cairn:begin block='), '卸载后受管区块应被移除');
  });
});
