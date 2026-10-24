/**
 * 受管 Markdown 投影测试（tasks 7.x）。
 *
 * 核心证据点：
 * - 块替换只动块内字节，块外逐字节保留；
 * - 重复 generate 同内容 → changed=false 且文件字节不变、无重复块；
 * - disable 后与原始字节逐字节一致（用户未改时）；
 * - 首次写入产生 .cairn-backup 且内容为原始字节，再次更新不覆盖备份。
 */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import {
  DEFAULT_BLOCK_ID,
  disableProjection,
  generateProjection,
  hasCairnMarker,
  removeBlockFromText,
  renderBlock,
  upsertBlockInText,
} from '../../src/projection/markdown.js';
import { openStore, type CairnStore } from '../../src/store/open.js';
import { isCairnError } from '../../src/core/errors.js';

const ID = DEFAULT_BLOCK_ID;

function begin(revision: number, blockId = ID): string {
  return `<!-- cairn:begin block="${blockId}" revision="${revision}" -->`;
}
function end(blockId = ID): string {
  return `<!-- cairn:end block="${blockId}" -->`;
}

function forCode(code: string) {
  return (e: unknown): boolean => isCairnError(e) && e.code === code;
}

describe('renderBlock / upsertBlockInText / removeBlockFromText（纯文本操作）', () => {
  it('renderBlock：标记格式精确（block/revision/换行）', () => {
    assert.equal(renderBlock('正文A', 3, ID), `${begin(3)}\n正文A\n${end()}`);
    assert.equal(renderBlock('a\nb', 1, 'custom-id'), `<!-- cairn:begin block="custom-id" revision="1" -->\na\nb\n<!-- cairn:end block="custom-id" -->`);
  });

  it('upsert：无块 → 追加，前面恰好一个空行分隔，revision=1', () => {
    const text = '# 说明\n\n- 条目\n';
    const r = upsertBlockInText(text, ID, '内容');
    assert.equal(r.changed, true);
    assert.equal(r.hadBlock, false);
    assert.equal(r.revision, 1);
    assert.equal(r.output, `# 说明\n\n- 条目\n\n${begin(1)}\n内容\n${end()}\n`);
  });

  it('upsert：空文本 → 区块置于文件开头；尾部多余换行被规范化为一个空行分隔', () => {
    assert.equal(upsertBlockInText('', ID, 'x').output, `${begin(1)}\nx\n${end()}\n`);
    assert.equal(
      upsertBlockInText('# 头部\n\n\n\n', ID, 'x').output,
      `# 头部\n\n${begin(1)}\nx\n${end()}\n`,
      '尾部 3 个换行规范化为恰好一个空行分隔',
    );
  });

  it('upsert：有块 → 整体替换 revision+1，块外字节逐字节保留', () => {
    const head = '# 说明\n\n前置说明…\n\n';
    const tail = '\n\n## 后续章节\n内容\n';
    const text = `${head}${begin(2)}\n旧内容\n${end()}${tail}`;
    const r = upsertBlockInText(text, ID, '新内容');
    assert.equal(r.changed, true);
    assert.equal(r.hadBlock, true);
    assert.equal(r.revision, 3);
    assert.equal(r.output, `${head}${begin(3)}\n新内容\n${end()}${tail}`, '头尾必须逐字节一致');
  });

  it('upsert：内容未变 → 幂等（changed=false 且输出逐字节等于输入，revision 不变）', () => {
    const text = `# 头\n\n${begin(7)}\n稳定内容\n${end()}\n`;
    const r = upsertBlockInText(text, ID, '稳定内容');
    assert.equal(r.changed, false);
    assert.equal(r.hadBlock, true);
    assert.equal(r.revision, 7);
    assert.equal(r.output, text, '幂等调用不得改动任何字节');
  });

  it('upsert：revisionSeed —— 文件无块但库有历史时，revision 从 seed+1 续号', () => {
    const r = upsertBlockInText('# 头\n', ID, 'x', { revisionSeed: 4 });
    assert.equal(r.revision, 5);
    assert.ok(r.output.includes(begin(5)));
  });

  it('remove：移除区块并回收安装时加入的分隔空行，其余字节逐字节保留', () => {
    const original = '# 项目说明\n\n- 规则 A\n- 规则 B\n';
    const installed = `${original}\n${begin(1)}\n路由文案\n${end()}\n`;
    const r = removeBlockFromText(installed, ID);
    assert.equal(r.changed, true);
    assert.equal(r.hadBlock, true);
    assert.equal(r.output, original, '卸载后必须与安装前逐字节一致');
  });

  it('remove：块后有内容 → 用户内容与其空行全部保留', () => {
    const installed = `# 头\n\n${begin(1)}\n块\n${end()}\n\n用户自己加的\n`;
    const r = removeBlockFromText(installed, ID);
    assert.equal(r.output, '# 头\n\n用户自己加的\n');
  });

  it('remove：用户在分隔空行外另加了空行 → 只回收安装加入的那一个', () => {
    const original = '# 头\n\n\n用户多加的空行在后\n';
    const installed = `# 头\n\n\n\n${begin(1)}\n块\n${end()}\n用户多加的空行在后\n`;
    assert.equal(removeBlockFromText(installed, ID).output, original);
  });

  it('remove：无块 → changed=false 且原样返回', () => {
    const text = '# 普通文件\n';
    const r = removeBlockFromText(text, ID);
    assert.equal(r.changed, false);
    assert.equal(r.output, text);
  });

  it('重复标记与不平衡标记拒绝（E_VALIDATION）', () => {
    const dup = `${begin(1)}\na\n${end()}\n${begin(2)}\nb\n${end()}\n`;
    assert.throws(() => upsertBlockInText(dup, ID, 'x'), forCode('E_VALIDATION'));
    const unbalanced = `${begin(1)}\na\n`;
    assert.throws(() => removeBlockFromText(unbalanced, ID), forCode('E_VALIDATION'));
    const orphanEnd = `x\n${end()}\n`;
    assert.throws(() => upsertBlockInText(orphanEnd, ID, 'x'), forCode('E_VALIDATION'));
  });

  it('区块内容包含 cairn 标记 / 非法 blockId → E_VALIDATION（防嵌套）', () => {
    assert.throws(() => renderBlock('正文\n<!-- cairn:end block="x" -->', 1, ID), forCode('E_VALIDATION'));
    assert.throws(() => upsertBlockInText('t', '带"引号', 'x'), forCode('E_VALIDATION'));
  });

  it('hasCairnMarker：含标记 true，普通文件 false', () => {
    assert.equal(hasCairnMarker(`${begin(1)}\nx\n${end()}`), true);
    assert.equal(hasCairnMarker('<!-- cairn:end block="whatever" -->'), true);
    assert.equal(hasCairnMarker('# 普通文档\n正文提到 Cairn 但没有标记\n'), false);
    assert.equal(hasCairnMarker(''), false);
  });
});

describe('generateProjection / disableProjection（含本地库）', () => {
  let base = '';
  let store: CairnStore;

  before(async () => {
    base = await mkdtemp(path.join(tmpdir(), 'cairn-proj-store-'));
    store = openStore({ home: path.join(base, 'store-home') });
  });
  after(async () => {
    store.close();
    await rm(base, { recursive: true, force: true });
  });

  it('generateProjection：新文件生成受管区块', async () => {
    const target = path.join(base, 'new', 'AGENTS.md');
    const r = await generateProjection(store, { targetPath: target, content: '路由文案 v1', agentId: 'test-agent' });
    assert.equal(r.changed, true);
    assert.equal(r.revision, 1);
    const text = await readFile(target, 'utf8');
    assert.equal(text, `${begin(1)}\n路由文案 v1\n${end()}\n`);
    const row = store.blocks.get(target, ID);
    assert.ok(row, '库中应有受管区块记录');
    assert.equal(row.content, '路由文案 v1');
    assert.equal(row.startMarker, begin(1));
  });

  it('generateProjection：重复生成同内容 → changed=false、文件字节与 mtime 不变、无重复块', async () => {
    const target = path.join(base, 'idem.md');
    await generateProjection(store, { targetPath: target, content: '同内容', agentId: 'a' });
    const beforeBuf = await readFile(target);
    const beforeStat = await stat(target);
    const r = await generateProjection(store, { targetPath: target, content: '同内容', agentId: 'a' });
    assert.equal(r.changed, false);
    assert.equal(r.revision, 1, '幂等时 revision 不变');
    const afterBuf = await readFile(target);
    const afterStat = await stat(target);
    assert.ok(beforeBuf.equals(afterBuf), '文件字节不得变化');
    assert.equal(beforeStat.mtimeMs, afterStat.mtimeMs, '幂等生成不得触碰文件（mtime 不变）');
    const text = afterBuf.toString('utf8');
    assert.equal(text.split(`<!-- cairn:begin block="${ID}"`).length - 1, 1, '不得产生重复块');
  });

  it('generateProjection：更新内容 → 只替换块内字节；revision 递增；库记录同步', async () => {
    const target = path.join(base, 'update.md');
    await writeFile(target, '# 项目备忘\n\n手工内容\n', 'utf8');
    await generateProjection(store, { targetPath: target, content: 'v1', agentId: 'a' });
    const installed = await readFile(target, 'utf8');
    const r = await generateProjection(store, { targetPath: target, content: 'v2\n第二行', agentId: 'a' });
    assert.equal(r.changed, true);
    assert.equal(r.revision, 2);
    const updated = await readFile(target, 'utf8');
    assert.ok(updated.includes(`${begin(2)}\nv2\n第二行\n${end()}`));
    assert.ok(updated.startsWith('# 项目备忘\n\n手工内容\n\n'), '块外前缀逐字节保留');
    assert.equal(
      updated.slice(0, updated.indexOf(begin(2))),
      installed.slice(0, installed.indexOf(begin(1))),
      '起始标记之前的字节完全一致',
    );
    const row = store.blocks.get(target, ID)!;
    assert.equal(row.content, 'v2\n第二行');
    assert.equal(row.startMarker, begin(2));
  });

  it('generateProjection：首次写入备份原始字节；再次更新不覆盖备份', async () => {
    const target = path.join(base, 'backup.md');
    const original = '# 原始文件\n\n原始内容\n';
    await writeFile(target, original, 'utf8');
    await generateProjection(store, { targetPath: target, content: 'v1', agentId: 'a' });
    const backupPath = target + '.cairn-backup';
    assert.equal(await readFile(backupPath, 'utf8'), original, '备份必须是原始字节');
    await generateProjection(store, { targetPath: target, content: 'v2', agentId: 'a' });
    assert.equal(await readFile(backupPath, 'utf8'), original, '再次更新不得覆盖备份');
    const row = store.blocks.get(target, ID)!;
    assert.equal(row.backupPath, backupPath);
  });

  it('disableProjection：用户未改时恢复原始字节（逐字节一致），记录清空并留审计', async () => {
    const target = path.join(base, 'disable-clean.md');
    const original = '# 说明文档\n\n原有规则\n';
    await writeFile(target, original, 'utf8');
    await generateProjection(store, { targetPath: target, content: '路由', agentId: 'a' });
    assert.equal(store.blocks.listActive(target).length, 1);

    const r = await disableProjection(store, { targetPath: target });
    assert.equal(r.removed, true);
    assert.equal(r.restoredOriginal, true, '未修改时应整文件恢复备份');
    assert.equal(await readFile(target, 'utf8'), original, '必须与原始字节逐字节一致');
    assert.equal(store.blocks.listActive(target).length, 0, 'markRemoved 后 listActive 为空');
    const evt = store.audit.recent(20).find((e) => e.action === 'projection_removed');
    assert.ok(evt, '必须写入审计事件');
    assert.equal(evt.category, 'config');
    assert.equal(evt.detail['targetPath'], target, '审计含目标路径');
    assert.ok(!JSON.stringify(evt.detail).includes('路由'), '审计不得包含区块正文');
    // 备份恢复成功后应被清理（文件不再存在）
    await assert.rejects(readFile(target + '.cairn-backup'), () => true);  });

  it('disableProjection：用户追加自定义行后 → 只删块、自定义行保留', async () => {
    const target = path.join(base, 'disable-user.md');
    const original = '# 说明文档\n\n原有规则\n';
    await writeFile(target, original, 'utf8');
    await generateProjection(store, { targetPath: target, content: '路由', agentId: 'a' });
    await writeFile(target, (await readFile(target, 'utf8')) + '自定义备注行\n', 'utf8');

    const r = await disableProjection(store, { targetPath: target });
    assert.equal(r.removed, true);
    assert.equal(r.restoredOriginal, false, '有用户修改时不得整文件覆盖');
    const text = await readFile(target, 'utf8');
    assert.equal(text, original + '自定义备注行\n');
    assert.equal(hasCairnMarker(text), false);
    assert.equal(store.blocks.listActive(target).length, 0);
  });

  it('disableProjection：库记录丢失但文件有块 → 仍按标记移除；文件不存在时不写文件', async () => {
    // 无记录有块：以 DEFAULT_BLOCK_ID 标记为准移除
    const target = path.join(base, 'orphan.md');
    await writeFile(target, `# 头\n\n${begin(1)}\n块\n${end()}\n`, 'utf8');
    const r = await disableProjection(store, { targetPath: target });
    assert.equal(r.removed, true);
    assert.equal(await readFile(target, 'utf8'), '# 头\n');

    // 文件不存在：不创建文件，仅清记录 + 审计
    const missing = path.join(base, 'never-exists.md');
    const r2 = await disableProjection(store, { targetPath: missing });
    assert.equal(r2.removed, false);
    assert.equal(r2.restoredOriginal, false);
    await assert.rejects(readFile(missing));
  });

  it('generateProjection：用户手工删除块后重新生成 → revision 从库记录续号', async () => {
    const target = path.join(base, 'reseed.md');
    await writeFile(target, '# 头\n', 'utf8');
    await generateProjection(store, { targetPath: target, content: 'a', agentId: 'a' });
    await generateProjection(store, { targetPath: target, content: 'b', agentId: 'a' }); // rev 2
    await writeFile(target, '# 头\n', 'utf8'); // 用户删掉整块
    const r = await generateProjection(store, { targetPath: target, content: 'c', agentId: 'a' });
    assert.equal(r.revision, 3, 'revision 取库记录 +1 续号');
    assert.ok((await readFile(target, 'utf8')).includes(begin(3)));
  });
});
