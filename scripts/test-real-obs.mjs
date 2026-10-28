#!/usr/bin/env node
/**
 * 跑真实云端 OBS 往返用例 —— 唯一会访问真实网络的测试入口。
 *
 * 为什么需要这个脚本：Windows 的 cmd.exe 不识别 `VAR=value cmd` 前缀，
 * 所以 `CAIRN_TEST_REAL_OBS=1 npm test` 在 PowerShell/cmd 里不会生效。
 * 这里在进程内设置开关再 spawn，跨平台一致。
 *
 * 用法：npm run test:real
 * 退出码：0 全部通过 / 1 有用例失败 / 2 凭据不全（明确报错，不静默 skip）
 */
import { spawnSync } from 'node:child_process';

const REQUIRED = [
  'OBS_ENDPOINT',
  'OBS_BUCKET',
  'OBS_PREFIX',
  'OBS_ACCESS_KEY_ID',
  'OBS_SECRET_ACCESS_KEY',
];

const missing = REQUIRED.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`[test:real] 缺少环境变量：${missing.join(', ')}`);
  console.error('[test:real] 真实云端往返需要全部 5 个 OBS_* 变量。');
  console.error('[test:real] 只想跑本地用例请用 npm test（默认不联网，该项会 skip）。');
  process.exit(2);
}

console.error(
  `[test:real] CAIRN_TEST_REAL_OBS=1，将访问真实 OBS：endpoint=${process.env.OBS_ENDPOINT} bucket=${process.env.OBS_BUCKET} prefix=${process.env.OBS_PREFIX}`,
);

const result = spawnSync(
  process.execPath,
  ['--import', 'tsx', '--test', 'tests/sync/obs-store.test.ts'],
  { stdio: 'inherit', env: { ...process.env, CAIRN_TEST_REAL_OBS: '1' } },
);

if (result.error) {
  console.error(`[test:real] 无法启动测试进程：${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
