// 只读核查真实库迁移结果（第三轮交接 toZcode.md 第 1 项）；不执行任何写操作
import { DatabaseSync } from 'node:sqlite';
const DB = 'C:/Users/Carlos/.cairn/data/cairn.db';
const BAK = 'C:/Users/Carlos/.cairn/backups/cairn-pre-v4-20261102-002039.db';
const open = (p) => new DatabaseSync(p, { readOnly: true });
const one = (db, sql) => { const r = db.prepare(sql).get(); return r ? Object.values(r)[0] : undefined; };

const db = open(DB);
const out = {};
out.user_version = one(db, 'PRAGMA user_version');
out.integrity = one(db, 'PRAGMA integrity_check');
out.fk_violations = db.prepare('PRAGMA foreign_key_check').all().length;
const expect = { memory: 28, memory_revision: 28, import_item: 533, scope: 2, onboarding_plan: 3, plan_operation: 27 };
out.rowCounts = {};
out.rowCountMatch = true;
for (const [t, n] of Object.entries(expect)) {
  const c = Number(one(db, `SELECT COUNT(*) FROM ${t}`));
  out.rowCounts[t] = c;
  if (c !== n) out.rowCountMatch = false;
}
out.memoryIndexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='memory' ORDER BY name").all().map((r) => r.name);
out.memoryTriggers = db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='memory' ORDER BY name").all().map((r) => r.name);
out.ftsHits = Number(one(db, "SELECT COUNT(*) FROM memory_fts WHERE memory_fts MATCH 'cairn'"));
db.close();

const bak = open(BAK);
out.backup = { user_version: one(bak, 'PRAGMA user_version'), integrity: one(bak, 'PRAGMA integrity_check') };
bak.close();

console.log(JSON.stringify(out, null, 1));
