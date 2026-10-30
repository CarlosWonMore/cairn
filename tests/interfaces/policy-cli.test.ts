import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTestHome, cleanupTestHome } from '../helpers.js';
import { openStore } from '../../src/store/index.js';

/**
 * `cairn policy` 与 `cairn onboarding auto` 的命令行合同（任务 5.4）。
 *
 * 走真实子进程：签发是把文件写到数据目录、退出码是给脚本用的，
 * 这两件事都只在进程边界上成立。
 */

const { cliEntry } = await import('../spawn-target.js');
const target = cliEntry();
const ARGV = [...target.loader, target.file];

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runCli(args: string[]): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [...ARGV, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (c) => (stdout += c));
    p.stderr.on('data', (c) => (stderr += c));
    p.on('error', reject);
    p.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function seededHome(): Promise<{ home: string; cleanup(): void }> {
  const home = makeTestHome('cairn-polcli-');
  const init = await runCli(['--home', home, '--json', 'init']);
  assert.equal(init.code, 0, init.stderr);
  const dir = join(home, 'sources');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'notes.md');
  writeFileSync(
    file,
    ['生产环境数据库端口是 5433，连接超时 60 秒。', '构建命令是 pnpm build，产物目录是 dist。', '发布流程第一步是冻结主干分支。'].join('\n\n') + '\n',
    'utf8',
  );
  const imp = await runCli(['--home', home, '--json', 'import', file]);
  assert.equal(imp.code, 0, imp.stderr);
  return {
    home,
    cleanup() {
      cleanupTestHome(home);
    },
  };
}

/** --json 模式下错误体走 stdout，诊断走 stderr：断言要看合并输出。 */
function all(r: RunResult): string {
  return r.stdout + r.stderr;
}

function memCount(home: string): number {
  const s = openStore({ home, readOnly: true });
  try {
    return Number(s.db.get('SELECT count(*) AS n FROM memory')!.n);
  } finally {
    s.close();
  }
}

test('policy sign：内联参数签发并打印哈希', async () => {
  const s = await seededHome();
  try {
    const r = await runCli([
      '--home', s.home, '--json', 'policy', 'sign',
      '--id', 'p1', '--scopes', 'personal-global', '--allow-create', '--note', '首次整理',
    ]);
    assert.equal(r.code, 0, r.stderr);
    const out = JSON.parse(r.stdout) as { id: string; policyHash: string; spec: Record<string, unknown> };
    assert.equal(out.id, 'p1');
    assert.equal(out.policyHash.length, 64);
    assert.deepEqual(out.spec['allowedScopes'], ['personal-global']);
    assert.equal(out.spec['allowCreate'], true);

    const list = await runCli(['--home', s.home, '--json', 'policy', 'list']);
    assert.equal(list.code, 0, list.stderr);
    const items = JSON.parse(list.stdout) as { spec: { id: string } }[];
    assert.deepEqual(items.map((i) => i.spec.id), ['p1']);

    const show = await runCli(['--home', s.home, '--json', 'policy', 'show', 'p1']);
    assert.equal(show.code, 0, show.stderr);
  } finally {
    s.cleanup();
  }
});

test('policy sign：缺 --id 时退出码 2 并给出用法', async () => {
  const s = await seededHome();
  try {
    const r = await runCli(['--home', s.home, 'policy', 'sign', '--scopes', 'personal-global']);
    assert.equal(r.code, 2, `用法错误应是 2，实际 ${r.code}`);
    assert.ok(all(r).includes('policy sign'), all(r));
  } finally {
    s.cleanup();
  }
});

test('onboarding auto --dry-run：零写入', async () => {
  const s = await seededHome();
  try {
    const sign = await runCli(['--home', s.home, '--json', 'policy', 'sign', '--id', 'p1', '--scopes', 'personal-global', '--allow-create']);
    assert.equal(sign.code, 0, sign.stderr);
    const before = memCount(s.home);

    const r = await runCli(['--home', s.home, '--json', 'onboarding', 'auto', '--policy', 'p1', '--dry-run']);
    assert.equal(r.code, 0, r.stderr);
    const out = JSON.parse(r.stdout) as { applied: number; auto: number; dryRun: boolean; balanced: boolean };
    assert.equal(out.dryRun, true);
    assert.equal(out.applied, 0);
    assert.ok(out.auto > 0, 'dry-run 仍要给出分档');
    assert.equal(out.balanced, true);
    assert.equal(memCount(s.home), before, 'dry-run 不得写任何记忆');
  } finally {
    s.cleanup();
  }
});

test('onboarding auto：按策略应用，记忆增加', async () => {
  const s = await seededHome();
  try {
    await runCli(['--home', s.home, '--json', 'policy', 'sign', '--id', 'p1', '--scopes', 'personal-global', '--allow-create']);
    const before = memCount(s.home);
    const r = await runCli(['--home', s.home, '--json', 'onboarding', 'auto', '--policy', 'p1']);
    assert.equal(r.code, 0, r.stderr);
    const out = JSON.parse(r.stdout) as { applied: number; balanced: boolean };
    assert.ok(out.applied >= 1);
    assert.equal(out.balanced, true);
    assert.ok(memCount(s.home) > before);
  } finally {
    s.cleanup();
  }
});

test('策略被改动后运行被拒：退出码 3，且不写入', async () => {
  const s = await seededHome();
  try {
    await runCli(['--home', s.home, '--json', 'policy', 'sign', '--id', 'p1', '--scopes', 'personal-global', '--allow-create']);
    const file = join(s.home, 'policy', 'p1.json');
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    (parsed['spec'] as Record<string, unknown>)['minConfidence'] = 0;
    writeFileSync(file, JSON.stringify(parsed), 'utf8');

    const before = memCount(s.home);
    const r = await runCli(['--home', s.home, '--json', 'onboarding', 'auto', '--policy', 'p1']);
    assert.equal(r.code, 3, `被治理拒绝应是 3，实际 ${r.code}: ${r.stderr}`);
    assert.ok(all(r).includes('哈希') || all(r).includes('重新签发'), all(r));
    assert.equal(memCount(s.home), before);
  } finally {
    s.cleanup();
  }
});

test('policy revoke：撤销后不能再用于自动整理', async () => {
  const s = await seededHome();
  try {
    await runCli(['--home', s.home, '--json', 'policy', 'sign', '--id', 'p1', '--scopes', 'personal-global', '--allow-create']);
    const rev = await runCli(['--home', s.home, '--json', 'policy', 'revoke', 'p1']);
    assert.equal(rev.code, 0, rev.stderr);
    const out = JSON.parse(rev.stdout) as { revokedAt: string | null };
    assert.ok(out.revokedAt, '撤销必须留下时间');

    const r = await runCli(['--home', s.home, '--json', 'onboarding', 'auto', '--policy', 'p1']);
    assert.equal(r.code, 3, `撤销后用应是 3，实际 ${r.code}`);
    assert.ok(all(r).includes('撤销'), all(r));
  } finally {
    s.cleanup();
  }
});

test('未签发策略：onboarding auto 退出码 1 并提示先签发', async () => {
  const s = await seededHome();
  try {
    const r = await runCli(['--home', s.home, '--json', 'onboarding', 'auto', '--policy', 'nope']);
    assert.notEqual(r.code, 0);
    assert.ok(all(r).includes('策略不存在') || all(r).includes('policy sign'), all(r));
  } finally {
    s.cleanup();
  }
});

test('onboarding revoke：回滚某策略写进去的记忆，转墓碑且可审计', async () => {
  const s = await seededHome();
  try {
    await runCli(['--home', s.home, '--json', 'policy', 'sign', '--id', 'p1', '--scopes', 'personal-global', '--allow-create']);
    const auto = await runCli(['--home', s.home, '--json', 'onboarding', 'auto', '--policy', 'p1']);
    assert.equal(auto.code, 0, auto.stderr);
    const applied = (JSON.parse(auto.stdout) as { applied: number }).applied;
    assert.ok(applied >= 1);

    const before = memCount(s.home);
    const r = await runCli(['--home', s.home, '--json', 'onboarding', 'revoke', '--policy', 'p1']);
    assert.equal(r.code, 0, all(r));
    const out = JSON.parse(r.stdout) as { tombstoned: number; memoryIds: string[] };
    assert.equal(out.tombstoned, applied, '撤销条数应等于这次写入的条数');
    assert.equal(memCount(s.home), before, '不物理删除：记忆行还在，只是转墓碑');

    const st = openStore({ home: s.home, readOnly: true });
    try {
      const alive = Number(st.db.get("SELECT count(*) AS n FROM memory WHERE status='active'")!.n);
      const dead = Number(st.db.get("SELECT count(*) AS n FROM memory WHERE status='tombstoned'")!.n);
      assert.equal(alive, 0);
      assert.equal(dead, applied);
      const revokedEvents = Number(
        st.db.get("SELECT count(*) AS n FROM audit_event WHERE category='policy' AND action='revoked'")!.n,
      );
      assert.ok(revokedEvents >= 1);
    } finally {
      st.close();
    }
  } finally {
    s.cleanup();
  }
});

test('onboarding revoke：缺 --policy → 退出码 2 并给出用法', async () => {
  const s = await seededHome();
  try {
    const r = await runCli(['--home', s.home, 'onboarding', 'revoke']);
    assert.equal(r.code, 2, `用法错误应是 2，实际 ${r.code}`);
    assert.ok(all(r).includes('onboarding revoke'), all(r));
  } finally {
    s.cleanup();
  }
});

test('onboarding auto --items：只处理点名的条目（点名即显式重做）', async () => {
  const s = await seededHome();
  try {
    await runCli(['--home', s.home, '--json', 'policy', 'sign', '--id', 'p1', '--scopes', 'personal-global', '--allow-create']);
    // 先跑一轮把条目晋升掉，再点名：不能因为"已晋升"被静默过滤成"不属于该批次"
    const first = await runCli(['--home', s.home, '--json', 'onboarding', 'auto', '--policy', 'p1']);
    assert.equal(first.code, 0, all(first));

    const st = openStore({ home: s.home, readOnly: true });
    let itemId = '';
    try {
      const row = st.db.get("SELECT id FROM import_item WHERE scan_state='clean' ORDER BY id LIMIT 1");
      itemId = String(row!.id);
    } finally {
      st.close();
    }
    assert.ok(itemId.length > 0);

    const r = await runCli(['--home', s.home, '--json', 'onboarding', 'auto', '--policy', 'p1', '--items', itemId]);
    assert.equal(r.code, 0, all(r));
    const out = JSON.parse(r.stdout) as { totalItems: number; balanced: boolean; tiers: { itemId: string }[] };
    assert.equal(out.totalItems, 1, `只应处理 1 条，实际 ${out.totalItems}`);
    assert.equal(out.tiers[0]!.itemId, itemId);
    assert.equal(out.balanced, true);
  } finally {
    s.cleanup();
  }
});

test('onboarding auto --redo：接受该开关并重新判定已晋升条目', async () => {
  const s = await seededHome();
  try {
    await runCli(['--home', s.home, '--json', 'policy', 'sign', '--id', 'p1', '--scopes', 'personal-global', '--allow-create']);
    const first = await runCli(['--home', s.home, '--json', 'onboarding', 'auto', '--policy', 'p1']);
    assert.equal(first.code, 0, all(first));
    const total = (JSON.parse(first.stdout) as { totalItems: number }).totalItems;

    // 不带 redo：已晋升的条目不再进入处理集，也不会再写一遍。
    // （批次里若有转人工的条目，它们仍未晋升，所以这里只断言"没多写"，不断言 totalItems=0。）
    const afterFirst = memCount(s.home);
    const plain = await runCli(['--home', s.home, '--json', 'onboarding', 'auto', '--policy', 'p1']);
    assert.equal(plain.code, 0, all(plain));
    const p = JSON.parse(plain.stdout) as { applied: number; totalItems: number; balanced: boolean };
    assert.equal(p.applied, 0, '默认重跑不得再写一遍');
    assert.equal(p.balanced, true);
    assert.equal(memCount(s.home), afterFirst, '默认重跑不得改变记忆数');

    const again = await runCli(['--home', s.home, '--json', 'onboarding', 'auto', '--policy', 'p1', '--redo']);
    assert.equal(again.code, 0, all(again));
    const a = JSON.parse(again.stdout) as { totalItems: number; applied: number; balanced: boolean };
    assert.equal(a.totalItems, total, '--redo 要把整批重新判一遍');
    assert.equal(a.applied, 0, '正文已在库中，重新判定只会得到"已并入"，不会再新建');
    assert.equal(a.balanced, true);
    assert.equal(memCount(s.home), afterFirst, '重做不得凭空多出记忆');
  } finally {
    s.cleanup();
  }
});
