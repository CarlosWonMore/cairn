#!/usr/bin/env node
/**
 * Second half of the in-history probe: cache behaviour at a realistic prefix size.
 *
 * The first run proved the SEMANTICS (a mid-conversation system message is obeyed:
 * the model answered with the colour given in the second system message). Token
 * counters there were useless — a 52-token prompt is below the provider's cache
 * granularity, so everything read 0%.
 *
 * This run pads the head to roughly 3,000 tokens and asks the same four shapes, so
 * "did the prefix stay reusable" becomes visible in prompt_cache_hit_tokens.
 *
 * Prints counters only — never the token, never prompt text.
 * Usage: node scripts/probe-workbuddy-inhistory.mjs --large
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const VAULT = 'D:/AIAgents_Data/DSH_DATA/workbuddy-vault/cn';
const ENDPOINT = 'https://copilot.tencent.com/v2/chat/completions';
const UA = 'CLI/2.63.2 CodeBuddy/2.63.2';
const MODEL = 'deepseek-v4.1-flash';

const vaultFile = readdirSync(VAULT).find((f) => f.endsWith('.json') && readFileSync(join(VAULT, f), 'utf8').includes('www.workbuddy.cn'));
const auth = JSON.parse(readFileSync(join(VAULT, vaultFile), 'utf8')).auth;
const uuid = () => crypto.randomUUID().replace(/-/g, '');

function headers() {
  const origin = 'https://www.codebuddy.cn';
  return {
    Accept: 'application/json, text/plain, */*',
    'Content-Type': 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
    Origin: origin,
    Referer: origin + '/',
    'User-Agent': UA,
    'X-Product': 'SaaS',
    'X-No-User-Id': '1',
    'X-No-Enterprise-Id': '1',
    'X-No-Department-Info': '1',
    'X-Conversation-ID': uuid(),
    'X-Conversation-Request-ID': uuid(),
    'X-Conversation-Message-ID': uuid(),
    Authorization: 'Bearer ' + auth.accessToken,
  };
}

async function send(messages, label) {
  const body = JSON.stringify({ model: MODEL, stream: true, messages, max_tokens: 16 });
  const response = await fetch(ENDPOINT, { method: 'POST', headers: headers(), body });
  if (!response.ok) return { label, ok: false, status: response.status, body: (await response.text()).slice(0, 240) };
  const raw = await response.text();
  let usage = null, text = '';
  for (const line of raw.split('\n')) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (payload === '' || payload === '[DONE]') continue;
    let parsed;
    try { parsed = JSON.parse(payload); } catch { continue; }
    if (parsed.usage) usage = parsed.usage;
    const delta = parsed.choices?.[0]?.delta?.content;
    if (typeof delta === 'string') text += delta;
  }
  return { label, ok: true, usage, text: text.replace(/\s+/g, ' ').slice(0, 40) };
}

// ~3k tokens of stable head: identical bytes in every request that keeps the head.
const FILLER = Array.from({ length: 120 }, (_, i) => 'Rule ' + (i + 1) + ': keep replies short and answer only what was asked.').join(' ');
const S1 = 'You are a test assistant. ' + FILLER + ' Your colour is RED.';
const S2 = 'You are a test assistant. ' + FILLER + ' Your colour is BLUE.';

const base = [
  { role: 'user', content: 'Hello.' },
  { role: 'assistant', content: 'Hello. How can I help?' },
];

const results = [];
results.push(await send([{ role: 'system', content: S1 }, ...base, { role: 'user', content: 'Say the word apple once.' }], 'A baseline'));
results.push(await send([{ role: 'system', content: S1 }, ...base, { role: 'user', content: 'Say the word banana once.' }], 'B append-only'));
results.push(await send([{ role: 'system', content: S1 }, ...base, { role: 'system', content: S2 }, { role: 'user', content: 'Which colour? One word.' }], 'C mid system'));
results.push(await send([{ role: 'system', content: S2 }, ...base, { role: 'user', content: 'Say the word cherry once.' }], 'D head rewritten'));
results.push(await send([{ role: 'system', content: S1 }, ...base, { role: 'system', content: S2 }, { role: 'user', content: 'Which colour? One word.' }], 'C2 mid system'));

for (const r of results) {
  if (!r.ok) { console.log(r.label.padEnd(18) + ' FAILED ' + r.status + ' ' + r.body); continue; }
  const u = r.usage ?? {};
  const prompt = u.prompt_tokens ?? 0;
  const cached = u.prompt_cache_hit_tokens ?? u.prompt_tokens_details?.cached_tokens ?? u.cached_tokens ?? 0;
  console.log(
    r.label.padEnd(18) +
    'prompt=' + String(prompt).padStart(6) +
    '  cached=' + String(cached).padStart(6) +
    '  hit=' + String(prompt ? Math.round((cached / prompt) * 100) : 0).padStart(3) + '%' +
    '  reply="' + r.text + '"',
  );
}
