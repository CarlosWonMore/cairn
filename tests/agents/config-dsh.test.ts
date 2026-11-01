/**
 * DSH（cordis-patch 形态）的 plan → apply → doctor → uninstall 闭环测试。
 *
 * 关键证据点：
 * - plan 零写入（前后字节与 mtime 不变）；
 * - 同名外来条目 → 冲突，apply 拒绝且文件未动；
 * - 目标在计划后变化 / 签名篡改 → E_TARGET_CHANGED；
 * - apply 幂等（第二次内容未变化）；
 * - uninstall 后与原始字节逐字一致。
 *
 * 全部用临时目录里的合成 patch 文件，不碰真实宿主机配置。
 */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import {
  applyAgentConfig,
  doctorAgentConfig,
  planAgentConfig,
  planSignature,
  uninstallAgentConfig,
} from '../../src/agents/config.js';
import { setDshProfile } from '../../src/agents/adapters.js';
import { CAIRN_DSH_ENTRY_ID } from '../../src/agents/cordisPatch.js';
import { isCairnError } from '../../src/core/errors.js';
import { openStore, type CairnStore } from '../../src/store/open.js';

const MCP_CMD: { command: string; args: string[] } = {
  command: 'D:/nodejs/node.exe',
  args: ['D:/proj/dist/src/interfaces/mcp/server.js'],
};

/** 抄自真实 DSH patch 文件形态（含注释、flow-style 行与其他插件行）。 */
const BASE_PATCH = [
  '# Your patch layer for this dsh profile, applied after every bundle layer:',
  '# a top-level YAML array of loader patch entries.',
  '- { id: computer-use-cua-driver-native, disabled: false }',
  '- id: dsh-connect-workbuddy',
  '  name: dsh-connect-workbuddy',
  '  config:',
  '    regions:',
  '      cn:',
  '        enabled: true',
  '- id: ui-settings',
  '  name: "@deepseek-ai/dsh-client-ui-settings"',
  '  config:',
  '    enabled: true',
  '',
].join('\n');

function patchPath(dshHome: string): string {
  return path.join(dshHome, 'profiles', 'desktop', 'cordis.patch.yml');
}

async function putFile(p: string, content: string): Promise<void> {
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, content, 'utf8');
}

function forCode(code: string) {
  return (e: unknown): boolean => isCairnError(e) && e.code === code;
}

let store: CairnStore;
let root: string;
let dshHome: string;
let projRoot: string;

before(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'cairn-dsh-'));
  dshHome = path.join(root, 'dsh-home');
  projRoot = path.join(root, 'project');
  store = openStore({ home: root, allowUninitialized: true } as never);
  setDshProfile(null);
});

after(async () => {
  try {
    store.close();
  } catch {
    /* ignore */
  }
  await rm(root, { recursive: true, force: true });
});

describe('DSH plan：零写入与冲突检测', () => {
  it('plan 不修改文件（字节与 mtime 均不变）', async () => {
    const home = path.join(root, 'plan-zero');
    const p = patchPath(home);
    await putFile(p, BASE_PATCH);
    const beforeBytes = await readFile(p);
    const beforeMtime = (await stat(p)).mtimeMs;

    const plan = await planAgentConfig(store, {
      agentKind: 'dsh',
      homeRoot: home,
      projectRoot: projRoot,
      mode: 'router',
      mcpCommand: MCP_CMD,
    });
    assert.ok(plan.actions.some((a) => a.type === 'write_mcp_config'), '应产生 MCP 写动作');
    assert.ok(plan.actions.some((a) => a.type === 'write_managed_block'), '应有受管块动作（用户级 AGENTS.md）');
    assert.deepEqual(plan.conflicts, []);

    assert.deepEqual(await readFile(p), beforeBytes, 'plan 必须零写入');
    assert.equal((await stat(p)).mtimeMs, beforeMtime);
  });

  it('已存在同名外来条目（无安装记录）→ 记入 conflicts', async () => {
    const home = path.join(root, 'plan-conflict');
    const p = patchPath(home);
    const foreign = BASE_PATCH + '- insert:\n    - id: mcp-cairn\n      name: "@deepseek-ai/dsh-mcp-client"\n      config:\n        serverName: cairn\n';
    await putFile(p, foreign);

    const plan = await planAgentConfig(store, {
      agentKind: 'dsh',
      homeRoot: home,
      projectRoot: projRoot,
      mode: 'router',
      mcpCommand: MCP_CMD,
    });
    assert.equal(plan.conflicts.length, 1);
    assert.ok(plan.conflicts[0]!.reason.includes(CAIRN_DSH_ENTRY_ID));

    await assert.rejects(
      () => applyAgentConfig(store, { plan, signature: planSignature(plan) }),
      forCode('E_CONFIG_CONFLICT'),
    );
    assert.equal(await readFile(p, 'utf8'), foreign, '冲突时不得改动文件');
  });

  it('observe 模式零动作', async () => {
    const home = path.join(root, 'plan-observe');
    await putFile(patchPath(home), BASE_PATCH);
    const plan = await planAgentConfig(store, {
      agentKind: 'dsh',
      homeRoot: home,
      projectRoot: projRoot,
      mode: 'observe',
    });
    assert.deepEqual(plan.actions, []);
  });
});

describe('DSH apply / doctor / uninstall 闭环', () => {
  it('apply 写入 → doctor 确认 → uninstall 恢复原始字节', async () => {
    const home = path.join(root, 'cycle');
    const p = patchPath(home);
    await putFile(p, BASE_PATCH);
    const original = await readFile(p, 'utf8');

    const plan = await planAgentConfig(store, {
      agentKind: 'dsh',
      homeRoot: home,
      projectRoot: projRoot,
      mode: 'router',
      mcpCommand: MCP_CMD,
    });
    const res = await applyAgentConfig(store, { plan, signature: planSignature(plan) });
    assert.ok(res.applied.length >= 1, '至少应用了 MCP 动作');

    const afterApply = await readFile(p, 'utf8');
    assert.ok(afterApply.includes('id: ' + CAIRN_DSH_ENTRY_ID), '条目必须已插入');
    assert.ok(afterApply.includes('- insert:'), '必须是 insert 块形态');
    assert.ok(afterApply.startsWith('# Your patch layer'), '既有注释必须保留');
    assert.ok(afterApply.includes('id: ui-settings'), '其他条目必须保留');
    assert.equal((afterApply.match(/- insert:/g) ?? []).length, 1, '只能有一个 insert 块');

    // doctor：识别为本产品条目
    const doc = await doctorAgentConfig(store, { agentKind: 'dsh', homeRoot: home, projectRoot: projRoot });
    assert.equal(doc.configExists, true);
    assert.equal(doc.cairnEntryPresent, true);
    assert.ok(doc.notes.some((n) => n.includes('已插入')), 'doctor 应报告已插入');
    assert.equal(doc.blockPath, path.join(home, 'AGENTS.md'), '块目标是用户级 AGENTS.md');
    assert.equal(doc.blockPresent, true);

    // 用户级 AGENTS.md 必须含受管块
    const agents = await readFile(path.join(home, 'AGENTS.md'), 'utf8');
    assert.ok(agents.includes('cairn:begin block='), '用户级文件必须含受管区块');

    // uninstall：patch 与 AGENTS.md 都回到原始状态
    const un = await uninstallAgentConfig(store, { agentKind: 'dsh', homeRoot: home, projectRoot: projRoot });
    assert.ok(un.removed.length >= 1);
    assert.equal(await readFile(p, 'utf8'), original, 'uninstall 后 patch 必须逐字节回到原始');
  });

  it('apply 幂等：第二次内容未变化', async () => {
    const home = path.join(root, 'idem');
    const p = patchPath(home);
    await putFile(p, BASE_PATCH);

    const plan1 = await planAgentConfig(store, {
      agentKind: 'dsh', homeRoot: home, projectRoot: projRoot, mode: 'router', mcpCommand: MCP_CMD,
    });
    await applyAgentConfig(store, { plan: plan1, signature: planSignature(plan1) });
    const afterFirst = await readFile(p, 'utf8');

    const plan2 = await planAgentConfig(store, {
      agentKind: 'dsh', homeRoot: home, projectRoot: projRoot, mode: 'router', mcpCommand: MCP_CMD,
    });
    const res2 = await applyAgentConfig(store, { plan: plan2, signature: planSignature(plan2) });
    assert.equal(await readFile(p, 'utf8'), afterFirst, '第二次 apply 不得改变文件');
    assert.ok(res2.skipped.some((s) => s.includes('write_mcp_config')), '第二次应跳过 MCP 写入');
  });

  it('计划后目标被改 → E_TARGET_CHANGED', async () => {
    const home = path.join(root, 'changed');
    const p = patchPath(home);
    await putFile(p, BASE_PATCH);
    const plan = await planAgentConfig(store, {
      agentKind: 'dsh', homeRoot: home, projectRoot: projRoot, mode: 'router', mcpCommand: MCP_CMD,
    });
    await writeFile(p, BASE_PATCH + '- id: injected-later\n  name: x\n', 'utf8');
    await assert.rejects(
      () => applyAgentConfig(store, { plan, signature: planSignature(plan) }),
      forCode('E_TARGET_CHANGED'),
    );
  });

  it('签名篡改 → E_TARGET_CHANGED', async () => {
    const home = path.join(root, 'sig');
    await putFile(patchPath(home), BASE_PATCH);
    const plan = await planAgentConfig(store, {
      agentKind: 'dsh', homeRoot: home, projectRoot: projRoot, mode: 'router', mcpCommand: MCP_CMD,
    });
    await assert.rejects(
      () => applyAgentConfig(store, { plan, signature: 'deadbeef' }),
      forCode('E_TARGET_CHANGED'),
    );
  });

  it('结构不符的 patch 文件 → doctor 如实报告，不写入', async () => {
    const home = path.join(root, 'malformed');
    await putFile(patchPath(home), 'foo: bar\n');
    const doc = await doctorAgentConfig(store, { agentKind: 'dsh', homeRoot: home, projectRoot: projRoot });
    assert.equal(doc.configExists, true);
    assert.equal(doc.cairnEntryPresent, false);
    assert.ok(doc.notes.some((n) => n.includes('结构不符合预期')), 'doctor 必须报告结构问题');
  });
});
