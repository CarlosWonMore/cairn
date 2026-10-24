import { join } from 'node:path';

import { err } from '../core/errors.js';

/**
 * 宿主适配器元数据（tasks 8.1）。
 *
 * 全部路径与能力边界来自 M0 能力矩阵
 * artifacts/m0/delegated/work/agent-adapters/out/adapter-matrix.json
 * （仅依据官方公开文档，未公开路径一律 blocked，不做逆向猜测）。
 *
 * 能力分级（诚实原则）：
 * - 本实现未对任何真实宿主 CLI 复跑验证，因此一律不标 real-cli-tested；
 * - 'fixture-only'：契约只对官方形态的 fixture 文件验证过；
 * - 'blocked'：无公开文档路径或需要用户手动 UI 步骤，原型拒绝写入推测路径。
 */

export type AgentKind = 'claude-code' | 'cursor' | 'copilot' | 'openclaw' | 'workbuddy';

export type CapabilityLevel = 'fixture-only' | 'blocked';

/** MCP 配置里服务器映射的顶层键名（copilot 的 VS Code 路径为 "servers"，矩阵明确与 CLI 不同）。 */
export type McpServerMapKey = 'mcpServers' | 'servers';

export interface HostAdapter {
  kind: AgentKind;
  label: string;
  /** MCP 配置文件路径；null = 官方未公开路径，拒绝写入。 */
  mcpConfigPath(homeRoot: string, projectRoot: string | null): string | null;
  mcpConfigCapability: CapabilityLevel;
  /** 受管区块目标文件；null = 无公开块文件，只提供可复制文案。 */
  blockTargetPath(homeRoot: string, projectRoot: string | null): string | null;
  blockCapability: CapabilityLevel;
  /** mcp-primary 的原生记忆关闭方式：documented-manual = 有文档化手动步骤；none = 无公开关闭接口。 */
  nativeDisable: 'documented-manual' | 'none';
  /**
   * MCP 服务器映射顶层键。claude-code/cursor/openclaw 生态为 mcpServers；
   * copilot 的 VS Code 工作区文件 .vscode/mcp.json 顶层键为 "servers"（M0 矩阵明确）。
   */
  mcpServerMapKey(homeRoot: string, projectRoot: string | null): McpServerMapKey;
  notes: string[];
}

export const AGENT_KINDS: readonly AgentKind[] = ['claude-code', 'cursor', 'copilot', 'openclaw', 'workbuddy'];

export function isAgentKind(value: unknown): value is AgentKind {
  return typeof value === 'string' && (AGENT_KINDS as readonly string[]).includes(value);
}

export const HOST_ADAPTERS: Record<AgentKind, HostAdapter> = {
  'claude-code': {
    kind: 'claude-code',
    label: 'Claude Code',
    mcpConfigPath: (homeRoot, projectRoot) => {
      // 矩阵：仅 project 作用域（项目根 .mcp.json）；local/user 聚合在 ~/.claude.json，
      // 原型不写聚合状态文件（blocked），请用官方 CLI 指定作用域。
      void homeRoot;
      return projectRoot ? join(projectRoot, '.mcp.json') : null;
    },
    mcpConfigCapability: 'fixture-only',
    blockTargetPath: (homeRoot, projectRoot) =>
      // 矩阵 rules_memory：CLAUDE.md（项目）与 .claude/CLAUDE.md（用户）均为公开文件。
      projectRoot ? join(projectRoot, 'CLAUDE.md') : join(homeRoot, '.claude', 'CLAUDE.md'),
    blockCapability: 'fixture-only',
    nativeDisable: 'documented-manual',
    mcpServerMapKey: () => 'mcpServers',
    notes: [
      'MCP 仅支持 project 作用域（项目根 .mcp.json）；local/user 作用域聚合在 ~/.claude.json，本原型不写该文件，请用官方 CLI。',
      '只写 CLAUDE.md 受管区块；不接管 auto memory 目录（~/.claude/projects/<project>/memory/），也不把自动记忆回读成指令。',
      'mcp-primary 模式：官方只提供 /memory 开关或 CLAUDE_CODE_DISABLE_AUTO_MEMORY 环境变量，需用户手动完成，本原型不写 settings.json。',
    ],
  },
  cursor: {
    kind: 'cursor',
    label: 'Cursor',
    mcpConfigPath: (homeRoot, projectRoot) =>
      // 矩阵：.cursor/mcp.json（project）或 ~/.cursor/mcp.json（global），两者均为公开路径。
      projectRoot ? join(projectRoot, '.cursor', 'mcp.json') : join(homeRoot, '.cursor', 'mcp.json'),
    mcpConfigCapability: 'fixture-only',
    blockTargetPath: (homeRoot, projectRoot) => {
      // 矩阵 rules_memory：项目级 AGENTS.md 为公开规则文件；全局规则只有 User Rules (UI)，
      // 无文件路径，故 projectRoot 为 null 时不提供块目标。
      void homeRoot;
      return projectRoot ? join(projectRoot, 'AGENTS.md') : null;
    },
    blockCapability: 'fixture-only',
    nativeDisable: 'none',
    mcpServerMapKey: () => 'mcpServers',
    notes: [
      '官方 Rules 文档明确模型补全之间不保留记忆：无原生自动记忆，无需也无法关闭。',
      '默认写项目根 AGENTS.md 受管区块；.cursor/rules/*.mdc 需要 frontmatter，本原型不覆盖既有 .mdc 文件。',
      '全局规则只有 User Rules (UI) / Team Rules (dashboard)，无公开文件路径。',
    ],
  },
  copilot: {
    kind: 'copilot',
    label: 'GitHub Copilot',
    mcpConfigPath: (homeRoot, projectRoot) =>
      // 矩阵：VS Code 工作区 .vscode/mcp.json（project）；CLI 用户级 ~/.copilot/mcp-config.json（user）。
      projectRoot ? join(projectRoot, '.vscode', 'mcp.json') : join(homeRoot, '.copilot', 'mcp-config.json'),
    mcpConfigCapability: 'fixture-only',
    blockTargetPath: (homeRoot, projectRoot) => {
      // 矩阵 rules_memory：.github/copilot-instructions.md 为仓库级公开文件；无 home 级块文件。
      void homeRoot;
      return projectRoot ? join(projectRoot, '.github', 'copilot-instructions.md') : null;
    },
    blockCapability: 'fixture-only',
    nativeDisable: 'documented-manual',
    mcpServerMapKey: (_homeRoot, projectRoot) => (projectRoot ? 'servers' : 'mcpServers'),
    notes: [
      'VS Code 工作区配置 .vscode/mcp.json 顶层键为 "servers"，与 CLI 的 mcpServers 不同（矩阵明确）；合并时保留未知顶层字段。',
      'M0 曾对 CLI 用户级路径做过 real-cli-tested（Copilot CLI 1.0.86、synthetic HOME）；本实现未复跑真实 CLI，能力按 fixture-only 如实标注。',
      'Copilot Memory 为服务端账号级能力（public preview），个人仅可查看/删除，无公开写入或批量导出 API，本原型不访问云端。',
      'mcp-primary 模式：原生 Memory 只能由用户在 GitHub 设置中手动关闭。',
    ],
  },
  openclaw: {
    kind: 'openclaw',
    label: 'OpenClaw',
    mcpConfigPath: () => {
      // 矩阵：官方说明 mcp.servers 存于 OpenClaw config，但未给出配置文件路径；CLI 不在本机。
      // 拒绝写入推测路径（blocked）。
      return null;
    },
    mcpConfigCapability: 'blocked',
    blockTargetPath: (homeRoot) =>
      // 矩阵：~/.openclaw/workspace/AGENTS.md 为官方默认工作区模板，公开路径；openclaw 无项目作用域。
      join(homeRoot, '.openclaw', 'workspace', 'AGENTS.md'),
    blockCapability: 'fixture-only',
    nativeDisable: 'none',
    mcpServerMapKey: () => 'mcpServers',
    notes: [
      'MCP 配置文件路径官方未公开（openclaw mcp add CLI 不在本机）：本原型拒绝写入推测路径，MCP 条目需用户手动添加。',
      '只在 ~/.openclaw/workspace/AGENTS.md 写受管区块；USER.md / MEMORY.md / memory/YYYY-MM-DD.md / DREAMS.md 不整文件改写。',
      '原生记忆（dreaming 等）开关存在但配置路径未公开：不能宣称已接管或关闭原生记忆，只能给出手动步骤。',
      '原生记忆导入官方走 Control UI（复制到 memory/imports/ 且源文件不变）；本原型只做有界发现与显式快照。',
    ],
  },
  workbuddy: {
    kind: 'workbuddy',
    label: 'WorkBuddy',
    mcpConfigPath: () => {
      // 矩阵：官方仅描述"自定义连接器"UI 安装 MCP，未公开本地 mcp.json 路径（blocked）。
      return null;
    },
    mcpConfigCapability: 'blocked',
    blockTargetPath: () => {
      // 矩阵：官方记忆页只有设置界面与"复制提示词—粘贴结果"导入，未公开工作区记忆/规则文件（blocked）。
      return null;
    },
    blockCapability: 'blocked',
    nativeDisable: 'none',
    mcpServerMapKey: () => 'mcpServers',
    notes: [
      'MCP 配置文件路径未公开：拒绝写入 ~/.workbuddy/mcp.json 等未记录路径，只能由用户在连接器 UI 中信任并启用。',
      '无公开工作区规则/记忆文件：不写任何块文件，只提供可复制的路由文案，由用户手动粘贴。',
      '原生记忆为账号级服务端能力，无公开文件或写入 API：不能宣称已接管或关闭原生记忆，只能由用户在设置中手动关闭。',
      '本原型不爬取云端与缓存；记忆导入仅走官方粘贴通道。',
    ],
  },
};

/** 按字符串取适配器；未知宿主一律 E_VALIDATION，绝不猜路径。 */
export function getAdapter(kind: string): HostAdapter {
  if (!isAgentKind(kind)) {
    throw err('E_VALIDATION', `未知宿主类型: ${JSON.stringify(kind)}（支持：${AGENT_KINDS.join(', ')}）`);
  }
  return HOST_ADAPTERS[kind];
}
