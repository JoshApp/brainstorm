// DELVE network layer — the client's link to the living dungeon.
//
// Transport only: connect to the SpacetimeDB `delve` database on Maincloud,
// subscribe to the shared tables, report this player's deaths, and fan
// incoming deaths-from-others out to listeners. Presentation (what the voice
// in the deep SAYS) lives in death-feed.ts.
//
// Identity model: game data keys on a stable PLAYER, not on the auth
// identity. We resolve our own player id from the `identity` table (the
// identity→player map) so linked accounts read as one player. See
// docs/ALPHA-AND-BACKEND.md.
//
// Everything here is BEST-EFFORT and fire-and-forget. Offline, blocked, or
// unpublished → every call no-ops and the game is unaffected (PWA-friendly).

import { DbConnection } from './module_bindings';
import { getPlayerName } from '../state/meta-state';
import { latestPatchVersion } from '../content/patchlog';

const MAINCLOUD_URI = 'wss://maincloud.spacetimedb.com';
const DB_NAME = 'delve';
// The anon Identity token, persisted so a returning player reconnects as the
// SAME identity (which resolves to the same player) across sessions.
const TOKEN_KEY = 'delve:stdb-token';

/** A death by SOMEONE ELSE, as the feed cares about it. */
export interface DeathElsewhere {
  name: string;
  depth: number;
  killedBy: string;
}

/** The facts a local death carries — the caller (death.ts) knows these;
 *  name + build tag are filled in here. */
export interface DeathFacts {
  depth: number;
  x: number;
  z: number;
  runSeed: number;
  killedBy?: string;
}

type Listener = (d: DeathElsewhere) => void;

let conn: DbConnection | null = null;
let myIdentityHex: string | null = null;
// The stable player this connection maps to, resolved from the `identity`
// table once it syncs. Game data keys on this, not on the auth identity, so
// linked accounts read as ONE player. Null until resolved.
let myPlayerId: bigint | null = null;
// Gate live reactions until the subscription's initial backlog has loaded,
// so connecting doesn't replay every historical death as if it just happened.
let applied = false;
const listeners = new Set<Listener>();
// Fired on every successful connect/reconnect — run-sync drains its upload
// queue here.
const connectedListeners = new Set<() => void>();

/** The build/season tag stamped on every reported death (and, later, the
 *  query key for per-build leaderboards). */
function buildTag(): string {
  return latestPatchVersion()?.version ?? 'unknown';
}

/** Find our own player id in the synced identity→player map. */
function resolveMyPlayer(): void {
  if (!conn || !myIdentityHex) return;
  for (const row of conn.db.identity.iter()) {
    if (row.id.toHexString() === myIdentityHex) {
      myPlayerId = row.playerId;
      return;
    }
  }
}

// Build a connection with the given token. `persistAnon` saves the returned
// token as our anon identity (only for the anon connection — an OIDC token
// expires and is re-fetched from the provider each session). `onReady` fires
// once the subscription applies (player id resolved) OR on connect error.
function buildConnection(token: string | undefined, persistAnon: boolean, onReady?: () => void): void {
  let readyFired = false;
  const ready = () => { if (!readyFired) { readyFired = true; onReady?.(); } };
  conn = DbConnection.builder()
    .withUri(MAINCLOUD_URI)
    .withDatabaseName(DB_NAME)
    .withToken(token)
    .onConnect((c, identity, tok) => {
      myIdentityHex = identity.toHexString();
      if (persistAnon) {
        try { localStorage.setItem(TOKEN_KEY, tok); } catch { /* storage off */ }
      }
      // Sync our local display name onto the canonical player row.
      const name = getPlayerName();
      if (name) {
        try { c.reducers.setDisplayName({ name }); } catch { /* best-effort */ }
      }
      // Subscribe to deaths (feed + board + bloodstains) and the
      // identity→player map (to resolve our own player id). onApplied flips
      // `applied` so the death backlog doesn't fire the voice.
      c.subscriptionBuilder()
        .onApplied(() => {
          applied = true;
          resolveMyPlayer();
          ready();
          for (const cb of connectedListeners) {
            try { cb(); } catch { /* one listener must not break the others */ }
          }
        })
        .subscribe(['SELECT * FROM death', 'SELECT * FROM identity']);
    })
    .onConnectError((_ctx, err) => {
      // Offline / blocked / bad token — stay silent, game runs on.
      console.warn('[net] connect error:', err.message);
      ready();
    })
    .onDisconnect(() => {
      applied = false;
    })
    .build();

  // Keep our player id current as identity rows arrive (ours may land after
  // the initial apply, e.g. first-ever connection).
  conn.db.identity.onInsert((_ctx, row) => {
    if (myIdentityHex && row.id.toHexString() === myIdentityHex) myPlayerId = row.playerId;
  });

  // Every death row insert. Skip the connect backlog and our OWN deaths
  // (matched by player, so all our linked identities count as us); what's
  // left is "someone else just died, live".
  conn.db.death.onInsert((_ctx, row) => {
    if (!applied) return;
    if (myPlayerId !== null && row.playerId === myPlayerId) return;
    const d: DeathElsewhere = { name: row.name, depth: row.depth, killedBy: row.killedBy };
    for (const cb of listeners) {
      try { cb(d); } catch { /* a listener throwing must not break the others */ }
    }
  });
}

/** Connect once, on boot, as the persisted anonymous identity. Idempotent. */
export function initNetwork(): void {
  if (conn) return;
  let saved: string | undefined;
  try {
    saved = localStorage.getItem(TOKEN_KEY) ?? undefined;
  } catch {
    saved = undefined;
  }
  try {
    buildConnection(saved, true);
  } catch (err) {
    console.warn('[net] init failed:', err);
    conn = null;
  }
}

/** Reconnect under a new auth token (e.g. an OIDC JWT from Clerk), becoming
 *  that identity. Resolves once the new connection has synced. Used by the
 *  account-link flow to redeem as the freshly-signed-in identity. */
export function reconnectWithToken(token: string): Promise<void> {
  return new Promise((resolve) => {
    try { conn?.disconnect(); } catch { /* already gone */ }
    conn = null;
    myPlayerId = null;
    myIdentityHex = null;
    applied = false;
    try {
      buildConnection(token, false, resolve);
    } catch (err) {
      console.warn('[net] reconnect failed:', err);
      resolve();
    }
  });
}

/** Subscribe to deaths-by-others. Multiple listeners allowed. */
export function onDeathElsewhere(cb: Listener): void {
  listeners.add(cb);
}

/** Run a callback on every successful connect/reconnect (drains queues). */
export function addConnectedListener(cb: () => void): void {
  connectedListeners.add(cb);
}

/** Submit a recorded run (seed + compressed input tape + claimed result) for
 *  verification. Returns false if not connected (caller keeps it queued). */
export function submitRun(rec: {
  seed: number;
  buildVersion: string;
  depth: number;
  kills: number;
  name: string;
  tape: string;
}): boolean {
  if (!conn) return false;
  try {
    conn.reducers.submitRun({
      seed: BigInt(Math.max(0, Math.floor(rec.seed))),
      buildVersion: rec.buildVersion,
      depth: rec.depth,
      kills: rec.kills,
      name: rec.name,
      tape: rec.tape,
    });
    return true;
  } catch (err) {
    console.warn('[net] submitRun failed:', err);
    return false;
  }
}

/** Push the player's chosen name to the canonical player row. Call when the
 *  name is set (name-entry) and on connect. No-op if unconnected. */
export function pushDisplayName(name: string): void {
  if (!conn) return;
  try {
    conn.reducers.setDisplayName({ name });
  } catch (err) {
    console.warn('[net] setDisplayName failed:', err);
  }
}

/** Report this player's death to the living dungeon. No-op if unconnected.
 *  The server resolves our player from ctx.sender — we just send the facts. */
export function reportDeath(facts: DeathFacts): void {
  if (!conn) return;
  try {
    conn.reducers.reportDeath({
      name: getPlayerName() ?? 'a nameless delver',
      depth: facts.depth,
      killedBy: facts.killedBy ?? '',
      x: facts.x,
      z: facts.z,
      runSeed: BigInt(Math.max(0, Math.floor(facts.runSeed))),
      buildVersion: buildTag(),
    });
  } catch (err) {
    console.warn('[net] reportDeath failed:', err);
  }
}

// ── Account linking ─────────────────────────────────────────────────
// The client owns code generation (the link_code table is private, so a code
// is never read back from the server — it lives only here). The fewest-clicks
// in-place upgrade issues a code as the anon player, reconnects as the OAuth
// identity, and redeems — all invisibly. The same wrappers serve a manual
// cross-device flow. See docs/ALPHA-AND-BACKEND.md.

/** A fresh, hard-to-guess link code. The client owns code generation. */
export function freshLinkCode(): string {
  const bytes = new Uint8Array(8);
  try {
    crypto.getRandomValues(bytes);
  } catch {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no look-alikes
  let s = '';
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return s;
}

/** Bind a link code to THIS player (the progress holder). No-op if offline. */
export function issueLinkCode(code: string): void {
  if (!conn) return;
  try {
    conn.reducers.issueLinkCode({ code });
  } catch (err) {
    console.warn('[net] issueLinkCode failed:', err);
  }
}

/** Redeem a code as the CURRENT identity — merges this identity's player into
 *  the code's player. No-op if offline. */
export function redeemLinkCode(code: string): void {
  if (!conn) return;
  try {
    conn.reducers.redeemLinkCode({ code });
  } catch (err) {
    console.warn('[net] redeemLinkCode failed:', err);
  }
}

/** A death recorded at a given depth — read from the live cache to place as
 *  a bloodstain when a floor at that depth builds. Includes the player's own
 *  past deaths (you see where you fell, Souls-style). */
export interface DeathRecord {
  name: string;
  depth: number;
  x: number;
  z: number;
  killedBy: string;
}

/** All deaths recorded at `depth`, from the subscribed cache. Empty if
 *  offline / not yet synced. Best-effort; never throws. */
export function deathsAtDepth(depth: number): DeathRecord[] {
  if (!conn) return [];
  try {
    const out: DeathRecord[] = [];
    for (const row of conn.db.death.iter()) {
      if (row.depth !== depth) continue;
      out.push({ name: row.name, depth: row.depth, x: row.x, z: row.z, killedBy: row.killedBy });
    }
    return out;
  } catch {
    return [];
  }
}

/** One delver on the deepest-descent board. */
export interface LeaderEntry {
  name: string;
  /** Deepest depth they reached (= their deepest death). */
  depth: number;
  /** How many times they've fallen. */
  deaths: number;
  /** This is the local player. */
  own: boolean;
}

/** The deepest-descent leaderboard, DERIVED from the death table: one entry
 *  per PLAYER (their deepest death, freshest name), deepest first. Aggregating
 *  by player_id means a player's several linked identities collapse into one
 *  board row. Best-effort: empty when offline / not yet synced. */
export function getLeaderboard(limit = 25): LeaderEntry[] {
  if (!conn) return [];
  try {
    interface Agg { name: string; depth: number; deaths: number; at: bigint; pid: bigint; }
    const byPlayer = new Map<string, Agg>();
    for (const row of conn.db.death.iter()) {
      const key = row.playerId.toString();
      const at = row.at.microsSinceUnixEpoch;
      const a = byPlayer.get(key);
      if (a) {
        a.deaths += 1;
        if (row.depth > a.depth) a.depth = row.depth;
        if (at > a.at) { a.at = at; a.name = row.name; }  // keep the freshest name
      } else {
        byPlayer.set(key, { name: row.name, depth: row.depth, deaths: 1, at, pid: row.playerId });
      }
    }
    const entries: LeaderEntry[] = [];
    for (const a of byPlayer.values()) {
      entries.push({ name: a.name, depth: a.depth, deaths: a.deaths, own: myPlayerId !== null && a.pid === myPlayerId });
    }
    // Deepest first; ties broken by fewer deaths (got there cleaner).
    entries.sort((x, y) => y.depth - x.depth || x.deaths - y.deaths);
    return entries.slice(0, limit);
  } catch {
    return [];
  }
}
