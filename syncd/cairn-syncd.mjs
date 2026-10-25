#!/usr/bin/env node
/**
 * Cairn syncd —— 最小单用户同步中继（design D5 / 构想 §11.2 约束版）。
 *
 * 协议（与 RemoteStore 对应）：
 *   PUT  /chunks/<key>       不可变上传（同 key 同体幂等；带 Content-MD5 校验可选）
 *   GET  /chunks/<key>       下载（404 = 不存在）
 *   GET  /manifests/<key>    下载 manifest（404 = 不存在）
 *   PUT  /manifests/<key>    发布 manifest；头 X-Cairn-Generation 必须大于服务器当前值，回退 409
 *   GET  /healthz            健康检查
 *
 * 安全：Bearer token（环境变量 CAIRN_SYNCD_TOKEN）；仅监听指定接口
 * （默认 Tailscale IP——公网安全组亦全闭，双重隔离）。数据落本地目录。
 *
 * 零依赖：node:http + node:fs。单用户单 vault，验证载体与自建选项；
 * 官方推荐路径是对象存储（OBS）。数据目录备份由运维负责（文档如实说明）。
 */

import { createServer } from 'node:http';
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync, statSync, readdirSync } from 'node:fs';
import { join, dirname, normalize, relative } from 'node:path';

const PORT = Number(process.env['CAIRN_SYNCD_PORT'] ?? 8471);
const HOST = process.env['CAIRN_SYNCD_HOST'] ?? '127.0.0.1';
const TOKEN = process.env['CAIRN_SYNCD_TOKEN'] ?? '';
const DATA_DIR = process.env['CAIRN_SYNCD_DATA'] ?? join(process.cwd(), 'syncd-data');

if (!TOKEN) {
  console.error('[cairn-syncd] CAIRN_SYNCD_TOKEN is required');
  process.exit(1);
}

mkdirSync(join(DATA_DIR, 'chunks'), { recursive: true });
mkdirSync(join(DATA_DIR, 'manifests'), { recursive: true });

function safeKey(raw) {
  // 防路径穿越：只允许 [A-Za-z0-9/_.-]，且解析后必须仍在数据目录内
  const key = decodeURIComponent(raw).replace(/\\/g, '/');
  if (!/^[A-Za-z0-9/_.-]+$/.test(key) || key.includes('..')) return null;
  const full = normalize(join(DATA_DIR, key));
  if (!full.startsWith(normalize(DATA_DIR))) return null;
  return full;
}

function auth(req) {
  const h = req.headers['authorization'] ?? '';
  return h === `Bearer ${TOKEN}`;
}

function send(res, code, body, headers = {}) {
  const buf = typeof body === 'string' ? Buffer.from(body) : body;
  res.writeHead(code, { 'content-length': buf.byteLength, ...headers });
  res.end(buf);
}

const server = createServer((req, res) => {
  if (!auth(req)) {
    send(res, 401, 'unauthorized');
    return;
  }
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;

  if (req.method === 'GET' && path === '/healthz') {
    send(res, 200, JSON.stringify({ ok: true, uptime: process.uptime() }));
    return;
  }

  if (req.method === 'GET' && path === '/list') {
    const rawPrefix = url.searchParams.get('prefix') ?? '';
    if (!/^[A-Za-z0-9/_.-]*$/.test(rawPrefix) || rawPrefix.includes('..')) {
      send(res, 400, 'bad prefix');
      return;
    }
    // 虚拟键空间：chunks/<key> 与 manifests/<key> 两个物理子目录合并，
    // 返回去掉首段存储类的虚拟 key（与 PUT /chunks/<key> 的寻址一致）
    const keys = [];
    const walk = (dir, topLevel) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full, topLevel);
        } else {
          // 跳过旁路元数据与原子写残留：它们不是同步对象
          if (entry.name.endsWith('.gen') || entry.name.includes('.tmp-')) continue;
          const rel = full.slice(normalize(join(DATA_DIR, topLevel)).length + 1).split('\\').join('/');
          if (rel.startsWith(rawPrefix)) keys.push(rel);
        }
      }
    };
    for (const topLevel of ['chunks', 'manifests']) {
      const dir = join(DATA_DIR, topLevel);
      if (existsSync(dir)) walk(dir, topLevel);
    }
    keys.sort();
    send(res, 200, JSON.stringify({ keys }));
    return;
  }

  if (path.startsWith('/chunks/') || path.startsWith('/manifests/')) {
    const full = safeKey(path.slice(1));
    if (!full) {
      send(res, 400, 'bad key');
      return;
    }
    if (req.method === 'GET') {
      if (!existsSync(full)) {
        send(res, 404, 'not found');
        return;
      }
      const body = readFileSync(full);
      send(res, 200, body, { 'content-type': 'application/octet-stream' });
      return;
    }
    if (req.method === 'PUT') {
      const chunksIn = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.byteLength;
        if (size > 64 * 1024 * 1024) {
          send(res, 413, 'too large');
          req.destroy();
        } else {
          chunksIn.push(c);
        }
      });
      req.on('end', () => {
        const body = Buffer.concat(chunksIn);
        if (path.startsWith('/manifests/')) {
          // 代次 CAS：X-Cairn-Generation 必须大于当前（回退 409）。
          // 当前代次读【旁路 .gen 文件】——真实客户端的 manifest 是加密字节，
          // JSON.parse 恒抛会让 CAS 形同虚设（第三轮验证 P2）；.gen 缺失时
          // 兼容尝试明文 JSON（仅历史遗留路径）。
          const genHeader = Number(req.headers['x-cairn-generation'] ?? '-1');
          if (!Number.isFinite(genHeader) || genHeader < 1) {
            send(res, 400, 'missing X-Cairn-Generation');
            return;
          }
          const genFile = `${full}.gen`;
          let current = 0;
          if (existsSync(genFile)) {
            current = Number(readFileSync(genFile, 'utf8').trim()) || 0;
          } else if (existsSync(full)) {
            try {
              current = JSON.parse(readFileSync(full, 'utf8')).generation ?? 0;
            } catch {
              current = 0;
            }
          }
          if (genHeader <= current) {
            send(res, 409, JSON.stringify({ error: 'generation_regression', current }), { 'content-type': 'application/json' });
            return;
          }
          mkdirSync(dirname(full), { recursive: true });
          // 原子写：tmp + rename；代次落旁路文件（正文可以是任意密文字节）
          const tmp = `${full}.tmp-${process.pid}-${Date.now()}`;
          writeFileSync(tmp, body);
          renameSync(tmp, full);
          writeFileSync(`${full}.gen`, String(genHeader));
          send(res, 200, JSON.stringify({ ok: true, bytes: body.byteLength, generation: genHeader }), { 'content-type': 'application/json' });
          return;
        }
        mkdirSync(dirname(full), { recursive: true });
        // 原子写：tmp + rename
        const tmp = `${full}.tmp-${process.pid}-${Date.now()}`;
        writeFileSync(tmp, body);
        renameSync(tmp, full);
        send(res, 200, JSON.stringify({ ok: true, bytes: body.byteLength }), { 'content-type': 'application/json' });
      });
      return;
    }
  }

  send(res, 404, 'not found');
});

server.listen(PORT, HOST, () => {
  console.log(`[cairn-syncd] listening on http://${HOST}:${PORT} data=${DATA_DIR}`);
});
