/**
 * 作用域是统一策略对象，不是标签集合（design D4）。
 * 预设只是构造器；写入、检索、详情、导出、投影与 outbox 构造
 * 必须调用同一组判定入口，禁止各入口自行解释作用域。
 */

import { err } from './errors.js';

export type SyncPolicy = 'local_only' | 'encrypted';
export type ReadPolicy = 'all_agents' | 'allowlist';
export type RetentionPolicy = 'permanent' | 'ttl' | 'lru' | 'session';
export type ProjectionPolicy = 'none' | 'allowlist';

export const SCOPE_PRESETS = [
  'personal-global',
  'device-local',
  'project-global',
  'project-device',
  'agent-private',
  'session-ephemeral',
  'custom',
] as const;
export type ScopePresetName = (typeof SCOPE_PRESETS)[number];

export type ScopeKind = 'personal' | 'project' | 'agent' | 'device' | 'custom';

/** 逻辑作用域描述（构造/校验用；存储映射在 store 层）。 */
export interface ScopeSpec {
  preset: ScopePresetName;
  scopeKind: ScopeKind;
  /** 自定义空间名称；custom 必填，其余为展示名。 */
  spaceName: string;
  projectId: string | null;
  /** 'all' 或具体设备 ID；device 类作用域必须是具体设备。 */
  deviceId: string;
  /** 'all' 或具体 Agent ID。 */
  agentId: string;
  syncPolicy: SyncPolicy;
  readPolicy: ReadPolicy;
  /** 读取 allowlist：readPolicy 为 allowlist 时生效。 */
  readAllowlist: string[];
  retentionPolicy: RetentionPolicy;
  projectionPolicy: ProjectionPolicy;
  sensitivity: 'normal' | 'sensitive';
  ttlDays: number | null;
}

export interface ScopeRow {
  id: string;
  spaceId: string;
  preset: ScopePresetName;
  scopeKind: ScopeKind;
  projectId: string | null;
  deviceId: string;
  agentId: string;
  syncPolicy: SyncPolicy;
  readPolicy: ReadPolicy;
  readAllowlist: string[];
  retentionPolicy: RetentionPolicy;
  projectionPolicy: ProjectionPolicy;
  sensitivity: 'normal' | 'sensitive';
  ttlDays: number | null;
  builtin: boolean;
}

/** 读取请求方的身份三元组；所有读取入口都必须提供。 */
export interface ScopeQuery {
  deviceId: string;
  agentId: string;
  projectId?: string | null;
}

// ---------------------------------------------------------------------------
// 预设构造器（构想 §7.3）
// ---------------------------------------------------------------------------

export function personalGlobal(): ScopeSpec {
  return base('personal-global', 'personal', 'personal', {
    deviceId: 'all',
    agentId: 'all',
    syncPolicy: 'encrypted',
    readPolicy: 'all_agents',
    retentionPolicy: 'permanent',
  });
}

export function deviceLocal(deviceId: string): ScopeSpec {
  if (deviceId === 'all') throw err('E_SCOPE_INVALID', 'device-local 作用域必须绑定具体设备');
  return base('device-local', 'device', 'device-local', {
    deviceId,
    agentId: 'all',
    syncPolicy: 'local_only',
    readPolicy: 'all_agents',
    retentionPolicy: 'permanent',
  });
}

export function projectGlobal(projectId: string, projectName: string): ScopeSpec {
  return base('project-global', 'project', projectName, {
    projectId,
    deviceId: 'all',
    agentId: 'all',
    syncPolicy: 'encrypted',
    readPolicy: 'all_agents',
    retentionPolicy: 'permanent',
  });
}

export function projectDevice(projectId: string, projectName: string, deviceId: string): ScopeSpec {
  if (deviceId === 'all') throw err('E_SCOPE_INVALID', 'project-device 作用域必须绑定具体设备');
  return base('project-device', 'project', projectName, {
    projectId,
    deviceId,
    agentId: 'all',
    syncPolicy: 'local_only',
    readPolicy: 'all_agents',
    retentionPolicy: 'permanent',
  });
}

export function agentPrivate(agentId: string, opts?: { syncPolicy?: SyncPolicy }): ScopeSpec {
  return base('agent-private', 'agent', `agent:${agentId}`, {
    deviceId: 'all',
    agentId,
    syncPolicy: opts?.syncPolicy ?? 'local_only',
    readPolicy: 'allowlist',
    readAllowlist: [agentId],
    retentionPolicy: 'permanent',
  });
}

export function sessionEphemeral(ttlDays: number): ScopeSpec {
  return base('session-ephemeral', 'personal', 'session', {
    deviceId: 'all',
    agentId: 'all',
    syncPolicy: 'local_only',
    readPolicy: 'all_agents',
    retentionPolicy: 'ttl',
    ttlDays,
  });
}

/**
 * 自定义空间：默认 local_only、默认不向所有 Agent 放宽（构想 §7.4）。
 * 调用方必须显式扩大范围；不提供任意表达式语言。
 */
export function customSpace(spaceName: string, opts?: Partial<ScopeSpec>): ScopeSpec {
  const spec = base('custom', 'custom', spaceName, {
    deviceId: 'all',
    agentId: 'all',
    syncPolicy: 'local_only',
    readPolicy: 'all_agents',
    retentionPolicy: 'permanent',
    ...opts,
  });
  return spec;
}

function base(
  preset: ScopePresetName,
  scopeKind: ScopeKind,
  spaceName: string,
  fields: Partial<ScopeSpec>,
): ScopeSpec {
  return {
    preset,
    scopeKind,
    spaceName,
    projectId: null,
    deviceId: 'all',
    agentId: 'all',
    syncPolicy: 'local_only',
    readPolicy: 'all_agents',
    readAllowlist: [],
    retentionPolicy: 'permanent',
    projectionPolicy: 'none',
    sensitivity: 'normal',
    ttlDays: null,
    ...fields,
  } as ScopeSpec;
}

// ---------------------------------------------------------------------------
// 校验
// ---------------------------------------------------------------------------

const CUSTOM_SPACE_NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,63}$/u;

export function validateScopeSpec(spec: ScopeSpec): void {
  const problems: string[] = [];
  if (spec.scopeKind === 'project' && !spec.projectId) {
    problems.push('project 作用域必须绑定 projectId');
  }
  if (spec.scopeKind === 'custom') {
    if (!CUSTOM_SPACE_NAME_RE.test(spec.spaceName)) {
      problems.push(`自定义空间名称非法: ${JSON.stringify(spec.spaceName)}（1-64 字符，字母/数字/空格/._-）`);
    }
    if (spec.syncPolicy === 'encrypted' && spec.sensitivity === 'sensitive') {
      problems.push('sensitive 空间不允许启用加密同步（默认 local_only）');
    }
  }
  // 物理边界：设备绑定作用域永远不可上行（spec memory-store / 构想 §7.5）
  if (spec.deviceId !== 'all' && spec.syncPolicy !== 'local_only') {
    problems.push('设备绑定作用域的 syncPolicy 必须是 local_only');
  }
  if (spec.syncPolicy === 'encrypted' && spec.deviceId !== 'all') {
    problems.push('encrypted 同步要求 device 为 all');
  }
  if (spec.retentionPolicy === 'ttl' && (spec.ttlDays == null || spec.ttlDays <= 0)) {
    problems.push('retention ttl 必须提供正整数 ttlDays');
  }
  if (spec.sensitivity === 'sensitive' && spec.syncPolicy !== 'local_only') {
    problems.push('sensitive 作用域必须 local_only（首版保守规则）');
  }
  if (spec.readPolicy === 'allowlist' && spec.readAllowlist.length === 0) {
    problems.push('readPolicy allowlist 必须提供 readAllowlist');
  }
  if (problems.length > 0) {
    throw err('E_SCOPE_INVALID', `作用域校验失败: ${problems.join('; ')}`, { problems });
  }
}

// ---------------------------------------------------------------------------
// 统一判定入口：检索、详情、导出、投影、outbox 共用
// ---------------------------------------------------------------------------

/**
 * 读取判定。项目作用域只对同一逻辑项目可见；设备/Agent 维度按绑定匹配。
 * 注意：不允许通过替代入口绕过（spec scoped-retrieval）。
 */
export function scopeAllowsRead(scope: Pick<ScopeRow, 'deviceId' | 'agentId' | 'projectId' | 'readPolicy' | 'readAllowlist'>, query: ScopeQuery): boolean {
  if (scope.readPolicy === 'allowlist' && !scope.readAllowlist.includes(query.agentId)) {
    return false;
  }
  if (scope.deviceId !== 'all' && scope.deviceId !== query.deviceId) {
    return false;
  }
  if (scope.agentId !== 'all' && scope.agentId !== query.agentId) {
    return false;
  }
  if (scope.projectId != null && (query.projectId ?? null) !== scope.projectId) {
    return false;
  }
  return true;
}

/** 上行判定：只有 encrypted 作用域可以生成上行任务。 */
export function scopeAllowsUpstream(scope: Pick<ScopeRow, 'syncPolicy'>): boolean {
  return scope.syncPolicy === 'encrypted';
}

/** local_only / 设备限定内容是否被物理排除于上行之外。 */
export function isPhysicallyLocal(scope: Pick<ScopeRow, 'syncPolicy' | 'deviceId'>): boolean {
  return scope.syncPolicy === 'local_only' || scope.deviceId !== 'all';
}
