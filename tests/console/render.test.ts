import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openStore, CairnStore } from '../../src/store/open.js';
import { makeTestHome, cleanupTestHome } from '../helpers.js';
import { importSnapshot } from '../../src/onboarding/import.js';
import { assignBatch } from '../../src/onboarding/batches.js';
import { buildModel, listArchiveItems, memoryDetail } from '../../src/interfaces/console/model.js';
import { UI_JS } from '../../src/interfaces/console/assets/ui-js.js';
import { computeInbox } from '../../src/interfaces/console/suggestions.js';

/**
 * 预览视图的数据面（任务 4.2 / 4.3）。
 *
 * 断言分两半：
 * - **数据**：页面要显示的东西，服务端必须真的给得出（空层级、clean/blocked 拆分、
 *   修订与证据）。
 * - **源码**：那些"不该出现"的东西（编辑/删除控件、预选勾选框）在脚本里必须一次都不出现。
 *   这类负向约束只能靠源码断言，跑 DOM 也测不出"用户根本点不到"。
 */

const NORMAL_TEXT = '构建命令是 pnpm build，产物目录 dist';
const SECRET_TEXT = '部署凭据 AKIAIOSFODNN7EXAMPLE 需要轮换';
const SENSITIVE_TEXT = '我的家庭住址是某某路 12 号 3 单元';

interface Ctx {
  home: string;
  store: CairnStore;
  batchId: string;
  archiveId: string;
  cleanup(): void;
}

async function setup(): Promise<Ctx> {
  const home = makeTestHome('cairn-render-');
  const store = openStore({ home });
  const scope = store.scopes.resolvePreset('personal-global', {});
  const local = store.scopes.resolvePreset('device-local', { deviceId: store.identity.deviceId });
  // 故意建一个永远为空的层级：页面要能把"这层什么都还没记"显示出来，而不是整行消失。
  store.scopes.resolvePreset('project-global', { projectId: 'proj-empty', projectName: '空层级项目' });
  store.memories.add(
    { kind: 'fact', content: NORMAL_TEXT, scopeId: scope.id, authority: 'user_explicit', createdBy: 'cli' },
    store.identity.deviceId,
  );
  store.memories.add(
    {
      kind: 'fact',
      content: SENSITIVE_TEXT,
      scopeId: local.id,
      authority: 'user_explicit',
      createdBy: 'cli',
      sensitivity: 'sensitive',
    },
    store.identity.deviceId,
  );
  const dir = join(home, 'sources');
  mkdirSync(dir, { recursive: true });
  const p = join(dir, 'mixed.md');
  writeFileSync(p, ['一条正常快照条目，长度足够。', SECRET_TEXT].join('\n\n'), 'utf8');
  const o = await importSnapshot(store, { agentKind: 'manual', sourcePath: p });
  const archiveId = (o.archiveId ?? o.reusedArchiveId)!;
  const batchId = assignBatch(store, archiveId);
  store.close();
  const readOnly = openStore({ home, readOnly: true });
  return {
    home,
    store: readOnly,
    batchId,
    archiveId,
    cleanup() {
      try {
        readOnly.close();
      } catch {
        /* 已关闭 */
      }
      cleanupTestHome(home);
    },
  };
}

test('作用域层级：空层级也返回，并带 0 计数（页面才能显示空态而不是漏掉一层）', async () => {
  const ctx = await setup();
  try {
    const model = buildModel(ctx.store, { mode: 'brief' });
    assert.ok(model.scopes.length >= 3, `已解析的层级应全部列出，实际 ${model.scopes.length}`);
    const empty = model.scopes.filter((s) => s.counts.total === 0);
    assert.ok(empty.length >= 1, '空层级必须仍然出现在列表里（否则页面无法显示空态）');
    assert.deepEqual(empty[0]!.counts.byStatus, {}, '空层级的分布是真空，不是缺字段');
    for (const s of model.scopes) {
      assert.equal(typeof s.preset, 'string');
      assert.equal(typeof s.syncPolicy, 'string');
      assert.ok(s.counts.byStatus != null);
    }
  } finally {
    ctx.cleanup();
  }
});

test('UI_JS：空层级有专门文案，不会被静默跳过', () => {
  assert.ok(UI_JS.includes('还没有'), '空态文案必须存在');
  assert.ok(/model\.scopes\.forEach/.test(UI_JS), '层级应全量渲染');
});

test('快照：clean 与 blocked 可分别列出，blocked 原文取不回来且如实标注', async () => {
  const ctx = await setup();
  try {
    const clean = listArchiveItems(ctx.store, ctx.archiveId, { mode: 'full', redact: false, scanState: 'clean' });
    const blocked = listArchiveItems(ctx.store, ctx.archiveId, { mode: 'full', redact: false, scanState: 'blocked' });
    assert.ok(clean.items.length >= 1);
    assert.ok(blocked.items.length >= 1);
    assert.ok(clean.items.every((i) => i.scanState === 'clean'));
    assert.ok(blocked.items.every((i) => i.scanState === 'blocked'));
    for (const i of blocked.items) {
      assert.equal(i.contentAvailable, false, 'blocked 条目在库里只剩占位符');
      assert.ok(
        i.content.text == null || i.content.text.startsWith('[blocked:'),
        `正文位只能出现占位符，实际 ${String(i.content.text)}`,
      );
      assert.equal(SECRET_TEXT.includes(String(i.content.text)), false, '秘密原文不得复原');
    }
    const all = listArchiveItems(ctx.store, ctx.archiveId, { mode: 'full', redact: false });
    assert.equal(all.total, clean.items.length + blocked.items.length);
  } finally {
    ctx.cleanup();
  }
});

test('记忆详情：正文、状态、权威、敏感度、修订、证据一次给全', async () => {
  const ctx = await setup();
  try {
    const list = buildModel(ctx.store, { mode: 'full', redact: false });
    const target = list.memories.find((m) => m.content.text === NORMAL_TEXT);
    assert.ok(target != null, 'fixture 记忆应在列表里');
    const d = memoryDetail(ctx.store, target!.id, { mode: 'full', redact: false });
    assert.equal(d.memory.status, 'active');
    assert.equal(d.memory.authority, 'user_explicit');
    assert.equal(d.memory.sensitivity, 'normal');
    assert.ok(d.memory.kind.length > 0);
    assert.ok(Array.isArray(d.revisions));
    assert.ok(d.revisions.length >= 1, '至少有一条初始修订');
    assert.ok(Array.isArray(d.evidence));
    assert.ok(Array.isArray(d.relations));
    assert.ok(Array.isArray(d.conflicts));
    assert.ok(d.scope != null);
  } finally {
    ctx.cleanup();
  }
});

test('预览页不含任何写操作控件（只读是承诺，不是权限）', () => {
  for (const bad of ['删除', '编辑', '注销', '移出']) {
    assert.equal(UI_JS.includes(bad), false, `预览脚本不得出现写操作词：${bad}`);
  }
  // 英文标识单独判：removeChild 这类 DOM API 不算写操作，必须按边界匹配
  assert.equal(/(edit|delete|destroy|forget|purge)/.test(UI_JS), false, '不得出现写操作的英文标识');
  assert.equal(/method:\s*'DELETE'/.test(UI_JS), false, '不得发出 DELETE 请求');
  assert.equal(/data-action="edit"/.test(UI_JS), false);
  assert.ok(UI_JS.includes('if (!STATIC)'), '所有写操作入口必须被 STATIC 关掉');
});

test('待处理队列：规则层与 AI 层并列呈现，分歧单独标出且默认不预选', async () => {
  const ctx = await setup();
  try {
    const inbox = computeInbox(ctx.store, { redact: false, limit: 100 });
    assert.ok(inbox.entries.length >= 1, 'fixture 应有待判条目');
    // 每条都带规则层结论（AI 层可有可无，二者并列而非覆盖）
    const withRule = inbox.entries.filter((e) => e.ruleLayer != null);
    assert.ok(withRule.length >= 1);
    for (const e of withRule) {
      assert.ok(e.ruleLayer!.ruleId.startsWith('S-'), `规则号应可追溯，实际 ${e.ruleLayer!.ruleId}`);
      assert.ok(e.ruleLayer!.reason.length > 0, '规则层必须给出理由');
    }
    // 分歧判定只在两层都有结论时才可能成立
    for (const e of inbox.entries.filter((x) => x.conflict)) {
      assert.ok(e.ruleLayer != null && e.aiLayer != null, '没有两层就谈不上分歧');
      assert.notEqual(e.ruleLayer!.action, e.aiLayer!.action);
    }
  } finally {
    ctx.cleanup();
  }
});

test('UI_JS：批量处理只纳入有建议的条目，需人判断的单列且不预选', () => {
  // 旧版"待处理"视图已被导入工作台取代（任务 4.2）：分档与分歧提示搬进抽屉。
  // 三条不变量跟着搬：
  assert.ok(UI_JS.includes("s.action !== 'needs_human'"), '需人判断的条目不得进入批量处理');
  assert.ok(UI_JS.includes('（不纳入）'), '被排除的条目必须明说没纳入，而不是悄悄丢掉');
  assert.ok(UI_JS.includes("el('details')"), '被排除条目的原因应折叠可展开');
  assert.ok(UI_JS.includes('ok.disabled = usable.length === 0'), '一条可用都没有时不得让人按下去');
  assert.equal(/createElement\('input'\)[\s\S]{0,80}checked/.test(UI_JS), false, '不得预选任何条目');
});
