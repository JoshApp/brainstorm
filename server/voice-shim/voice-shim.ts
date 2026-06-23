// voice-shim — the local DEV backend for ALL runtime AI decisions.
//
// Implements the common contract  POST /api/ai { kind, context } -> artifact
// by funnelling each request into a WARM, per-kind daemon-core Claude Code
// session. This is the dev/authoring plane of the two-plane architecture
// (docs/ALPHA-AND-BACKEND.md): the daemon bills the Max pool and runs at full
// quality so we can TUNE the prompts. Production swaps this for a Cloudflare
// Worker calling Anthropic — SAME /api/ai contract, no game change.
//
// One warm session per kind is reused across calls, so the deep "remembers"
// what it said earlier this session — for free, and on-theme.
//
// Run:
//   1. start your daemon-core daemon (defaults to :7429), no auth token
//   2. `npm run voice-shim`
//   3. `npm run dev`   (vite proxies /api/ai → here, port 8787)
//
// Requires Node >= 22 (global fetch + WebSocket).

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { PERSONAS } from './persona';

const PORT = Number(process.env.VOICE_SHIM_PORT ?? 8787);
const DAEMON_URL = (process.env.DAEMON_URL ?? 'http://localhost:7429').replace(/\/$/, '');
const DAEMON_AUTH = process.env.DAEMON_AUTH_TOKEN ?? '';
const MODEL = process.env.VOICE_MODEL ?? 'sonnet'; // prototype at quality; port to haiku later
const USE_BRIDGE = /^(1|true|on|yes)$/i.test(process.env.VOICE_USE_BRIDGE ?? '0'); // default: SDK mode (no bridge); set 1 for bridge / Max pool
const RESULT_TIMEOUT_MS = 25_000;

// Global WebSocket lands in Node 22. Pull it loosely so this file type-checks
// regardless of the project's @types/node version.
const WS: any = (globalThis as any).WebSocket;
if (!WS) {
  console.error(`[voice-shim] needs Node >= 22 for global WebSocket (current ${process.version}).`);
  process.exit(1);
}
if (DAEMON_AUTH) {
  console.warn('[voice-shim] DAEMON_AUTH_TOKEN set, but the WS subscribe cannot send auth headers '
    + 'via the global WebSocket — run the local daemon without an auth token, or the result stream will fail.');
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return DAEMON_AUTH ? { ...extra, authorization: `Bearer ${DAEMON_AUTH}` } : extra;
}

// One warm session per kind (each carries its own persona via appendSystemPrompt).
const sessions = new Map<string, string>();
// In-flight creations, so concurrent prefetches for the same kind share ONE
// session instead of racing past the reuse check and each spawning their own.
const creating = new Map<string, Promise<string>>();

async function ensureSession(kind: string): Promise<string> {
  const existing = sessions.get(kind);
  if (existing) return existing;
  const inflight = creating.get(kind);
  if (inflight) return inflight;
  const p = createSession(kind);
  creating.set(kind, p);
  try {
    return await p;
  } finally {
    creating.delete(kind);
  }
}

async function createSession(kind: string): Promise<string> {
  const persona = PERSONAS[kind];
  if (!persona) throw new Error(`unknown kind '${kind}'`);
  const body = {
    model: MODEL,
    maxTurns: 1,
    permissionMode: 'bypassPermissions',
    strictMcpConfig: true,
    // Bridge honours appendSystemPrompt (not systemPrompt) — use append so the
    // persona reaches the worker on BOTH the bridge and SDK paths.
    appendSystemPrompt: persona,
    useBridge: USE_BRIDGE,
    label: `delve-${kind}`,
  };
  const resp = await fetch(`${DAEMON_URL}/sessions`, {
    method: 'POST',
    headers: authHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`daemon /sessions ${resp.status}: ${await resp.text().catch(() => '')}`);
  const data = (await resp.json()) as { session_id?: string };
  if (!data.session_id) throw new Error('daemon returned no session_id');
  sessions.set(kind, data.session_id);
  console.log(`[voice-shim] ${kind} session ${data.session_id} (model=${MODEL}, bridge=${USE_BRIDGE})`);
  return data.session_id;
}

/** Send one message to a warm session; read the result text over the WS. */
function speak(id: string, content: string): Promise<string> {
  const wsUrl = `${DAEMON_URL.replace(/^http/, 'ws')}/ws/${id}`;
  return new Promise<string>((resolve, reject) => {
    const ws = new WS(wsUrl);
    const parts: string[] = [];
    let settled = false;
    const finish = (err: Error | null, val?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch { /* ignore */ }
      if (err) reject(err);
      else resolve(val ?? '');
    };
    const timer = setTimeout(() => finish(new Error('result timeout')), RESULT_TIMEOUT_MS);
    ws.onopen = () => {
      fetch(`${DAEMON_URL}/sessions/${id}/message`, {
        method: 'POST',
        headers: authHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ content }),
      }).catch((e: unknown) => finish(e instanceof Error ? e : new Error(String(e))));
    };
    ws.onmessage = (ev: any) => {
      let msg: any;
      try { msg = JSON.parse(String(ev.data)); } catch { return; }
      if (msg?.type === 'assistant' && msg.message?.content) {
        for (const b of msg.message.content) if (b?.type === 'text') parts.push(b.text);
      } else if (msg?.type === 'result') {
        finish(null, (msg.result && String(msg.result)) || parts.join(' '));
      }
    };
    ws.onerror = () => finish(new Error('ws error'));
    ws.onclose = () => finish(null, parts.join(' '));
  });
}

/** Build the per-kind prompt from the request context. New kinds plug in here.
 *  `ctx.player` is the dossier — who the deep knows the delver to be — woven in
 *  so the line/card answers the player, not just the moment. */
function buildPrompt(kind: string, ctx: any): string {
  const depth = ctx?.depth ?? 1;
  const who = ctx?.player ? `\nWhat the deep knows of them: ${ctx.player}\n` : '\n';
  switch (kind) {
    case 'voice':
      return `A delver has died on depth ${depth}, killed by ${ctx?.killedBy ?? 'the dark'}, after ${ctx?.kills ?? 0} kills.${who}Speak.`;
    case 'item-skin':
      return `A delver just took something from the dark on depth ${depth}.${who}Remark on the find.`;
    case 'fate-card':
      return `A delver draws a fate card at a bonfire on depth ${depth}.${who}Give them one card that answers who they are.`;
    default:
      return JSON.stringify(ctx);
  }
}

/** Shape the raw model text into the kind's artifact. */
function toArtifact(kind: string, raw: string): Record<string, string> {
  const first = (raw || '').split('\n').map((l) => l.trim()).filter(Boolean)[0] ?? '';
  const clean = first.replace(/^["'`]+|["'`]+$/g, '').trim();
  if (kind === 'fate-card') {
    const m = clean.split(/\s+[—–-]\s+/); // NAME — meaning
    if (m.length >= 2) return { name: m[0].trim(), flavor: m.slice(1).join(' — ').trim() };
    return { name: clean, flavor: '' };
  }
  return { line: clean };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => resolve(raw));
  });
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200); res.end('ok'); return;
  }
  if (req.method === 'POST' && req.url === '/api/ai') {
    let kind = '';
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      kind = body.kind;
      const id = await ensureSession(kind);
      const artifact = toArtifact(kind, await speak(id, buildPrompt(kind, body.context)));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(artifact));
      console.log(`[voice-shim] ${kind} → ${artifact.line ?? `${artifact.name} — ${artifact.flavor}`}`);
    } catch (e) {
      if (kind) sessions.delete(kind); // drop the session so the next call recreates it
      const msg = e instanceof Error ? e.message : String(e);
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: msg }));
      console.warn('[voice-shim] error:', msg);
    }
    return;
  }
  res.writeHead(404); res.end();
});

server.listen(PORT, () => {
  console.log(`[voice-shim] http://localhost:${PORT}  →  daemon ${DAEMON_URL}  (vite proxies /api/ai here)`);
  console.log(`[voice-shim] kinds: ${Object.keys(PERSONAS).join(', ')}`);
});
