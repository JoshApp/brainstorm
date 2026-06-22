// The Discord bridge — the dungeon's voice, in your server.
//
// A SMALL STANDALONE process (NOT part of the game bundle). It subscribes to the
// shared SpacetimeDB `death` table — the same live feed the game reads — and
// fans each new death out to a Discord webhook in the voice of the thing that
// watches. This is the right home for outbound platform integration:
//   - server-side: holds the webhook secret (never in the client bundle),
//   - deduped: one post per death, here, not once per connected player,
//   - the natural place for the Phase-5 LLM voice (async, cached, zero in-game
//     cost — none of the determinism/latency constraints that gate runtime LLM
//     INSIDE the game apply out here).
//
// Run it anywhere cheap (Fly / Railway / a cron box):  npm run bridge
// Config via env (all optional except the webhook):
//   DISCORD_DEATH_WEBHOOK   the channel webhook URL (required; a SECRET)
//   SPACETIME_URI           default wss://maincloud.spacetimedb.com
//   DELVE_MODULE            the published module name (match src/net/delve-net.ts)
//   ANTHROPIC_API_KEY       if set, the LLM writes the mockery; else a template
//
// SKETCH STATUS: the Discord post + the LLM voice are concrete. The SpacetimeDB
// connect/subscribe mirrors src/net/delve-net.ts — wire DELVE_MODULE to the real
// published name and confirm the generated bindings path resolves from here.

import { DbConnection } from '../src/net/module_bindings';

const WEBHOOK = process.env.DISCORD_DEATH_WEBHOOK;
const URI = process.env.SPACETIME_URI || 'wss://maincloud.spacetimedb.com';
const MODULE = process.env.DELVE_MODULE || 'delve';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

if (!WEBHOOK) { console.error('[bridge] DISCORD_DEATH_WEBHOOK is required'); process.exit(1); }

// A death row (src/net/module_bindings/death_table.ts): name, depth, killedBy, …
interface Death { name: string; depth: number; killedBy: string; }

// The voice in the deep. Cruel, wry, present tense — the broadcast register, not
// the in-world grimdark (see CLAUDE.md → Tone Layering). One sentence, no emoji.
const TONE =
  'You are the thing that watches a grimdark dungeon and profits from every death. ' +
  'A delver has just died. In ONE sentence, mock them — cruel, wry, present tense, ' +
  'no emoji, no exclamation marks, no modern slang. You speak from below, amused.';

async function voiceFor(d: Death): Promise<string> {
  const facts = `name: ${d.name}; depth: ${d.depth}; killed by: ${d.killedBy}`;
  if (ANTHROPIC_KEY) {
    try { return await llmVoice(facts); } catch { /* fall back to a template */ }
  }
  return `${d.name} fell to ${d.killedBy} on depth ${d.depth}. The dark keeps the tally.`;
}

// LLM slot — Claude writes the mockery. Haiku 4.5: cheapest + fastest, plenty for
// one line. Raw fetch keeps the bridge dependency-light; swap for @anthropic-ai/sdk
// if you grow the voice. Cache by (depth, killedBy) upstream to keep cost near zero.
async function llmVoice(facts: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_KEY as string,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 120,
      system: TONE,
      messages: [{ role: 'user', content: facts }],
    }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}`);
  const data = await res.json() as { content: { type: string; text?: string }[] };
  const text = data.content.find((b) => b.type === 'text')?.text?.trim();
  if (!text) throw new Error('empty completion');
  return text;
}

async function post(line: string): Promise<void> {
  try {
    await fetch(WEBHOOK as string, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'the deep', content: line }),
    });
  } catch (e) { console.error('[bridge] webhook failed:', e); }
}

// On connect we receive the EXISTING death rows as inserts (the initial
// subscription snapshot). Don't replay the whole history to Discord — flip
// `ready` true only after that snapshot lands, then post only genuinely new ones.
let ready = false;

DbConnection.builder()
  .withUri(URI)
  .withModuleName(MODULE)
  .onConnect((conn) => {
    conn.subscriptionBuilder()
      .onApplied(() => { ready = true; console.log('[bridge] subscribed; watching for deaths'); })
      .subscribe(['SELECT * FROM death']);

    conn.db.death.onInsert(async (_ctx, row: Death) => {
      if (!ready) return; // initial snapshot — already-recorded deaths, skip
      const line = await voiceFor(row);
      console.log('[bridge] death →', line);
      await post(line);
    });
  })
  .onConnectError((_ctx, err) => { console.error('[bridge] connect error:', err); process.exit(1); })
  .build();
