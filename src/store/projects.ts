import { CairnDb } from './db.js';
import { AuditLog } from './audit.js';
import { normalizeAlias } from './project-alias.js';
import { uuidv7 } from '../core/ids.js';
import { nowIso } from '../core/time.js';
import { err } from '../core/errors.js';

/**
 * 项目身份仓储（add-stable-project-identity design D1/D4/D6）。
 *
 * 项目的 id 是 uuidv7，路径/仓库地址只作为别名存在；CLI 与 MCP 都只能经由
 * 本模块的三个函数读写，避免「同一判断写两份」。
 * 不校验路径是否存在（D5）：跨设备解析时对方目录本就不在本机。
 */

export interface ProjectSummary {
  projectId: string;
  name: string;
  aliases: string[];
  createdAt: string;
}

export interface ResolveProjectResult {
  projectId: string;
  name: string;
  /** true=本次新建；false=命中已有项目 */
  created: boolean;
  /** 本次用于匹配/登记的归一化别名 */
  matchedAlias: string;
}

export interface AddAliasResult {
  projectId: string;
  alias: string;
  /** false 表示该别名本来就属于这个项目（幂等，无写入） */
  added: boolean;
  aliases: string[];
}

/** 解析：命中返回原 id，未命中建项目（uuidv7）+ 首别名。 */
export function resolveProject(db: CairnDb, raw: string, opts: { name?: string } = {}): ResolveProjectResult {
  const alias = normalizeAlias(raw);
  const hit = findOwner(db, alias.value);
  if (hit) return { projectId: hit.projectId, name: hit.name, created: false, matchedAlias: alias.value };

  const projectId = uuidv7();
  // 默认显示名用归一化值：原始 URL 可能带凭据，不能落到 project.name。
  const name = opts.name?.trim() || alias.value;
  db.transaction(() => {
    db.run(
      'INSERT INTO project (id, name, aliases, created_at) VALUES (?, ?, ?, ?)',
      projectId,
      name,
      JSON.stringify([alias.value]),
      nowIso(),
    );
    new AuditLog(db).record('project', 'created', { type: 'project', id: projectId }, { alias: alias.value, kind: alias.kind, name });
  });
  return { projectId, name, created: true, matchedAlias: alias.value };
}

/** 追加别名：被别的项目占用即拒绝并报告归属，不改任何数据（D4）。 */
export function addAlias(db: CairnDb, projectId: string, raw: string): AddAliasResult {
  const alias = normalizeAlias(raw);
  const target = getProject(db, projectId);
  if (!target) throw err('E_NOT_FOUND', `项目不存在: ${projectId}`);

  const owner = findOwner(db, alias.value);
  if (owner && owner.projectId !== projectId) {
    throw err('E_CONFLICT_STATE', `别名已属于其他项目: ${alias.value} → ${owner.name}`, {
      alias: alias.value,
      ownerProjectId: owner.projectId,
      ownerName: owner.name,
    });
  }
  if (owner) return { projectId, alias: alias.value, added: false, aliases: target.aliases };

  const aliases = [...target.aliases, alias.value];
  db.transaction(() => {
    db.run('UPDATE project SET aliases = ? WHERE id = ?', JSON.stringify(aliases), projectId);
    new AuditLog(db).record('project', 'alias_added', { type: 'project', id: projectId }, { alias: alias.value, kind: alias.kind });
  });
  return { projectId, alias: alias.value, added: true, aliases };
}

/** 严格只读：绝不建项目。 */
export function listProjects(db: CairnDb): ProjectSummary[] {
  return db.all('SELECT id, name, aliases, created_at FROM project ORDER BY created_at, id').map(mapProject);
}

function getProject(db: CairnDb, projectId: string): ProjectSummary | null {
  const row = db.get('SELECT id, name, aliases, created_at FROM project WHERE id = ?', projectId);
  return row ? mapProject(row) : null;
}

/** ponytail: 全表扫描。项目数是几十量级；上万时再加别名索引。 */
function findOwner(db: CairnDb, value: string): ProjectSummary | null {
  return listProjects(db).find((p) => p.aliases.includes(value)) ?? null;
}

function mapProject(r: Record<string, unknown>): ProjectSummary {
  return {
    projectId: r.id as string,
    name: r.name as string,
    aliases: parseAliases(r.aliases as string),
    createdAt: r.created_at as string,
  };
}

function parseAliases(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}
