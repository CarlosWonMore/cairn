/** add-operation-audit 写放大基准：CAIRN_AUDIT_OPERATIONS=false|true 两进程对照。一次性脚本。 */
import { AppService } from '../src/interfaces/app-service.js';
import { makeTestHome, cleanupTestHome } from '../tests/helpers.js';

const N = 1000;
const WARM = 100;
const home = makeTestHome('cairn-bench-');
const svc = AppService.open(home);
svc.addMemory({ content: '基准记忆：跨设备共享记忆统一走 Cairn MCP', kind: 'fact', scope: { preset: 'personal-global' } });
const q = { deviceId: svc.caller.deviceId, agentId: 'bench' };
for (let i = 0; i < WARM; i++) svc.search({ text: `预热 ${i % 5}`, query: q });
const t0 = performance.now();
for (let i = 0; i < N; i++) svc.search({ text: `基准查询第 ${i % 7} 号`, query: q });
const ms = performance.now() - t0;
const mode = process.env['CAIRN_AUDIT_OPERATIONS'] === 'false' ? '审计关' : '审计开';
console.log(`${mode}: ${N} 次 search 共 ${ms.toFixed(0)} ms（${(ms / N).toFixed(3)} ms/次）`);
svc.close();
cleanupTestHome(home);
