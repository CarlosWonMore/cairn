import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/**
 * 真实库只读冒烟（任务 7.3）。
 *
 * 只做三件事：起 `cairn ui`、打只读端点、对数据目录做前后指纹比对。
 * 全程不发任何 POST / 不生成复核包 / 不 approve——本脚本存在的意义
 * 就是证明"打开工作台"这件事在数据层面确实是零写入。
 */

const HOME = process.env.CAIRN_HOME ?? join(homedir(), '.cairn');
const DB = join(HOME, 'data', 'cairn.db');
const OUT_DIR = 'artifacts';
const EPHEMERAL = /-(wal|shm)$/;

const TABLES = ['memory', 'memory_revision', 'import_archive', 'import_item', 'onboarding_plan', 'approval', 'audit_event', 'outbox_job', 'conflict'];

function fingerprint() {
  const h = createHash('sha256');
  const files = [DB, `${DB}-wal`, `${DB}-shm`].filter((f) => {
    try {
      statSync(f);
      return true;
    } catch {
      return false;
    }
  });
  const sizes = {};
  for (const f of files.sort()) {
    const buf = readFileSync(f);
    sizes[f.replace(HOME, '~')] = buf.length;
    // WAL/SHM 是运行期易变文件（checkpoint 时清理），只记体积不参与哈希判定
    if (!EPHEMERAL.test(f)) h.update(buf);
  }
  return { sha256: h.digest('hex'), sizes };
}

function counts() {
  return new Promise((resolve, reject) => {
    const p = spawn(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
        import { openStore } from './dist/src/store/open.js';
        const s = openStore({ home: process.argv[1], readOnly: true });
        const out = {};
        for (const t of ${JSON.stringify(TABLES)}) out[t] = Number(s.db.scalar('SELECT COUNT(*) AS n FROM ' + t) ?? 0);
        s.close();
        process.stdout.write(JSON.stringify(out));
        `,
        HOME,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let out = '';
    let err = '';
    p.stdout.on('data', (c) => (out += c));
    p.stderr.on('data', (c) => (err += c));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(JSON.parse(out)) : reject(new Error(err || `exit ${code}`))));
  });
}

async function startUi() {
  const p = spawn(process.execPath, ['dist/src/interfaces/cli/main.js', '--json', 'ui', '--port', '0', '--no-open'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const info = await new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error(`启动超时: ${buf}`)), 30_000);
    p.stdout.on('data', (c) => {
      buf += c;
      const at = buf.indexOf('{');
      if (at < 0) return;
      try {
        const j = JSON.parse(buf.slice(at));
        clearTimeout(timer);
        resolve(j);
      } catch {
        /* 未收全 */
      }
    });
    p.on('error', reject);
  });
  return { proc: p, info };
}

const ENDPOINTS = [
  '/api/status',
  '/api/scopes',
  '/api/memories?limit=50',
  '/api/memories?mode=full&limit=5',
  '/api/archives',
  '/api/batches',
  '/api/imports',
  '/api/policies',
  '/api/plans',
  '/api/reviews',
  '/api/inbox?limit=50',
  '/api/sync/status',
];

/**
 * 抽屉接口：条目列表要靠 archive id 才能打。
 * 先读 /api/imports 取第一条档案，再打它的 items——这条路径正是页面上"点开抽屉"走的。
 */
async function drawerProbe(base, token) {
  const out = [];
  let archiveId = null;
  try {
    const r = await fetch(new URL('/api/imports', base), { headers: { 'x-cairn-token': token } });
    const j = await r.json();
    archiveId = j?.data?.rows?.[0]?.archiveId ?? null;
    out.push({ endpoint: '/api/imports（取抽屉目标）', status: r.status, bytes: 0, ms: 0, ok: r.status === 200 && j?.ok === true });
  } catch (e) {
    out.push({ endpoint: '/api/imports（取抽屉目标）', status: 0, bytes: 0, ms: 0, ok: false, note: String(e) });
    return out;
  }
  if (archiveId == null) {
    // 空库不是失败：没有档案就没有抽屉可开。
    out.push({ endpoint: '/api/archives/<id>/items', status: 0, bytes: 0, ms: 0, ok: true, note: '库中无导入档案，跳过' });
    return out;
  }
  const ep = `/api/archives/${encodeURIComponent(archiveId)}/items?limit=20`;
  const t0 = Date.now();
  const r2 = await fetch(new URL(ep, base), { headers: { 'x-cairn-token': token } });
  const body = await r2.text();
  out.push({
    endpoint: '/api/archives/<id>/items（抽屉）',
    status: r2.status,
    bytes: body.length,
    ms: Date.now() - t0,
    ok: r2.status === 200 && body.startsWith('{"ok":true'),
  });
  return out;
}

async function main() {
  const startedAt = new Date().toISOString();
  const before = { fp: fingerprint(), counts: await counts() };
  const { proc, info } = await startUi();
  const token = new URL(info.tokenUrl).searchParams.get('t');
  const results = [];
  try {
    for (const ep of ENDPOINTS) {
      const t0 = Date.now();
      const r = await fetch(new URL(ep, info.url), { headers: { 'x-cairn-token': token } });
      const body = await r.text();
      results.push({ endpoint: ep, status: r.status, bytes: body.length, ms: Date.now() - t0, ok: r.status === 200 && body.startsWith('{"ok":true') });
    }
    // 反向用例：无令牌必须 401
    const noToken = await fetch(new URL('/api/status', info.url));
    results.push({ endpoint: '/api/status (无令牌)', status: noToken.status, bytes: 0, ms: 0, ok: noToken.status === 401 });
    // 反向用例：GET 打写端点不得落进写分支
    const getWrite = await fetch(new URL('/api/sync/push', info.url), { headers: { 'x-cairn-token': token } });
    results.push({ endpoint: 'GET /api/sync/push', status: getWrite.status, bytes: 0, ms: 0, ok: getWrite.status === 404 });
    // 反向用例：GET 打自动整理/撤销端点也不得落进写分支（只读冒烟的底线）
    for (const ep of ['/api/onboarding/auto', '/api/onboarding/revoke']) {
      const r = await fetch(new URL(ep, info.url), { headers: { 'x-cairn-token': token } });
      results.push({ endpoint: `GET ${ep}`, status: r.status, bytes: 0, ms: 0, ok: r.status === 404 });
    }
    // 抽屉路径：点开抽屉会打 archive items
    for (const x of await drawerProbe(info.url, token)) results.push(x);
  } finally {
    proc.kill();
  }

  const after = { fp: fingerprint(), counts: await counts() };
  const diffTables = TABLES.filter((t) => before.counts[t] !== after.counts[t]).map((t) => ({
    table: t,
    before: before.counts[t],
    after: after.counts[t],
  }));

  const report = {
    startedAt,
    finishedAt: new Date().toISOString(),
    home: HOME.replace(homedir(), '~'),
    dbBytes: before.fp.sizes,
    dbSha256Before: before.fp.sha256,
    dbSha256After: after.fp.sha256,
    bytesIdentical: before.fp.sha256 === after.fp.sha256,
    countsBefore: before.counts,
    countsAfter: after.counts,
    changedTables: diffTables,
    endpoints: results,
    verdict: before.fp.sha256 === after.fp.sha256 && diffTables.length === 0 && results.every((r) => r.ok) ? 'PASS' : 'FAIL',
  };

  mkdirSync(OUT_DIR, { recursive: true });
  const stamp = startedAt.slice(0, 10);
  const file = join(OUT_DIR, `console-smoke-${stamp}.json`);
  writeFileSync(file, JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify(report, null, 2));
  if (report.verdict !== 'PASS') process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
