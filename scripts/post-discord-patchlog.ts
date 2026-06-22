// Post new Patch-summary entries to a Discord channel on deploy — the build-in-
// public devlog, automated. Runs as a deploy-workflow step AFTER the site is
// live. The Patch-summary lines are already authored in-character (the dungeon's
// ledger of its own changes); this just routes them out.
//
// No-op unless DISCORD_PATCHLOG_WEBHOOK is set, so it's inert until you create
// the webhook and add it as a repo secret. The webhook URL is a SECRET (anyone
// with it can post to your channel) — it lives only here, server-side in CI,
// never in the client bundle.
//
// Range: PATCH_BEFORE..PATCH_AFTER (the push range, passed from the workflow).
// Falls back to just HEAD if the range is missing/invalid (first push, etc).

import { execSync } from 'node:child_process';

const WEBHOOK = process.env.DISCORD_PATCHLOG_WEBHOOK;
if (!WEBHOOK) { console.log('[discord] no DISCORD_PATCHLOG_WEBHOOK — skipping'); process.exit(0); }

const ZERO = '0000000000000000000000000000000000000000';
const before = process.env.PATCH_BEFORE;
const after = process.env.PATCH_AFTER || 'HEAD';
const range = before && before !== ZERO && /^[0-9a-f]{7,40}$/i.test(before)
  ? `${before}..${after}`
  : `${after}~1..${after}`;

// Decimal embed colours per tag (no emoji — the Tone Bible bans them; the
// coloured stripe + the wry line carry it).
const TAG_COLOR: Record<string, number> = {
  add: 0x6ad29a, fix: 0xe0a85a, tune: 0x7aa0c4, content: 0xb07ad2, tech: 0x8a8a8a,
};

interface Entry { summary: string; tag: string; area?: string; sha: string; }

function commitsInRange(): string[] {
  let raw: string;
  try { raw = execSync(`git log --reverse --format=%H ${range}`, { encoding: 'utf8' }); }
  catch { raw = execSync('git log -1 --format=%H', { encoding: 'utf8' }); }
  return raw.split('\n').map((s) => s.trim()).filter(Boolean);
}

function entryFor(sha: string): Entry | null {
  const body = execSync(`git log -1 --format=%B ${sha}`, { encoding: 'utf8' });
  const summary = body.match(/^Patch-summary:\s*(.+)$/im)?.[1]?.trim();
  if (!summary || summary.length < 4) return null;          // no summary → not surfaced (the rule)
  const tag = (body.match(/^Patch-tag:\s*(\w+)$/im)?.[1] ?? 'tune').toLowerCase();
  const area = body.match(/^Patch-area:\s*(.+)$/im)?.[1]?.trim();
  return { summary, tag, area, sha: sha.slice(0, 7) };
}

const entries = commitsInRange().map(entryFor).filter((e): e is Entry => !!e).slice(0, 10);
if (entries.length === 0) { console.log('[discord] no Patch-summary entries in range — skipping'); process.exit(0); }

const embeds = entries.map((e) => ({
  description: e.summary,
  color: TAG_COLOR[e.tag] ?? TAG_COLOR.tune,
  footer: { text: [e.tag, e.area, e.sha].filter(Boolean).join(' · ') },
}));

const res = await fetch(WEBHOOK, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: 'the deep', embeds }),
});
if (!res.ok) { console.error(`[discord] webhook failed: ${res.status} ${await res.text()}`); process.exit(1); }
console.log(`[discord] posted ${entries.length} patch entr${entries.length === 1 ? 'y' : 'ies'}`);
