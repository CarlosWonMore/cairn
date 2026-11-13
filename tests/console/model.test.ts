import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openStore, CairnStore } from '../../src/store/open.js';
import { makeTestHome, cleanupTestHome } from '../helpers.js';
import { importSnapshot } from '../../src/onboarding/import.js';
import { assignBatch, markItemPromoted } from '../../src/onboarding/batches.js';
import { buildModel, listArchiveItems } from '../../src/interfaces/console/model.js';

// 合成凭据：AWS 官方文档示例 ID，非真实凭据。
const FAKE_AWS_ID = 'AKIAIOSFODNN7EXAMPLE';

const SENSITIVE_TEXT = '敏感记忆正文：家庭住址与门牌号仅供本人查看';
const NORMAL_TEXT = '构建命令是 pnpm build，测试用 npm test';

interface Ctx {
  home: string;
  store: CairnStore;
  cleanup(): void;
}

function setup(): Ctx {
  const home = makeTestHome('cairn-console-model-');
  const store = openStore({ home });
  return {
    home,
    store,
    cleanup() {
      try {
        store.close();
      } catch {
        /* 已关闭 */
      }
      cleanupTestHome(home);
    },
  };
}

async function seed(store: CairnStore, home: string) {
  const dir = join(home, 'sources');
  mkdirSync(dir, { recursive: true });

  const normalPath = join(dir, 'normal.md');
  writeFileSync(normalPath, ['# 笔记', '', '- 部署端口 9090', '- 时区 Asia/Shanghai', '- 回滚先查 audit'].join('\n'), 'utf8');
  const normal = await importSnapshot(store, { agentKind: 'manual', sourcePath: normalPath });
  const normalBatch = normal.batchId ?? assignBatch(store, normal.archiveId!);

  const blockedPath = join(dir, 'blocked.md');
  writeFileSync(blockedPath, ['# 混入', '', `- 正常条目`, `- AWS 配置泄露：${FAKE_AWS_ID}`].join('\n'), 'utf8');
  const blocked = await importSnapshot(store, { agentKind: 'manual', sourcePath: blockedPath });
  const blockedBatch = blocked.batchId ?? assignBatch(store, blocked.archiveId!);

  const scope = store.scopes.resolvePreset('personal-global', {});
  const sensitiveScope = store.scopes.resolvePreset('device-local', { deviceId: store.identity.deviceId });
  store.memories.add(
    {
      kind: 'fact',
      content: NORMAL_TEXT,
      scopeId: scope.id,
      authority: 'user_explicit',
      createdBy: 'cli',
    },
    store.identity.deviceId,
  );
  store.memories.add(
    {
      kind: 'fact',
      content: SENSITIVE_TEXT,
      scopeId: sensitiveScope.id,
      authority: 'user_explicit',
      createdBy: 'cli',
      sensitivity: 'sensitive',
    },
    store.identity.deviceId,
  );

  return { normalBatch, blockedBatch, normalArchive: normal.archiveId!, blockedArchive: blocked.archiveId! };
}

test('model: 各段计数与库实测一致', async () => {
  const ctx = setup();
  try {
    const seeded = await seed(ctx.store, ctx.home);
    const model = buildModel(ctx.store, { mode: 'full', redact: true });

    assert.equal(model.scopes.length, Number(ctx.store.db.scalar('SELECT COUNT(*) FROM scope')));
    assert.equal(model.memories.length, Number(ctx.store.db.scalar('SELECT COUNT(*) FROM memory')));
    assert.equal(model.archives.length, Number(ctx.store.db.scalar('SELECT COUNT(*) FROM import_archive')));
    assert.equal(model.batches.length, Number(ctx.store.db.scalar('SELECT COUNT(DISTINCT batch_id) FROM import_item')));
    assert.equal(model.counts.items.total, Number(ctx.store.db.scalar('SELECT COUNT(*) FROM import_item')));
    assert.equal(model.counts.items.blocked, Number(ctx.store.db.scalar("SELECT COUNT(*) FROM import_item WHERE scan_state='blocked'")));
    assert.equal(model.counts.items.clean, model.counts.items.total - model.counts.items.blocked);
    assert.equal(model.schemaVersion, Number(ctx.store.db.scalar('PRAGMA user_version')));
    assert.ok(model.counts.items.blocked > 0, 'fixture 里应有一条 blocked 条目');
    assert.equal(model.counts.batches, 2, `两个批次，实际 ${seeded.normalBatch} / ${seeded.blockedBatch}`);
  } finally {
    ctx.cleanup();
  }
});

test('model: 每条记忆的 scopeId 都能在 scopes 里查到（列表徽章的查表契约）', async () => {
  const ctx = setup();
  try {
    await seed(ctx.store, ctx.home);
    const model = buildModel(ctx.store, { mode: 'brief', redact: true });
    const byId = new Map(model.scopes.map((s) => [s.id, s]));
    assert.ok(model.memories.length >= 2);
    for (const m of model.memories) {
      const scope = byId.get(m.scopeId);
      assert.ok(scope != null, `记忆 ${m.id.slice(0, 8)} 的 scopeId 查不到对应作用域`);
      assert.ok(scope!.preset.length > 0, '徽章要显示人读的 preset 名，不能只剩内部 UUID');
    }
    // 「仅本机」判据来自作用域表实际存储的 syncPolicy，不来自 preset 名
    const sensitive = model.memories.find((m) => m.sensitivity === 'sensitive');
    assert.ok(sensitive != null);
    const localScope = byId.get(sensitive!.scopeId)!;
    assert.equal(localScope.preset, 'device-local');
    assert.equal(localScope.syncPolicy, 'local_only');
  } finally {
    ctx.cleanup();
  }
});

test('model: activeBatchId 只返回 1 个时 batches 仍返回全部行', async () => {
  const ctx = setup();
  try {
    await seed(ctx.store, ctx.home);
    // 模拟 AppService.activeBatchId 的单值语义：只取最新一个
    const active = ctx.store.db.get(
      `SELECT i.batch_id AS bid FROM import_item i WHERE i.scan_state='clean' AND i.batch_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM audit_event a WHERE a.category='onboarding' AND a.action='item_promoted'
                         AND json_extract(a.detail,'$.itemId') = i.id)
       GROUP BY i.batch_id ORDER BY i.batch_id DESC LIMIT 1`,
    );
    assert.ok(active != null, '应能取到活跃批次');
    const model = buildModel(ctx.store, { mode: 'brief', redact: true });
    assert.ok(model.batches.length >= 2, '批次视图必须列出全部批次，而不是只列活跃那一个');
  } finally {
    ctx.cleanup();
  }
});

test('model: mode=brief 不出现完整正文，mode=full 出现', async () => {
  const ctx = setup();
  try {
    await seed(ctx.store, ctx.home);
    const longText = 'X'.repeat(600) + '-结尾标记-TAIL';
    const scope = ctx.store.scopes.resolvePreset('personal-global', {});
    ctx.store.memories.add(
      { kind: 'fact', content: longText, scopeId: scope.id, authority: 'user_explicit', createdBy: 'cli' },
      ctx.store.identity.deviceId,
    );

    const brief = buildModel(ctx.store, { mode: 'brief', redact: false, briefChars: 240 });
    const briefJson = JSON.stringify(brief.memories);
    assert.ok(!briefJson.includes('-结尾标记-TAIL'), 'brief 模式不得包含完整正文');

    const full = buildModel(ctx.store, { mode: 'full', redact: false });
    const fullJson = JSON.stringify(full.memories);
    assert.ok(fullJson.includes('-结尾标记-TAIL'), 'full 模式必须包含完整正文');
  } finally {
    ctx.cleanup();
  }
});

test('model: redact=true 时敏感记忆正文不出现；blocked 条目原文本就未入库', async () => {
  const ctx = setup();
  try {
    const seeded = await seed(ctx.store, ctx.home);
    const model = buildModel(ctx.store, { mode: 'full', redact: true, includeItems: true });
    const json = JSON.stringify(model);
    assert.ok(!json.includes(SENSITIVE_TEXT), '敏感记忆正文不得出现在装配结果中');
    assert.ok(!json.includes(FAKE_AWS_ID), 'blocked 条目原文不得出现在装配结果中');

    const maskedMem = model.memories.find((m) => m.sensitivity === 'sensitive');
    assert.ok(maskedMem != null);
    assert.equal(maskedMem!.content.masked, true);
    assert.equal(maskedMem!.content.text, null);
    assert.equal(maskedMem!.content.length, SENSITIVE_TEXT.length);
    assert.match(maskedMem!.content.hashPrefix, /^[0-9a-f]{12}$/);

    const blockedItems = model.items!.filter((i) => i.scanState === 'blocked');
    assert.ok(blockedItems.length > 0);
    for (const it of blockedItems) {
      // 关键事实：blocked 条目在导入时就被替换成 [blocked:kind] 占位符，原文从未入库。
      // 因此这里断言的是 contentAvailable=false，而不是"被掩码"。
      assert.equal(it.contentAvailable, false);
      assert.match(it.content.text ?? '', /^\[blocked:/);
    }

    // 非敏感记忆照常可读
    const normal = model.memories.find((m) => m.content.text === NORMAL_TEXT);
    assert.ok(normal != null, '正常记忆在 redact 模式下不应被掩码');
    void seeded;
  } finally {
    ctx.cleanup();
  }
});

test('model: redact=false 也拿不到 blocked 原文（原文已物理丢弃，不是开关问题）', async () => {
  const ctx = setup();
  try {
    const seeded = await seed(ctx.store, ctx.home);
    const model = buildModel(ctx.store, { mode: 'full', redact: false, includeItems: true });
    const json = JSON.stringify(model);
    assert.ok(!json.includes(FAKE_AWS_ID), '库里没有 blocked 原文，任何模式都读不到');
    const sensitive = model.memories.find((m) => m.sensitivity === 'sensitive');
    assert.equal(sensitive!.content.text, SENSITIVE_TEXT, 'redact=false 时应输出敏感记忆原文');
    void seeded;
  } finally {
    ctx.cleanup();
  }
});

test('model: 来源标识中的绝对路径折叠为 ~', async () => {
  const ctx = setup();
  try {
    await seed(ctx.store, ctx.home);
    const model = buildModel(ctx.store, { mode: 'brief', redact: true });
    for (const a of model.archives) {
      assert.ok(!/^[A-Za-z]:\\/.test(a.sourceLabel ?? ''), `来源标识不应以盘符开头: ${a.sourceLabel}`);
      assert.ok(!(a.sourceLabel ?? '').includes(ctx.home), '来源标识不应包含 HOME 绝对路径');
    }
    assert.ok(!JSON.stringify(model).includes(ctx.home), '整份装配结果都不应包含 HOME 绝对路径');
  } finally {
    ctx.cleanup();
  }
});

test('model: 晋升后 remaining 与 promoted 同步变化', async () => {
  const ctx = setup();
  try {
    await seed(ctx.store, ctx.home);
    const before = buildModel(ctx.store, { mode: 'brief', redact: true });
    const targetBatch = before.batches.find((b) => b.clean > 0);
    assert.ok(targetBatch != null);
    const item = ctx.store.db.get(
      "SELECT id FROM import_item WHERE batch_id = ? AND scan_state = 'clean' ORDER BY item_index LIMIT 1",
      targetBatch!.batchId,
    );
    assert.ok(item != null);
    markItemPromoted(ctx.store, String(item!['id']), 'mem-placeholder');
    const after = buildModel(ctx.store, { mode: 'brief', redact: true });
    const afterBatch = after.batches.find((b) => b.batchId === targetBatch!.batchId)!;
    assert.equal(afterBatch.promoted, targetBatch!.promoted + 1);
    assert.equal(afterBatch.remaining, targetBatch!.remaining - 1);
  } finally {
    ctx.cleanup();
  }
});

test('model: 空库不抛错，给出可读告警', () => {
  const ctx = setup();
  try {
    const model = buildModel(ctx.store, { mode: 'brief', redact: true });
    assert.equal(model.counts.memoriesTotal, 0);
    assert.equal(model.archives.length, 0);
    assert.deepEqual(model.batches, []);
    assert.ok(model.notes.some((n) => n.includes('没有匹配的记忆')));
    // 作用域是惰性创建的：新库没有 memory 时没有任何 scope 行，视图必须能接受这个空态
    assert.equal(model.scopes.length, 0);
  } finally {
    ctx.cleanup();
  }
});

test('listArchiveItems: 分页与过滤正确，blocked 条目告知原文不可用', async () => {
  const ctx = setup();
  try {
    const seeded = await seed(ctx.store, ctx.home);
    const page = listArchiveItems(ctx.store, seeded.blockedArchive, { mode: 'full', redact: true, limit: 1 });
    assert.equal(page.limit, 1);
    assert.ok(page.total > 1);
    assert.equal(page.items.length, 1);

    const blockedOnly = listArchiveItems(ctx.store, seeded.blockedArchive, { mode: 'full', redact: true, scanState: 'blocked' });
    assert.ok(blockedOnly.total >= 1);
    assert.ok(blockedOnly.items.every((i) => i.scanState === 'blocked'));
    assert.ok(blockedOnly.items.every((i) => i.contentAvailable === false));
    assert.ok(!JSON.stringify(blockedOnly).includes(FAKE_AWS_ID));

    const redactedOff = listArchiveItems(ctx.store, seeded.blockedArchive, { mode: 'full', redact: false, scanState: 'blocked' });
    assert.ok(!JSON.stringify(redactedOff).includes(FAKE_AWS_ID), 'blocked 原文不在库中，关闭掩码也读不到');
  } finally {
    ctx.cleanup();
  }
});

// ---------------------------------------------------------------------------
// 导入工作台单表（任务 4.1 / 4.4 / 4.6）
// ---------------------------------------------------------------------------

test('imports：一条来源一次导入一行，同源折叠只展开最新一次', async () => {
  const ctx = setup();
  try {
    const seeded = await seed(ctx.store, ctx.home);
    // 同一份笔记改完再导一次：必须是**两行**，而不是合成一行。合成会把
    // "这次又导进来 N 条"这个数字抹掉，而用户常常正是要看它。
    // （内容必须真的变了：内容哈希相同会被导入层直接复用旧档案。）
    const againPath = join(ctx.home, 'sources', 'normal.md');
    writeFileSync(againPath, ['# 笔记', '', '- 部署端口 9091', '- 时区 Asia/Shanghai', '- 回滚先查 audit'].join('\n'), 'utf8');
    const again = await importSnapshot(ctx.store, { agentKind: 'manual', sourcePath: againPath });
    assert.ok(again.archiveId != null || again.reusedArchiveId != null);

    const model = buildModel(ctx.store, { mode: 'brief', redact: true });
    assert.equal(model.imports.rows.length, model.archives.length, '行数应等于导入次数');

    const sameSource = model.imports.groups.find((g) => g.importCount > 1);
    assert.ok(sameSource, '重复导入应落在同一组');
    assert.equal(sameSource!.rowIds.length, sameSource!.importCount);

    const latest = model.imports.rows.filter((r) => r.id === sameSource!.rowIds[0])[0]!;
    assert.equal(latest.isLatestOfSource, true, '组内第一行是最新一次');
    for (const id of sameSource!.rowIds.slice(1)) {
      const old = model.imports.rows.find((r) => r.id === id)!;
      assert.equal(old.isLatestOfSource, false, '历史导入不得标成最新');
      assert.equal(old.importCount, sameSource!.importCount, 'importCount 是整组的次数');
    }
    // 每组恰好一行 isLatestOfSource，否则折叠会展开多次或一次都不展开
    for (const g of model.imports.groups) {
      const n = model.imports.rows.filter((r) => g.rowIds.includes(r.id) && r.isLatestOfSource).length;
      assert.equal(n, 1, `组 ${g.key} 应恰有 1 行是最新`);
    }
    assert.ok(seeded.normalArchive.length > 0);
  } finally {
    ctx.cleanup();
  }
});

test('imports：行内计数与 archive 级实测一致，且来源标识不含用户名', async () => {
  const ctx = setup();
  try {
    await seed(ctx.store, ctx.home);
    const model = buildModel(ctx.store, { mode: 'brief', redact: true });
    for (const row of model.imports.rows) {
      const total = Number(ctx.store.db.scalar('SELECT COUNT(*) FROM import_item WHERE archive_id = ?', row.archiveId));
      assert.equal(row.items.total, total, '行内条目数必须来自库，不是估算');
      assert.ok(row.items.clean + row.items.blocked <= row.items.total);
    }
    assert.equal(JSON.stringify(model.imports).includes(ctx.home), false, '来源标识不得带出绝对路径');
  } finally {
    ctx.cleanup();
  }
});

test('imports：自动整理后行上挂策略标识，撤销后标已撤销', async () => {
  const ctx = setup();
  try {
    await seed(ctx.store, ctx.home);
    // 单用 seed 的短条目会被规则层判成"结构残片"，更适合做 manual 档的用例；
    // 这里要验的是摘要能不能挂到行上，所以单独导一份完整句子的笔记。
    const autoPath = join(ctx.home, 'sources', 'auto.md');
    writeFileSync(
      autoPath,
      [
        '生产环境数据库端口是 5433，连接超时 60 秒。',
        '构建命令是 pnpm build，产物目录是 dist。',
        '发布流程第一步是冻结主干分支。',
      ].join('\n\n'),
      'utf8',
    );
    const autoImport = await importSnapshot(ctx.store, { agentKind: 'manual', sourcePath: autoPath });
    const autoBatch = autoImport.batchId ?? assignBatch(ctx.store, autoImport.archiveId!);

    const policy = {
      id: 'model-auto',
      allowedScopes: ['personal-global'],
      maxSensitivity: 'normal' as const,
      requireAiAgreement: false,
      allowCreate: true,
      minConfidence: 0.6,
      note: '测试用',
    };
    const { signPolicy } = await import('../../src/onboarding/policy.js');
    const { revokeByPolicy, runAutoOnboarding } = await import('../../src/onboarding/auto.js');
    signPolicy(ctx.home, policy, { via: 'cli' });

    const run = runAutoOnboarding(ctx.store, { policyId: 'model-auto', batchId: autoBatch });
    assert.ok(run.applied >= 1, `应先自动写入至少一条，实际 ${run.applied}`);

    const before = buildModel(ctx.store, { mode: 'brief', redact: true });
    const withRun = before.imports.rows.filter((r) => r.autoRun != null);
    assert.ok(withRun.length >= 1, '跑过自动整理的批次行应带摘要');
    const hit = withRun[0]!.autoRun!;
    assert.equal(hit.policyId, 'model-auto');
    assert.ok((hit.policyHashPrefix ?? '').length === 8, '要显示可核对的哈希前缀');
    assert.equal(hit.revokedAt, null);
    assert.ok(hit.liveMemories > 0, '此时产物还在');

    revokeByPolicy(ctx.store, 'model-auto');
    const after = buildModel(ctx.store, { mode: 'brief', redact: true });
    const revoked = after.imports.rows.filter((r) => r.autoRun != null && r.autoRun.revokedAt != null);
    assert.ok(revoked.length >= 1, '撤销后行上应标出已撤销');
    assert.equal(revoked[0]!.autoRun!.liveMemories, 0, '产物应全部转墓碑');
  } finally {
    ctx.cleanup();
  }
});
