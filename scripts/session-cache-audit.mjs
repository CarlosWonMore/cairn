#!/usr/bin/env node
/**
 * Report which DSH sessions paid a full-prefix re-bill, and why.
 *
 * A re-bill is one request whose whole surface went in uncached because the leading
 * system node changed: `cacheReadTokens` collapses toward zero while `totalTokens`
 * stays large. Every other request in these sessions sits at 97-100%.
 *
 * Attribution reads the session log itself: a `system/message` event within a few
 * events of the request means the prompt (tool docs, MCP declarations, skills) had just
 * changed — the cause DSH cannot avoid without `systemPromptUpdate: 'in-history'`.
 * Anything else is an expired provider cache.
 *
 * Credits: 0.06005/K uncached input at weekday peak (09:00-12:00, 14:00-18:00
 * Asia/Shanghai), half that off-peak — the catalog's creditMultiplier 0.11 plus the
 * night discount, cross-checked against request-usage exports.
 *
 * Usage: node scripts/session-cache-audit.mjs [--min-surface 100000] [--json]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import zlib from 'node:zlib';

const HOME = process.env.DSH_HOME ?? 'D:/AIAgents_Data/DSH_DATA';
const SESSIONS = join(HOME, 'sessions');
const argv = process.argv.slice(2);
const minSurface = Number(argv[argv.indexOf('--min-surface') + 1]) || 100_000;
const asJson = argv.includes('--json');

const PEAK_CREDITS_PER_K = 0.06005;

/** Asia/Shanghai wall clock for one epoch-ms, plus the peak flag that prices it. */
function stamp(ms) {
  const d = new Date(ms + 8 * 3600_000);
  const weekday = d.getUTCDay();
  const hour = d.getUTCHours();
  const peak = weekday >= 1 && weekday <= 5 && ((hour >= 9 && hour < 12) || (hour >= 14 && hour < 18));
  return { text: d.toISOString().slice(5, 16).replace('T', ' '), peak };
}

/** Every durable event of one session log; a torn trailing line is dropped, not fatal. */
function readEvents(file) {
  const raw = readFileSync(file);
  const text = raw[0] === 0x28 && raw[1] === 0xb5 ? zlib.zstdDecompressSync(raw).toString('utf8') : raw.toString('utf8');
  const events = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    try { events.push(JSON.parse(line)); } catch { /* torn tail line */ }
  }
  return events;
}

const rebills = [];
const sessions = [];

for (const workspace of readdirSync(SESSIONS)) {
  const workspacePath = join(SESSIONS, workspace);
  if (!statSync(workspacePath).isDirectory()) continue;
  for (const sessionDir of readdirSync(workspacePath)) {
    const sessionPath = join(workspacePath, sessionDir);
    if (!statSync(sessionPath).isDirectory()) continue;
    const label = workspace.replace(/^--|--$/g, '').slice(0, 22) + '/' + sessionDir.replace(/^session-/, '').slice(0, 8);
    for (const name of readdirSync(sessionPath)) {
      if (!name.endsWith('.jsonl.zstd') || name.includes('.bak')) continue;
      let events;
      try { events = readEvents(join(sessionPath, name)); } catch { continue; }

      const promptSeqs = events.filter((e) => e.type === 'system/message').map((e) => e.seq);
      let requests = 0;
      let billed = 0;
      let surface = 0;
      let previousSeq = null;

      for (const event of events) {
        if (event.type !== 'assistant/message') continue;
        const usage = event.data?.usage;
        if (!usage) continue;
        const total = usage.totalTokens ?? 0;
        const read = usage.cacheReadTokens ?? 0;
        requests += 1;
        billed += usage.inputTokens ?? 0;
        surface += total;

        const nearPromptChange = promptSeqs.some((s) => s < event.seq && event.seq - s < 8);
        if (previousSeq !== null && total >= minSurface && read / Math.max(total, 1) < 0.05) {
          const uncached = usage.inputTokens ?? total - read;
          const when = stamp(event.time);
          rebills.push({
            when: when.text,
            session: label,
            turn: event.data?.turn,
            uncached,
            surface: total,
            credits: Math.round((uncached / 1000) * PEAK_CREDITS_PER_K * (when.peak ? 1 : 0.5) * 100) / 100,
            cause: nearPromptChange ? 'prompt-changed' : 'cache-expired',
            peak: when.peak,
          });
        }
        previousSeq = event.seq;
      }

      if (requests > 0) {
        sessions.push({ label, requests, cacheShare: surface === 0 ? 0 : Math.round((1 - billed / surface) * 1000) / 10 });
      }
    }
  }
}

rebills.sort((a, b) => b.credits - a.credits);
if (asJson) {
  console.log(JSON.stringify({ sessions, rebills }, null, 2));
} else {
  const total = rebills.reduce((sum, r) => sum + r.credits, 0);
  const byCause = {};
  for (const r of rebills) byCause[r.cause] = Math.round(((byCause[r.cause] ?? 0) + r.credits) * 10) / 10;
  console.log('sessions scanned: ' + sessions.length);
  for (const s of [...sessions].sort((a, b) => b.requests - a.requests).slice(0, 8)) {
    console.log('  ' + s.label.padEnd(32) + ' reqs ' + String(s.requests).padStart(5) + '   cache ' + String(s.cacheShare).padStart(5) + '%');
  }
  console.log('');
  console.log('re-billed requests: ' + rebills.length + '   estimated credits: ' + total.toFixed(1));
  console.log('by cause: ' + JSON.stringify(byCause));
  console.log('');
  console.log('when            credits  uncached   surface  cause            session');
  for (const r of rebills) {
    console.log(
      r.when.padEnd(15) +
      String(r.credits).padStart(7) + '  ' +
      String(r.uncached).padStart(8) + '  ' +
      String(r.surface).padStart(8) + '  ' +
      r.cause.padEnd(15) + ' ' + r.session,
    );
  }
}
