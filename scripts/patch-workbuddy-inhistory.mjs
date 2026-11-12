#!/usr/bin/env node
/**
 * Declare pi-ai's mid-conversation-system capability for the WorkBuddy route.
 *
 * WHY: DSH only appends a changed system prompt AFTER the cached history when the
 * prepared call declares `systemPromptUpdate: 'in-history'`, and dsh-llm-pi-ai derives
 * that from pi-ai's `compat.supportsMidConvoSystemMessages`. The WorkBuddy adapter never
 * sets it, so every tool-schema change rewrites system node 0 and the provider prefix
 * cache misses from the first changed token — a full-prefix re-bill (measured: 690,601
 * uncached tokens = 41.47 credits on 2026-11-12 09:20).
 *
 * DEFAULT IS OFF. Turning it on asserts that WorkBuddy's /v2/chat/completions reads the
 * latest `system` message at any position as the effective prompt. If that is false the
 * model keeps running on the OLD prompt (worse than the cost), so verify before enabling:
 *   1. enable, restart the host, open a NEW session
 *   2. /compact once to force a system-prompt version change
 *   3. the next turn's usage must keep a high cacheReadTokens share AND the new tool
 *      must be visible to the model
 * Revert any time with --revert. An adapter upgrade overwrites lib/index.js, so re-run.
 *
 * Usage: node scripts/patch-workbuddy-inhistory.mjs [--enable|--revert|--status]
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';

const TARGET = 'D:/AIAgents_Data/DSH_DATA/profiles/desktop/node_modules/dsh-connect-workbuddy/lib/index.js';
const MARK = 'supportsMidConvoSystemMessages: true';
const FROM = 'compat: { supportsReasoningEffort: thinkingLevelMap !== void 0 }';
const TO = 'compat: { supportsReasoningEffort: thinkingLevelMap !== void 0, supportsMidConvoSystemMessages: true }';

const mode = process.argv[2] ?? '--status';
if (!existsSync(TARGET)) { console.error('adapter not installed at ' + TARGET); process.exit(2); }
const before = readFileSync(TARGET, 'utf8');
const patched = before.includes(MARK);
const occurrences = before.split(FROM).length - 1;

if (mode === '--status') {
  console.log(JSON.stringify({ path: TARGET, patched, anchorOccurrences: occurrences }, null, 2));
  process.exit(0);
}
if (mode === '--enable') {
  if (patched) { console.log('already patched'); process.exit(0); }
  if (occurrences !== 1) { console.error('anchor not unique (' + occurrences + '); refusing to patch'); process.exit(3); }
  copyFileSync(TARGET, TARGET + '.bak-inhistory');
  writeFileSync(TARGET, before.replace(FROM, TO));
  console.log('patched; backup at ' + TARGET + '.bak-inhistory');
  process.exit(0);
}
if (mode === '--revert') {
  if (!existsSync(TARGET + '.bak-inhistory')) { console.error('no backup to revert from'); process.exit(4); }
  copyFileSync(TARGET + '.bak-inhistory', TARGET);
  console.log('reverted from backup');
  process.exit(0);
}
console.error('unknown mode ' + mode);
process.exit(5);
