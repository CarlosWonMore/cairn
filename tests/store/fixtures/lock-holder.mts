import { AppService } from '../../../src/interfaces/app-service.js';

// 锁持有器：打开（或创建+迁移）数据库后持有未提交写事务 holdMs 毫秒再提交退出。
// 供冷启动竞态回归测试使用（父线程同步阻塞时 setTimeout 无法触发，必须独立进程）。
const dbPath = process.argv[2] ?? '';
const holdMs = Number(process.argv[3] ?? 1200);
if (!dbPath) {
  console.error('usage: lock-holder.mts <dbPath> [holdMs]');
  process.exit(2);
}
const { CairnDb } = await import('../../../src/store/db.js');
const { runMigrations } = await import('../../../src/store/migrate.js');
const db = CairnDb.open(dbPath);
runMigrations(db);
db.exec('BEGIN IMMEDIATE');
db.run("INSERT OR REPLACE INTO meta (key, value) VALUES ('lock_holder', '1')");
const timer = setTimeout(() => {
  try {
    db.exec('COMMIT');
    db.close();
    console.log('released');
    process.exit(0);
  } catch (e) {
    console.error(String(e));
    process.exit(1);
  }
}, holdMs);
timer.unref?.();
// 防止事件循环空转退出
const keepAlive = setInterval(() => {}, 100);
keepAlive.unref?.();
setTimeout(() => {}, holdMs + 5000);
