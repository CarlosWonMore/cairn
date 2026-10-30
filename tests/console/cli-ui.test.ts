import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTestHome, cleanupTestHome } from '../helpers.js';

/**
 * `cairn ui` 与 `cairn review` 的命令行合同（任务 1.4 / 3.5）。
 *
 * 这些用例故意走真实子进程：`ui` 的关键性质（只读打开、SIGINT 优雅退出、
 * 打印带令牌的 URL）都只在进程边界上成立，进程内调用测不出来。
 */

const { cliEntry } = await import('../spawn-target.js');
const target = cliEntry();
const ARGV = [...target.loader, target.file];

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], env?: Record<string, string>): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [...ARGV, ...args], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (c) => (stdout += c));
    p.stderr.on('data', (c) => (stderr += c));
    p.on('error', reject);
    p.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

/** 带 HOME 的初始数据目录 + 一个已导入批次，供 review / ui 使用。 */
async function seededHome(): Promise<{ home: string; cleanup(): void }> {
  const home = makeTestHome('cairn-cliui-');
  const init = await runCli(['--home', home, '--json', 'init']);
  assert.equal(init.code, 0, init.stderr);
  const add = await runCli(['--home', home, '--json', 'add', '构建命令是 pnpm build，产物目录 dist', '--kind', 'fact']);
  assert.equal(add.code, 0, add.stderr);
  const dir = join(home, 'sources');
  mkdirSync(dir, { recursive: true });
  const p = join(dir, 'notes.md');
  writeFileSync(
    p,
    ['生产环境数据库端口是 5433，连接超时 60 秒。', '发布流程第一步是冻结主干分支。'].join('\n\n'),
    'utf8',
  );
  const imp = await runCli(['--home', home, '--json', 'import', p]);
  assert.equal(imp.code, 0, imp.stderr);
  return { home, cleanup: () => cleanupTestHome(home) };
}

test('ui --export：产出单文件 HTML，文件名带 -personal，退出码 0', async () => {
  const s = await seededHome();
  try {
    const out = join(s.home, 'preview.html');
    const r = await runCli(['--home', s.home, '--json', 'ui', '--export', out]);
    assert.equal(r.code, 0, r.stderr);
    const j = JSON.parse(r.stdout);
    assert.equal(j.redacted, false);
    assert.ok(j.written.endsWith('preview-personal.html'), `文件名应规范化，实际 ${j.written}`);
    assert.ok(existsSync(j.written));
    assert.ok(j.bytes > 1000);
    assert.ok(j.counts.memories >= 1);
    assert.ok(j.counts.items >= 1);
    const html = readFileSync(j.written, 'utf8');
    assert.ok(html.includes('构建命令是 pnpm build'));
    assert.ok(html.includes('请勿外传'));
  } finally {
    s.cleanup();
  }
});

test('ui --export：stdout 明确提示产物含明文（三层告知的第 3 层）', async () => {
  const s = await seededHome();
  try {
    const r = await runCli(['--home', s.home, '--json', 'ui', '--export', join(s.home, 'p.html')]);
    assert.equal(r.code, 0, r.stderr);
    assert.ok(r.stderr.includes('明文本地记忆'), `stderr 应提示明文，实际 ${r.stderr}`);
    assert.ok(r.stderr.includes('--redact'), '应给出唯一反向开关');
    assert.equal(r.stderr.includes('--include-blocked'), false, '不应再提示已被移除的开关');
  } finally {
    s.cleanup();
  }
});

test('ui --export --redact：脱敏产物不含敏感正文', async () => {
  const s = await seededHome();
  try {
    const sens = await runCli([
      '--home',
      s.home,
      '--json',
      'add',
      '我的家庭住址是某某路 12 号 3 单元',
      '--kind',
      'fact',
      '--sensitive',
      '--scope',
      'device-local',
    ]);
    assert.equal(sens.code, 0, `sensitive 记忆必须落在 local_only 作用域：${sens.stderr}`);
    const r = await runCli(['--home', s.home, '--json', 'ui', '--export', join(s.home, 'r.html'), '--redact']);
    assert.equal(r.code, 0, r.stderr);
    const j = JSON.parse(r.stdout);
    assert.equal(j.redacted, true);
    const html = readFileSync(j.written, 'utf8');
    assert.equal(html.includes('某某路'), false);
    assert.ok(r.stderr.includes('--redact'));
  } finally {
    s.cleanup();
  }
});

test('ui --port：非法端口 → 退出码 2 且信息指向参数', async () => {
  const s = await seededHome();
  try {
    for (const bad of ['abc', '-1', '65536']) {
      const r = await runCli(['--home', s.home, 'ui', '--port', bad, '--no-open']);
      assert.equal(r.code, 2, `--port ${bad} 应以参数错误退出，实际 ${r.code}`);
      assert.ok(r.stderr.includes('端口') || r.stderr.includes('port'), r.stderr);
    }
  } finally {
    s.cleanup();
  }
});

test('ui --json --no-open：打印带令牌 URL，服务可访问，SIGINT 优雅退出', async () => {
  const s = await seededHome();
  let child: ReturnType<typeof spawn> | null = null;
  try {
    child = spawn(process.execPath, [...ARGV, '--home', s.home, '--json', 'ui', '--port', '0', '--no-open'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const handle = child;
    const stdout = handle.stdout;
    assert.ok(stdout != null, '子进程必须带 pipe stdout');
    const started = await new Promise<{ url: string; tokenUrl: string; port: number }>((resolve, reject) => {
      let buf = '';
      const timer = setTimeout(() => reject(new Error(`启动超时，已收到: ${buf}`)), 20_000);
      stdout.on('data', (c) => {
        buf += c;
        const at = buf.indexOf('{');
        if (at < 0) return;
        try {
          const j = JSON.parse(buf.slice(at)) as { url: string; tokenUrl: string; port: number };
          clearTimeout(timer);
          resolve(j);
        } catch {
          /* 还没收全 */
        }
      });
      handle.on('error', reject);
    });

    assert.ok(started.tokenUrl.includes('t='), '应打印带令牌的 URL');
    assert.equal(started.url.includes('t='), false, '裸 URL 不带令牌');
    assert.ok(started.url.startsWith('http://127.0.0.1:'));

    const token = new URL(started.tokenUrl).searchParams.get('t')!;
    const noToken = await fetch(new URL('/api/status', started.url));
    assert.equal(noToken.status, 401, '无令牌必须 401');
    const ok = await fetch(new URL('/api/status', started.url), { headers: { 'x-cairn-token': token } });
    assert.equal(ok.status, 200);
    const body = (await ok.json()) as { data: { counts: { memoriesTotal: number } } };
    assert.ok(body.data.counts.memoriesTotal >= 1);

    const exitCode = await new Promise<number | null>((resolve) => {
      handle.on('close', (code) => resolve(code));
      handle.kill('SIGINT');
    });
    if (process.platform === 'win32') {
      // Windows 无法把 SIGINT 递送给另一个进程（kill 直接 TerminateProcess），
      // 所以这里只能断言"进程确实退出、端口释放"，优雅退出的语义由 POSIX 覆盖。
      assert.equal(exitCode, null, 'Windows 下由系统强制终止，退出码为 null');
      let released = false;
      try {
        await fetch(new URL('/api/status', started.url), { headers: { 'x-cairn-token': token } });
      } catch {
        released = true;
      }
      assert.equal(released, true, '进程退出后端口必须释放');
    } else {
      assert.equal(exitCode, 0, 'SIGINT 应优雅退出（0），而不是被信号杀掉');
    }
  } finally {
    child?.kill('SIGKILL');
    s.cleanup();
  }
});

test('review pack → list → submit：AI 复核回写闭环', async () => {
  const s = await seededHome();
  try {
    const pack = await runCli(['--home', s.home, '--json', 'review', 'pack', '--out', join(s.home, 'pack.json')]);
    assert.equal(pack.code, 0, pack.stderr);
    const packJson = JSON.parse(pack.stdout) as { runId: string; outFile: string; itemCount: number };
    assert.ok(packJson.itemCount >= 1, '应至少有一个待判条目');
    const packFile = JSON.parse(readFileSync(packJson.outFile, 'utf8')) as {
      runId: string;
      items: Array<{ itemId: string }>;
    };
    assert.equal(packFile.items.length, packJson.itemCount);

    const before = await runCli(['--home', s.home, '--json', 'review', 'list']);
    assert.equal(before.code, 0, before.stderr);
    assert.deepEqual(JSON.parse(before.stdout), [], '尚未提交时应为空');

    const first = packFile.items[0]!;
    const reviewFile = join(s.home, 'reviews.json');
    writeFileSync(
      reviewFile,
      JSON.stringify({
        runId: packJson.runId,
        model: 'test-model',
        items: [{ itemId: first.itemId, action: 'promote', reason: '内容稳定且可复用' }],
      }),
      'utf8',
    );
    const submit = await runCli(['--home', s.home, '--json', 'review', 'submit', '--input', reviewFile]);
    assert.equal(submit.code, 0, submit.stderr);
    const submitted = JSON.parse(submit.stdout) as { accepted: number; overwritten: number; items: unknown[] };
    assert.equal(submitted.accepted, 1);
    assert.equal(submitted.items.length, 1);

    const after = await runCli(['--home', s.home, '--json', 'review', 'list']);
    const list = JSON.parse(after.stdout) as Array<{ itemId: string; action: string; model: string | null }>;
    assert.equal(list.length, 1);
    assert.equal(list[0]!.itemId, first.itemId);
    assert.equal(list[0]!.action, 'promote');
    assert.equal(list[0]!.model, 'test-model');
  } finally {
    s.cleanup();
  }
});

test('review submit：任一条不合法则整批拒绝（不部分落库）', async () => {
  const s = await seededHome();
  try {
    const pack = await runCli(['--home', s.home, '--json', 'review', 'pack', '--out', join(s.home, 'pack.json')]);
    assert.equal(pack.code, 0, pack.stderr);
    const packFile = JSON.parse(readFileSync(JSON.parse(pack.stdout).outFile, 'utf8')) as {
      runId: string;
      items: Array<{ itemId: string }>;
    };
    const file = join(s.home, 'bad.json');
    writeFileSync(
      file,
      JSON.stringify({
        runId: packFile.runId,
        items: [
          { itemId: packFile.items[0]!.itemId, action: 'promote', reason: '合理' },
          { itemId: packFile.items[0]!.itemId, action: '瞎写一个动作', reason: '非法' },
        ],
      }),
      'utf8',
    );
    const r = await runCli(['--home', s.home, 'review', 'submit', '--input', file]);
    assert.notEqual(r.code, 0, '含非法动作应失败');
    assert.ok(r.stderr.includes('整批拒绝'), `应说明整批拒绝，实际 ${r.stderr}`);
    const list = await runCli(['--home', s.home, '--json', 'review', 'list']);
    assert.deepEqual(JSON.parse(list.stdout), [], '整批拒绝：合法的那条也不得落库');
  } finally {
    s.cleanup();
  }
});

test('review：未知子命令 → 退出码 2，提示用法', async () => {
  const s = await seededHome();
  try {
    const r = await runCli(['--home', s.home, 'review', 'nonsense']);
    assert.equal(r.code, 2);
    assert.ok(r.stderr.includes('review pack'), r.stderr);
  } finally {
    s.cleanup();
  }
});
