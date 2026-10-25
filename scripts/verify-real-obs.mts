/**
 * 真实 OBS 双设备同步验证（OpenSpec add-real-cloud-sync 任务 4.1）
 * 机器可读结果输出到 stdout（JSON）；专用前缀 cairn/，不触碰 obsidian/ 与 famboard/。
 * 运行：OBS_* 环境变量齐备后 node --import tsx scripts/verify-real-obs.mts
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = process.cwd();
const CLI = join(ROOT, 'src', 'interfaces', 'cli', 'main.ts');
const results: Record<string, unknown>[] = [];
const fail = (step: string, msg: string): never => {
  results.push({ step, ok: false, error: msg });
  console.log(JSON.stringify({ verified: false, results }, null, 2));
  process.exit(1);
};

function runCli(args: string[], home: string, env: Record<string, string> = {}): { code: number; stdout: string } {
  const r = spawnSync(process.execPath, ['--import', 'tsx', CLI, '--home', home, '--json', ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { code: r.status ?? 1, stdout: r.stdout ?? '' };
}

function jsonOut(stdout: string): Record<string, unknown> {
  return JSON.parse(stdout) as Record<string, unknown>;
}

// 前置：OBS 环境变量必须齐备（真实验证前提）
for (const k of ['OBS_ENDPOINT', 'OBS_BUCKET', 'OBS_PREFIX', 'OBS_ACCESS_KEY_ID', 'OBS_SECRET_ACCESS_KEY']) {
  if (!process.env[k]) fail('env', `缺少 ${k}；真实验证需要 OBS 凭据`);
}
const obsEnv = {
  OBS_ENDPOINT: process.env['OBS_ENDPOINT']!,
  OBS_BUCKET: process.env['OBS_BUCKET']!,
  OBS_PREFIX: process.env['OBS_PREFIX']!,
};

// 设备 A
const homeA = mkdtempSync(join(tmpdir(), 'cairn-devA-'));
// 设备 B
const homeB = mkdtempSync(join(tmpdir(), 'cairn-devB-'));
mkdirSync(join(homeA, 'data'), { recursive: true });
mkdirSync(join(homeB, 'data'), { recursive: true });
// local_only 记忆（不应上云）
const localOnlyHome = homeA;

try {
  // 步骤 1：A 初始化 vault（provider obs）
  let r = runCli(['vault', 'init-remote', '--provider', 'obs', '--bucket', obsEnv.OBS_BUCKET, '--prefix', obsEnv.OBS_PREFIX, '--endpoint', obsEnv.OBS_ENDPOINT], homeA);
  if (r.code !== 0) fail('vault-init-remote', r.stdout + r.stderr);
  const initA = jsonOut(r.stdout) as { vaultId: string; recovery: string };
  results.push({ step: 'vault-init-remote', ok: true, vaultId: initA.vaultId });

  // 步骤 2：B 用 A 的恢复材料加入同一 vault
  const recoveryFile = join(homeB, 'recovery.txt');
  writeFileSync(recoveryFile, initA.recovery, 'utf8');
  r = runCli(['vault', 'import-key', '--recovery-file', recoveryFile], homeB);
  if (r.code !== 0) fail('vault-import-key', r.stdout + r.stderr);
  r = runCli(['vault', 'init-remote', '--provider', 'obs', '--bucket', obsEnv.OBS_BUCKET, '--prefix', obsEnv.OBS_PREFIX, '--endpoint', obsEnv.OBS_ENDPOINT], homeB);
  if (r.code !== 0) fail('vault-init-remote-b', r.stdout + r.stderr);
  const initB = jsonOut(r.stdout) as { vaultId: string };
  if (initB.vaultId !== initA.vaultId) fail('vault-identity', `B 的 vaultId ${initB.vaultId} ≠ A 的 ${initA.vaultId}`);
  results.push({ step: 'vault-join-b', ok: true, vaultIdMatch: true });

  // 步骤 3：A 写入两条记忆（一条 personal-global 一条 device-local）并 push
  r = runCli(['add', '真实云端验证记忆甲——跨设备同步'], homeA);
  if (r.code !== 0) fail('add-a1', r.stdout + r.stderr);
  r = runCli(['add', '设备本机记忆乙——绝不上云 LOCALONLY-CANARY-9d41', '--scope', 'device-local'], homeA);
  if (r.code !== 0) fail('add-a2-local', r.stdout + r.stderr);
  r = runCli(['sync', 'push'], homeA, obsEnv);
  if (r.code !== 0) fail('sync-push-a', r.stdout + r.stderr);
  results.push({ step: 'sync-push-a', ok: true, output: jsonOut(r.stdout) });

  // 步骤 4：B pull → 两条中应只见 personal-global 那条
  r = runCli(['sync', 'pull'], homeB, obsEnv);
  if (r.code !== 0) fail('sync-pull-b', r.stdout + r.stderr);
  results.push({ step: 'sync-pull-b', ok: true, output: jsonOut(r.stdout) });
  r = runCli(['search', '跨设备同步'], homeB);
  const s1 = jsonOut(r.stdout) as { results: { memory: { content: string } }[] };
  if (s1.results.length !== 1) fail('b-search', `B 检索到 ${s1.results.length} 条，期望 1`);
  r = runCli(['search', 'LOCALONLY-CANARY'], homeB);
  const s2 = jsonOut(r.stdout) as { results: unknown[] };
  if (s2.results.length !== 0) fail('b-local-leak', 'local_only 内容泄漏到设备 B');
  results.push({ step: 'cross-device-restore', ok: true });

  // 步骤 5：B 写入并 push，A pull
  r = runCli(['add', '设备B 写入的记忆丙——回流验证'], homeB);
  if (r.code !== 0) fail('add-b1', r.stdout + r.stderr);
  r = runCli(['sync', 'push'], homeB, obsEnv);
  if (r.code !== 0) fail('sync-push-b', r.stdout + r.stderr);
  r = runCli(['sync', 'pull'], homeA, obsEnv);
  if (r.code !== 0) fail('sync-pull-a', r.stdout + r.stderr);
  r = runCli(['search', '回流验证'], homeA);
  const s3 = jsonOut(r.stdout) as { results: { memory: { content: string } }[] };
  if (s3.results.length !== 1) fail('a-search-b-content', `A 未收到 B 的记忆`);
  results.push({ step: 'reverse-direction', ok: true });

  // 步骤 6：远端对象密文核查（vault 完整前缀 = cairn/vaults/<vaultId>/）
  r = runCli(['vault', 'status'], homeA);
  if (r.code !== 0) fail('vault-status', r.stdout + r.stderr);
  const st = jsonOut(r.stdout) as { obs: { prefix: string } | null };
  const vaultPrefix = st.obs?.prefix;
  if (!vaultPrefix) fail('vault-prefix', 'vault.json 缺少 obs.prefix');
  const listScript = join(ROOT, 'scripts', 'obs-list-keys.mts');
  r = spawnSync(process.execPath, ['--import', 'tsx', listScript], { encoding: 'utf8', env: { ...process.env, ...obsEnv, OBS_PREFIX: vaultPrefix } });
  if (r.status !== 0) fail('remote-list', r.stderr);
  const keys = JSON.parse(r.stdout) as string[];
  if (keys.length === 0) fail('remote-list-empty', 'store prefix 下没有对象');
  // 密文核查：解密全部对象，金丝雀不得出现（recovery 材料从步骤 1 传入）
  const checkScript = join(ROOT, 'scripts', 'obs-no-local-leak.mts');
  r = spawnSync(process.execPath, ['--import', 'tsx', checkScript, 'LOCALONLY-CANARY-9d41', initA.recovery], { encoding: 'utf8', env: { ...process.env, ...obsEnv, OBS_PREFIX: vaultPrefix } });
  if (r.status !== 0) fail('remote-leak-check', (r.stdout ?? '') + (r.stderr ?? ''));
  results.push({ step: 'remote-objects-encrypted-no-local-leak', ok: true, objectCount: keys.length, vaultPrefix });

  // 步骤 7：doctor 三态
  r = runCli(['doctor'], homeA);
  const d = jsonOut(r.stdout) as { remote: string; remoteProvider?: string };
  if (d.remote !== 'verified') fail('doctor-remote', `期望 verified，实际 ${d.remote}`);
  if (d.remoteProvider !== 'obs') fail('doctor-provider', `期望 obs，实际 ${String(d.remoteProvider)}`);
  results.push({ step: 'doctor-verified', ok: true, remote: d.remote, provider: d.remoteProvider });

  console.log(JSON.stringify({ verified: true, results }, null, 2));
} finally {
  // 清理本地临时目录；远端 cairn/ 对象保留（由用户决定清理时机）
  for (const h of [homeA, homeB]) {
    if (h.startsWith(tmpdir()) && existsSync(h)) {
      try {
        spawnSync(process.execPath, ['-e', `require('fs').rmSync(${JSON.stringify(h)}, { recursive: true, force: true, maxRetries: 5 })`]);
      } catch { /* best effort */ }
    }
  }
  void localOnlyHome;
}
