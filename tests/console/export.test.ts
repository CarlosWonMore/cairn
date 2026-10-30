import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openStore, CairnStore } from '../../src/store/open.js';
import { makeTestHome, cleanupTestHome } from '../helpers.js';
import { importSnapshot } from '../../src/onboarding/import.js';
import { assignBatch } from '../../src/onboarding/batches.js';
import { exportConsoleHtml, normalizePersonalName, renderExportPage } from '../../src/interfaces/console/export.js';
import { buildModel } from '../../src/interfaces/console/model.js';

const SENSITIVE_TEXT = '我的家庭住址是某某路 12 号 3 单元，仅本人可见';
const NORMAL_TEXT = '构建命令是 pnpm build，产物目录 dist';
const FAKE_AWS_ID = 'AKIAIOSFODNN7EXAMPLE';

interface Ctx {
  home: string;
  store: CairnStore;
  cleanup(): void;
}

function setup(): Ctx {
  const home = makeTestHome('cairn-export-');
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

async function seed(ctx: Ctx): Promise<void> {
  const scope = ctx.store.scopes.resolvePreset('personal-global', {});
  const local = ctx.store.scopes.resolvePreset('device-local', { deviceId: ctx.store.identity.deviceId });
  ctx.store.memories.add(
    { kind: 'fact', content: NORMAL_TEXT, scopeId: scope.id, authority: 'user_explicit', createdBy: 'cli' },
    ctx.store.identity.deviceId,
  );
  ctx.store.memories.add(
    {
      kind: 'fact',
      content: SENSITIVE_TEXT,
      scopeId: local.id,
      authority: 'user_explicit',
      createdBy: 'cli',
      sensitivity: 'sensitive',
    },
    ctx.store.identity.deviceId,
  );
  const dir = join(ctx.home, 'sources');
  mkdirSync(dir, { recursive: true });
  const p = join(dir, 'mixed.md');
  writeFileSync(p, ['一条正常快照条目，长度足够。', `密钥记录：${FAKE_AWS_ID}`].join('\n\n'), 'utf8');
  const o = await importSnapshot(ctx.store, { agentKind: 'manual', sourcePath: p });
  assignBatch(ctx.store, (o.archiveId ?? o.reusedArchiveId)!);
}

test('默认导出：含敏感记忆完整正文，文件名带 -personal，含警示文案', async () => {
  const ctx = setup();
  try {
    await seed(ctx);
    const outFile = join(ctx.home, 'out', 'preview.html');
    const r = exportConsoleHtml(ctx.store, { outFile });
    assert.equal(r.redacted, false);
    assert.ok(r.outFile.endsWith('preview-personal.html'), `文件名应带 -personal，实际 ${r.outFile}`);
    const html = readFileSync(r.outFile, 'utf8');
    assert.ok(html.includes(SENSITIVE_TEXT), '默认导出必须含敏感记忆完整正文');
    assert.ok(html.includes(NORMAL_TEXT));
    assert.ok(html.includes('请勿外传'), '文件头必须有警示');
    assert.ok(html.includes('含明文本地记忆'));
    assert.ok(r.counts.memories >= 2);
    assert.ok(r.counts.items >= 1);
  } finally {
    ctx.cleanup();
  }
});

test('默认导出：不含本机绝对路径（用户名与目录结构不外泄）', async () => {
  const ctx = setup();
  try {
    await seed(ctx);
    const r = exportConsoleHtml(ctx.store, { outFile: join(ctx.home, 'p.html') });
    const html = readFileSync(r.outFile, 'utf8');
    assert.ok(!html.includes(ctx.home), '产物不得包含 HOME 绝对路径');
    assert.ok(!/[A-Za-z]:\\Users\\/.test(html), '产物不得包含盘符级别的用户目录');
    assert.ok(html.includes('~'), '来源标识应折叠为 ~ 相对形式');
  } finally {
    ctx.cleanup();
  }
});

test('--redact：敏感记忆正文被掩码，其余照常', async () => {
  const ctx = setup();
  try {
    await seed(ctx);
    const r = exportConsoleHtml(ctx.store, { outFile: join(ctx.home, 'r.html'), redact: true });
    assert.equal(r.redacted, true);
    const html = readFileSync(r.outFile, 'utf8');
    assert.ok(!html.includes(SENSITIVE_TEXT), '脱敏导出不得含敏感正文');
    assert.ok(html.includes(NORMAL_TEXT), '非敏感内容照常导出');
    assert.ok(html.includes('脱敏导出'), '文件头应说明这是脱敏产物');
    assert.ok(html.includes('masked'));
  } finally {
    ctx.cleanup();
  }
});

test('blocked 条目：如实标注原文未入库，且任何模式都取不回来', async () => {
  const ctx = setup();
  try {
    await seed(ctx);
    const plain = exportConsoleHtml(ctx.store, { outFile: join(ctx.home, 'b1.html') });
    const redacted = exportConsoleHtml(ctx.store, { outFile: join(ctx.home, 'b2.html'), redact: true });
    for (const r of [plain, redacted]) {
      const html = readFileSync(r.outFile, 'utf8');
      assert.ok(!html.includes(FAKE_AWS_ID), 'blocked 原文不在库中，导出不可能包含');
      assert.ok(html.includes('[blocked:'), '应输出占位符，让读者知道这里被拦过');
      assert.ok(html.includes('原文未入库') || html.includes('物理丢弃'), '必须如实说明原文已丢弃');
    }
    assert.ok(plain.warnings.some((w) => w.includes('blocked')), '导出应报告 blocked 条目数');
  } finally {
    ctx.cleanup();
  }
});

test('离线：不含任何外部资源引用（link/script src/img src/@import/url()）', async () => {
  const ctx = setup();
  try {
    await seed(ctx);
    const r = exportConsoleHtml(ctx.store, { outFile: join(ctx.home, 'offline.html') });
    const html = readFileSync(r.outFile, 'utf8');
    // 判据是"外链资源"，不是"正文里出现 URL 字符串"——记忆正文本来就可能有链接。
    assert.equal(/<link\b/i.test(html), false, '不得有 <link>');
    assert.equal(/<script[^>]+\bsrc=/i.test(html), false, '不得有外部脚本');
    assert.equal(/<img[^>]+\bsrc=/i.test(html), false, '不得有外部图片');
    assert.equal(/@import/i.test(html), false, 'CSS 不得 @import');
    assert.equal(/url\(\s*['"]?https?:/i.test(html), false, 'CSS 不得引用远程资源');
    assert.equal(/<iframe/i.test(html), false, '不得有 iframe');
    assert.ok(html.includes('<!DOCTYPE html>'));
    assert.ok(html.includes('<style>'), '样式必须内联');
  } finally {
    ctx.cleanup();
  }
});

test('内联 JSON 转义：正文含 </script> 不会截断文档', () => {
  const ctx = setup();
  try {
    const model = buildModel(ctx.store, { mode: 'full', redact: false });
    model.memories.push({
      ...model.memories[0]!,
      id: 'fake',
      content: { masked: false, text: '危险内容 </script><script>alert(1)</script>', length: 40, hashPrefix: 'a'.repeat(12), truncated: false },
    });
    const html = renderExportPage(model);
    assert.equal(html.split('</script>').length - 1, 2, '只有 model 与 UI 两个脚本块，正文不得额外产生闭合标签');
    assert.ok(html.includes('\\u003c/script\\u003e'));
  } finally {
    ctx.cleanup();
  }
});

test('体积超限：降级裁掉正文并如实报告条数', async () => {
  const ctx = setup();
  try {
    await seed(ctx);
    const r = exportConsoleHtml(ctx.store, { outFile: join(ctx.home, 'big.html'), maxBytes: 20_000, degradeKeepItems: 1 });
    assert.ok(r.degradedItems > 0, '应触发降级');
    assert.ok(r.warnings.some((w) => w.includes('降级')));
    const html = readFileSync(r.outFile, 'utf8');
    assert.ok(html.includes('体积降级') || html.includes('裁掉'), '文件头应标注截断');
  } finally {
    ctx.cleanup();
  }
});

test('文件名规范化：已有 -personal 不重复追加', () => {
  assert.equal(normalizePersonalName('a/preview.html'), join('a', 'preview-personal.html'));
  // 已带后缀时原样返回（不重新拼路径，避免改变调用方给定的相对/绝对形式）
  assert.equal(normalizePersonalName('a/preview-personal.html'), 'a/preview-personal.html');
  assert.equal(normalizePersonalName('a/x.txt'), join('a', 'x-personal.txt'));
});
