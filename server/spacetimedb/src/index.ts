import { schema, table, t } from 'spacetimedb/server';

// DELVE backend — the living dungeon's shared memory.
//
// First feature: "the dungeon notices a death elsewhere." Every delver's
// death is reported here as a row; subscribed clients receive it live (the
// voice in the deep remarks on it), and the same rows are the substrate
// for async bloodstains (Phase 4) and, later, the leaderboard. One table,
// several features. See docs/ALPHA-AND-BACKEND.md.

const death = table(
  { name: 'death', public: true },
  {
    // autoInc id — NOT monotonic (gaps are normal), so never order by it.
    // The feed orders by `at`.
    id: t.u64().primaryKey().autoInc(),
    // The dier's identity — AUTHORITATIVE (set from ctx.sender server-side,
    // never self-reported). This is the real account key; the client's
    // interim localStorage playerId is a separate, weaker thing.
    player: t.identity(),
    // Display name, denormalised onto the row so the feed needs no join.
    // Self-reported + cosmetic — trust-but-verify, like depth.
    name: t.string(),
    // How deep they got. Indexed: the feed greets by depth, and async
    // bloodstains query "deaths near depth N".
    depth: t.u32().index('btree'),
    // What ended them — enemy id / cause, for "slain by ___" flavour.
    killedBy: t.string(),
    // Where they fell, in floor coords — the future bloodstain position.
    x: t.f32(),
    z: t.f32(),
    // The run this death belongs to (the run seed = SaveData.startedAt).
    // Links a death to a replay-verifiable run for the leaderboard later.
    runSeed: t.u64(),
    // Build/season tag. Balance changes invalidate old scores and reframe
    // the feed, so every row is stamped and queries filter on it.
    buildVersion: t.string().index('btree'),
    // Server-stamped death time (deterministic ctx.timestamp). The feed's
    // ordering key, since autoInc id is not sequential.
    at: t.timestamp(),
  }
);

const spacetimedb = schema({ death });
export default spacetimedb;

export const init = spacetimedb.init((_ctx) => {
  // Called once when the module is first published.
});

export const onConnect = spacetimedb.clientConnected((_ctx) => {
  // A delver's client connected. Presence / phantoms will hook here later.
});

export const onDisconnect = spacetimedb.clientDisconnected((_ctx) => {
  // A delver's client disconnected.
});

// Report a death. The client calls this when the player dies; the row fans
// out to every subscribed client (the live "death elsewhere" feed) and
// persists as the async bloodstain. Identity + time are authoritative
// (server-set); name / depth / position are self-reported
// (trust-but-verify, per the charter). Cosmetic strings are clamped so a
// bad client can't bloat the table.
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
    ctx.db.death.insert({
      id: 0n, // autoInc assigns the real id
      player: ctx.sender,
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
