import { err } from './errors.js';
import { InjectionFinding, SecretFinding, SecretKind, SecretScanResult } from './types.js';

/**
 * 秘密与提示注入扫描（任务 3.5 / 构想 §12.3）。
 * 多层检测：密钥形态 + 字段名 + 连接串；已知占位符不误报。
 * 硬性约束：任何错误与报告【绝不】包含秘密原文，只有 masked 摘要与位置。
 */

interface SecretRule {
  kind: SecretKind;
  /** 命中的原始片段捕获组（通常为组 1）；用于 mask 与去重。 */
  re: RegExp;
  /** 需要同行上下文关键词才判定命中的规则（降低误报）。 */
  requiresKeyword?: boolean;
}

const KEYWORDS = /(api[_-]?key|apikey|secret|token|password|passwd|pwd|credential|auth|令牌|密钥|密码|凭据|访问令牌|私密)/i;

const PLACEHOLDER = /^(<[^>]+>|\$\{[^}]*\}|\{\{[^}]*\}\}|x{8,}|\*+|…+|your[_-].*|my[_-].*|example.*|dummy.*|fake.*|test[_-]?key.*|<your-password>|changeme|placeholder.*)$/i;

const RULES: SecretRule[] = [
  { kind: 'private_key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----|-----BEGIN OPENSSH PRIVATE KEY-----/g },
  { kind: 'aws_access_key_id', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { kind: 'aws_secret_access_key', re: /\b(?=[A-Za-z0-9/+=]{40}\b)(?![A-Za-z0-9]*AKIA)[A-Za-z0-9/+=]{40}\b/g, requiresKeyword: true },
  { kind: 'github_token', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,255}\b|\bgithub_pat_[A-Za-z0-9_]{22,255}\b/g },
  { kind: 'jwt', re: /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g },
  { kind: 'bearer_token', re: /\b(?:Bearer|bearer)\s+[A-Za-z0-9._~+/=-]{16,}\b/g },
  {
    kind: 'generic_api_key',
    re: /\b(?:sk|pk|rk)[-_][A-Za-z0-9_-]{16,}\b|\b(?:api[_-]?key|apikey|access[_-]?token|secret[_-]?key|client[_-]?secret|private[_-]?token)["']?\s*[:=]\s*["']([A-Za-z0-9._~+/=-]{12,})["']|(?:访问令牌|访问密钥|api密钥|接口密钥)["']?\s*[:=：]\s*["']([A-Za-z0-9._~+/=-]{12,})["']/gi,
  },
  {
    kind: 'password_assignment',
    re: /\b(?:password|passwd|pwd|secret|token)["']?\s*[:=]\s*["']([^"'\s{}]{6,})["']|(?:密码|口令)["']?\s*[:=：]\s*["']?([^"'\s{}]{6,})["']?/gi,
  },
  {
    kind: 'connection_string',
    re: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp|mssql):\/\/[^\s:/@]+:([^\s@/]{3,})@[^\s]+/gi,
  },
];

// 注入启发：不可信正文要求忽略规则 / 导出记忆 / 扩大权限 / 角色覆盖 / 伪造审批
interface InjectionRule {
  kind: InjectionFinding['kind'];
  rule: string;
  re: RegExp;
}

const INJECTION_RULES: InjectionRule[] = [
  {
    kind: 'ignore_instructions',
    rule: 'ignore_previous_instructions',
    re: /忽略(?:之前|上述|前面|以上)(?:的)?(?:所有|全部|任何)?(?:系统)?(?:指令|提示|规则)|无视(?:之前|上述)(?:的)?(?:指令|规则)|ignore\s+(?:all\s+)?(?:previous|prior|above)\s+(?:instructions|prompts?|rules?)|disregard\s+(?:all\s+)?(?:previous|prior)\s+instructions/i,
  },
  {
    kind: 'exfiltrate_memory',
    rule: 'exfiltrate_all_memories',
    re: /(?:把|将)?(?:全部|所有|整个)(?:记忆|库|数据).{0,6}(?:导出|上传|发送|输出|泄露)|(?:导出|上传|发送|输出|泄露).{0,6}(?:全部|所有|整个)(?:记忆|库|数据)|export\s+(?:all|the\s+entire)\s+(?:memor|data|vault)|dump\s+all\s+memor/i,
  },
  {
    kind: 'escalate_scope',
    rule: 'escalate_scope_or_permissions',
    re: /(?:扩大|提升|放宽|修改).{0,4}(?:作用域|权限|同步范围|scope)|(?:作用域|权限|同步范围).{0,6}(?:扩大|提升|放宽)|(?:升为|改成|变为)个人公共|escalate\s+(?:scope|permissions?)|broaden\s+the\s+scope|grant\s+yourself\s+permission/i,
  },
  {
    kind: 'role_override',
    rule: 'role_override',
    re: /(?:从现在起|现在)你是|(?:你)是一个(?:新的)?(?:系统|管理员|root)|ignore\s+your\s+(?:role|persona)|you\s+are\s+now\s+(?:a|an|the)\s+(?:system|admin|root|developer)/i,
  },
  {
    kind: 'fake_approval',
    rule: 'fake_user_approval',
    re: /用户(?:已经|已|已經)(?:同意|确认|批准|授权)|(?:用户|他|她)(?:已|已经)确认过了|user\s+(?:has\s+)?(?:already\s+)?(?:confirmed|approved)|treat\s+(?:this|it)\s+as\s+(?:user\s+)?(?:approved|confirmed)/i,
  },
];

function mask(raw: string): string {
  const s = raw.trim();
  if (s.length <= 4) return '***';
  return `${s.slice(0, 2)}***${s.slice(-2)}`;
}

function isPlaceholder(v: string): boolean {
  return PLACEHOLDER.test(v.trim()) || /^(A-Z{3,})$/.test(v.trim()) === true && v === v.toUpperCase() && v.length <= 12;
}

/** 扫描文本中的疑似秘密与提示注入。findings 不含原文，仅 masked 与位置。 */
export function scanText(text: string): SecretScanResult {
  const findings: SecretFinding[] = [];
  const injectionFindings: InjectionFinding[] = [];

  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.re.exec(text)) != null) {
      const raw = (m[1] ?? m[0]) as string;
      if (raw.length === 0) continue;
      if (rule.requiresKeyword) {
        const lineStart = text.lastIndexOf('\n', m.index) + 1;
        const lineEnd = text.indexOf('\n', m.index);
        const line = text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
        if (!KEYWORDS.test(line)) continue;
      }
      if (isPlaceholder(raw)) continue;
      findings.push({ kind: rule.kind, start: m.index, end: m.index + m[0].length, masked: mask(raw) });
      if (m.index === rule.re.lastIndex) rule.re.lastIndex++;
    }
  }

  for (const rule of INJECTION_RULES) {
    rule.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.re.exec(text)) != null) {
      // 去重：同一 kind 已有更早命中则跳过（只报最具体一条）
      if (injectionFindings.some((f) => f.kind === rule.kind)) break;
      injectionFindings.push({ kind: rule.kind, start: m.index, end: m.index + m[0].length, rule: rule.rule });
      if (m.index === rule.re.lastIndex) rule.re.lastIndex++;
    }
  }

  return { findings, injectionFindings, clean: findings.length === 0 && injectionFindings.length === 0 };
}

/** 供报告使用的打码切片（与 findings.masked 同策略）。 */
export function maskText(text: string, f: { start: number; end: number }): string {
  return mask(text.slice(f.start, f.end));
}

/**
 * 断言文本可进入 Agent 批次 / 存储 / 投影 / outbox。
 * 抛出的 CairnError 只含 kind/rule/位置摘要，绝不回显秘密原文。
 */
export function assertClean(text: string, context: string): void {
  const r = scanText(text);
  if (!r.clean) {
    if (r.findings.length > 0) {
      throw err('E_SECRET_DETECTED', `${context}: 检测到疑似秘密，已阻断（不回显原文）`, {
        context,
        findings: r.findings.map((f) => ({ kind: f.kind, masked: f.masked, start: f.start, end: f.end })),
      });
    }
    throw err('E_INJECTION_SUSPECTED', `${context}: 检测到疑似提示注入指令，已阻断`, {
      context,
      findings: r.injectionFindings.map((f) => ({ kind: f.kind, rule: f.rule, start: f.start, end: f.end })),
    });
  }
}
