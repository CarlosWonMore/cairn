import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { homedir } from 'node:os';

/**
 * 控制台安全边界（design D6）。
 *
 * 威胁模型承认一件事：本机任何进程、任何浏览器页面都能向 127.0.0.1 发请求。
 * 因此这里做四道确定性校验，任何一道失败都不返回正文：
 *   1. Host 白名单（防 DNS rebinding）
 *   2. 一次性会话令牌（防同机其他页面盲发）
 *   3. Origin / Sec-Fetch-Site 校验（防跨源 POST）
 *   4. 写操作必须 POST + 令牌（GET 永不改状态）
 *
 * 另一件事同样要承认：浏览器通道无法证明"点击的是人"。
 * 令牌只证明"发请求的进程拿到过启动时那行 URL"，不证明签名者身份——
 * 所以审批仍要求在页面内重抄 plan_hash 前 8 位，那道读动作才是防误签的关键。
 */

/** 正文视图：要么带原文，要么只有掩码元数据。二者不会同时出现。 */
export interface ContentView {
  masked: boolean;
  text: string | null;
  length: number;
  hashPrefix: string;
  truncated: boolean;
}

export interface ContentViewOptions {
  /** true 时只给长度与哈希前缀，text 恒为 null。 */
  masked?: boolean;
  /** 大于 0 时裁切到该字符数；0/undefined 表示不裁。 */
  maxChars?: number;
  /** 已算好的内容哈希（避免重复计算）；缺省时由 text 计算。 */
  hash?: string | null;
}

/** 掩码占位符：稳定、不可逆、能看出"这里原本有内容"。 */
export const MASK_CHAR = '•';

export function contentView(text: string, opts: ContentViewOptions = {}): ContentView {
  const length = text.length;
  const hashPrefix = (opts.hash ?? hashOf(text)).slice(0, 12);
  if (opts.masked === true) {
    return { masked: true, text: null, length, hashPrefix, truncated: false };
  }
  const max = opts.maxChars ?? 0;
  if (max > 0 && length > max) {
    return { masked: false, text: text.slice(0, max), length, hashPrefix, truncated: true };
  }
  return { masked: false, text, length, hashPrefix, truncated: false };
}

/** 掩码块的可读形式（HTML 渲染与 stdout 提示共用）。 */
export function maskBlock(view: ContentView): string {
  return `${MASK_CHAR.repeat(Math.min(12, Math.max(3, Math.ceil(view.length / 40))))} (${view.length} 字符, #${view.hashPrefix})`;
}

/**
 * 来源标识脱敏：把本机绝对路径折叠成 ~ 相对形式。
 * 目的是不泄漏用户名与目录结构，不是隐藏"它来自哪个文件"。
 */
export function sanitizeLabel(label: string | null | undefined): string | null {
  if (label == null) return null;
  let out = label;
  const home = homedir();
  if (home && home.length > 2) {
    out = out.split(home).join('~');
    out = out.split(home.replace(/\\/g, '/')).join('~');
  }
  // 兜底：任何残留的 x:\Users\<name> 或 /home/<name> 形式
  out = out.replace(/[A-Za-z]:\\Users\\[^\\/]+/g, '~');
  out = out.replace(/\/home\/[^/]+/g, '~');
  out = out.replace(/\/Users\/[^/]+/g, '~');
  return out;
}

/** 路径型字段的导出脱敏：与 sanitizeLabel 同义，语义化别名供 D8 使用。 */
export const sanitizePath = sanitizeLabel;

/** 会话令牌：256 位随机，十六进制。一次性（进程生命周期）。 */
export function newToken(): string {
  return randomBytes(32).toString('hex');
}

/** 定长时间比较，避免按字节提前返回泄漏令牌前缀。 */
export function tokenEquals(a: string | undefined | null, b: string | undefined | null): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export interface GuardInput {
  method: string;
  host: string | undefined;
  origin: string | undefined;
  secFetchSite: string | undefined;
  token: string | undefined;
}

export interface GuardPolicy {
  token: string;
  /** 允许的 Host 头字面值（含端口）。 */
  allowedHosts: string[];
  /** 允许的 Origin 字面值（含协议与端口）。 */
  allowedOrigins: string[];
}

export type GuardVerdict = { ok: true } | { ok: false; status: 401 | 403; reason: string };

const SAFE_METHODS = new Set(['GET', 'HEAD']);

/**
 * 请求守卫。判定顺序刻意固定：Host → Origin → 令牌，
 * 这样"非回环 Host"永远不会先被令牌校验掩盖，诊断信息稳定可复现。
 */
export function guardRequest(input: GuardInput, policy: GuardPolicy): GuardVerdict {
  const host = (input.host ?? '').toLowerCase();
  if (!policy.allowedHosts.map((h) => h.toLowerCase()).includes(host)) {
    return { ok: false, status: 403, reason: 'host_not_allowed' };
  }
  const fetchSite = (input.secFetchSite ?? '').toLowerCase();
  if (fetchSite === 'cross-site') {
    return { ok: false, status: 403, reason: 'cross_site_blocked' };
  }
  if (input.origin != null && input.origin.length > 0) {
    const origin = input.origin.toLowerCase();
    if (!policy.allowedOrigins.map((o) => o.toLowerCase()).includes(origin)) {
      return { ok: false, status: 403, reason: 'origin_not_allowed' };
    }
  }
  if (!SAFE_METHODS.has(input.method.toUpperCase())) {
    // 写方法必须带 Origin 或至少不能缺失令牌；缺令牌一律 401。
    if (!tokenEquals(input.token, policy.token)) {
      return { ok: false, status: 401, reason: 'token_missing_or_invalid' };
    }
  } else if (!tokenEquals(input.token, policy.token)) {
    // 读也需要令牌：否则同机任意页面可 dragnet 全库。
    return { ok: false, status: 401, reason: 'token_missing_or_invalid' };
  }
  return { ok: true };
}

/** 响应头：不缓存 + 不嗅探 + 禁止被嵌入 + 严格 CSP（内联资源需 'unsafe-inline'）。 */
export function baseHeaders(contentType: string): Record<string, string> {
  return {
    'Content-Type': contentType,
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    Pragma: 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy':
      "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  };
}

/** 写操作额外要求的头集合（配合 guardRequest 使用）。 */
export const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function hashOf(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
