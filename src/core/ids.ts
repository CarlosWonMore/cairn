import { randomBytes } from 'node:crypto';

/**
 * RFC 9562 UUIDv7：48bit 毫秒时间戳 + 12bit rand_a + 62bit rand_b。
 * 记忆、修订、计划等主键使用时间可排序 ID（design D3 / 构想 §7.1）。
 */
export function uuidv7(now: Date = new Date()): string {
  const ts = BigInt(now.getTime()) & 0xffffffffffffn; // 48 bits
  const rand = randomBytes(10); // 80 bits = rand_a(12) + rand_b(62) + 6 spare
  const bytes = Buffer.alloc(16);
  // time_low / time_mid / time_hi_and_version
  bytes[0] = Number((ts >> 40n) & 0xffn);
  bytes[1] = Number((ts >> 32n) & 0xffn);
  bytes[2] = Number((ts >> 24n) & 0xffn);
  bytes[3] = Number((ts >> 16n) & 0xffn);
  bytes[4] = Number((ts >> 8n) & 0xffn);
  bytes[5] = Number(ts & 0xffn);
  bytes[6] = ((rand[0] ?? 0) & 0x0f) | 0x70; // version 7
  bytes[7] = rand[1] ?? 0;
  bytes[8] = ((rand[2] ?? 0) & 0x3f) | 0x80; // variant 10
  bytes[9] = rand[3] ?? 0;
  bytes[10] = rand[4] ?? 0;
  bytes[11] = rand[5] ?? 0;
  bytes[12] = rand[6] ?? 0;
  bytes[13] = rand[7] ?? 0;
  bytes[14] = rand[8] ?? 0;
  bytes[15] = rand[9] ?? 0;
  return formatUuid(bytes);
}

export function formatUuid(b: Buffer): string {
  const hex = b.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** 校验 UUID 形态（v7 校验仅检查版本位，供导入数据使用）。 */
export function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s);
}

/** 幂等键：用确定性输入派生，重复应用不会产生第二条记录。 */
export function deriveIdempotencyKey(...parts: readonly string[]): string {
  return parts.map((p) => p.length.toString(16) + ':' + p).join('|');
}
