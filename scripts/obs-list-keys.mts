// 列举 OBS 前缀下全部对象 key（stdout JSON 数组）；凭据走环境变量
import { ObsRemoteStore } from '../src/sync/obs-store.js';

const cfg = {
  endpoint: process.env['OBS_ENDPOINT']!,
  bucket: process.env['OBS_BUCKET']!,
  prefix: process.env['OBS_PREFIX']!,
  accessKeyId: process.env['OBS_ACCESS_KEY_ID']!,
  secretAccessKey: process.env['OBS_SECRET_ACCESS_KEY']!,
};
if (!cfg.endpoint || !cfg.bucket || !cfg.prefix || !cfg.accessKeyId || !cfg.secretAccessKey) {
  console.error('OBS env missing');
  process.exit(1);
}
const store = new ObsRemoteStore(cfg);
const all: string[] = [];
let cursor: string | undefined;
for (;;) {
  const r = await store.list('', cursor);
  all.push(...r.keys);
  if (!r.nextCursor) break;
  cursor = r.nextCursor;
}
console.log(JSON.stringify(all));
