/**
 * 宿主适配器元数据测试（tasks 8.1）。
 * 断言与 M0 能力矩阵（adapter-matrix.json）逐项一致：路径不许发明，能力分级诚实。
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';

import { AGENT_KINDS, HOST_ADAPTERS, getAdapter, isAgentKind } from '../../src/agents/adapters.js';
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

  it('五宿主种类表完整；未知宿主拒绝且不猜路径', () => {
    assert.deepEqual([...AGENT_KINDS].sort(), ['claude-code', 'copilot', 'cursor', 'openclaw', 'workbuddy']);
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
});
