import { createHash } from 'node:crypto';

/** 小写十六进制 sha256；所有 hash 字段统一使用该形态。 */
export function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * 规范化 JSON：键递归排序、无空白。计划哈希（plan_hash）与内容哈希
 * 必须基于规范化形态，字段顺序或空白变化不得影响结果（任务 3.1）。
 */
export function canonicalJson(value: unknown): string {
  return canonicalize(value);
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map((v) => canonicalize(v ?? null)).join(',') + ']';
  }
  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize(obj[k])).join(',') + '}';
  }
  throw new TypeError(`canonicalJson: unsupported type ${typeof value}`);
}

export function sha256Canonical(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

/**
 * 正文规范化：NFC、去首尾空白、压缩连续空白。用于内容去重哈希；
 * 原始正文始终单独保留（design D5：保留原始正文）。
 */
export function normalizeContent(text: string): string {
  return text.normalize('NFC').trim().replace(/\s+/g, ' ');
}

export function contentHash(text: string): string {
  return sha256Hex(normalizeContent(text));
}
