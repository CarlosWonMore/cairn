import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { CairnStore } from '../store/open.js';
import { err } from '../core/errors.js';
import { sha256Canonical, sha256Hex } from '../core/hash.js';
import { AGENT_KINDS, HOST_ADAPTERS, isAgentKind } from './adapters.js';
import type { AgentKind, CapabilityLevel, HostAdapter } from './adapters.js';
import {
  BACKUP_SUFFIX,
  DEFAULT_BLOCK_ID,
  hasCairnMarker,
  removeBlockFromText,
  upsertBlockInText,
} from '../projection/markdown.js';
import { generateProjection } from '../projection/markdown.js';

/**
 * 宿主配置 plan → apply → doctor → uninstall（tasks 8.2/8.3）。
 *
 * 不变量（spec agent-interfaces / agent-onboarding）：
 * - 计划默认零写入；apply 前校验 plan_hash 签名与目标整文件哈希。
 * - MCP 合并只加/更新本产品条目，未知顶层字段与其他 server 原样保留；
 *   同名外来条目视为冲突，拒绝覆盖。
 * - 受管区块走 projection 模块（幂等、原子写、首次备份）。
 * - uninstall 只处理本产品安装记录覆盖的路径，能恢复原字节就恢复原字节。
 */

export type ConfigMode = 'observe' | 'router' | 'mcp-primary';

const CONFIG_MODES: readonly ConfigMode[] = ['observe', 'router', 'mcp-primary'];

export interface ConfigPlanAction {
  type: 'write_mcp_config' | 'write_managed_block' | 'manual_step';
  path: string | null;
  before: string | null;
  after: string | null;
  /** plan 时目标整文件 sha256；null = 文件不存在。 */
  beforeHash: string | null;
}

export interface AgentConfigPlan {
  agentKind: AgentKind;
  homeRoot: string;
  projectRoot: string | null;
  mode: ConfigMode;
  actions: ConfigPlanAction[];
  conflicts: { path: string; reason: string }[];
  capability: CapabilityLevel;
  notes: string[];
}

/** router 受管区块正文（跨设备记忆路由约定，5 行）。 */
export const ROUTER_BLOCK_CONTENT = [
  '本区块由 Cairn（本地优先记忆层）受管，请勿手工编辑；卸载时会被精确移除。',
  '跨设备共享的长期记忆统一经 Cairn MCP 读写：需要保存、检索、更正或遗忘共享记忆时，显式调用 Cairn 工具。',
  '用户明确要求“记住 / 更正 / 遗忘”某条信息时，先通过 Cairn 工具完成，再按需回复。',
  '不要在每次对话开始时无条件检索记忆；仅在与当前任务相关时检索。',
  'Agent 私有的原生记忆继续保留：会话草稿与本机偏好留在原生记忆，不承担跨设备共享职责。',
].join('\n');

/** mcp-primary 的原生记忆手动关闭步骤（全部来自 M0 矩阵的公开文档边界）。 */
const NATIVE_DISABLE_MANUAL: Record<AgentKind, string> = {
  'claude-code': [
    '手动步骤（mcp-primary 准备；本原型不代写 settings.json）：',
    '1. 在 Claude Code 会话中执行 /memory 关闭自动记忆，或在项目启动环境中设置 CLAUDE_CODE_DISABLE_AUTO_MEMORY=1。',
    '2. 确认 ~/.claude/projects/<project>/memory/ 不再产生新写入后，才把 Cairn 作为主要记忆入口。',
    '完成前不得宣称原生记忆已被接管或关闭。',
  ].join('\n'),
  cursor: '该宿主没有原生自动记忆（官方 Rules 文档明确模型补全之间不保留记忆）：无需也无法手动关闭原生记忆。',
  copilot: [
    '手动步骤（mcp-primary 准备）：在 GitHub Settings → Copilot 中关闭 Memory 或删除已存记忆。',
    '该开关只在 GitHub 设置中，本原型无法代为更改；完成前不得宣称原生记忆已被接管或关闭。',
  ].join('\n'),
  openclaw: [
    '手动步骤（mcp-primary 准备）：dreaming 等原生记忆开关存在，但配置文件路径官方未公开，本原型不能代为关闭。',
    '请按官方文档在宿主自身配置 / Control UI 中手动关闭；完成前不能宣称已接管或关闭原生记忆。',
  ].join('\n'),
  workbuddy: [
    '手动步骤（mcp-primary 准备）：原生记忆为账号级服务端设置，请在 设置 → 记忆 中手动关闭。',
    '本原型不能代为更改；完成前不能宣称已接管或关闭原生记忆。',
  ].join('\n'),
};

/** 宿主无公开块文件时，router 文案降级为可复制的手动步骤。 */
const ROUTER_COPY_MANUAL_PREFIX =
  '该宿主没有公开的规则/块文件路径：请把以下路由文案手动粘贴到宿主的说明位置（本原型不写入未公开路径）：\n\n';

function worstCapability(a: CapabilityLevel, b: CapabilityLevel): CapabilityLevel {
  return a === 'blocked' || b === 'blocked' ? 'blocked' : 'fixture-only';
}

async function readFileOrNull(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path);
  } catch (e) {
    if ((e as { code?: string }).code === 'ENOENT') return null;
    throw err('E_CONFIG_IO', `读取文件失败: ${path}（${(e as { code?: string }).code ?? '未知错误'}）`);
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (e) {
    if ((e as { code?: string }).code === 'ENOENT') return false;
    throw err('E_CONFIG_IO', `检查文件失败: ${path}（${(e as { code?: string }).code ?? '未知错误'}）`);
  }
}

async function writeFileAtomic(path: string, data: Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.cairn-tmp-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
  try {
    await writeFile(tmp, data);
    await rename(tmp, path);
  } catch (e) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw err('E_CONFIG_IO', `原子写入失败: ${path}（${(e as Error).message}）`);
  }
}

/** 应用前备份原始字节（仅首次，已存在则不覆盖）；目标不存在时无需备份。 */
async function ensureBackup(path: string, current: Buffer | null): Promise<string | null> {
  if (current === null) return null;
  const backupPath = path + BACKUP_SUFFIX;
  if (!(await pathExists(backupPath))) {
    await writeFileAtomic(backupPath, current);
  }
  return backupPath;
}

function parseJsonObject(text: string, path: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw err('E_CONFIG_IO', `配置文件不是合法 JSON: ${path}（${(e as Error).message}）`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw err('E_CONFIG_IO', `配置文件顶层必须是 JSON 对象: ${path}`);
  }
  return parsed as Record<string, unknown>;
}

interface McpMergeInput {
  existingText: string | null;
  mapKey: 'mcpServers' | 'servers';
  entry: { command: string; args: string[] };
  path: string;
}

/** JSON 合并：保留未知顶层字段与其他 server，只加/更新本产品条目。 */
function mergeMcpConfig(input: McpMergeInput): string {
  const obj = input.existingText === null ? {} : parseJsonObject(input.existingText, input.path);
  const existingMap = obj[input.mapKey];
  if (existingMap !== undefined && (typeof existingMap !== 'object' || existingMap === null || Array.isArray(existingMap))) {
    throw err('E_CONFIG_CONFLICT', `${input.mapKey} 不是对象，拒绝覆盖: ${input.path}`);
  }
  const map = { ...(existingMap as Record<string, unknown>) };
  map['cairn'] = { command: input.entry.command, args: input.entry.args };
  const out = { ...obj, [input.mapKey]: map };
  return `${JSON.stringify(out, null, 2)}\n`;
}

/** 判断现有 cairn 条目是否由本产品安装（该配置路径存在活跃安装记录即为本产品所有）。 */
function cairnEntryOwnedByUs(store: CairnStore, agentKind: AgentKind, homeRoot: string, configPath: string): boolean {
  return store.installations.activeFor(agentKind, homeRoot).some((r) => r.configPath === configPath);
}

/** 在两种已知顶层键（mcpServers / servers）中定位本产品条目。 */
function findExistingCairnKey(obj: Record<string, unknown>): 'mcpServers' | 'servers' | null {
  for (const key of ['mcpServers', 'servers'] as const) {
    const map = obj[key];
    if (map !== null && typeof map === 'object' && !Array.isArray(map) && 'cairn' in (map as Record<string, unknown>)) {
      return key;
    }
  }
  return null;
}

/** 计划哈希：规范化 JSON 的 sha256（字段顺序与空白不敏感）。 */
export function planHash(p: AgentConfigPlan): string {
  return sha256Canonical(p);
}

/** planHash 别名：apply 用签名校验计划未被篡改/过期。 */
export function planSignature(p: AgentConfigPlan): string {
  return planHash(p);
}

function resolveAdapter(agentKind: string, homeRoot: string): { adapter: HostAdapter; kind: AgentKind } {
  if (!isAgentKind(agentKind)) {
    throw err('E_VALIDATION', `未知宿主类型: ${JSON.stringify(agentKind)}（支持：${AGENT_KINDS.join(', ')}）`);
  }
  if (typeof homeRoot !== 'string' || homeRoot.length === 0) {
    throw err('E_VALIDATION', 'homeRoot 不能为空');
  }
  return { adapter: HOST_ADAPTERS[agentKind], kind: agentKind };
}

function assertMode(mode: ConfigMode): void {
  if (!CONFIG_MODES.includes(mode)) {
    throw err('E_VALIDATION', `未知配置模式: ${JSON.stringify(mode)}（支持：${CONFIG_MODES.join(', ')}）`);
  }
}

/**
 * 生成配置计划（零写入）：observe 只出说明；router 出受管区块（与可选 MCP 条目）；
 * mcp-primary 额外出原生记忆手动关闭步骤。
 */
export async function planAgentConfig(
  store: CairnStore,
  input: {
    agentKind: AgentKind;
    homeRoot: string;
    projectRoot?: string | null;
    mode: ConfigMode;
    mcpCommand?: { command: string; args: string[] };
  },
): Promise<AgentConfigPlan> {
  assertMode(input.mode);
  const { adapter, kind: agentKind } = resolveAdapter(input.agentKind, input.homeRoot);
  const homeRoot = input.homeRoot;
  const projectRoot = input.projectRoot ?? null;
  const mode = input.mode;
  const notes: string[] = [...adapter.notes];
  const conflicts: { path: string; reason: string }[] = [];
  const actions: ConfigPlanAction[] = [];

  if (mode === 'observe') {
    notes.push('observe 模式：零写入，不修改任何宿主文件。');
    return {
      agentKind,
      homeRoot,
      projectRoot,
      mode,
      actions: [],
      conflicts,
      capability: worstCapability(adapter.mcpConfigCapability, adapter.blockCapability),
      notes,
    };
  }

  // ---- 受管区块（router / mcp-primary）----
  const blockPath = adapter.blockTargetPath(homeRoot, projectRoot);
  if (blockPath !== null) {
    const current = await readFileOrNull(blockPath);
    const before = current !== null ? current.toString('utf8') : null;
    const seedRow = store.blocks.get(blockPath, DEFAULT_BLOCK_ID);
    const seedRevision = seedRow
      ? Number.parseInt(/revision="(\d+)"/.exec(seedRow.startMarker)?.[1] ?? '0', 10)
      : 0;
    const upserted = upsertBlockInText(before ?? '', DEFAULT_BLOCK_ID, ROUTER_BLOCK_CONTENT, {
      revisionSeed: seedRevision,
    });
    actions.push({
      type: 'write_managed_block',
      path: blockPath,
      before,
      after: upserted.output,
      beforeHash: current !== null ? sha256Hex(current) : null,
    });
  } else {
    actions.push({
      type: 'manual_step',
      path: null,
      before: null,
      after: ROUTER_COPY_MANUAL_PREFIX + ROUTER_BLOCK_CONTENT,
      beforeHash: null,
    });
    notes.push('无公开块文件路径：路由文案只提供复制，不写文件。');
  }

  // ---- MCP 条目（提供了 mcpCommand 且宿主有公开路径时）----
  const mcpPath = adapter.mcpConfigPath(homeRoot, projectRoot);
  if (input.mcpCommand !== undefined) {
    if (
      typeof input.mcpCommand.command !== 'string' ||
      input.mcpCommand.command.length === 0 ||
      !Array.isArray(input.mcpCommand.args)
    ) {
      throw err('E_VALIDATION', 'mcpCommand 必须是 { command, args }');
    }
    if (mcpPath !== null) {
      const current = await readFileOrNull(mcpPath);
      const existingText = current !== null ? current.toString('utf8') : null;
      if (existingText !== null) {
        const obj = parseJsonObject(existingText, mcpPath);
        const existingKey = findExistingCairnKey(obj);
        if (existingKey !== null && !cairnEntryOwnedByUs(store, agentKind, homeRoot, mcpPath)) {
          conflicts.push({
            path: mcpPath,
            reason: `已存在同名外来条目 ${existingKey}.cairn（无本产品安装记录），拒绝覆盖`,
          });
        }
      }
      if (conflicts.length === 0) {
        const after = mergeMcpConfig({
          existingText,
          mapKey: adapter.mcpServerMapKey(homeRoot, projectRoot),
          entry: input.mcpCommand,
          path: mcpPath,
        });
        actions.push({
          type: 'write_mcp_config',
          path: mcpPath,
          before: existingText,
          after,
          beforeHash: current !== null ? sha256Hex(current) : null,
        });
      }
    } else {
      notes.push('已提供 mcpCommand，但该宿主没有公开的 MCP 配置路径（blocked）：跳过写入，需用户手动添加。');
    }
  }

  // ---- mcp-primary：原生记忆手动关闭步骤 ----
  if (mode === 'mcp-primary') {
    actions.push({
      type: 'manual_step',
      path: null,
      before: null,
      after: NATIVE_DISABLE_MANUAL[agentKind],
      beforeHash: null,
    });
  }

  // ---- 能力分级（诚实水印）----
  let capability = worstCapability(adapter.mcpConfigCapability, adapter.blockCapability);
  if (mode === 'router' && input.mcpCommand === undefined) {
    capability = adapter.blockCapability;
  }
  if (mode === 'mcp-primary' && agentKind !== 'cursor') {
    // 矩阵：除 cursor（无原生自动记忆，not-applicable）外，mcp-primary 的原生接管一律 blocked（需用户手动）。
    capability = 'blocked';
  }

  return { agentKind, homeRoot, projectRoot, mode, actions, conflicts, capability, notes };
}

export interface ApplyAgentConfigResult {
  applied: ConfigPlanAction[];
  skipped: string[];
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 从计划 after 文本中提取区块正文（apply 严格按计划内容写入）。 */
function extractBlockContent(projected: string, blockId: string): string {
  const re = new RegExp(
    `^<!-- cairn:begin block="${escapeRe(blockId)}" revision="\\d+" -->\\n([\\s\\S]*?)\\n<!-- cairn:end block="${escapeRe(blockId)}" -->`,
    'm',
  );
  const m = re.exec(projected);
  if (m === null || m[1] === undefined) {
    throw err('E_VALIDATION', '计划的 write_managed_block.after 中缺少合法受管区块');
  }
  return m[1];
}

/** 应用配置计划：校验签名与冲突，逐动作核对目标哈希后写入。 */
export async function applyAgentConfig(
  store: CairnStore,
  input: { plan: AgentConfigPlan; signature: string },
): Promise<ApplyAgentConfigResult> {
  const plan = input.plan;
  if (input.signature !== planHash(plan)) {
    throw err('E_TARGET_CHANGED', '计划签名不匹配：计划可能被篡改或已过期，拒绝应用');
  }
  resolveAdapter(plan.agentKind, plan.homeRoot);
  if (plan.conflicts.length > 0) {
    throw err(
      'E_CONFIG_CONFLICT',
      `计划包含未解决冲突（${plan.conflicts.length} 条），拒绝应用：${plan.conflicts.map((c) => c.path).join('; ')}`,
    );
  }
  store.assertWritable();

  const applied: ConfigPlanAction[] = [];
  const skipped: string[] = [];

  for (let i = 0; i < plan.actions.length; i++) {
    const action = plan.actions[i]!;
    if (action.type === 'manual_step') {
      skipped.push(`manual_step#${i + 1}: 需用户手动完成`);
      continue;
    }
    if (action.path === null || action.after === null) {
      throw err('E_VALIDATION', `写动作缺少 path/after（动作 #${i + 1}，类型 ${action.type}）`);
    }
    // 目标在计划后发生变化 → 拒绝（before=null 表示计划时文件不存在，文件新出现同样拒绝）
    const current = await readFileOrNull(action.path);
    const currentHash = current !== null ? sha256Hex(current) : null;
    if (currentHash !== action.beforeHash) {
      throw err('E_TARGET_CHANGED', `目标文件在计划后发生变化，拒绝应用: ${action.path}`);
    }

    if (action.type === 'write_mcp_config') {
      const afterBytes = Buffer.from(action.after, 'utf8');
      const targetHash = sha256Hex(afterBytes);
      const changed = current === null || current.toString('utf8') !== action.after;
      const backupPath = await ensureBackup(action.path, current);
      if (changed) {
        await writeFileAtomic(action.path, afterBytes);
        applied.push(action);
      } else {
        skipped.push(`write_mcp_config:${action.path}: 内容未变化`);
      }
      store.installations.record({
        agentKind: plan.agentKind,
        homeRoot: plan.homeRoot,
        configPath: action.path,
        targetHash,
        ...(backupPath ? { backupPath } : {}),
      });
      store.audit.record(
        'config',
        'applied',
        { type: 'mcp_config', id: plan.agentKind },
        { path: action.path, targetHash, changed },
      );
    } else if (action.type === 'write_managed_block') {
      const content = extractBlockContent(action.after, DEFAULT_BLOCK_ID);
      const result = await generateProjection(store, {
        targetPath: action.path,
        content,
        blockId: DEFAULT_BLOCK_ID,
        agentId: plan.agentKind,
      });
      const targetHash = sha256Hex(Buffer.from(action.after, 'utf8'));
      store.installations.record({
        agentKind: plan.agentKind,
        homeRoot: plan.homeRoot,
        configPath: action.path,
        targetHash,
        ...(result.backupPath ? { backupPath: result.backupPath } : {}),
      });
      if (result.changed) {
        applied.push(action);
      } else {
        skipped.push(`write_managed_block:${action.path}: 内容未变化（revision ${result.revision}）`);
      }
      store.audit.record(
        'config',
        'applied',
        { type: 'managed_block', id: DEFAULT_BLOCK_ID },
        { path: action.path, revision: result.revision, changed: result.changed },
      );
    }
  }

  return { applied, skipped };
}

export interface DoctorResult {
  agentKind: string;
  configPath: string | null;
  configExists: boolean;
  cairnEntryPresent: boolean;
  blockPath: string | null;
  blockPresent: boolean;
  capability: CapabilityLevel;
  notes: string[];
}

/** 只读健康检查：如实报告 fixture-only/blocked，不宣称真实宿主认证。 */
export async function doctorAgentConfig(
  store: CairnStore,
  input: { agentKind: AgentKind; homeRoot: string; projectRoot?: string | null },
): Promise<DoctorResult> {
  const { adapter, kind: agentKind } = resolveAdapter(input.agentKind, input.homeRoot);
  const homeRoot = input.homeRoot;
  const projectRoot = input.projectRoot ?? null;
  const notes: string[] = [...adapter.notes];

  const mcpPath = adapter.mcpConfigPath(homeRoot, projectRoot);
  const blockPath = adapter.blockTargetPath(homeRoot, projectRoot);

  let configExists = false;
  let cairnEntryPresent = false;
  if (mcpPath === null) {
    notes.push('MCP：无公开配置文件路径（blocked），不做检查。');
  } else {
    configExists = await pathExists(mcpPath);
    if (configExists) {
      const buf = (await readFileOrNull(mcpPath))!;
      try {
        const obj = parseJsonObject(buf.toString('utf8'), mcpPath);
        const key = findExistingCairnKey(obj);
        cairnEntryPresent = key !== null;
        if (cairnEntryPresent) {
          const owned = cairnEntryOwnedByUs(store, agentKind, homeRoot, mcpPath);
          notes.push(
            owned ? `MCP：本产品条目已安装（${key}.cairn）。` : 'MCP：发现 cairn 条目但无本产品安装记录（视为外来条目）。',
          );
        }
      } catch {
        notes.push('MCP：配置文件存在但不是合法 JSON，无法确认条目。');
      }
    }
  }

  let blockPresent = false;
  if (blockPath === null) {
    notes.push('受管区块：无公开块文件路径（blocked），只提供可复制文案。');
  } else if (await pathExists(blockPath)) {
    const buf = (await readFileOrNull(blockPath))!;
    blockPresent = hasCairnMarker(buf.toString('utf8'));
  }

  const installations = store.installations.activeFor(agentKind, homeRoot);
  notes.push(`本产品安装记录：${installations.length} 条。`);
  notes.push('本检查基于本地文件与本地库状态；fixture-only/blocked 分级如实反映能力边界，不代表真实宿主 CLI 或认证已验证。');

  return {
    agentKind,
    configPath: mcpPath,
    configExists,
    cairnEntryPresent,
    blockPath,
    blockPresent,
    capability: worstCapability(adapter.mcpConfigCapability, adapter.blockCapability),
    notes,
  };
}

export interface UninstallResult {
  removed: { path: string; restoredOriginal: boolean }[];
  notes: string[];
}

/** 卸载：只处理本产品安装记录覆盖的路径；能恢复原字节就整文件恢复。 */
export async function uninstallAgentConfig(
  store: CairnStore,
  input: { agentKind: AgentKind; homeRoot: string; projectRoot?: string | null },
): Promise<UninstallResult> {
  const { adapter } = resolveAdapter(input.agentKind, input.homeRoot);
  const homeRoot = input.homeRoot;
  const projectRoot = input.projectRoot ?? null;
  store.assertWritable();

  const records = store.installations.activeFor(input.agentKind, homeRoot);
  const notes: string[] = [];
  const removed: { path: string; restoredOriginal: boolean }[] = [];
  if (records.length === 0) {
    return { removed, notes: ['没有本产品的安装记录，未修改任何文件。'] };
  }

  const seen = new Set<string>();
  for (const record of records) {
    const configPath = record.configPath;
    if (seen.has(configPath)) continue;
    seen.add(configPath);

    const current = await readFileOrNull(configPath);
    let restoredOriginal = false;

    if (current === null) {
      notes.push(`${configPath}: 文件已不存在，仅清除安装记录。`);
    } else if (sha256Hex(current) === record.targetHash) {
      // 文件与本产品上次安装后的状态一致 → 整文件恢复备份字节
      const backup = record.backupPath ? await readFileOrNull(record.backupPath) : null;
      if (backup !== null) {
        await writeFileAtomic(configPath, backup);
        restoredOriginal = true;
        const usedBackup = record.backupPath!;
        await rm(usedBackup, { force: true }).catch(() => undefined);
      } else {
        notes.push(`${configPath}: 备份缺失，改为只移除本产品部分。`);
        await removeOnlyOurParts(store, adapter, configPath, current, homeRoot, projectRoot, notes);
      }
    } else {
      // 用户有后续修改 → 只移除本产品部分，其余保留
      await removeOnlyOurParts(store, adapter, configPath, current, homeRoot, projectRoot, notes);
    }

    // 清理与该路径相关的受管区块记录
    for (const blockRow of store.blocks.listActive(configPath)) {
      store.blocks.markRemoved(blockRow.id);
    }
    store.installations.markRemoved(record.id);
    store.audit.record(
      'config',
      'removed',
      { type: 'installation', id: record.id },
      { path: configPath, restoredOriginal },
    );
    removed.push({ path: configPath, restoredOriginal });
  }

  return { removed, notes };
}

async function removeOnlyOurParts(
  store: CairnStore,
  adapter: HostAdapter,
  configPath: string,
  current: Buffer,
  homeRoot: string,
  projectRoot: string | null,
  notes: string[],
): Promise<void> {
  const mcpPath = adapter.mcpConfigPath(homeRoot, projectRoot);
  const blockPath = adapter.blockTargetPath(homeRoot, projectRoot);
  const text = current.toString('utf8');

  if (mcpPath !== null && configPath === mcpPath) {
    const obj = parseJsonObject(text, configPath);
    const key = findExistingCairnKey(obj);
    if (key !== null) {
      delete (obj[key] as Record<string, unknown>)['cairn'];
      await writeFileAtomic(configPath, Buffer.from(`${JSON.stringify(obj, null, 2)}\n`, 'utf8'));
      notes.push(`${configPath}: 只移除了 ${key}.cairn，其他条目与字段保持不变。`);
    } else {
      notes.push(`${configPath}: 未找到本产品 cairn 条目，无需修改。`);
    }
    return;
  }

  if ((blockPath !== null && configPath === blockPath) || hasCairnMarker(text)) {
    const blockRows = store.blocks.listActive(configPath);
    const ids = blockRows.length > 0 ? blockRows.map((r) => r.blockId) : [DEFAULT_BLOCK_ID];
    let out = text;
    let changed = false;
    for (const id of ids) {
      const r = removeBlockFromText(out, id);
      if (r.changed) {
        out = r.output;
        changed = true;
      }
    }
    if (changed) {
      await writeFileAtomic(configPath, Buffer.from(out, 'utf8'));
      notes.push(`${configPath}: 只移除了受管区块，其余内容保持不变。`);
    } else {
      notes.push(`${configPath}: 未发现本产品受管区块，无需修改。`);
    }
    return;
  }

  notes.push(`${configPath}: 路径不属于已知 MCP/块目标且无受管标记，未修改。`);
}
