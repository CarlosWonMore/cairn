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
import { AUTHORITIES, MEMORY_KINDS, MEMORY_STATUSES } from '../../src/core/types.js';
import { SCOPE_PRESETS } from '../../src/core/scope.js';

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
  // 断言从「脚本里不出现写操作词」收紧到「不出现写操作控件」：
  // add-memory-annotations 起，界面必须显示「仍为活动状态，尚未删除」与终端处置
  // 命令（spec 强制），而 `delete state.picks[...]` 是 JS 运算符、不是写入口。
  // 按词扫描会把说明文字和语言关键字误判成写操作。
  const controlLabel = /el\('button'[^\r\n]*'(删除|编辑|注销|移出)'/;
  assert.equal(controlLabel.test(UI_JS), false, '预览脚本不得出现写操作按钮');
  assert.equal(/method:\s*'DELETE'/.test(UI_JS), false, '不得发出 DELETE 请求');
  assert.equal(/data-action="edit"/.test(UI_JS), false);
  assert.ok(UI_JS.includes('if (!STATIC)'), '所有写操作入口必须被 STATIC 关掉');
  // 批注的两个写入口必须存在，且都在各自的 !STATIC 分支内
  for (const anchor of ['data-annotation-save', 'data-batch-apply']) {
    assert.ok(UI_JS.includes(anchor), `缺少写入口标记 ${anchor}`);
  }
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

// ---------------------------------------------------------------------------
// 作用域徽章与过滤器消歧（add-console-scope-badge）
// ---------------------------------------------------------------------------

test('UI_JS：记忆卡片按 scopeId 查表渲染作用域徽章，本地限定带文字标记', () => {
  assert.match(UI_JS, /byScope\[mem\.scopeId\]/, '徽章必须由 scopeId 查 scopes 得出，不能靠猜');
  assert.ok(UI_JS.includes("chip('scope?', 'muted')"), '查不到时渲染中性徽章，既不崩也不静默省略');
  // 判据必须落在 scopeLocalOnly 这一处：只断言全文含 syncPolicy === 'local_only' 会被
  // 「作用域层级表」里同名字面量满足，把判据改成 return false 也照样绿（实测漏网）。
  assert.ok(
    UI_JS.includes("function scopeLocalOnly(s) { return s.syncPolicy === 'local_only'; }"),
    '本地限定判据必须是 scopeLocalOnly 里的 syncPolicy，不是 preset 名',
  );
  assert.ok(UI_JS.includes("' · 仅本机'"), '色觉障碍用户不能只靠颜色，徽章文本必须自解释');
  // 徽章自己必须带「仅本机」，不靠工具栏选项里那处同名字面量满足（实测漏网）。
  // 文案经 add-console-zh-labels 改成 label(scope.preset, PRESET_LABEL)：意图不变
  // （徽章自身拼「仅本机」且判据走 scopeLocalOnly），原文模式渲染出来的仍是同一串。
  assert.ok(
    UI_JS.includes("var presetText = label(scope.preset, PRESET_LABEL);"),
    '卡片徽章的 preset 必须走 label()，且原文模式仍渲染原始枚举值',
  );
  assert.ok(
    UI_JS.includes("chip(presetText + (scopeLocalOnly(scope) ? ' · 仅本机' : '')"),
    '卡片徽章本身必须拼上「仅本机」，且判据走 scopeLocalOnly',
  );
  assert.match(
    UI_JS,
    /chipLabel\(mem\.status[\s\S]{0,600}byScope\[mem\.scopeId\][\s\S]{0,600}chipLabel\(mem\.authority/,
    '徽章应插在 status 与 authority 之间',
  );
});

test('UI_JS：paintMemories 接收 scopes，静态与在线两处调用点都传', () => {
  assert.match(UI_JS, /function paintMemories\(host, list, total, scopes\)/);
  assert.ok(UI_JS.includes('paintMemories(host, list, list.length, model.scopes)'), '静态分支必须传 model.scopes');
  assert.ok(UI_JS.includes('paintMemories(host, data.memories, data.total, data.scopes)'), '在线分支必须传 data.scopes');
});

test('UI_JS：作用域过滤选项带消歧标识、同步策略与记忆数', () => {
  assert.match(UI_JS, /scopeCue\(s\)/, '选项必须用限定标识消歧，不能只渲染 preset');
  assert.match(UI_JS, /if \(s\.projectId\) parts\.push\(s\.spaceName \|\| s\.projectId\.slice\(0, 8\)\)/, '项目作用域优先显示人读的项目名');
  assert.match(UI_JS, /if \(s\.deviceId && s\.deviceId !== 'all'\) parts\.push\(s\.deviceId\.slice\(0, 12\)\)/, '设备绑定作用域用设备标识消歧');
  assert.ok(UI_JS.includes("(scopeLocalOnly(s) ? ' · 仅本机' : '')"), '选项必须标明同步策略');
  assert.match(UI_JS, /s\.counts && s\.counts\.total \? ' · ' \+ s\.counts\.total/, '既有的记忆数必须保留');
});

// ---------------------------------------------------------------------------
// 详情进抽屉（refine-memory-detail-drawer）
//
// 这一组全是负向断言：源码里"不该出现的东西"（clear(#view)、render()、返回按钮）
// 只能在源码层验证——跑 DOM 只能看到抽屉开了，看不出列表其实被重建过。
// ---------------------------------------------------------------------------

/** 取出 IIFE 里某个具名函数的源码体（已去掉整行注释），用于"这段里不许出现 X"这类断言。 */
function fnBody(name: string): string {
  const m = new RegExp(`function ${name}\\(([^)]*)\\) \\{([\\s\\S]*?)\\n  \\}`).exec(UI_JS);
  assert.ok(m != null, `UI_JS 里应能找到 function ${name}`);
  return m![2]!.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
}

test('详情复用既有抽屉：openDetail 不再清空 #view，也不再自带返回按钮', () => {
  const od = fnBody('openDetail');
  assert.match(od, /showDetail/, '详情渲染交给 showDetail（内容构建与承载容器分开）');
  assert.equal(/clear\(/.test(od), false, '不得清空 #view：那正是列表被销毁、滚动位置丢失的原因');
  assert.equal(/getElementById\('view'\)/.test(od), false, '详情不再往 #view 里画');
  // 只有一份面板实现，否则两处关闭/焦点行为会漂移（本项目已踩过两次同类坑）
  assert.equal((UI_JS.match(/function openDrawer\(/g) || []).length, 1, 'openDrawer 必须只有一份');
  assert.equal(UI_JS.includes('← 返回列表'), false, '抽屉自带关闭入口，原返回按钮必须删掉');
});

test('关闭详情只清状态与地址，不重查列表', () => {
  const sd = fnBody('showDetail');
  assert.match(sd, /openDrawer\(/, '承载容器必须是既有抽屉');
  assert.equal(/\brender\(/.test(sd), false, 'onClose 里不得调 render()：那会重新请求 /api/memories 并打乱顺序');
  assert.match(sd, /state\.mem = ''/, '关闭时必须清掉 mem，否则地址残留、刷新会再打开');
  assert.match(sd, /writeUrl\(false\)/, '打开与关闭都要回写地址（详情可寻址）');
});

test('buildDetailBody 返回独立容器，内容渲染一处未改', () => {
  const bd = fnBody('buildDetailBody');
  assert.match(bd, /var host = el\('div'\)/, '内容装进新建的 div，由抽屉接手挂载');
  assert.match(bd, /return host;\s*$/, '必须把容器返回给调用方');
  assert.equal(/clear\(/.test(bd), false, '内容构建不得清任何宿主');
  for (const anchor of ['contentHash', 'data-memory-annotations', '修订史（', '证据（', '冲突（']) {
    assert.ok(bd.includes(anchor), `详情内容块「${anchor}」必须原样保留`);
  }
});

test('mem 可寻址：切视图清 mem，带 mem 进入时自动打开详情', () => {
  assert.match(fnBody('go'), /state\.mem = ''/, '切视图必须收起详情，不能让旧 id 跟到新视图的地址里');
  const rm = fnBody('renderMemories');
  assert.equal(
    (rm.match(/if \(state\.mem\) openDetail\(state\.mem\)/g) || []).length,
    2,
    '在线与静态两条路径都要按地址里的 mem 重新打开详情',
  );
  assert.match(fnBody('detailFromModel'), /staticModel\(\)/, '静态页的详情数据来自内嵌模型，不发请求');
});

// ---------------------------------------------------------------------------
// 标签语言可切换（add-console-zh-labels）
//
// 词表与 label() 都在 UI_JS 那个字符串里，只能靠源码断言：从源码取出表体，
// 再与 core/types.ts 的事实源对齐——枚举加了而词表没跟上，这里必须变红。
// ---------------------------------------------------------------------------

/** 取出一张 * _LABEL 表的表体（模板里没有嵌套对象，非贪婪到第一个 }; 即可）。 */
function tableBody(name: string): string {
  const m = new RegExp(`var ${name} = \\{([\\s\\S]*?)\\};`).exec(UI_JS);
  assert.ok(m != null, `UI_JS 里应有 ${name}`);
  return m![1]!;
}

function tableKeys(name: string): string[] {
  const keys: string[] = [];
  const re = /(?:'([^']+)'|([A-Za-z_][A-Za-z0-9_]*))\s*:/g;
  let hit: RegExpExecArray | null;
  const body = tableBody(name);
  while ((hit = re.exec(body))) keys.push(hit[1] ?? hit[2]!);
  return keys;
}

test('标签表覆盖全部领域枚举，且每条都给了中文', () => {
  const pairs: Array<[string, readonly string[]]> = [
    ['KIND_LABEL', MEMORY_KINDS],
    ['STATUS_LABEL', MEMORY_STATUSES],
    ['AUTHORITY_LABEL', AUTHORITIES],
    ['PRESET_LABEL', SCOPE_PRESETS],
  ];
  for (const [table, values] of pairs) {
    const keys = tableKeys(table);
    for (const v of values) assert.ok(keys.includes(v), `${table} 缺少枚举 ${v}`);
    // 值必须是中文：占位符或漏翻（照抄英文）都算没做
    for (const body of Array.from(tableBody(table).matchAll(/:\s*'([^']*)'/g))) {
      assert.match(body[1]!, /[\u4e00-\u9fff]/, `${table} 的「${body[1]}」不像中文标签`);
    }
  }
  // 同步策略与扫描状态是字符串列，取值散在 store/契约层：按已知集合钉住
  assert.deepEqual(tableKeys('SYNC_POLICY_LABEL').sort(), ['encrypted', 'local_only']);
  assert.deepEqual(tableKeys('SCAN_STATE_LABEL').sort(), ['blocked', 'clean', 'pending']);
  assert.deepEqual(tableKeys('REDACTION_LABEL').sort(), ['blocked', 'clean', 'not_scanned']);
});

test('标签走 label() 单点，卡片不再直接渲染原始枚举', () => {
  assert.match(
    UI_JS,
    /function label\(v, table\) \{ return state\.labelLang === 'raw' \|\| !table \|\| !table\[v\] \? v : table\[v\]; \}/,
    '单点映射必须在函数内判断原文态，不能靠每个调用点各判一次',
  );
  assert.match(UI_JS, /function chip\(text, kind, title\)/, 'chip 要支持可选的 title（中文模式保留原文）');
  assert.match(UI_JS, /return chip\(t, kind, t === v \? null : v\);/, '只有被翻译过的标签才挂 title');
  for (const bad of ['chip(mem.kind', 'chip(mem.status', 'chip(mem.authority']) {
    assert.equal(UI_JS.includes(bad), false, `卡片标签必须走 label()，不得直接渲染原文：${bad}`);
  }
  for (const name of [
    'KIND_LABEL', 'STATUS_LABEL', 'AUTHORITY_LABEL', 'PRESET_LABEL',
    'SYNC_POLICY_LABEL', 'SCAN_STATE_LABEL', 'REDACTION_LABEL',
  ]) {
    assert.equal((UI_JS.match(new RegExp(`var ${name} =`, 'g')) || []).length, 1, `${name} 必须单点定义，不能各处再拼一份`);
  }
});

test('label() 未知值原样返回：新枚举最坏是回到原文，不是空白', () => {
  const m = /function label\(v, table\) \{[^\n]*\}/.exec(UI_JS);
  assert.ok(m != null, 'UI_JS 里应有 label 的实现');
  // 用页面里跑的同一份实现（只补一个 state 桩）：在测试里另写一个等价函数，测的就不是同一段代码了
  const label = new Function(`var state = { labelLang: 'zh' }; ${m![0]}; return label;`)() as (
    v: string,
    t: Record<string, string> | null,
  ) => string;
  assert.equal(label('fact', { fact: '事实' }), '事实');
  assert.equal(label('brand-new-kind', { fact: '事实' }), 'brand-new-kind', '未知值必须原样返回');
  assert.equal(label('fact', {}), 'fact');
  assert.equal(label('fact', null), 'fact', '没有词表时也不得返回空串或 undefined');

  // 原文模式：词表在也不许翻译（本轮实测踩过：只查未知值降级，漏了模式本身）
  const labelRaw = new Function(`var state = { labelLang: 'raw' }; ${m![0]}; return label;`)() as (
    v: string,
    t: Record<string, string> | null,
  ) => string;
  assert.equal(labelRaw('fact', { fact: '事实' }), 'fact', '原文模式必须逐字节等于库里的取值');
});

