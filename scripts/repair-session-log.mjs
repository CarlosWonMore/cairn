#!/usr/bin/env node
/**
 * 修复被 cairn 注入写坏的 DSH session log（v4 容器：串联 zstd 帧 + JSONL）。
 *
 * 病因：plugin 注入的 `user/message` 事件缺 `id`。宿主重放会话时
 * `assertMessageEventShape`（app.asar）要求该事件的 data 本身是一条带非空字符串
 * `id` 的完整消息，缺失即抛
 *   `session event at seq N lacks an identified message`
 * → 整个会话被判 corrupt，历史加载失败。
 *
 * 修法：逐帧解压 → 只给「source.kind = cairn-memory-injection 且缺 id」的事件补
 * randomUUID → 只重压被改动的那几帧，其余帧保留原始字节（帧边界与行对齐不变）
 * → 先在同一目录写 .bak，再原子替换。
 *
 * 用法：
 *   node scripts/repair-session-log.mjs <session.v4.jsonl.zstd>            # 干跑
 *   node scripts/repair-session-log.mjs <session.v4.jsonl.zstd> --apply    # 写盘
 *   node scripts/repair-session-log.mjs --scan                            # 只扫描 DSH_DATA 下全部会话
 */
import { copyFileSync, readFileSync, readdirSync, statSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import zlib from 'node:zlib';

const SESSION_FILE = 'session.v4.jsonl.zstd';

/** 解开串联的 zstd 帧，返回 [{ raw, text, dirty }]，raw 是该帧在源文件里的原始字节。 */
function readFrames(buf) {
  const frames = [];
  let rest = buf;
  let offset = 0;
  while (rest.length > 0) {
    const res = zlib.zstdDecompressSync(rest, { info: true });
    const consumed = res.engine.bytesWritten;
    if (!consumed) throw new Error(`zstd frame at byte ${offset} made no progress`);
    frames.push({ raw: buf.subarray(offset, offset + consumed), text: res.buffer.toString('utf8') });
    offset += consumed;
    rest = rest.subarray(consumed);
  }
  return frames;
}

/** 缺 id 的注入事件计数，并原地补 id；返回该帧改动条数。 */
function patchFrameText(text) {
  let patched = 0;
  const next = text.split('\n').map((line) => {
    if (!line.trim()) return line;
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      return line; // 坏行原样保留，交给宿主自己报错，不静默吞掉
    }
    if (ev?.type !== 'user/message') return line;
    const data = ev.data;
    if (!data || typeof data !== 'object') return line;
    if (typeof data.id === 'string' && data.id !== '') return line;
    // 只补 cairn 注入这一类；其它来源缺 id 说明有别的缺陷，不能靠这个脚本掩盖
    if (data.source?.kind !== 'cairn-memory-injection') return line;
    data.id = randomUUID();
    patched++;
    return JSON.stringify(ev);
  });
  return { patched, text: next.join('\n') };
}

function inspect(file) {
  const frames = readFrames(readFileSync(file));
  let patched = 0;
  let touched = 0;
  const rebuilt = frames.map((frame) => {
    const r = patchFrameText(frame.text);
    if (r.patched === 0) return frame.raw;
    patched += r.patched;
    touched++;
    return zlib.zstdCompressSync(Buffer.from(r.text, 'utf8'));
  });
  return { frames: frames.length, touched, patched, rebuilt };
}

function sessionRoots() {
  const data = process.env.DSH_DATA?.trim() || join(homedir(), '.dsh');
  return { sessions: join(data, 'sessions'), data };
}

function scanAll() {
  const { sessions } = sessionRoots();
  const found = [];
  for (const dir of readdirSync(sessions)) {
    const sub = join(sessions, dir);
    if (!statSync(sub).isDirectory()) continue;
    for (const id of readdirSync(sub)) {
      const file = join(sub, id, SESSION_FILE);
      try {
        if (!statSync(file).isFile()) continue;
      } catch {
        continue;
      }
      const r = inspect(file);
      if (r.patched > 0) found.push({ file, ...r, rebuilt: undefined });
    }
  }
  return found;
}

const [, , target, ...rest] = process.argv;
const apply = rest.includes('--apply');

if (target === '--scan' || target === undefined) {
  const hits = scanAll();
  if (hits.length === 0) {
    console.log('没有需要修复的会话');
    process.exit(0);
  }
  for (const h of hits) console.log(`${h.patched} 条缺 id 注入 · ${h.touched}/${h.frames} 帧需重压 · ${h.file}`);
  process.exit(0);
}

const r = inspect(target);
console.log(`frames=${r.frames} touchedFrames=${r.touched} patchedEvents=${r.patched}`);
if (r.patched === 0) {
  console.log('无需修复');
  process.exit(0);
}
if (!apply) {
  console.log('干跑：加 --apply 才写盘');
  process.exit(0);
}

const backup = `${target}.bak-repair-${Date.now()}`;
copyFileSync(target, backup);
const tmp = `${target}.tmp-repair`;
writeFileSync(tmp, Buffer.concat(r.rebuilt));
renameSync(tmp, target);
console.log('backup:', backup);
console.log('written:', statSync(target).size, 'bytes');
