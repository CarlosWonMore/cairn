// 删除 OBS 指定前缀（argv[1]，如 cairn/ 或 cairn/vaults/<id>/）下全部对象。
// 安全护栏：前缀必须以本产品专用根 cairn/ 开头——绝不触碰 obsidian/、famboard/。
// stdout: {"deleted":N}
import { ObsRemoteStore } from '../src/sync/obs-store.js';

const rawPrefix = (process.argv[2] ?? process.env['OBS_PREFIX'] ?? '').replace(/\/+$/, '');
if (rawPrefix !== 'cairn' && !rawPrefix.startsWith('cairn/')) {
  console.error(`refuse: prefix must be cairn or cairn/... (got ${JSON.stringify(rawPrefix)})`);
  process.exit(1);
}
const cfg = {
  endpoint: process.env['OBS_ENDPOINT']!,
  bucket: process.env['OBS_BUCKET']!,
  prefix: `${rawPrefix}/`,
  accessKeyId: process.env['OBS_ACCESS_KEY_ID']!,
  secretAccessKey: process.env['OBS_SECRET_ACCESS_KEY']!,
};
if (!cfg.endpoint || !cfg.bucket || !cfg.accessKeyId || !cfg.secretAccessKey) {
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
let deleted = 0;
for (const key of all) {
  await store.deleteObject(key);
  deleted++;
}
console.log(JSON.stringify({ deleted, prefix: `${rawPrefix}/` }));
