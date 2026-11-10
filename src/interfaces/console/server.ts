import { createServer, IncomingMessage, ServerResponse, Server } from 'node:http';
import { existsSync } from 'node:fs';
import { AppService } from '../app-service.js';
import { defaultHome, openStore, CairnStore, resolvePaths } from '../../store/open.js';
import { CairnError, err, exitCodeFor, isCairnError } from '../../core/errors.js';
import { buildModel, buildImportRows, listArchiveItems, memoryDetail, ViewMode } from './model.js';
import { baseHeaders, guardRequest, newToken } from './security.js';
import { renderShell } from './assets/page.js';
import { computeInbox, computeSuggestions } from './suggestions.js';
import { reviewPackForBatch, reviewSubmit, readReviews } from './review-store.js';
import { readAnnotations } from './annotations.js';
import { OpHint, ProposedItem } from '../../governance/propose.js';
import { promotedPredicate } from '../../onboarding/batches.js';
import { listPolicies } from '../../onboarding/policy.js';
import { revokeByPolicy, runAutoOnboarding } from '../../onboarding/auto.js';

/**
 * 本地回环控制台服务（design D2/D3/D6）。
 *
 * 三条硬约束：
 * 1. 只绑 127.0.0.1；不提供 --host 之类的放开开关。
 * 2. 读路径使用独立的**只读连接**（`openStore({ readOnly: true })`），
 *    仓储层的写守卫会把任何误写拒为 E_READONLY。写路由才惰性打开可写服务，
 *    因此"只浏览"这个动作在数据目录层面确实零写入。
 * 3. 日志只记方法、路径（去掉 query，防止令牌进日志）与状态码，绝不记正文。
 */

export interface ConsoleServerOptions {
  home?: string;
  /** 0 = 让系统分配；默认先试 7767，占用则回退随机。 */
  port?: number;
  /** 测试注入固定令牌；生产一律随机。 */
  token?: string;
  /** 页面上显示的警示横幅。 */
  banners?: string[];
}

export interface ConsoleServerHandle {
  url: string;
  /** 带令牌的完整 URL（打印给用户的那一行）。 */
  tokenUrl: string;
  token: string;
  port: number;
  host: string;
  close(): Promise<void>;
}

const DEFAULT_PORT = 7767;
const MAX_BODY_BYTES = 2 * 1024 * 1024;

export async function startConsoleServer(opts: ConsoleServerOptions = {}): Promise<ConsoleServerHandle> {
  const home = opts.home;
  const paths = resolvePaths(home ?? defaultHome());
  if (!existsSync(paths.dbPath)) {
    throw err('E_IO', `数据目录尚未初始化（${paths.dbPath} 不存在）：请先运行 cairn init`);
  }
  const token = opts.token ?? newToken();
  const readStore = openStore({ home, readOnly: true });

  // 写路径惰性打开：只浏览时不触碰 meta/device 表。
  // 一旦打开就保持到服务关闭——按请求开关会引入"关闭后仍被复用"的悬空句柄，
  // 而且重复 open 会反复迁移/校验 schema，代价远高于常驻一个连接。
  let writeService: AppService | null = null;
  const getWriteService = (): AppService => {
    if (writeService == null) writeService = AppService.open(home);
    return writeService;
  };

  let boundPort = 0;
  const state = { origin: '', allowedHosts: [] as string[], allowedOrigins: [] as string[] };

  const server = createServer((req, res) => {
    void handle(req, res).catch((e) => {
      writeJson(res, 500, { ok: false, error: { code: 'E_INTERNAL', message: '控制台内部错误' } });
      logRequest(req, 500);
      void e;
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const rawUrl = req.url ?? '/';
    const u = new URL(rawUrl, 'http://127.0.0.1');
    const queryToken = u.searchParams.get('t') ?? undefined;
    const headerToken = header(req, 'x-cairn-token');
    const verdict = guardRequest(
      {
        method: req.method ?? 'GET',
        host: header(req, 'host'),
        origin: header(req, 'origin'),
        secFetchSite: header(req, 'sec-fetch-site'),
        token: headerToken ?? queryToken,
      },
      { token, allowedHosts: state.allowedHosts, allowedOrigins: state.allowedOrigins },
    );
    if (!verdict.ok) {
      writeJson(res, verdict.status, { ok: false, error: { code: 'E_FORBIDDEN', message: verdict.reason } });
      logRequest(req, verdict.status);
      return;
    }

    const path = u.pathname.replace(/\/+$/, '') || '/';
    if (path === '/') {
      const html = renderShell({
        title: 'cairn 控制台',
        subtitle: `本地回环 · ${state.origin} · 只读预览 + 工作台`,
        banners: opts.banners,
      });
      res.writeHead(200, baseHeaders('text/html; charset=utf-8'));
      res.end(html);
      logRequest(req, 200);
      return;
    }

    if (!path.startsWith('/api')) {
      writeJson(res, 404, { ok: false, error: { code: 'E_NOT_FOUND', message: '未知路径' } });
      logRequest(req, 404);
      return;
    }

    try {
      const data = await route(path, u, req, readStore, getWriteService);
      writeJson(res, 200, { ok: true, data });
      logRequest(req, 200);
    } catch (e) {
      const { status, body } = toHttpError(e);
      writeJson(res, status, body);
      logRequest(req, status);
    }
  }

  async function route(
    path: string,
    u: URL,
    req: IncomingMessage,
    store: CairnStore,
    getWriter: () => AppService,
  ): Promise<unknown> {
    const method = (req.method ?? 'GET').toUpperCase();
    const q = u.searchParams;
    const mode = ((q.get('mode') ?? 'brief') === 'full' ? 'full' : 'brief') as ViewMode;
    const redact = q.get('redact') !== '0';

    if (method === 'GET') {
      if (path === '/api/status') {
        const model = buildModel(store, { mode: 'brief', redact });
        return {
          generatedAt: model.generatedAt,
          home: model.home,
          schemaVersion: model.schemaVersion,
          counts: model.counts,
          sync: model.sync,
          notes: model.notes,
        };
      }
      if (path === '/api/scopes') {
        return buildModel(store, { mode: 'brief', redact }).scopes;
      }
      if (path === '/api/memories') {
        const model = buildModel(store, {
          mode,
          redact,
          q: q.get('q') ?? undefined,
          scopeIds: listParam(q.get('scope')),
          statuses: listParam(q.get('status')),
          kinds: listParam(q.get('kind')),
        });
        const limit = clampInt(q.get('limit'), 1, 2000, 500);
        return {
          total: model.memories.length,
          shown: Math.min(limit, model.memories.length),
          mode,
          redacted: redact,
          memories: model.memories.slice(0, limit),
          scopes: model.scopes,
        };
      }
      if (path.startsWith('/api/memories/')) {
        const id = decodeURIComponent(path.slice('/api/memories/'.length));
        if (id.length === 0) throw err('E_VALIDATION', '缺少记忆 id');
        return memoryDetail(store, id, { mode, redact });
      }
      if (path === '/api/archives') {
        return buildModel(store, { mode: 'brief', redact }).archives;
      }
      if (/^\/api\/archives\/[^/]+\/items$/.test(path)) {
        const archiveId = decodeURIComponent(path.split('/')[3] ?? '');
        const stateParam = q.get('state');
        const scanState = stateParam === 'clean' || stateParam === 'blocked' || stateParam === 'pending' ? stateParam : undefined;
        return listArchiveItems(store, archiveId, {
          mode,
          redact,
          scanState,
          offset: clampInt(q.get('offset'), 0, 1_000_000, 0),
          limit: clampInt(q.get('limit'), 1, 500, 100),
        });
      }
      if (path === '/api/batches') {
        return buildModel(store, { mode: 'brief', redact }).batches;
      }
      if (path.startsWith('/api/batches/')) {
        const batchId = decodeURIComponent(path.slice('/api/batches/'.length));
        const exists = Number(store.db.scalar('SELECT COUNT(*) AS n FROM import_item WHERE batch_id = ?', batchId) ?? 0);
        if (exists === 0) throw err('E_NOT_FOUND', `批次不存在: ${batchId}`);
        const progress = store.db.get(
          `SELECT COUNT(*) AS total,
             SUM(CASE WHEN i.scan_state='clean' THEN 1 ELSE 0 END) AS clean,
             SUM(CASE WHEN i.scan_state='blocked' THEN 1 ELSE 0 END) AS blocked
           FROM import_item i WHERE i.batch_id = ?`,
          batchId,
        );
        const promoted = Number(
          store.db.scalar(
            `SELECT COUNT(*) AS n FROM import_item i WHERE i.batch_id = ?
               AND ${promotedPredicate('i').exists}`,
            batchId,
          ) ?? 0,
        );
        const total = Number(progress?.['total'] ?? 0);
        const clean = Number(progress?.['clean'] ?? 0);
        const blocked = Number(progress?.['blocked'] ?? 0);
        return {
          batchId,
          progress: { batchId, total, clean, blocked, promoted, remaining: Math.max(0, clean - promoted) },
          suggestions: computeSuggestions(store, { batchId, redact }),
          aiReviews: readReviews(store, { batchId }),
        };
      }
      if (path === '/api/imports') {
        return buildImportRows(store);
      }
      if (path === '/api/policies') {
        // 只列出"可签名与哈希前缀"，不吐策略正文：页面需要的只是选一个能用的，
        // 具体阈值由 CLI 签发时决定，在页面上改阈值等于绕过签发。
        return listPolicies(store.paths.home).map((p) => ({
          id: p.spec.id,
          policyHashPrefix: p.policyHash.slice(0, 8),
          signedAt: p.signedAt,
          signedVia: p.signedVia,
          revoked: p.revokedAt != null,
          note: p.spec.note,
          allowedScopes: p.spec.allowedScopes,
          maxSensitivity: p.spec.maxSensitivity,
          allowCreate: p.spec.allowCreate,
          minConfidence: p.spec.minConfidence,
        }));
      }
      if (path === '/api/plans') {
        const model = buildModel(store, { mode: 'brief', redact });
        return { plans: model.plans, approvals: model.approvals };
      }
      if (path.startsWith('/api/plans/')) {
        const id = decodeURIComponent(path.slice('/api/plans/'.length));
        const model = buildModel(store, { mode: 'brief', redact });
        const plan = model.plans.find((p) => p.id === id);
        if (!plan) throw err('E_NOT_FOUND', `计划不存在: ${id}`);
        return plan;
      }
      if (path === '/api/reviews') {
        const batchId = q.get('batch') ?? undefined;
        const itemId = q.get('item') ?? undefined;
        return {
          rule: computeSuggestions(store, { batchId, itemId, redact }),
          ai: readReviews(store, { batchId, itemId }),
        };
      }
      if (path === '/api/annotations') {
        // 空串是"未选择"（前端下拉的默认项就是空值），不能当成过滤值，
        // 否则 `?status=&disposition=` 会把所有批注都筛掉。
        const opt = (k: string): string | undefined => {
          const v = q.get(k);
          return v == null || v.trim().length === 0 ? undefined : v;
        };
        const items = readAnnotations(store, {
          memoryId: opt('memory'),
          disposition: opt('disposition'),
          status: opt('status'),
          limit: clampInt(q.get('limit'), 1, 2000, 500),
        });
        return { total: items.length, items };
      }
      if (path === '/api/inbox') {
        return computeInbox(store, {
          redact,
          limit: clampInt(q.get('limit'), 1, 500, 100),
        });
      }
      if (path === '/api/sync/status') {
        return buildModel(store, { mode: 'brief', redact }).sync;
      }
      throw err('E_NOT_FOUND', `未知 API 路径: ${path}`);
    }

    if (method === 'POST') {
      const body = await readJsonBody(req);
      if (path === '/api/reviews/run') {
        const batchId = typeof body['batchId'] === 'string' ? body['batchId'] : undefined;
        const suggestions = computeSuggestions(store, { batchId, redact: false });
        return { runId: `rule_${Date.now()}`, count: suggestions.items.length, items: suggestions.items };
      }
      if (path === '/api/reviews/pack') {
        const writer = getWriter();
        return await reviewPackForBatch(writer.store, {
          batchId: typeof body['batchId'] === 'string' ? body['batchId'] : undefined,
          outFile: typeof body['outFile'] === 'string' ? body['outFile'] : undefined,
          maxCharsPerItem: typeof body['maxCharsPerItem'] === 'number' ? body['maxCharsPerItem'] : undefined,
        });
      }
      if (path === '/api/reviews/import') {
        const writer = getWriter();
        const items = Array.isArray(body['items']) ? (body['items'] as unknown[]) : [];
        return reviewSubmit(writer.store, { items, producer: 'webui', model: typeof body['model'] === 'string' ? body['model'] : null });
      }
      if (path === '/api/annotations') {
        // 只写批注文件：不改记忆、不入 outbox。单条与批量共用一个端点，
        // 批量逐条校验、分别计数（spec「批量标记」）。
        const writer = getWriter();
        const disposition = typeof body['disposition'] === 'string' ? body['disposition'] : '';
        const note = typeof body['note'] === 'string' ? body['note'] : '';
        if (Array.isArray(body['memoryIds'])) {
          const ids = (body['memoryIds'] as unknown[]).map(String);
          return writer.annotateBatch({ memoryIds: ids, disposition, note });
        }
        const memoryId = typeof body['memoryId'] === 'string' ? body['memoryId'] : '';
        if (memoryId.length === 0) throw err('E_VALIDATION', '缺少 memoryId 或 memoryIds');
        const annotation = writer.annotateMemory({ memoryId, disposition, note });
        return { succeeded: 1, failed: [], annotations: [annotation] };
      }
      if (path === '/api/plans') {
        const writer = getWriter();
        const raw = Array.isArray(body['items']) ? (body['items'] as Record<string, unknown>[]) : [];
        return writer.proposeForBatch({
          batchId: typeof body['batchId'] === 'string' ? body['batchId'] : undefined,
          items: normalizeProposedItems(store, raw),
          proposedBy: 'webui',
        });
      }
      if (path === '/api/onboarding/auto') {
        // 页面只能"用一把已经签好的钥匙"，不能自己配钥匙：
        // 这里只接受 policyId，策略内容永远来自 <home>/policy/<id>.json。
        const writer = getWriter();
        const policyId = typeof body['policyId'] === 'string' ? body['policyId'].trim() : '';
        if (policyId.length === 0) throw err('E_VALIDATION', '缺少 policyId');
        return runAutoOnboarding(writer.store, {
          policyId,
          batchId: typeof body['batchId'] === 'string' && body['batchId'].length > 0 ? body['batchId'] : undefined,
          dryRun: body['dryRun'] === true,
          redo: body['redo'] === true,
        });
      }
      if (path === '/api/onboarding/revoke') {
        const writer = getWriter();
        const policyId = typeof body['policyId'] === 'string' ? body['policyId'].trim() : '';
        if (policyId.length === 0) throw err('E_VALIDATION', '缺少 policyId');
        return revokeByPolicy(writer.store, policyId, {
          batchId: typeof body['batchId'] === 'string' && body['batchId'].length > 0 ? body['batchId'] : undefined,
        });
      }
      const approveMatch = /^\/api\/plans\/([^/]+)\/approve$/.exec(path);
      if (approveMatch) {
        const planId = decodeURIComponent(approveMatch[1]!);
        const prefix = typeof body['planHashPrefix'] === 'string' ? body['planHashPrefix'] : '';
        const writer = getWriter();
        const plan = writer.store.plans.requireById(planId);
        // 页内要求重抄哈希前 8 位：这是"让审批者读一遍"的唯一机械约束。
        if (prefix.trim().toLowerCase() !== plan.planHash.slice(0, 8).toLowerCase()) {
          throw err('E_VALIDATION', '计划哈希前缀不匹配：请核对页面上显示的 8 位哈希后重试');
        }
        return writer.approve(planId, { channel: 'webui' });
      }
      const applyMatch = /^\/api\/plans\/([^/]+)\/apply$/.exec(path);
      if (applyMatch) {
        const planId = decodeURIComponent(applyMatch[1]!);
        const approvalId = typeof body['approvalId'] === 'string' ? body['approvalId'] : '';
        if (approvalId.length === 0) throw err('E_VALIDATION', '缺少 approvalId');
        return getWriter().applyPlan(planId, approvalId);
      }
      if (path === '/api/sync/push' || path === '/api/sync/pull') {
        const writer = getWriter();
        const out = path.endsWith('push') ? await writer.syncPushCmd() : await writer.syncPullCmd();
        return out ?? { pushed: false, note: '没有待上行任务' };
      }
      throw err('E_NOT_FOUND', `未知 API 路径: ${path}`);
    }

    throw err('E_VALIDATION', `不支持的 HTTP 方法: ${method}（读用 GET，写用 POST）`);
  }

  // 端口绑定：优先指定端口，被占用则退到系统分配（design D2/待决项 1）。
  const desired = opts.port ?? DEFAULT_PORT;
  boundPort = await listen(server, desired).catch(async (e) => {
    if (desired !== 0) return listen(server, 0);
    throw e;
  });
  const port = boundPort;
  const host = '127.0.0.1';
  state.origin = `http://${host}:${port}`;
  state.allowedHosts = [`${host}:${port}`, `localhost:${port}`];
  state.allowedOrigins = [`http://${host}:${port}`, `http://localhost:${port}`];

  return {
    url: state.origin + '/',
    tokenUrl: `${state.origin}/?t=${token}`,
    token,
    port,
    host,
    close: async () => {
      readStore.close();
      writeService?.close();
      writeService = null;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const onError = (e: NodeJS.ErrnoException) => {
      server.removeListener('listening', onListening);
      reject(e);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      const addr = server.address();
      resolve(typeof addr === 'object' && addr != null ? addr.port : port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}

function header(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name];
  if (Array.isArray(v)) return v[0];
  return v;
}

function listParam(v: string | null): string[] {
  if (v == null || v.trim().length === 0) return [];
  return v
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function clampInt(v: string | null, min: number, max: number, fallback: number): number {
  if (v == null) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX_BODY_BYTES) throw err('E_VALIDATION', '请求体过大（上限 2 MB）');
    chunks.push(buf);
  }
  if (chunks.length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw err('E_VALIDATION', '请求体不是合法 JSON');
  }
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw err('E_VALIDATION', '请求体必须是 JSON 对象');
  }
  return parsed as Record<string, unknown>;
}

function writeJson(res: ServerResponse, status: number, payload: unknown): void {
  if (res.headersSent) return;
  res.writeHead(status, baseHeaders('application/json; charset=utf-8'));
  res.end(JSON.stringify(payload));
}

/** CLI 退出码语义 → HTTP 状态码。E_NOT_FOUND 单独抬到 404，不跟着 failure 走 500。 */
export function statusForError(e: unknown): number {
  if (!isCairnError(e)) return 500;
  if (e.code === 'E_NOT_FOUND') return 404;
  switch (exitCodeFor(e.code)) {
    case 2:
      return 400;
    case 3:
      return 403;
    case 4:
      return 409;
    case 5:
      return 503;
    default:
      return 500;
  }
}

function toHttpError(e: unknown): { status: number; body: { ok: false; error: Record<string, unknown> } } {
  if (e instanceof CairnError) {
    return { status: statusForError(e), body: { ok: false, error: e.toJSON() as unknown as Record<string, unknown> } };
  }
  const message = (e as Error)?.message ?? '未知错误';
  return { status: 500, body: { ok: false, error: { code: 'E_INTERNAL', message } } };
}

/**
 * 把页面提交的草稿归一化成计划候选（design D5）。
 *
 * 页面**不回传正文**：摘要模式下它手里根本没有全文，短文模式回传也只是多一次
 * 搬运与一次被篡改的机会。所以这里按 `itemId` 从 import_item 取权威原文，
 * 页面只表达"我对哪条、想做什么动作"。
 *
 * 动作词表也不同：页面用面向人的 promote/merge/keep_both/skip，
 * 计划层用 opHint 的 add/merge/keep_both/skip。转换集中在这一处，
 * 免得两边各写一遍、然后某一侧悄悄少了一个动作。
 */
export function normalizeProposedItems(store: CairnStore, raw: Record<string, unknown>[]): ProposedItem[] {
  const OP_MAP: Record<string, OpHint> = {
    add: 'add',
    promote: 'add',
    merge: 'merge',
    keep_both: 'keep_both',
    skip: 'skip',
  };
  return raw.map((it, index) => {
    const itemId = typeof it['itemId'] === 'string' && it['itemId'].length > 0 ? it['itemId'] : undefined;
    const opRaw = typeof it['opHint'] === 'string' ? it['opHint'] : typeof it['opType'] === 'string' ? it['opType'] : '';
    const opHint = OP_MAP[opRaw];
    const kindRaw = typeof it['kind'] === 'string' ? it['kind'] : 'fact';
    let content = typeof it['content'] === 'string' ? it['content'] : '';

    if (content.trim().length === 0) {
      if (itemId == null) {
        throw err('E_VALIDATION', `第 ${index + 1} 项缺少 itemId：页面只能对已导入条目提计划`);
      }
      const row = store.db.get('SELECT content, scan_state FROM import_item WHERE id = ?', itemId);
      if (row == null) throw err('E_NOT_FOUND', `第 ${index + 1} 项的条目不存在: ${itemId}`);
      if (String(row['scan_state']) === 'blocked') {
        // 原文在导入时已被替换成占位符，物理上取不回来——不能假装能纳入计划。
        throw err('E_VALIDATION', `第 ${index + 1} 项在导入时被拦截，原文未入库，无法纳入计划`);
      }
      content = String(row['content']);
    }

    return {
      itemId,
      content,
      kind: kindRaw as ProposedItem['kind'],
      opHint,
      targetMemoryId: typeof it['targetMemoryId'] === 'string' ? it['targetMemoryId'] : undefined,
      reason: typeof it['reason'] === 'string' ? it['reason'] : undefined,
    };
  });
}

/** 日志只保留方法、路径与状态码；query 一律剔除（其中可能有令牌）。 */function logRequest(req: IncomingMessage, status: number): void {
  const raw = req.url ?? '/';
  const at = raw.indexOf('?');
  const path = at >= 0 ? raw.slice(0, at) : raw;
  process.stderr.write(`[cairn-ui] ${req.method ?? 'GET'} ${path} ${status}\n`);
}
