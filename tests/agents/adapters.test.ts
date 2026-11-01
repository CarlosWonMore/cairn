/**
 * 宿主适配器元数据测试（tasks 8.1）。
 * 断言与 M0 能力矩阵（adapter-matrix.json）逐项一致：路径不许发明，能力分级诚实。
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  AGENT_KINDS,
  DEFAULT_DSH_PROFILE,
  HOST_ADAPTERS,
  dshProfileFor,
  getAdapter,
  isAgentKind,
  resolveDshHome,
  setDshProfile,
} from '../../src/agents/adapters.js';
import { isCairnError } from '../../src/core/errors.js';

const HOME = path.resolve('/synthetic/home');
const PROJ = path.resolve('/synthetic/project');

describe('HOST_ADAPTERS：与 M0 矩阵一致的宿主元数据', () => {
  it('claude-code：project 作用域 .mcp.json + CLAUDE.md；user/local 聚合文件不写', () => {
    const a = HOST_ADAPTERS['claude-code'];
    assert.equal(a.label, 'Claude Code');
    assert.equal(a.mcpConfigPath(HOME, PROJ), path.join(PROJ, '.mcp.json'));
    assert.equal(a.mcpConfigPath(HOME, null), null, '无项目时不写 ~/.claude.json（blocked）');
    assert.equal(a.mcpConfigCapability, 'fixture-only');
    assert.equal(a.blockTargetPath(HOME, PROJ), path.join(PROJ, 'CLAUDE.md'));
    assert.equal(a.blockTargetPath(HOME, null), path.join(HOME, '.claude', 'CLAUDE.md'));
    assert.equal(a.blockCapability, 'fixture-only');
    assert.equal(a.nativeDisable, 'documented-manual');
    assert.ok(a.notes.some((n) => n.includes('~/.claude.json')), 'notes 必须说明聚合状态文件边界');
  });

  it('cursor：project/global 两个 mcp 路径 + 项目根 AGENTS.md；无原生自动记忆', () => {
    const a = HOST_ADAPTERS['cursor'];
    assert.equal(a.mcpConfigPath(HOME, PROJ), path.join(PROJ, '.cursor', 'mcp.json'));
    assert.equal(a.mcpConfigPath(HOME, null), path.join(HOME, '.cursor', 'mcp.json'));
    assert.equal(a.mcpConfigCapability, 'fixture-only');
    assert.equal(a.blockTargetPath(HOME, PROJ), path.join(PROJ, 'AGENTS.md'));
    assert.equal(a.blockTargetPath(HOME, null), null, '全局规则只有 User Rules (UI)，无文件路径');
    assert.equal(a.blockCapability, 'fixture-only');
    assert.equal(a.nativeDisable, 'none');
    assert.ok(a.notes.some((n) => n.includes('.mdc')), 'notes 必须说明不覆盖既有 .mdc');
  });

  it('copilot：VS Code servers 键与 CLI mcpServers 键不同（矩阵明确）', () => {
    const a = HOST_ADAPTERS['copilot'];
    assert.equal(a.mcpConfigPath(HOME, PROJ), path.join(PROJ, '.vscode', 'mcp.json'));
    assert.equal(a.mcpConfigPath(HOME, null), path.join(HOME, '.copilot', 'mcp-config.json'));
    assert.equal(a.mcpServerMapKey(HOME, PROJ), 'servers', '.vscode/mcp.json 顶层键为 servers');
    assert.equal(a.mcpServerMapKey(HOME, null), 'mcpServers', 'CLI 用户级配置为 mcpServers');
    assert.equal(a.blockTargetPath(HOME, PROJ), path.join(PROJ, '.github', 'copilot-instructions.md'));
    assert.equal(a.blockTargetPath(HOME, null), null);
    assert.equal(a.mcpConfigCapability, 'fixture-only', '本实现未复跑真实 CLI，不冒标 real-cli-tested');
    assert.equal(a.nativeDisable, 'documented-manual');
    assert.ok(a.notes.some((n) => n.includes('servers')), 'notes 必须说明顶层键差异');
  });

  it('openclaw：MCP 路径未公开（null/blocked），块目标固定为 workspace/AGENTS.md', () => {
    const a = HOST_ADAPTERS['openclaw'];
    assert.equal(a.mcpConfigPath(HOME, PROJ), null);
    assert.equal(a.mcpConfigPath(HOME, null), null);
    assert.equal(a.mcpConfigCapability, 'blocked');
    assert.equal(a.blockTargetPath(HOME, null), path.join(HOME, '.openclaw', 'workspace', 'AGENTS.md'));
    assert.equal(a.blockTargetPath(HOME, PROJ), path.join(HOME, '.openclaw', 'workspace', 'AGENTS.md'), 'openclaw 无项目作用域');
    assert.equal(a.blockCapability, 'fixture-only');
    assert.equal(a.nativeDisable, 'none');
    assert.ok(a.notes.some((n) => n.includes('未公开')), 'notes 必须声明路径未公开');
  });

  it('workbuddy：MCP 与块目标均未公开（双 blocked），只给手动指引', () => {
    const a = HOST_ADAPTERS['workbuddy'];
    assert.equal(a.mcpConfigPath(HOME, PROJ), null);
    assert.equal(a.mcpConfigPath(HOME, null), null);
    assert.equal(a.mcpConfigCapability, 'blocked');
    assert.equal(a.blockTargetPath(HOME, PROJ), null);
    assert.equal(a.blockTargetPath(HOME, null), null);
    assert.equal(a.blockCapability, 'blocked');
    assert.equal(a.nativeDisable, 'none');
    assert.ok(a.notes.some((n) => n.includes('连接器')), 'notes 指引连接器 UI 手动安装');
  });

  it('六宿主种类表完整；未知宿主拒绝且不猜路径', () => {
    assert.deepEqual([...AGENT_KINDS].sort(), ['claude-code', 'copilot', 'cursor', 'dsh', 'openclaw', 'workbuddy']);
    assert.ok(isAgentKind('claude-code'));
    assert.ok(!isAgentKind('windsurf'));
    assert.throws(() => getAdapter('windsurf'), (e: unknown) => isCairnError(e) && e.code === 'E_VALIDATION');
    for (const kind of AGENT_KINDS) {
      const a = HOST_ADAPTERS[kind];
      assert.ok(a.notes.length > 0, `${kind} 必须有能力边界说明`);
      for (const n of a.notes) {
        assert.ok(!/real-cli-tested/.test(n) || kind === 'copilot', '除 copilot 的 M0 历史说明外不得宣称真实 CLI 验证');
      }
    }
  });

  it('dsh：Cordis 插件树形态（非 JSON），规则入口是用户级 AGENTS.md', () => {
    const a = HOST_ADAPTERS['dsh'];
    const DSH_HOME = path.resolve('/synthetic/dsh-home');
    assert.equal(a.label, 'DeepSeek Harness (DSH)');
    assert.equal(a.mcpConfigKind, 'cordis-patch', 'DSH 不读 mcp.json，形态是插件树');
    assert.equal(a.mcpConfigPath(DSH_HOME, PROJ), path.join(DSH_HOME, 'profiles', 'desktop', 'cordis.patch.yml'));
    assert.equal(a.mcpConfigPath(DSH_HOME, null), path.join(DSH_HOME, 'profiles', 'desktop', 'cordis.patch.yml'), 'DSH 的 MCP 路径与 projectRoot 无关');
    assert.equal(a.mcpConfigCapability, 'fixture-only');
    assert.equal(a.blockTargetPath(DSH_HOME, PROJ), path.join(DSH_HOME, 'AGENTS.md'), '用户级全局文件，而非项目级');
    assert.equal(a.blockTargetPath(DSH_HOME, null), path.join(DSH_HOME, 'AGENTS.md'));
    assert.equal(a.blockCapability, 'fixture-only');
    assert.equal(a.nativeDisable, 'none', 'DSH 无公开的原生记忆关闭接口');
    assert.ok(a.notes.some((n) => n.includes('insert')), 'notes 必须说明 insert 块形态');
    assert.ok(a.notes.some((n) => n.includes('证据边界')), 'notes 必须声明证据边界，不得虚标兼容所有版本');
  });

  it('各宿主 mcpConfigKind 与实际配置路径一致', () => {
    for (const kind of AGENT_KINDS) {
      const a = HOST_ADAPTERS[kind];
      assert.ok(['json', 'cordis-patch', 'none'].includes(a.mcpConfigKind), `${kind} 的形态必须已声明`);
      if (a.mcpConfigPath(path.resolve('/synthetic/home'), PROJ) === null) {
        assert.equal(a.mcpConfigKind, 'none', `${kind} 无路径时必须标 none`);
      } else {
        assert.notEqual(a.mcpConfigKind, 'none', `${kind} 有路径时不能标 none`);
      }
    }
  });

  it('resolveDshHome：显式值 > DSH_HOME，且不回退 ~/.dsh', () => {
    const saved = process.env['DSH_HOME'];
    try {
      process.env['DSH_HOME'] = path.resolve('/synthetic/env-dsh');
      assert.equal(resolveDshHome(path.resolve('/synthetic/explicit')), path.resolve('/synthetic/explicit'));
      assert.equal(resolveDshHome(null), path.resolve('/synthetic/env-dsh'));
      assert.equal(resolveDshHome(undefined), path.resolve('/synthetic/env-dsh'));
      delete process.env['DSH_HOME'];
      assert.throws(() => resolveDshHome(null), (e: unknown) => isCairnError(e) && e.code === 'E_VALIDATION');
      assert.throws(() => resolveDshHome(undefined), (e: unknown) => isCairnError(e) && e.code === 'E_VALIDATION');
    } finally {
      if (saved === undefined) delete process.env['DSH_HOME'];
      else process.env['DSH_HOME'] = saved;
    }
  });

  it('setDshProfile：接受合法名、拒绝非法名，可复位', () => {
    const home = path.resolve('/synthetic/h');
    try {
      assert.equal(dshProfileFor(home), DEFAULT_DSH_PROFILE);
      setDshProfile('work');
      assert.equal(dshProfileFor(home), 'work');
      assert.equal(HOST_ADAPTERS['dsh'].mcpConfigPath(home, null), path.join(home, 'profiles', 'work', 'cordis.patch.yml'));
      assert.throws(() => setDshProfile('../evil'), (e: unknown) => isCairnError(e) && e.code === 'E_VALIDATION');
    } finally {
      setDshProfile(null);
    }
    assert.equal(dshProfileFor(home), DEFAULT_DSH_PROFILE);
  });
});
