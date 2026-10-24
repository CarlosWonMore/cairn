/**
 * 隔离合同 fixture（design D9）：独立子进程里跑一轮必然失败的 runOnce。
 * 合同：即使所有 handler 都失败，子进程也必须以 exit 0 正常退出——
 * 「Agent 会话不被后台故障终止」的最小证明。
 *
 * 运行方式（由 tests/jobs/isolation.test.ts spawn）：
 *   node --import tsx tests/jobs/fixtures/worker-child.mts
 * 环境变量 CAIRN_TEST_HOME 指向合成 HOME；stdout 仅输出一行 summary JSON。
 */
import { openStore } from '../../../src/store/open.js';
import { registerDefaultHandlers, runOnce } from '../../../src/jobs/worker.js';

const home = process.env['CAIRN_TEST_HOME'];
if (!home) {
  process.stderr.write('CAIRN_TEST_HOME not set\n');
  process.exit(2);
}

const store = openStore({ home });
try {
  const scope = store.scopes.resolvePreset('personal-global');
  store.outbox.enqueue({
    jobType: 'extract',
    scopeId: scope.id,
    entityType: 'memory',
    entityId: 'child-memory-1',
    payload: { content: 'synthetic child memory' },
    idempotencyKey: 'child-extract-1',
  });
  registerDefaultHandlers();
  const summary = await runOnce(store);
  // Windows 管道上的 stdout 写入可能是异步的：等 flush 完成再 exit，避免摘要被截断。
  const json = JSON.stringify(summary);
  await new Promise<void>((resolve) => process.stdout.write(`${json}\n`, () => resolve()));
} finally {
  store.close();
}
process.exit(0);
