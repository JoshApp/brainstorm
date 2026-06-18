import { schema, table, t } from 'spacetimedb/server';
import { SenderError } from 'spacetimedb/server';

// DELVE backend — the living dungeon's shared memory.
//
// Identity model (the part we don't compromise on): game data references a
// stable internal PLAYER, never the auth identity directly. Many auth
// identities — an anonymous device token today, a linked Google/Apple
// account tomorrow — map MANY-to-one onto one player. Sign in from any of
// them and you are the same player. See docs/ALPHA-AND-BACKEND.md.

// ── The canonical player: a stable id every game row references. ──
const player = table(
  { name: 'player', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    displayName: t.string(),
    createdAt: t.timestamp(),
  }
);

// ── Auth identities → player (MANY-to-one). One row per device-anon token
//    or linked OIDC account; all of a player's identities share its id.
//    The PK `id` is the connection's Identity (ctx.sender). ──
const identity = table(
  { name: 'identity', public: true },
  {
    id: t.identity().primaryKey(),
    playerId: t.u64().index('btree'),
    provider: t.string(),            // 'anon' | 'google' | 'apple' | ...
    linkedAt: t.timestamp(),
  }
);

// ── Deaths key on PLAYER, not identity. name denormalised for cheap reads
//    (the feed, the bloodstain, the board). ──
const death = table(
  { name: 'death', public: true },
  {
    // autoInc id — NOT monotonic; never order by it. The feed orders by `at`.
    id: t.u64().primaryKey().autoInc(),
    playerId: t.u64().index('btree'),
    name: t.string(),
    depth: t.u32().index('btree'),
    killedBy: t.string(),
    x: t.f32(),
    z: t.f32(),
    runSeed: t.u64(),
    buildVersion: t.string().index('btree'),
    at: t.timestamp(),
  }
);

// ── Account-link handshake. PRIVATE (not public): knowing a code lets you
//    redeem it, so no client may read another's. The client GENERATES the
//    code locally and holds it; the server never needs to hand it back. ──
const linkCode = table(
  { name: 'link_code' },
  {
    code: t.string().primaryKey(),
    playerId: t.u64(),
    expiresAtMicros: t.u64(),
  }
);

// ── Run tapes awaiting verification. A run IS its seed + the input stream;
//    the verifier (a separate headless replay worker, NOT a reducer) re-runs
//    seed+tape under the matching build and confirms depth/kills before the
//    score counts. Captured offline, uploaded on reconnect. ──
const pendingRun = table(
  { name: 'pending_run', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    playerId: t.u64().index('btree'),
    seed: t.u64(),
    buildVersion: t.string().index('btree'),
    // The CLAIMED result the replay must reproduce.
    depth: t.u32(),
    kills: t.u32(),
    name: t.string(),
    // gzip+base64 of the input tape (seed + per-step intents). Small.
    tape: t.string(),
    // 'pending' | 'verified' | 'rejected' — the verifier sets the verdict.
    status: t.string().index('btree'),
    at: t.timestamp(),
  }
);

const spacetimedb = schema({ player, identity, death, linkCode, pendingRun });
export default spacetimedb;

// Resolve the caller to a player_id, auto-provisioning a fresh anonymous
// player the first time an identity is ever seen. So every connection — and
// every reducer call — always maps to a player, invisibly. (ctx typed `any`:
// internal helper shared by the lifecycle hook and the reducers below.)
function ensurePlayer(ctx: any): bigint {
  const link = ctx.db.identity.id.find(ctx.sender);
  if (link) return link.playerId;
  const p = ctx.db.player.insert({ id: 0n, displayName: 'a nameless delver', createdAt: ctx.timestamp });
  ctx.db.identity.insert({ id: ctx.sender, playerId: p.id, provider: 'anon', linkedAt: ctx.timestamp });
  return p.id;
}

export const init = spacetimedb.init((_ctx) => {
  // Called once when the module is first published.
});

export const onConnect = spacetimedb.clientConnected((ctx) => {
  // First contact provisions the player; returning identities just resolve.
  ensurePlayer(ctx);
});

export const onDisconnect = spacetimedb.clientDisconnected((_ctx) => {});

// Set / update this player's display name (the name-entry screen, and a
// resync on connect). Updates the canonical player row.
export const setDisplayName = spacetimedb.reducer(
  { name: t.string() },
  (ctx, { name }) => {
    const pid = ensurePlayer(ctx);
    const p = ctx.db.player.id.find(pid);
    if (p) ctx.db.player.id.update({ ...p, displayName: name.slice(0, 24) });
  }
);

// Report a death — keyed on the resolved player. Identity + time are
// server-authoritative; name / depth / position are self-reported
// (trust-but-verify). Cosmetic strings clamped.
export const reportDeath = spacetimedb.reducer(
  {
    name: t.string(),
    depth: t.u32(),
    killedBy: t.string(),
    x: t.f32(),
    z: t.f32(),
    runSeed: t.u64(),
    buildVersion: t.string(),
  },
  (ctx, { name, depth, killedBy, x, z, runSeed, buildVersion }) => {
    const pid = ensurePlayer(ctx);
    ctx.db.death.insert({
      id: 0n,
      playerId: pid,
      name: name.slice(0, 24),
      depth,
      killedBy: killedBy.slice(0, 48),
      x,
      z,
      runSeed,
      buildVersion: buildVersion.slice(0, 32),
      at: ctx.timestamp,
    });
  }
);

// Submit a recorded run (seed + input tape) for verification. Stored
// 'pending'; the offline verifier replays it and sets the verdict. The
// claimed depth/kills are what the replay must reproduce.
export const submitRun = spacetimedb.reducer(
  {
    seed: t.u64(),
    buildVersion: t.string(),
    depth: t.u32(),
    kills: t.u32(),
    name: t.string(),
    tape: t.string(),
  },
  (ctx, { seed, buildVersion, depth, kills, name, tape }) => {
    if (tape.length > 600_000) throw new SenderError('tape too large');
    const pid = ensurePlayer(ctx);
    ctx.db.pendingRun.insert({
      id: 0n,
      playerId: pid,
      seed,
      buildVersion: buildVersion.slice(0, 32),
      depth,
      kills,
      name: name.slice(0, 24),
      tape,
      status: 'pending',
      at: ctx.timestamp,
    });
  }
);

// ── Account linking ─────────────────────────────────────────────────
// Convert / link in seconds, no code typed by the user in the common case:
// the client (signed in as anon A) issues a code, does the OAuth redirect,
// reconnects as the new identity B, and redeems the code — merging B's fresh
// player into A so A's progress is preserved and B now logs into it. The
// same reducers serve a manual cross-device "show code / enter code" path.

// Bind a client-generated code to the caller's player (the progress holder).
// 10-minute TTL; one active code per player.
export const issueLinkCode = spacetimedb.reducer(
  { code: t.string() },
  (ctx, { code }) => {
    const pid = ensurePlayer(ctx);
    for (const c of [...ctx.db.linkCode.iter()]) {
      if (c.playerId === pid) ctx.db.linkCode.code.delete(c.code);
    }
    const expires = ctx.timestamp.microsSinceUnixEpoch + 600_000_000n; // 10 min
    ctx.db.linkCode.insert({ code: code.slice(0, 64), playerId: pid, expiresAtMicros: expires });
  }
);

// Redeem a code as identity B: MERGE B's player into the code's player A.
// B's deaths are reassigned, B's identities repointed, B's now-empty player
// removed. After this, A and B both resolve to the same player.
export const redeemLinkCode = spacetimedb.reducer(
  { code: t.string() },
  (ctx, { code }) => {
    const redeemerPid = ensurePlayer(ctx);
    const lc = ctx.db.linkCode.code.find(code);
    if (!lc) throw new SenderError('invalid or expired link code');
    ctx.db.linkCode.code.delete(code); // single-use
    if (ctx.timestamp.microsSinceUnixEpoch > lc.expiresAtMicros) {
      throw new SenderError('link code expired');
    }
    const keepPid = lc.playerId;
    if (keepPid === redeemerPid) return; // already the same player

    for (const d of [...ctx.db.death.playerId.filter(redeemerPid)]) {
      ctx.db.death.id.update({ ...d, playerId: keepPid });
    }
    for (const idn of [...ctx.db.identity.playerId.filter(redeemerPid)]) {
      ctx.db.identity.id.update({ ...idn, playerId: keepPid });
    }
    ctx.db.player.id.delete(redeemerPid);
  }
);
