import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../../src/interfaces/mcp/server.js';
import { AppService } from '../../src/interfaces/app-service.js';
import { openStore } from '../../src/store/open.js';
import { makeTestHome, cleanupTestHome } from '../helpers.js';

/**
 * MCP 批注通道（design D4 / agent-interfaces spec）：
 * 读取不返回记忆正文全文；回写只改批注状态并记录处置者；
 * 非法状态被拒；全程记忆零改动。
 */

const LONG_CONTENT = '部署窗口是每周四晚十点，发布前先冻结变更窗口；' + '补充细节'.repeat(40);

interface ToolResult {
  isError?: boolean;
  content: { type: string; text: string }[];
}

function body(r: ToolResult): Record<string, unknown> {
  return JSON.parse(r.content[0]!.text) as Record<string, unknown>;
}

test('MCP：批注列表不含正文全文；resolve 记录 mcp 身份；记忆完全未变', async () => {
  const home = makeTestHome('cairn-annot-mcp-');
  const svc = AppService.open(home);
  const a = svc.addMemory({ content: LONG_CONTENT }).memory!;
  const b = svc.addMemory({ content: '第二条记忆：报表服务压测基线是 800 QPS，超过先扩容。' }).memory!;
  const annA = svc.annotateMemory({ memoryId: a.id, disposition: 'needs_edit', note: '日期需要核对' });
  svc.annotateMemory({ memoryId: b.id, disposition: 'pending_forget', note: '可能过期' });
  const before = {
    memory: JSON.stringify(svc.store.db.all('SELECT * FROM memory ORDER BY id')),
    revisions: JSON.stringify(svc.store.db.all('SELECT * FROM memory_revision ORDER BY id')),
  };
  svc.close();

  const server = createServer(home);
  const client = new Client({ name: 'annot-test', version: '0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name);
    assert.ok(names.includes('memory_annotations_list'), '缺少 memory_annotations_list');
    assert.ok(names.includes('memory_annotation_resolve'), '缺少 memory_annotation_resolve');

    const list = body((await client.callTool({ name: 'memory_annotations_list', arguments: {} })) as ToolResult);
    const items = list['items'] as Record<string, unknown>[];
    assert.equal(items.length, 2);
    assert.equal(JSON.stringify(list).includes(LONG_CONTENT), false, '不得返回记忆正文全文');
    const item = items.find((x) => x['memoryId'] === a.id)!;
    assert.equal(item['disposition'], 'needs_edit');
    assert.equal(item['note'], '日期需要核对');
    assert.ok(String(item['memorySummary'] ?? '').length <= 81, '摘要只能是定位用的短片段');
    assert.equal(item['memoryStatus'], 'active');

    const pending = body(
      (await client.callTool({ name: 'memory_annotations_list', arguments: { disposition: 'pending_forget' } })) as ToolResult,
    );
    assert.equal((pending['items'] as unknown[]).length, 1, 'disposition 过滤应生效');
    assert.equal((pending['items'] as Record<string, unknown>[])[0]!['memoryId'], b.id);

    const bad = (await client.callTool({
      name: 'memory_annotation_resolve',
      arguments: { id: annA.id, status: 'done' },
    })) as ToolResult;
    assert.equal(bad.isError, true, '非法状态应作为工具错误返回');
    assert.equal(body(bad)['code'], 'E_VALIDATION');

    const resolved = body(
      (await client.callTool({ name: 'memory_annotation_resolve', arguments: { id: annA.id, status: 'resolved' } })) as ToolResult,
    );
    assert.equal(resolved['status'], 'resolved');
    assert.match(String(resolved['resolvedBy']), /^mcp:/);
    assert.match(String(resolved['resolvedAt']), /^\d{4}-\d{2}-\d{2}T/);

    const openList = body(
      (await client.callTool({ name: 'memory_annotations_list', arguments: { status: 'open' } })) as ToolResult,
    );
    const openItems = openList['items'] as Record<string, unknown>[];
    assert.equal(openItems.some((x) => x['id'] === annA.id), false, '已处置的批注不再出现在待办列表');
    assert.equal(openItems.length, 1);
  } finally {
    await client.close();
    await server.close();
  }

  const ro = openStore({ home, readOnly: true });
  try {
    assert.equal(JSON.stringify(ro.db.all('SELECT * FROM memory ORDER BY id')), before.memory, '正文与状态不得变化');
    assert.equal(
      JSON.stringify(ro.db.all('SELECT * FROM memory_revision ORDER BY id')),
      before.revisions,
      '修订链不得变化',
    );
  } finally {
    ro.close();
  }
  cleanupTestHome(home);
});
