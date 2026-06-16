// DELVE network layer — the client's link to the living dungeon.
//
// Transport only: connect to the SpacetimeDB `delve` database on Maincloud,
// subscribe to the shared `death` table, report this player's deaths, and
// fan incoming deaths-from-others out to listeners. Presentation (what the
// voice in the deep SAYS) lives in death-feed.ts.
//
// Everything here is BEST-EFFORT and fire-and-forget. Offline, blocked, or
// unpublished → every call no-ops and the game is unaffected (PWA-friendly).
// See docs/ALPHA-AND-BACKEND.md.

import { DbConnection } from './module_bindings';
import { getPlayerName } from '../state/meta-state';
import { latestPatchVersion } from '../content/patchlog';

const MAINCLOUD_URI = 'wss://maincloud.spacetimedb.com';
const DB_NAME = 'delve';
// The anon Identity token, persisted so a returning player reconnects as
// the SAME identity (their deaths stay attributed to them across sessions).
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
// Gate live reactions until the subscription's initial backlog has loaded,
// so connecting doesn't replay every historical death as if it just happened.
let applied = false;
const listeners = new Set<Listener>();

/** The build/season tag stamped on every reported death (and, later, the
 *  query key for per-build leaderboards). */
function buildTag(): string {
  return latestPatchVersion()?.version ?? 'unknown';
}

/** Connect once, on boot. Idempotent; safe to call before login exists. */
export function initNetwork(): void {
  if (conn) return;
  let saved: string | undefined;
  try {
    saved = localStorage.getItem(TOKEN_KEY) ?? undefined;
  } catch {
    saved = undefined;
  }
  try {
    conn = DbConnection.builder()
      .withUri(MAINCLOUD_URI)
      .withDatabaseName(DB_NAME)
      .withToken(saved)
      .onConnect((c, identity, token) => {
        myIdentityHex = identity.toHexString();
        try {
          localStorage.setItem(TOKEN_KEY, token);
        } catch {
          // storage disabled — we just won't persist the identity
        }
        // Subscribe to the whole death table (tiny in the alpha). onApplied
        // flips `applied` so the backlog doesn't fire the voice; only deaths
        // arriving AFTER are "live elsewhere". We can bound this later.
        c.subscriptionBuilder()
          .onApplied(() => {
            applied = true;
          })
          .subscribe('SELECT * FROM death');
      })
      .onConnectError((_ctx, err) => {
        // Offline / blocked / not yet published — stay silent, game runs on.
        console.warn('[net] connect error:', err.message);
      })
      .onDisconnect(() => {
        applied = false;
      })
      .build();

    // Every death row insert. Skip the connect backlog and our own deaths;
    // what's left is "someone else just died, live".
    conn.db.death.onInsert((_ctx, row) => {
      if (!applied) return;
      if (myIdentityHex && row.player.toHexString() === myIdentityHex) return;
      const d: DeathElsewhere = { name: row.name, depth: row.depth, killedBy: row.killedBy };
      for (const cb of listeners) {
        try {
          cb(d);
        } catch {
          // a listener throwing must not break the others
        }
      }
    });
  } catch (err) {
    console.warn('[net] init failed:', err);
    conn = null;
  }
}

/** Subscribe to deaths-by-others. Multiple listeners allowed. */
export function onDeathElsewhere(cb: Listener): void {
  listeners.add(cb);
}

/** Report this player's death to the living dungeon. No-op if unconnected. */
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
 *  per player (their deepest death, freshest name), deepest first. No
 *  dedicated table needed — every death already records the depth reached.
 *  Best-effort: empty when offline / not yet synced. */
export function getLeaderboard(limit = 25): LeaderEntry[] {
  if (!conn) return [];
  try {
    interface Agg { name: string; depth: number; deaths: number; at: bigint; }
    const byPlayer = new Map<string, Agg>();
    for (const row of conn.db.death.iter()) {
      const key = row.player.toHexString();
      const at = row.at.microsSinceUnixEpoch;
      const a = byPlayer.get(key);
      if (a) {
        a.deaths += 1;
        if (row.depth > a.depth) a.depth = row.depth;
        if (at > a.at) { a.at = at; a.name = row.name; }  // keep the freshest name
      } else {
        byPlayer.set(key, { name: row.name, depth: row.depth, deaths: 1, at });
      }
    }
    const entries: LeaderEntry[] = [];
    for (const [key, a] of byPlayer) {
      entries.push({ name: a.name, depth: a.depth, deaths: a.deaths, own: key === myIdentityHex });
    }
    // Deepest first; ties broken by fewer deaths (got there cleaner).
    entries.sort((x, y) => y.depth - x.depth || x.deaths - y.deaths);
    return entries.slice(0, limit);
  } catch {
    return [];
  }
}
