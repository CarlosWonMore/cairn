import { CairnDb } from './db.js';
import { err } from '../core/errors.js';
import { uuidv7 } from '../core/ids.js';
import { nowIso } from '../core/time.js';
import { sha256Hex } from '../core/hash.js';
import { WriteGuardMixin } from './write-guard.js';

/**
 * 受管区块与宿主配置安装记录（任务 6.1/6.4）。
 * managed_block：Markdown 投影区块所有权；device_installation：配置文件
 * plan→apply 的目标哈希与备份路径，uninstall 依据记录精确移除。
 */

export interface ManagedBlockRow {
  id: string;
  targetPath: string;
  blockId: string;
  agentId: string;
  contentHash: string;
  content: string;
  startMarker: string;
  endMarker: string;
  backupPath: string | null;
  installedAt: string;
  updatedAt: string;
  removedAt: string | null;
}

export interface DeviceInstallationRow {
  id: string;
  agentKind: string;
  homeRoot: string;
  configPath: string;
  targetHash: string;
  backupPath: string | null;
  planId: string | null;
  installedAt: string;
  removedAt: string | null;
}

export class ManagedBlockRepository extends WriteGuardMixin {
  constructor(private readonly db: CairnDb) {
    super();
  }

  upsert(input: {
    targetPath: string;
    blockId: string;
    agentId: string;
    content: string;
    startMarker: string;
    endMarker: string;
    backupPath?: string;
  }): ManagedBlockRow {
    this.checkWritable();
    const existing = this.db.get('SELECT * FROM managed_block WHERE target_path = ? AND block_id = ?', input.targetPath, input.blockId);
    const hash = sha256Hex(input.content);
    const at = nowIso();
    if (existing) {
      this.db.run(
        `UPDATE managed_block SET content = ?, content_hash = ?, start_marker = ?, end_marker = ?,
           backup_path = IFNULL(?, backup_path), updated_at = ?, removed_at = NULL WHERE id = ?`,
        input.content,
        hash,
        input.startMarker,
        input.endMarker,
        input.backupPath ?? null,
        at,
        existing.id,
      );
      return this.require(existing.id as string);
    }
    const id = uuidv7();
    this.db.run(
      `INSERT INTO managed_block (id, target_path, block_id, agent_id, content_hash, content, start_marker, end_marker, backup_path, installed_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.targetPath,
      input.blockId,
      input.agentId,
      hash,
      input.content,
      input.startMarker,
      input.endMarker,
      input.backupPath ?? null,
      at,
      at,
    );
    return this.require(id);
  }

  require(id: string): ManagedBlockRow {
    const row = this.db.get('SELECT * FROM managed_block WHERE id = ?', id);
    if (!row) throw err('E_NOT_FOUND', `受管区块不存在: ${id}`);
    return mapBlock(row);
  }

  get(targetPath: string, blockId: string): ManagedBlockRow | null {
    const row = this.db.get('SELECT * FROM managed_block WHERE target_path = ? AND block_id = ?', targetPath, blockId);
    return row ? mapBlock(row) : null;
  }

  listActive(targetPath?: string): ManagedBlockRow[] {
    if (targetPath) {
      return this.db.all('SELECT * FROM managed_block WHERE removed_at IS NULL AND target_path = ?', targetPath).map(mapBlock);
    }
    return this.db.all('SELECT * FROM managed_block WHERE removed_at IS NULL').map(mapBlock);
  }

  markRemoved(id: string): void {
    this.db.run('UPDATE managed_block SET removed_at = ? WHERE id = ?', nowIso(), id);
  }
}

export class DeviceInstallationRepository extends WriteGuardMixin {
  constructor(private readonly db: CairnDb) {
    super();
  }

  record(input: { agentKind: string; homeRoot: string; configPath: string; targetHash: string; backupPath?: string; planId?: string }): DeviceInstallationRow {
    this.checkWritable();
    const existing = this.db.get(
      'SELECT * FROM device_installation WHERE agent_kind = ? AND home_root = ? AND config_path = ? AND removed_at IS NULL',
      input.agentKind,
      input.homeRoot,
      input.configPath,
    );
    const at = nowIso();
    if (existing) {
      this.db.run(
        'UPDATE device_installation SET target_hash = ?, backup_path = IFNULL(?, backup_path), plan_id = IFNULL(?, plan_id), installed_at = ? WHERE id = ?',
        input.targetHash,
        input.backupPath ?? null,
        input.planId ?? null,
        at,
        existing.id,
      );
      return this.map(this.db.get('SELECT * FROM device_installation WHERE id = ?', existing.id)!);
    }
    const id = uuidv7();
    this.db.run(
      `INSERT INTO device_installation (id, agent_kind, home_root, config_path, target_hash, backup_path, plan_id, installed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.agentKind,
      input.homeRoot,
      input.configPath,
      input.targetHash,
      input.backupPath ?? null,
      input.planId ?? null,
      at,
    );
    return this.map(this.db.get('SELECT * FROM device_installation WHERE id = ?', id)!);
  }

  activeFor(agentKind: string, homeRoot: string): DeviceInstallationRow[] {
    return this.db
      .all('SELECT * FROM device_installation WHERE agent_kind = ? AND home_root = ? AND removed_at IS NULL', agentKind, homeRoot)
      .map((r) => this.map(r));
  }

  markRemoved(id: string): void {
    this.db.run('UPDATE device_installation SET removed_at = ? WHERE id = ?', nowIso(), id);
  }

  private map(r: Record<string, unknown>): DeviceInstallationRow {
    return {
      id: r.id as string,
      agentKind: r.agent_kind as string,
      homeRoot: r.home_root as string,
      configPath: r.config_path as string,
      targetHash: r.target_hash as string,
      backupPath: (r.backup_path as string | null) ?? null,
      planId: (r.plan_id as string | null) ?? null,
      installedAt: r.installed_at as string,
      removedAt: (r.removed_at as string | null) ?? null,
    };
  }
}

function mapBlock(r: Record<string, unknown>): ManagedBlockRow {
  return {
    id: r.id as string,
    targetPath: r.target_path as string,
    blockId: r.block_id as string,
    agentId: r.agent_id as string,
    contentHash: r.content_hash as string,
    content: r.content as string,
    startMarker: r.start_marker as string,
    endMarker: r.end_marker as string,
    backupPath: (r.backup_path as string | null) ?? null,
    installedAt: r.installed_at as string,
    updatedAt: r.updated_at as string,
    removedAt: (r.removed_at as string | null) ?? null,
  };
}
