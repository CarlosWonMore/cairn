#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolRequest,
} from '@modelcontextprotocol/sdk/types.js';
import { AppService } from '../app-service.js';
import { CairnError, isCairnError, err, ExitCode } from '../../core/errors.js';
import { memoryPreview } from '../../retrieval/preview.js';
import { MemoryKind, MEMORY_KINDS } from '../../core/types.js';
import { readReviews, reviewPackForBatch, reviewSubmit } from '../console/review-store.js';
import { ANNOTATION_STATUSES, DISPOSITIONS, RESOLVE_STATUSES } from '../console/annotations.js';
import { parseJudgement } from '../../onboarding/judgement.js';
import { runAutoOnboarding } from '../../onboarding/auto.js';
import { findProjectByAlias, listProjects, resolveProject } from '../../store/projects.js';

/**
 * Cairn MCP stdio 服务器（任务 5.2）：
 * - stdout 只输出 JSON-RPC 协议消息（由 SDK 写入）；一切日志/诊断走 stderr。
 * - 有界本地操作 + 任务入队；退出前不要求完成任何后台任务。
 * - memory_propose 只生成候选；user_confirmed 等声明字段不被信任。
 * - onboarding 工具仅在存在待整理批次时暴露（按需工具面）。
 */

const TOOL_NAMES = [
  'memory_context',
  'memory_search',
  'memory_get',
  'memory_add',
  'memory_propose',
  'memory_promote',
  'memory_reject',
  'memory_update',
  'memory_forget',
  'memory_status',
  'memory_audit',
  'memory_annotations_list',
  'memory_annotation_resolve',
  'revision_propose',
  'revision_list',
  'project_resolve',
  'project_list',
] as const;

const ONBOARDING_TOOLS = ['onboarding_status', 'onboarding_next_batch', 'onboarding_propose', 'onboarding_apply'] as const;

/** AI 复核通道：与 CLI 的 `cairn review pack|submit|list` 共用同一实现与校验。 */
const REVIEW_ACTIONS = ['pack', 'submit', 'list'] as const;

function toolDef(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
): { name: string; description: string; inputSchema: { type: 'object'; properties: Record<string, unknown>; required: string[] } } {
  return { name, description, inputSchema: { type: 'object', properties, required } };
}

/**
 * onboarding 工具面判定（fix-onboarding-tool-surface-flip）：
 * 存在已导入未晋升条目时才暴露 onboarding 工具（按需工具面）。
 * 判定失败按无待整理条目降级（fail-closed）并写 stderr 日志——server 不因判定失败拒启。
 */
export function resolveOnboardingActive(service: { doctor(): unknown }): boolean {
  try {
    const d = service.doctor() as { counts?: { importItems?: { clean?: number } } };
    return (d.counts?.importItems?.clean ?? 0) > 0;
  } catch (err) {
    process.stderr.write(`[cairn-mcp] onboarding 工具面判定失败，按无待整理条目降级：${String(err)}\n`);
    return false;
  }
}

export function createServer(home?: string): Server {
  // MCP 调用方是 Agent 通道：受作用域约束（CLI 是 user 通道，数据主权者）
  process.env['CAIRN_CHANNEL'] = 'agent';
  const service = AppService.open(home);
  const server = new Server(
    { name: 'cairn', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  // 工具面在进程生命周期内冻结：判定只在启动时执行一次，ListTools 结果必须字节稳定。
  // 运行中库状态翻转（另一进程 import、会话内治理动作）不得增减工具——重启（stdio 即新会话）才重估。
  const onboardingToolsActive = resolveOnboardingActive(service);

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = [
      toolDef(
        'memory_context',
        '返回当前上下文可用的启动/任务记忆（按作用域过滤的 active 记忆，条目为有界预览）。仅在任务确实需要历史偏好、决策和项目事实时调用；需要全文时用 memory_get 取详情。',
        {
          query: { type: 'string', description: '可选的主题关键词' },
          limit: { type: 'number', description: '默认 10，上限 50' },
          project_id: { type: 'string' },
        },
        [],
      ),
      toolDef(
        'memory_search',
        '按关键词检索记忆预览（有界摘要 + 截断标记 + 原文长度，不返回全文）。两段式纪律：先看预览判断相关性，确需全文再调 memory_get 取详情（支持唯一 id 前缀与 ids 批量）。',
        {
          query: { type: 'string' },
          status: { type: 'string', description: '默认 active；candidate/conflicted 需显式' },
          limit: { type: 'number' },
          project: { type: 'string', description: '可选项目身份（UUID 或已登记路径/git URL）；携带后项目作用域记忆可被召回。未登记的别名会报错——登记走 project_resolve。' },
          increment_usage: {
            type: 'boolean',
            description: '默认 true。宿主插件自动召回必须传 false——注入不计「被主动请求」。',
          },
        },
        ['query'],
      ),
      toolDef(
        'memory_get',
        '读取记忆的完整内容、修订历史与证据。id 接受完整标识或唯一前缀（≥8 字符，歧义时报候选）；传 ids 数组可批量获取（上限 10，逐条作用域检查）。',
        { id: { type: 'string' }, ids: { type: 'array', items: { type: 'string' }, description: '批量获取（上限 10）；与 id 二选一' } },
        ['id'],
      ),
      toolDef(
        'memory_add',
        '显式新增记忆。只在用户明确要求"记住/更正"时调用；写入内容成为 user_explicit 活动记忆。建议随写入一并给出 judgement：你已在上下文里，判断比事后复查更准，也不额外多一轮会话。',
        {
          content: { type: 'string' },
          kind: { type: 'string', enum: [...MEMORY_KINDS] },
          sensitive: { type: 'boolean' },
          scope_preset: { type: 'string', description: '默认 personal-global；device-local/project-global 等' },
          project_id: { type: 'string' },
          judgement: {
            type: 'object',
            description:
              '写入时判断（建议，非授权）：只能影响"值不值得记"，不能改敏感度/作用域，也不构成审批。同作用域已有相同正文时默认并入既有记忆而不新建；判为不值得记（verdict=skip 且 confidence=high）则本次不写入。',
            properties: {
              verdict: { type: 'string', description: 'keep | skip | merge_into:<记忆id>' },
              confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
              rationale: { type: 'string', description: '一句话理由，不能为空' },
              dedupe: { type: 'string', enum: ['merge', 'keep_both'], description: '默认 merge；keep_both 表示显式要求两条并存' },
            },
            required: ['verdict', 'confidence', 'rationale'],
          },
        },
        ['content'],
      ),
      toolDef(
        'memory_propose',
        '提交模型推断的候选记忆（进入待审查队列，不会直接成为活动记忆，不会覆盖用户明确记忆）。',
        {
          content: { type: 'string' },
          kind: { type: 'string', enum: [...MEMORY_KINDS] },
          importance: {
            type: 'integer',
            description: '重要度 1-5（值不值占用注入预算，与可信度无关）。推断来源上限 3。',
          },
        },
        ['content'],
      ),
      toolDef(
        'memory_promote',
        '把待审查候选晋升为活动记忆（用户已批准）。权威记为 user_confirmed；可同时指定作用域（含本机路径的内容应落 device-local）。',
        {
          id: { type: 'string' },
          scope_preset: {
            type: 'string',
            description: '可选：晋升时一并迁移作用域（personal-global / device-local / ...）',
          },
          project_id: { type: 'string' },
        },
        ['id'],
      ),
      toolDef(
        'memory_reject',
        '拒绝一条候选（转为墓碑，可审计、可恢复）。仅当用户明确表示不要这条记忆时调用。',
        { id: { type: 'string' }, reason: { type: 'string', description: '拒绝理由，不能为空' } },
        ['id', 'reason'],
      ),
      toolDef(
        'memory_update',
        '对既有记忆追加新修订（不无痕覆盖历史）。仅当用户明确更正时调用。',
        { id: { type: 'string' }, content: { type: 'string' }, reason: { type: 'string' } },
        ['id', 'content'],
      ),
      toolDef(
        'memory_forget',
        '遗忘一条记忆（生成可审计 tombstone）。仅当用户明确要求遗忘时调用。',
        { id: { type: 'string' }, reason: { type: 'string' } },
        ['id'],
      ),
      toolDef('memory_status', '返回本地库健康摘要：各状态计数、冲突数、待处理任务、设备状态。', {}, []),
      toolDef(
        'memory_audit',
        '只读查询本地审计事件（摘要级：时间/类目/动作/对象/计数，不含查询原文与记忆正文）。支持 category/action/since/limit 过滤。',
        {
          category: { type: 'string', description: '类目过滤，如 operation / memory' },
          action: { type: 'string', description: '动作过滤，如 memory_search / added' },
          since: { type: 'string', description: 'ISO 时间下界（含）' },
          limit: { type: 'number', description: '条数上限，默认 50、最大 200' },
        },
        [],
      ),
      toolDef(
        'memory_annotations_list',
        '读取用户在本地控制台写下的记忆批注（处置意见）。只返回记忆标识、类别、意见与状态摘要，不返回记忆正文全文；要改正文请另行 memory_get。',
        {
          disposition: { type: 'string', enum: [...DISPOSITIONS], description: '按处置类别过滤' },
          status: { type: 'string', enum: [...ANNOTATION_STATUSES], description: '默认全部；open 只看待办' },
          limit: { type: 'number', description: '条数上限，默认 50、最大 200' },
        },
        [],
      ),
      toolDef(
        'memory_annotation_resolve',
        '把一条批注标记为已处置或忽略，并记录处置者与时间。只能改批注状态，不能改记忆正文或删除记忆。',
        {
          id: { type: 'string' },
          status: { type: 'string', enum: [...RESOLVE_STATUSES], description: 'resolved=已处置，ignored=忽略' },
        },
        ['id', 'status'],
      ),
      toolDef(
        'revision_propose',
        '把「改什么、为什么改」写成一张修订提案（方案卡），落盘等待用户确认后由本地入口执行。你只有提案权：生成后记忆不会改变，你没有应用提案的工具。适用场景：针对用户批注（memory_annotations_list）给出具体修订方案。拟改正文与理由会做秘密/注入扫描，命中拒绝生成。',
        {
          memory_id: { type: 'string' },
          after_content: { type: 'string', description: '拟改后的完整正文（不是 diff）' },
          reason: { type: 'string', description: '改动理由，引用批注或用户诉求' },
          annotation_id: { type: 'string', description: '可选：关联的批注 id' },
        },
        ['memory_id', 'after_content', 'reason'],
      ),
      toolDef(
        'revision_list',
        '读取修订提案（方案卡）列表。默认只返回待审（pending）；可按状态与记忆过滤。返回改前摘要与拟改后完整正文。应用与拒绝是人的动作，工具面不提供。',
        {
          status: { type: 'string', enum: ['pending', 'applied', 'rejected', 'stale', 'all'], description: '默认 pending（待审）' },
          memory_id: { type: 'string' },
          limit: { type: 'number' },
        },
        [],
      ),
      toolDef(
        'project_resolve',
        '把路径或 git 远程地址解析为稳定的项目标识（UUID）。未登记过的会自动登记为新项目；不要求路径在本机存在。git 的 https/ssh 写法与路径的大小写、分隔符差异会被归一。',
        {
          path_or_url: { type: 'string', description: '项目根路径或 git 远程地址' },
          name: { type: 'string', description: '新建时的显示名；命中已有项目时不覆盖原显示名' },
        },
        ['path_or_url'],
      ),
      toolDef('project_list', '列出已登记的项目及其别名（只读，不会新建项目）。', {}, []),
    ];
    if (onboardingToolsActive) {
      tools.push(
        toolDef(
          'onboarding_status',
          '首次初始化：返回当前批次与待整理条目进度。只在用户明确要求初始化记忆时使用。',
          {},
          [],
        ),
        toolDef(
          'onboarding_next_batch',
          '首次初始化：取下一批已授权待整理条目（有界），供生成 add/merge/keep_both/skip 建议。',
          { limit: { type: 'number' } },
          [],
        ),
        toolDef(
          'onboarding_propose',
          '首次初始化：把本批建议（add/merge/keep_both/skip）提交为治理计划。只保存计划，不晋升；等待用户本地审批。',
          {
            batch_id: { type: 'string', description: '默认当前活跃批次' },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  content: { type: 'string' },
                  kind: { type: 'string', enum: [...MEMORY_KINDS] },
                  opHint: { type: 'string', description: 'add|merge|keep_both|skip' },
                  targetMemoryId: { type: 'string' },
                  reason: { type: 'string' },
                },
                required: ['content'],
              },
            },
          },
          ['items'],
        ),
        toolDef(
          'onboarding_apply',
          '首次初始化：应用已获本地审批（cairn approve 签发的 approval_id）的治理计划。调用方声明 user_confirmed 无效。',
          { plan_id: { type: 'string' }, approval_id: { type: 'string' } },
          ['plan_id', 'approval_id'],
        ),
        toolDef(
          'memory_review',
          'AI 复核通道：pack 生成复核包（会把条目正文交给模型读取，返回条数与字符量）、submit 写回你的判定（任一不合法即整批拒绝）、list 查看已写回的建议。动作取值同治理层：promote/merge/keep_both/skip/needs_human。',
          {
            action: { type: 'string', enum: [...REVIEW_ACTIONS] },
            batch_id: { type: 'string', description: '默认当前活跃批次' },
            out_file: { type: 'string', description: 'pack 的输出路径' },
            max_chars_per_item: { type: 'number', description: 'pack 单条正文字符上限，默认 1200' },
            run_id: { type: 'string', description: 'submit 时带上 pack 返回的 runId' },
            items: {
              type: 'array',
              description: 'submit 的判定数组',
              items: {
                type: 'object',
                properties: {
                  itemId: { type: 'string' },
                  action: { type: 'string', enum: ['promote', 'merge', 'keep_both', 'skip', 'needs_human'] },
                  reason: { type: 'string' },
                  targetMemoryId: { type: 'string' },
                },
                required: ['itemId', 'action'],
              },
            },
            item_id: { type: 'string', description: 'list 可按条目过滤' },
          },
          ['action'],
        ),
      );
    }
    // 自动整理通道：常驻暴露，因为 auto 可对指定批次运行，不依赖"当前有活跃批次"。
    tools.push(
      toolDef(
        'memory_decide',
        '自动整理通道（只服务没有在场写入方的存量导入条目）：next 取下一包待判断条目，submit 写回判断（含 confidence），auto 按已签发策略应用、其余转人工。本工具不能签发策略——策略只能在 cairn policy sign 或本机控制台签发；也不接受 channel 参数。',
        {
          action: { type: 'string', enum: ['next', 'submit', 'auto'] },
          batch_id: { type: 'string', description: '默认当前活跃批次' },
          limit: { type: 'number', description: 'next 的条目上限，默认 10' },
          items: {
            type: 'array',
            description: 'submit 的判断数组',
            items: {
              type: 'object',
              properties: {
                itemId: { type: 'string' },
                action: { type: 'string', enum: ['promote', 'merge', 'keep_both', 'skip', 'needs_human'] },
                reason: { type: 'string' },
                targetMemoryId: { type: 'string' },
                confidence: { type: 'string', enum: ['high', 'medium', 'low'], description: '默认 low；策略的 minConfidence 依赖它' },
              },
              required: ['itemId', 'action', 'reason'],
            },
          },
          model: { type: 'string', description: 'submit 时记录产出模型' },
          policy_id: { type: 'string', description: 'auto 必填：本机已签发的策略 id' },
          dry_run: { type: 'boolean', description: 'auto 只分档不写库' },
        },
        ['action'],
      ),
    );
    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
    const name = request.params.name;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    try {
      const result = await handleTool(service, name, args);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (e) {
      if (isCairnError(e)) {
        // 治理拒绝是正常的工具结果（isError 标记），不是协议错误；细节只含 masked
        return { isError: true, content: [{ type: 'text', text: JSON.stringify(e.toJSON()) }] };
      }
      throw e;
    }
  });

  // 进程退出：不做任何后台等待（design D9）
  const closeService = (): void => {
    try {
      service.close();
    } catch {
      /* 忽略关闭错误 */
    }
  };
  process.on('exit', closeService);
  process.on('SIGINT', () => {
    closeService();
    process.exit(0);
  });

  return server;
}

const PROJECT_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 项目身份参数解析（add-project-scope-recall D1）：UUID 直接使用（不存在时沿用既有
 * 静默空结果语义）；路径/URL 归一化后**只查不建**，未登记报错并指引 project_resolve。
 * 检索保持读语义纯度：登记只发生在 project_resolve（显式动作）。
 */
function resolveProjectArg(service: AppService, raw: unknown): string | null {
  if (raw == null || raw === '') return null;
  const value = String(raw);
  if (PROJECT_UUID_RE.test(value)) return value;
  const found = findProjectByAlias(service.store.db, value);
  if (!found) {
    throw err('E_NOT_FOUND', `项目别名未登记，请先经 project_resolve 登记: ${value}`, { project: value, hint: 'project_resolve' });
  }
  return found;
}

async function handleTool(service: AppService, name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'memory_context': {
      const query = typeof args['query'] === 'string' ? args['query'] : '';
      const limit = Math.min(Number(args['limit'] ?? 10) || 10, 50);
      if (query) {
        const r = service.search({
          text: query,
          query: { deviceId: service.caller.deviceId, agentId: service.caller.agentId, projectId: resolveProjectArg(service, args['project_id']) },
          limit,
        });
        return {
          why_recalled: 'query_match',
          items: r.results.map((h) => summarize(h.memory, { matchedBy: h.matchedBy, scopePreset: h.scopePreset, syncPolicy: h.syncPolicy })),
        };
      }
      // 无查询：返回最近更新的 active 记忆作为启动层（同一 scope 行，取一次带全量条目）
      const store = service.store;
      const scope = service.resolveScope(undefined);
      const recent = store.memories.list({ scopeId: scope.id, status: 'active', limit });
      return {
        why_recalled: 'recent_active',
        items: recent.map((m) => summarize(m, { scopePreset: scope.preset, syncPolicy: scope.syncPolicy })),
      };
    }

    case 'memory_search': {
      const r = service.search(
        {
          text: String(args['query'] ?? ''),
          query: { deviceId: service.caller.deviceId, agentId: service.caller.agentId, projectId: resolveProjectArg(service, args['project']) },
          statuses: args['status'] ? [String(args['status']) as never] : undefined,
          limit: args['limit'] != null ? Number(args['limit']) : undefined,
        },
        // 插件自动召回传 false：注入不计「被主动请求」，否则注入频率会污染排序
        // （add-memory-importance-and-usage-signal D5）。
        { incrementUsage: args['increment_usage'] !== false },
      );
      return { matchedBy: r.matchedBy, degraded: r.degraded, items: r.results.map((h) => summarize(h.memory, { matchedBy: h.matchedBy, conflictId: h.conflictId, unverifiableImport: h.unverifiableImport, scopePreset: h.scopePreset, syncPolicy: h.syncPolicy })) };
    }

    case 'memory_get': {
      // 批量：ids（≤10，逐条作用域检查）；单条：id（完整或唯一前缀）。
      const ids = Array.isArray(args['ids']) ? (args['ids'] as unknown[]).map((x) => String(x)) : null;
      if (ids) return service.showMemories(ids);
      return service.showMemory(String(args['id']));
    }

    case 'memory_add': {
      const judgementRaw = args['judgement'];
      const judgement = judgementRaw == null ? null : parseJudgement(judgementRaw);
      const r = service.addMemory(
        {
          content: String(args['content'] ?? ''),
          kind: args['kind'] as MemoryKind | undefined,
          sensitivity: args['sensitive'] === true ? 'sensitive' : 'normal',
          scope: {
            preset: args['scope_preset'] as never,
            projectId: args['project_id'] as string | undefined,
          },
        },
        { judgement },
      );
      if (r.action === 'skip') {
        return {
          written: false,
          action: r.action,
          basis: r.basis,
          note: '按判断未写入。判断是建议：如需写入，改用 verdict=keep 重新提交。',
        };
      }
      const m = r.memory!;
      return {
        id: m.id,
        status: m.status,
        authority: m.authority,
        action: r.action,
        basis: r.basis,
        duplicateOf: r.duplicateOf,
      };
    }

    case 'memory_propose': {
      const m = service.proposeCandidate({
        content: String(args['content'] ?? ''),
        kind: args['kind'] as MemoryKind | undefined,
        importance: args['importance'] != null ? Number(args['importance']) : undefined,
      });
      return { id: m.id, status: m.status, authority: m.authority, note: '候选已保存，等待用户审查；不会自动晋升' };
    }

    case 'memory_promote': {
      const r = service.promoteCandidate(String(args['id'] ?? ''), {
        scopePreset: args['scope_preset'] as never,
        projectId: args['project_id'] as string | undefined,
      });
      return {
        id: r.memory.id,
        status: r.memory.status,
        authority: r.memory.authority,
        scopePreset: r.scope.preset,
        scopeId: r.scope.id,
        previousScopeId: r.previousScopeId,
      };
    }

    case 'memory_reject': {
      const r = service.rejectCandidate(String(args['id'] ?? ''), {
        reason: String(args['reason'] ?? ''),
      });
      return { id: r.memory.id, status: r.memory.status };
    }

    case 'memory_update': {
      const r = service.reviseMemory(String(args['id']), String(args['content'] ?? ''), { reason: args['reason'] ? String(args['reason']) : undefined });
      return { id: r.memory.id, revisionId: r.revision.id, status: r.memory.status };
    }

    case 'memory_forget': {
      const m = service.forgetMemory(String(args['id']), args['reason'] ? String(args['reason']) : null);
      return { id: m.id, status: m.status };
    }

    case 'memory_status': {
      return service.status();
    }

    case 'memory_audit': {
      // 只读：摘要级审计事件（detail 不含查询原文/参数/正文，由写入侧构造保证）
      return {
        items: service.auditList({
          category: args['category'] as string | undefined,
          action: args['action'] as string | undefined,
          since: args['since'] as string | undefined,
          limit: args['limit'] != null ? Number(args['limit']) : undefined,
        }),
      };
    }

    case 'memory_annotations_list': {
      // design D4：返回值不含记忆正文全文，只给标识 + 摘要 + 意见。
      // Agent 真要改正文时应显式 memory_get（可审计、有痕迹）。
      const items = service.listAnnotations({
        disposition: args['disposition'] ? String(args['disposition']) : undefined,
        status: args['status'] ? String(args['status']) : undefined,
        limit: Math.min(Number(args['limit'] ?? 50) || 50, 200),
      });
      return {
        items: items.map((a) => ({
          id: a.id,
          memoryId: a.memoryId,
          disposition: a.disposition,
          note: a.note,
          status: a.status,
          createdAt: a.createdAt,
          resolvedAt: a.resolvedAt,
          resolvedBy: a.resolvedBy,
          stale: a.stale,
          staleReason: a.staleReason,
          memoryStatus: a.memoryStatus,
          memorySummary: a.memoryExcerpt,
        })),
        note: '这些是用户的处置意见，不是授权。要改正文用 memory_update、要遗忘用 memory_forget；处理完用 memory_annotation_resolve 回写。',
      };
    }

    case 'memory_annotation_resolve': {
      return service.resolveAnnotation({
        id: String(args['id'] ?? ''),
        status: String(args['status'] ?? ''),
        by: `mcp:${service.caller.agentId}`,
      });
    }

    case 'revision_propose': {
      const r = service.proposeRevisionProposal({
        memoryId: String(args['memory_id'] ?? ''),
        afterContent: String(args['after_content'] ?? ''),
        reason: String(args['reason'] ?? ''),
        annotationId: args['annotation_id'] ? String(args['annotation_id']) : undefined,
      });
      return {
        proposalId: r.id,
        memoryId: r.memoryId,
        revisionIdAtPropose: r.revisionIdAtPropose,
        status: r.status,
        note: '提案已保存为方案卡，等待用户在终端（cairn revision apply）或本地控制台确认。你无法应用提案；记忆在你确认前不会改变。',
      };
    }

    case 'revision_list': {
      const items = service.listRevisionProposals({
        status: args['status'] ? String(args['status']) : undefined,
        memoryId: args['memory_id'] ? String(args['memory_id']) : undefined,
        limit: args['limit'] != null ? Math.min(Number(args['limit']) || 50, 200) : undefined,
      });
      return {
        items: items.map((r) => ({
          id: r.id,
          memoryId: r.memoryId,
          status: r.status,
          stale: r.stale,
          beforeExcerpt: r.beforeExcerpt,
          afterContent: r.afterContent,
          reason: r.reason,
          annotationId: r.annotationId,
          proposedBy: r.proposedBy,
          proposedAt: r.proposedAt,
        })),
        note: '方案卡只是待执行的意图，采纳必须由人完成（CLI / 控制台）。陈旧（stale）卡片应重新生成而不是坚持应用。',
      };
    }

    case 'project_resolve': {
      const raw = String(args['path_or_url'] ?? '').trim();
      if (raw === '') throw new CairnError('E_VALIDATION', 'path_or_url 不能为空');
      return resolveProject(service.store.db, raw, { name: args['name'] ? String(args['name']) : undefined });
    }

    case 'project_list': {
      const items = listProjects(service.store.db);
      return { count: items.length, items };
    }

    case 'onboarding_status': {
      const batchId = service.activeBatchId();
      if (!batchId) return { activeBatch: null, note: '没有待整理批次' };
      return { ...service.batchStatus(batchId) };
    }

    case 'onboarding_next_batch': {
      const batchId = service.activeBatchId();
      if (!batchId) throw new CairnError('E_VALIDATION', '没有待整理批次；请先通过 CLI 导入来源');
      const limit = Math.min(Number(args['limit'] ?? 10) || 10, 50);
      return { batchId, items: service.batchChunk(batchId, limit) };
    }

    case 'onboarding_propose': {
      const items = (args['items'] as { content: string; kind?: string; opHint?: string; targetMemoryId?: string; reason?: string }[] | undefined) ?? [];
      if (items.length === 0) throw new CairnError('E_VALIDATION', 'items 不能为空：请对批次条目给出 add/merge/keep_both/skip 建议');
      const r = service.proposeForBatch({
        batchId: args['batch_id'] ? String(args['batch_id']) : undefined,
        items: items.map((i) => ({
          content: String(i.content ?? ''),
          kind: i.kind as never,
          opHint: i.opHint as never,
          targetMemoryId: i.targetMemoryId,
          reason: i.reason,
        })),
        proposedBy: `mcp:${service.caller.agentId}`,
      });
      return {
        planId: r.plan.id,
        planHash: r.planHash,
        status: r.plan.status,
        accepted: r.accepted,
        rejected: r.rejected,
        duplicates: r.duplicates,
        note: '计划等待用户在本地 CLI 审批（cairn approve）。批准后才能用 onboarding_apply 应用。',
      };
    }

    case 'onboarding_apply': {
      const planId = String(args['plan_id'] ?? '');
      const approvalId = String(args['approval_id'] ?? '');
      if (!planId || !approvalId) throw new CairnError('E_VALIDATION', '需要 plan_id 与 approval_id（approval 由本地 CLI cairn approve 签发）');
      const r = service.applyPlan(planId, approvalId);
      return { ...r, note: '已按一次性审批应用；调用方声明的 user_confirmed 不构成授权' };
    }

    case 'memory_decide': {
      // 刻意不接受策略内容、不接受 channel：签发能力不在这条通道上。
      const action = String(args['action'] ?? '');
      const batchId = args['batch_id'] ? String(args['batch_id']) : undefined;
      if (action === 'next') {
        const batch = batchId ?? service.activeBatchId();
        if (!batch) return { batchId: null, items: [], note: '没有待整理的批次' };
        const chunk = service.batchChunk(batch, args['limit'] != null ? Number(args['limit']) : 10);
        return {
          batchId: batch,
          items: chunk,
          note: '判断完用 action=submit 写回（记得给 confidence）；全部判断完再 action=auto 按策略应用。',
        };
      }
      if (action === 'submit') {
        const items = Array.isArray(args['items']) ? (args['items'] as unknown[]) : [];
        return reviewSubmit(service.store, {
          items,
          producer: 'mcp',
          model: args['model'] ? String(args['model']) : null,
        });
      }
      if (action === 'auto') {
        const policyId = args['policy_id'] ? String(args['policy_id']) : '';
        if (!policyId) {
          throw new CairnError('E_VALIDATION', 'auto 需要 policy_id；策略只能用 cairn policy sign 或本机控制台签发');
        }
        return runAutoOnboarding(service.store, {
          policyId,
          batchId,
          dryRun: args['dry_run'] === true,
        });
      }
      throw new CairnError('E_VALIDATION', 'action 只允许 next / submit / auto');
    }

    case 'memory_review': {
      const action = String(args['action'] ?? '');
      const batchId = args['batch_id'] ? String(args['batch_id']) : undefined;
      if (action === 'pack') {
        const r = reviewPackForBatch(service.store, {
          batchId,
          outFile: args['out_file'] ? String(args['out_file']) : undefined,
          maxCharsPerItem: args['max_chars_per_item'] != null ? Number(args['max_chars_per_item']) : undefined,
        });
        return {
          ...r,
          note: '接下来你会读到这些条目正文；判断完用 action=submit 写回。写回只是建议，晋升仍需本地审批。',
        };
      }
      if (action === 'submit') {
        const items = Array.isArray(args['items']) ? (args['items'] as unknown[]) : [];
        const r = reviewSubmit(service.store, {
          items,
          producer: `mcp:${service.caller.agentId}`,
          runId: args['run_id'] ? String(args['run_id']) : undefined,
        });
        return { ...r, note: '已写回建议层；不影响规则层结论，也不产生任何晋升。' };
      }
      if (action === 'list') {
        return readReviews(service.store, {
          batchId,
          itemId: args['item_id'] ? String(args['item_id']) : undefined,
        });
      }
      throw new CairnError('E_VALIDATION', `action 必须是 ${REVIEW_ACTIONS.join('/')}`);
    }

    default:
      throw new CairnError('E_VALIDATION', `未知工具: ${name}`);
  }
}

function summarize(
  m: {
    id: string;
    kind: string;
    status: string;
    authority: string;
    content: string;
    scopeId: string;
    updatedAt: string;
    sensitivity?: string;
    importance?: number | null;
    usageCount?: number;
  },
  extra: { matchedBy?: string; conflictId?: string; unverifiableImport?: boolean; scopePreset?: string; syncPolicy?: string },
): unknown {
  return {
    id: m.id,
    kind: m.kind,
    status: m.status,
    authority: m.authority,
    scopeId: m.scopeId,
    updated_at: m.updatedAt,
    // 重要度与使用次数随检索结果带出：面板要显示「这条为什么被选中」，
    // 不带出来就只能显示内容（add-memory-importance-and-usage-signal tasks 8.2.3）。
    importance: m.importance ?? null,
    usage_count: m.usageCount ?? 0,
    // 作用域边界属性随条目带出（add-memory-scope-visibility）：人读 preset 名 +
    // 敏感度 + 同步策略，让插件注入闸与面板徽章不靠猜。scope 行缺失时字段缺省
    // （JSON 序列化丢 undefined 键）——插件闸对缺失字段按不可注入处理（fail-closed）。
    sensitivity: m.sensitivity ?? 'normal',
    scope_preset: extra.scopePreset,
    sync_policy: extra.syncPolicy,
    // add-two-stage-memory-recall：列表条目返回有界预览而非全文（spec scoped-retrieval
    // 「检索列表返回有界预览而非全文」）；全文只经 memory_get。
    ...(() => {
      const pv = memoryPreview(m.content);
      return { preview: pv.preview, truncated: pv.truncated, content_length: pv.contentLength };
    })(),
    ...(extra.matchedBy ? { matched_by: extra.matchedBy } : {}),
    ...(extra.conflictId ? { conflict_id: extra.conflictId } : {}),
    ...(extra.unverifiableImport ? { unverifiable_import: true } : {}),
  };
}

export async function runMcpServer(home?: string): Promise<void> {
  const server = createServer(home);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`[cairn-mcp] stdio server ready (pid ${process.pid})\n`);
  // 保持进程运行直到客户端断开（transport 关闭时 exit 事件触发 service close）
  process.exitCode = ExitCode.success;
}

// 直接执行时启动（被测试导入时不自动执行）；解析 --home 与 CAIRN_HOME
if (process.argv[1] != null && /mcp[\\/]server\.(js|ts)$/.test(process.argv[1].replace(/\\/g, '/'))) {
  const homeIdx = process.argv.indexOf('--home');
  const home = homeIdx > 0 ? process.argv[homeIdx + 1] : undefined;
  void runMcpServer(home);
}
