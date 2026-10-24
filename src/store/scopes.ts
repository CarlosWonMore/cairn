import { CairnDb } from './db.js';
import {
  ScopeRow,
  ScopeSpec,
  ScopePresetName,
  validateScopeSpec,
  scopeAllowsRead,
  scopeAllowsUpstream,
  isPhysicallyLocal,
  ScopeQuery,
} from '../core/scope.js';
import { err } from '../core/errors.js';
import { WriteGuardMixin } from './write-guard.js';
import { uuidv7 } from '../core/ids.js';
import { nowIso } from '../core/time.js';

/**
 * 作用域仓储：预设 find-or-create、自定义空间创建与读取。
 * 所有写入/检索/导出/投影入口必须经由 scopeAllowsRead/Upstream 判定。
 */

export interface ResolvePresetOptions {
  projectId?: string;
  projectName?: string;
  agentId?: string;
  ttlDays?: number;
  customSpaceName?: string;
  overrides?: Partial<Pick<ScopeSpec, 'syncPolicy' | 'readPolicy' | 'readAllowlist' | 'projectionPolicy' | 'sensitivity' | 'ttlDays'>>;
}

export class ScopeRepository extends WriteGuardMixin {
  constructor(private readonly db: CairnDb) {
    super();
  }

  /** 首次初始化：确保内置个人空间存在。 */
  ensureBaseSpace(): string {
    const row = this.db.get("SELECT id FROM space WHERE space_kind = 'personal' LIMIT 1");
    if (row) return row.id as string;
    const id = uuidv7();
    this.db.run("INSERT INTO space (id, name, space_kind, created_at) VALUES (?, ?, 'personal', ?)", id, 'personal', nowIso());
    return id;
  }

  ensureProject(projectId: string, name: string): void {
    const row = this.db.get('SELECT id FROM project WHERE id = ?', projectId);
    if (row) return;
    this.db.run('INSERT INTO project (id, name, created_at) VALUES (?, ?, ?)', projectId, name, nowIso());
  }

  ensureProjectScope(projectId: string, projectName: string): void {
    this.ensureProject(projectId, projectName);
    const row = this.db.get("SELECT id FROM space WHERE space_kind = 'project' AND project_id = ?", projectId);
    if (!row) {
      this.db.run(
        "INSERT INTO space (id, name, space_kind, project_id, created_at) VALUES (?, ?, 'project', ?, ?)",
        uuidv7(),
        projectName,
        projectId,
        nowIso(),
      );
    }
  }

  /**
   * 按预设 find-or-create 作用域。device-local/project-device 需要显式 deviceId。
   * 返回库中的 ScopeRow（校验后的规范形态）。
   */
  resolvePreset(name: Exclude<ScopePresetName, 'custom'>, opts: ResolvePresetOptions & { deviceId?: string } = {}): ScopeRow {
    this.checkWritable();
    let spec: ScopeSpec;
    switch (name) {
      case 'personal-global':
        spec = { ...personalSpec(), ...opts.overrides };
        break;
      case 'device-local': {
        if (!opts.deviceId) throw err('E_SCOPE_INVALID', 'device-local 需要 deviceId');
        spec = { ...deviceSpec(opts.deviceId), ...opts.overrides };
        break;
      }
      case 'project-global': {
        if (!opts.projectId) throw err('E_SCOPE_INVALID', 'project-global 需要 projectId');
        spec = { ...projectSpec(opts.projectId, opts.projectName ?? opts.projectId, 'all'), ...opts.overrides };
        break;
      }
      case 'project-device': {
        if (!opts.projectId || !opts.deviceId) throw err('E_SCOPE_INVALID', 'project-device 需要 projectId 与 deviceId');
        spec = { ...projectSpec(opts.projectId, opts.projectName ?? opts.projectId, opts.deviceId), ...opts.overrides };
        break;
      }
      case 'agent-private': {
        if (!opts.agentId) throw err('E_SCOPE_INVALID', 'agent-private 需要 agentId');
        spec = { ...agentSpec(opts.agentId), ...opts.overrides };
        break;
      }
      case 'session-ephemeral': {
        spec = { ...sessionSpec(opts.ttlDays ?? 7), ...opts.overrides };
        break;
      }
      default: {
        const exhaustive: never = name;
        throw err('E_SCOPE_INVALID', `未知预设 ${String(exhaustive)}`);
      }
    }
    validateScopeSpec(spec);
    return this.upsertByFingerprint(spec, true);
  }

  /** 受约束自定义空间（构想 §7.4）：默认 local_only，显式扩大才放宽。 */
  createCustom(spec: ScopeSpec): ScopeRow {
    this.checkWritable();
    validateScopeSpec(spec);
    return this.upsertByFingerprint(spec, false);
  }

  /** 相同指纹复用已有作用域，避免同一策略产生多行。 */
  private upsertByFingerprint(spec: ScopeSpec, builtin: boolean): ScopeRow {
    const existing = this.findByFingerprint(spec);
    if (existing) return existing;
    const spaceId = this.ensureSpaceFor(spec);
    const id = uuidv7();
    this.db.run(
      `INSERT INTO scope (id, space_id, preset, scope_kind, project_id, device_id, agent_id, read_allowlist,
         sync_policy, read_policy, retention_policy, projection_policy, sensitivity, ttl_days, builtin, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      spaceId,
      spec.preset,
      spec.scopeKind,
      spec.projectId,
      spec.deviceId,
      spec.agentId,
      JSON.stringify(spec.readAllowlist),
      spec.syncPolicy,
      spec.readPolicy,
      spec.retentionPolicy,
      spec.projectionPolicy,
      spec.sensitivity,
      spec.ttlDays,
      builtin ? 1 : 0,
      nowIso(),
    );
    return this.requireById(id);
  }

  private ensureSpaceFor(spec: ScopeSpec): string {
    if (spec.scopeKind === 'project' && spec.projectId) {
      this.ensureProjectScope(spec.projectId, spec.spaceName);
      const row = this.db.get("SELECT id FROM space WHERE space_kind = 'project' AND project_id = ?", spec.projectId);
      return row!.id as string;
    }
    const row = this.db.get('SELECT id FROM space WHERE name = ? AND space_kind = ?', spec.spaceName, spec.scopeKind === 'custom' ? 'custom' : 'personal');
    if (row) return row.id as string;
    const id = uuidv7();
    this.db.run(
      'INSERT INTO space (id, name, space_kind, created_at) VALUES (?, ?, ?, ?)',
      id,
      spec.spaceName,
      spec.scopeKind === 'custom' ? 'custom' : 'personal',
      nowIso(),
    );
    return id;
  }

  private findByFingerprint(spec: ScopeSpec): ScopeRow | null {
    const rows = this.db.all(
      `SELECT s.* FROM scope s WHERE s.preset = ? AND s.device_id = ? AND s.agent_id = ?
        AND s.sync_policy = ? AND s.read_policy = ? AND s.retention_policy = ? AND s.projection_policy = ?
        AND s.sensitivity = ? AND IFNULL(s.project_id,'') = IFNULL(?, '') AND IFNULL(s.ttl_days,-1) = IFNULL(?, -1)
        AND s.read_allowlist = ?`,
      spec.preset,
      spec.deviceId,
      spec.agentId,
      spec.syncPolicy,
      spec.readPolicy,
      spec.retentionPolicy,
      spec.projectionPolicy,
      spec.sensitivity,
      spec.projectId,
      spec.ttlDays,
      JSON.stringify([...spec.readAllowlist].sort()),
    );
    if (rows.length === 0) return null;
    if (spec.preset === 'custom') {
      const matchingName = rows.find((r) => {
        const space = this.db.get('SELECT name FROM space WHERE id = ?', r.space_id);
        return space?.name === spec.spaceName;
      });
      return matchingName ? mapScope(matchingName) : null;
    }
    return mapScope(rows[0]!);
  }

  getById(id: string): ScopeRow | null {
    const row = this.db.get('SELECT * FROM scope WHERE id = ?', id);
    return row ? mapScope(row) : null;
  }

  requireById(id: string): ScopeRow {
    const row = this.getById(id);
    if (!row) throw err('E_NOT_FOUND', `作用域不存在: ${id}`);
    return row;
  }

  list(): ScopeRow[] {
    return this.db.all('SELECT * FROM scope ORDER BY created_at, id').map(mapScope);
  }

  /** 统一读取判定入口（检索/详情/导出/投影共用）。 */
  allowsRead(scopeId: string, query: ScopeQuery): boolean {
    return scopeAllowsRead(this.requireById(scopeId), query);
  }

  allowsUpstream(scopeId: string): boolean {
    return scopeAllowsUpstream(this.requireById(scopeId));
  }

  isPhysicallyLocal(scopeId: string): boolean {
    return isPhysicallyLocal(this.requireById(scopeId));
  }
}

// 预设基础形态（避免与 core/scope.ts 循环依赖的轻量副本语义一致）
function personalSpec(): ScopeSpec {
  return {
    preset: 'personal-global', scopeKind: 'personal', spaceName: 'personal', projectId: null,
    deviceId: 'all', agentId: 'all', syncPolicy: 'encrypted', readPolicy: 'all_agents', readAllowlist: [],
    retentionPolicy: 'permanent', projectionPolicy: 'none', sensitivity: 'normal', ttlDays: null,
  };
}
function deviceSpec(deviceId: string): ScopeSpec {
  return {
    preset: 'device-local', scopeKind: 'device', spaceName: 'device-local', projectId: null,
    deviceId, agentId: 'all', syncPolicy: 'local_only', readPolicy: 'all_agents', readAllowlist: [],
    retentionPolicy: 'permanent', projectionPolicy: 'none', sensitivity: 'normal', ttlDays: null,
  };
}
function projectSpec(projectId: string, projectName: string, deviceId: string): ScopeSpec {
  return {
    preset: deviceId === 'all' ? 'project-global' : 'project-device',
    scopeKind: 'project', spaceName: projectName, projectId,
    deviceId, agentId: 'all', syncPolicy: deviceId === 'all' ? 'encrypted' : 'local_only',
    readPolicy: 'all_agents', readAllowlist: [], retentionPolicy: 'permanent',
    projectionPolicy: 'none', sensitivity: 'normal', ttlDays: null,
  };
}
function agentSpec(agentId: string): ScopeSpec {
  return {
    preset: 'agent-private', scopeKind: 'agent', spaceName: `agent:${agentId}`, projectId: null,
    deviceId: 'all', agentId, syncPolicy: 'local_only', readPolicy: 'allowlist', readAllowlist: [agentId],
    retentionPolicy: 'permanent', projectionPolicy: 'none', sensitivity: 'normal', ttlDays: null,
  };
}
function sessionSpec(ttlDays: number): ScopeSpec {
  return {
    preset: 'session-ephemeral', scopeKind: 'personal', spaceName: 'session', projectId: null,
    deviceId: 'all', agentId: 'all', syncPolicy: 'local_only', readPolicy: 'all_agents', readAllowlist: [],
    retentionPolicy: 'ttl', projectionPolicy: 'none', sensitivity: 'normal', ttlDays,
  };
}

export function mapScope(r: Record<string, unknown>): ScopeRow {
  return {
    id: r.id as string,
    spaceId: r.space_id as string,
    preset: r.preset as ScopeRow['preset'],
    scopeKind: r.scope_kind as ScopeRow['scopeKind'],
    projectId: (r.project_id as string | null) ?? null,
    deviceId: r.device_id as string,
    agentId: r.agent_id as string,
    readAllowlist: safeJsonArray(r.read_allowlist as string),
    syncPolicy: r.sync_policy as ScopeRow['syncPolicy'],
    readPolicy: r.read_policy as ScopeRow['readPolicy'],
    retentionPolicy: r.retention_policy as ScopeRow['retentionPolicy'],
    projectionPolicy: r.projection_policy as ScopeRow['projectionPolicy'],
    sensitivity: r.sensitivity as ScopeRow['sensitivity'],
    ttlDays: (r.ttl_days as number | null) ?? null,
    builtin: Number(r.builtin) === 1,
  };
}

function safeJsonArray(s: string | null | undefined): string[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s) as unknown;
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}
