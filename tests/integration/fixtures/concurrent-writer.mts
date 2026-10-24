import { AppService } from '../../../src/interfaces/app-service.js';

// 并发写入器：4 个进程同时对同一本地库各写 5 条
const home = process.env['CAIRN_TEST_HOME'] ?? '';
const idx = process.argv[2] ?? '0';
if (!home) {
  console.error('CAIRN_TEST_HOME required');
  process.exit(2);
}
const service = AppService.open(home);
let ok = 0;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

try {
  for (let i = 0; i < 5; i++) {
    // 写争用下的有界重试（契约：返回可重试状态而非无限等待）
    for (let attempt = 1; ; attempt++) {
      try {
        service.addMemory({ content: `并发写入 进程${process.pid} 序号${i} 记录 p${idx}-item-${i}`, kind: 'fact' });
        ok++;
        break;
      } catch (e) {
        if ((e as { code?: string }).code === 'E_DB_LOCKED' && attempt < 10) {
          await sleep(150 * attempt);
          continue;
        }
        throw e;
      }
    }
  }
  console.log(JSON.stringify({ ok }));
} catch (e) {
  console.log(JSON.stringify({ ok, error: (e as { code?: string }).code ?? String(e) }));
  process.exitCode = 1;
} finally {
  service.close();
}
