// Meta-state — persistent progress that survives between RUNS.
//
// Distinct from run-state.ts (which holds the current run's snapshot).
// Meta-state is the "memory" of all runs ever — codex of things seen,
// records, totals, achievements. Updated incrementally during play,
// persisted to localStorage independently of the run save.
//
// On death the run save is cleared, but meta-state PERSISTS. That's the
// hook for the addictive loop: dying still adds to your records, fills
// in the codex, and (later) feeds the LLM personalization layer.
//
// This is also the substrate the future LLM layer reads from: which
// items has the player gravitated to, which enemies have they killed
// most, how many runs in. Item/enemy/note generation will pull from
// here.

import type { Rarity } from '../content/items';

const STORAGE_KEY = 'delve:meta';
// v2 added achievementsUnlocked + stash. v1 saves are compatible — the
// fields default-init to empty arrays during the load fixup below.
const META_VERSION = 2;

export interface StashEntry {
  /** Unique id used by the UI to key entries. Random per granted box. */
  id: string;
  /** Rarity tier that determines the item pool the box rolls from. */
  tier: Rarity;
  /** Where it came from — usually an achievement title for the reveal UI. */
  source: string;
}

export interface MetaState {
  version: number;
  /** Total runs the player has ATTEMPTED (start counted, finish optional). */
  runsAttempted: number;
  /** Runs that ended in death (vs in-progress). */
  runsDied: number;
  /** Deepest depth ever reached across all runs. */
  deepestDepth: number;
  /** Lifetime kill count. */
  totalKills: number;
  /** Lifetime play time in milliseconds (death sequences count too). */
  totalPlayMs: number;
  /** Unique enemy ids slain at least once. */
  enemiesSlain: string[];
  /** Unique item ids picked up at least once. */
  itemsFound: string[];
  /** Unique corpse-note bodies read (truncated to first 60 chars as key). */
  notesRead: string[];
  /** Achievement ids unlocked. Each fires AT MOST once across all runs. */
  achievementsUnlocked: string[];
  /** Unopened loot boxes waiting on the title screen. */
  stash: StashEntry[];
  /** The delver's chosen name — entered once before the first descent,
   *  shown on the title, and (Phase 4+) attached to leaderboard + trace
   *  submissions. */
  playerName?: string;
  /** Stable local player id. INTERIM identity: a client-generated UUID
   *  persisted here so runs can be attributed before any backend exists.
   *  Phase 4 supersedes this with SpacetimeDB's anonymous `Identity` (the
   *  connection token IS the account); until then this is the key we'd
   *  send with a score / trace. See docs/ALPHA-AND-BACKEND.md. */
  playerId?: string;
}

function emptyMeta(): MetaState {
  return {
    version: META_VERSION,
    runsAttempted: 0,
    runsDied: 0,
    deepestDepth: 0,
    totalKills: 0,
    totalPlayMs: 0,
    enemiesSlain: [],
    itemsFound: [],
    notesRead: [],
    achievementsUnlocked: [],
    stash: [],
  };
}

// ── In-memory cache ──────────────────────────────────────────────────
let cache: MetaState | null = null;

function load(): MetaState {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      cache = emptyMeta();
      return cache;
    }
    const parsed = JSON.parse(raw) as Partial<MetaState>;
    // Forward-migrate: any new fields added in later versions default to
    // empty. v1 → v2 added achievementsUnlocked + stash.
    if ((parsed.version ?? 0) > META_VERSION) {
      // Newer save format from a future build — reset rather than risk
      // half-reading it.
      cache = emptyMeta();
      return cache;
    }
    const fresh = emptyMeta();
    cache = { ...fresh, ...parsed, version: META_VERSION };
    return cache;
  } catch {
    cache = emptyMeta();
    return cache;
  }
}

function persist() {
  if (!cache) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // quota / disabled — silently ignore
  }
}

/** Read-only snapshot for UI display. Mutations go through the
 *  record* helpers below. */
export function getMeta(): Readonly<MetaState> {
  return load();
}

// ── Recorders ───────────────────────────────────────────────────────
// All take the value to record + return true iff this was the FIRST
// time. End-screen uses the return to highlight "discoveries this run."

export function recordRunStart() {
  const m = load();
  m.runsAttempted += 1;
  persist();
}

export function recordRunDeath(elapsedMs: number) {
  const m = load();
  m.runsDied += 1;
  m.totalPlayMs += elapsedMs;
  persist();
}

export function recordKill(enemyId: string): boolean {
  const m = load();
  m.totalKills += 1;
  if (m.enemiesSlain.includes(enemyId)) {
    persist();
    return false;
  }
  m.enemiesSlain.push(enemyId);
  persist();
  return true;
}

export function recordItemFound(itemId: string): boolean {
  const m = load();
  if (m.itemsFound.includes(itemId)) return false;
  m.itemsFound.push(itemId);
  persist();
  return true;
}

export function recordNoteRead(noteBody: string): boolean {
  const m = load();
  const key = noteBody.slice(0, 60);
  if (m.notesRead.includes(key)) return false;
  m.notesRead.push(key);
  persist();
  return true;
}

export function recordDepthReached(depth: number): boolean {
  const m = load();
  if (depth <= m.deepestDepth) return false;
  m.deepestDepth = depth;
  persist();
  return true;
}

// ── Achievements + stash ────────────────────────────────────────────

/** Mark an achievement unlocked. Returns true if this is the first time. */
export function recordAchievement(id: string): boolean {
  const m = load();
  if (m.achievementsUnlocked.includes(id)) return false;
  m.achievementsUnlocked.push(id);
  persist();
  return true;
}

export function hasAchievement(id: string): boolean {
  return load().achievementsUnlocked.includes(id);
}

/** Add a loot box to the stash. UI consumes via popStash. */
export function addStashEntry(tier: Rarity, source: string) {
  const m = load();
  m.stash.push({
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    tier,
    source,
  });
  persist();
}

/** Read-only view of unopened stash boxes. */
export function getStash(): readonly StashEntry[] {
  return load().stash;
}

/** Remove + return the stash entry with this id. Used when the player
 *  opens a box; the rolled item is computed elsewhere. */
export function consumeStashEntry(id: string): StashEntry | null {
  const m = load();
  const idx = m.stash.findIndex(e => e.id === id);
  if (idx < 0) return null;
  const [entry] = m.stash.splice(idx, 1);
  persist();
  return entry;
}

// ── Per-run discovery tracking ──────────────────────────────────────
// Reset at run start; populated whenever a record* call returns true.
// End-screen reads this to display "FIRST SEEN" badges. Lives in
// memory only (not persisted) — the run is over once we read it.

interface RunDiscoveries {
  enemies: string[];
  items: string[];
  notes: string[];
  newDepthRecord: boolean;
}

let discoveries: RunDiscoveries = freshDiscoveries();

function freshDiscoveries(): RunDiscoveries {
  return { enemies: [], items: [], notes: [], newDepthRecord: false };
}

export function resetRunDiscoveries() {
  discoveries = freshDiscoveries();
}

export function noteRunDiscovery(kind: 'enemy' | 'item' | 'note' | 'depth', value: string) {
  if (kind === 'enemy') discoveries.enemies.push(value);
  else if (kind === 'item') discoveries.items.push(value);
  else if (kind === 'note') discoveries.notes.push(value);
  else if (kind === 'depth') discoveries.newDepthRecord = true;
}

export function getRunDiscoveries(): Readonly<RunDiscoveries> {
  return discoveries;
}

// ── Reset ─────────────────────────────────────────────────────────
// Mostly for debug/testing. Wipes lifetime stats.
export function clearMeta() {
  cache = emptyMeta();
  persist();
}
