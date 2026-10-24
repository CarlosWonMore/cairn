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
}

function safeParse(s: string | null | undefined): Record<string, unknown> {
  if (!s) return {};
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return { unparsable: true };
  }
}
