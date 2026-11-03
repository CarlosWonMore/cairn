import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CairnDb } from './db.js';
import { uuidv7 } from '../core/ids.js';
import { nowIso } from '../core/time.js';

export interface AuditDetail {
  [k: string]: unknown;
}

/**
 * 本地审计事件（design D10）：记录计划、审批、配置备份、作用域排除、
 * 恢复与错误类别。detail 绝不写入记忆正文和秘密——调用方负责。
 */
export class AuditLog {
  constructor(private readonly db: CairnDb) {}

  record(category: string, action: string, subject?: { type?: string; id?: string }, detail: AuditDetail = {}): string {
    const id = uuidv7();
    this.db.run(
      'INSERT INTO audit_event (id, at, category, action, subject_type, subject_id, detail) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id,
      nowIso(),
      category,
      action,
      subject?.type ?? null,
      subject?.id ?? null,
      JSON.stringify(detail),
    );
    return id;
  }

  recent(limit = 50): { id: string; at: string; category: string; action: string; subjectType: string | null; subjectId: string | null; detail: Record<string, unknown> }[] {
    return this.db
      .all('SELECT * FROM audit_event ORDER BY at DESC, id DESC LIMIT ?', limit)
      .map((r) => ({
        id: r.id as string,
        at: r.at as string,
        category: r.category as string,
        action: r.action as string,
        subjectType: (r.subject_type as string | null) ?? null,
        subjectId: (r.subject_id as string | null) ?? null,
        detail: safeParse(r.detail as string),
      }));
  }

  countByCategory(): Record<string, number> {
    const rows = this.db.all('SELECT category, COUNT(*) AS n FROM audit_event GROUP BY category');
    const out: Record<string, number> = {};
    for (const r of rows) out[r.category as string] = Number(r.n);
    return out;
  }

  /**
   * 过滤查询（add-operation-audit）：只读；limit 默认 50、上限 200；since 为 ISO 下界（含）。
   */
  list(filter: { category?: string; action?: string; since?: string; limit?: number } = {}): AuditRow[] {
    const limit = Math.min(Math.max(Math.floor(Number(filter.limit) || 50), 1), 200);
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.category) {
      where.push('category = ?');
      params.push(filter.category);
    }
    if (filter.action) {
      where.push('action = ?');
      params.push(filter.action);
    }
    if (filter.since) {
      where.push('at >= ?');
      params.push(filter.since);
    }
    const sql = `SELECT * FROM audit_event${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY at DESC, id DESC LIMIT ?`;
    return this.db
      .all(sql, ...params, limit)
      .map((r) => ({
        id: r.id as string,
        at: r.at as string,
        category: r.category as string,
        action: r.action as string,
        subjectType: (r.subject_type as string | null) ?? null,
        subjectId: (r.subject_id as string | null) ?? null,
        detail: safeParse(r.detail as string),
      }));
  }

  /**
   * 保留期清理（add-operation-audit）：只删可清理白名单类目的过期行。
   * 白名单里只有 'operation'——治理类目从机制上不可能被删，未来新类目默认豁免。
   */
  pruneOperations(retentionDays: number): number {
    const days = Number.isFinite(retentionDays) && retentionDays > 0 ? retentionDays : 30;
    const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
    const whitelist = ['operation'];
    const placeholders = whitelist.map(() => '?').join(',');
    const res = this.db.run(
      `DELETE FROM audit_event WHERE category IN (${placeholders}) AND at < ?`,
      ...whitelist,
      cutoff,
    );
    return Number(res.changes);
  }
}

export interface AuditRow {
  id: string;
  at: string;
  category: string;
  action: string;
  subjectType: string | null;
  subjectId: string | null;
  detail: Record<string, unknown>;
}

/** 审计配置（add-operation-audit）：env > <home>/config.json > 默认；非法值回落默认并告警。 */
export interface AuditConfig {
  /** operation 类目是否留痕（治理类目不受影响）。 */
  operations: boolean;
  /** operation 类目保留天数。 */
  retentionDays: number;
}

export function readAuditConfig(home: string): AuditConfig {
  const defaults: AuditConfig = { operations: true, retentionDays: 30 };
  const cfg: AuditConfig = { ...defaults };
  // 1) config.json（存在才读；坏文件静默回落——不阻塞打开库）
  try {
    const file = join(home, 'config.json');
    if (existsSync(file)) {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as { audit?: { operations?: unknown; retentionDays?: unknown } };
      const a = parsed?.audit;
      if (a && typeof a === 'object') {
        if (typeof a.operations === 'boolean') cfg.operations = a.operations;
        if (Number.isFinite(Number(a.retentionDays)) && Number(a.retentionDays) > 0) {
          cfg.retentionDays = Number(a.retentionDays);
        }
      }
    }
  } catch {
    /* 坏文件回落默认 */
  }
  // 2) env 覆盖
  const envOps = process.env['CAIRN_AUDIT_OPERATIONS'];
  if (envOps !== undefined) cfg.operations = envOps !== 'false' && envOps !== '0';
  const envDaysRaw = process.env['CAIRN_AUDIT_RETENTION_DAYS'];
  if (envDaysRaw !== undefined) {
    const envDays = Number(envDaysRaw);
    if (Number.isFinite(envDays) && envDays > 0) cfg.retentionDays = envDays;
    else {
      cfg.retentionDays = defaults.retentionDays;
      console.error(`[cairn] CAIRN_AUDIT_RETENTION_DAYS 非法（${envDaysRaw}），回落 ${defaults.retentionDays} 天`);
    }
  }
  return cfg;
}

function safeParse(s: string | null | undefined): Record<string, unknown> {
  if (!s) return {};
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return { unparsable: true };
  }
}
