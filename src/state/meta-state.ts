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

const STORAGE_KEY = 'delve:meta';
const META_VERSION = 1;

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
    const parsed = JSON.parse(raw) as MetaState;
    if (parsed.version !== META_VERSION) {
      // Future migrations land here. For now, reset.
      cache = emptyMeta();
      return cache;
    }
    cache = parsed;
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
