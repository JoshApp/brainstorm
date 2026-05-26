// Run state — the per-run progress that survives between sessions.
//
// Persisted to localStorage on every floor transition. Mid-floor progress
// (kills, picked-up items, HP) is held in memory and snapshotted at the
// NEXT floor transition. If the player closes the tab mid-floor, they
// resume at the START of that floor with the inventory + HP they had at
// floor entry — same contract every roguelike player understands: "you
// save when you commit to descending."
//
// On death the save is cleared (RISE AGAIN = fresh dungeon).

import type { EquipSlot } from '../player/equipment';

const STORAGE_KEY = 'delve:save';
const SAVE_VERSION = 1;

export interface SaveData {
  version: number;
  /** Level id the player will resume at. */
  floorId: string;
  /** Displayed depth (1-based; floor-1 = depth 1). Tracked separately
   *  from floorId since the loader's currentDepth is reset on each load. */
  depth: number;
  /** HP at floor entry. Resume restores this. */
  hp: number;
  /** Inventory snapshot — item id → count. */
  inventory: Record<string, number>;
  /** Equipment snapshot — slot → item id. */
  equipment: Partial<Record<EquipSlot, string>>;
  /** ms timestamp of run start (Date.now()) for elapsed-time display. */
  startedAt: number;
  /** Total enemies killed this run (across all floors). */
  kills: number;
  /** Unique item ids picked up this run. Set semantics via Array. */
  itemsFound: string[];
}

// ── In-memory run state (mid-floor mutable counters) ─────────────────
// These accumulate during play. snapshot() reads them; commit() writes
// them to localStorage at the right moment (floor transition).
let inMemory: SaveData | null = null;

/** Start a fresh run. Wipes save, initializes memory state. */
export function startNewRun(initialFloorId: string) {
  inMemory = {
    version: SAVE_VERSION,
    floorId: initialFloorId,
    depth: 1,
    hp: 0,  // populated at first commit
    inventory: {},
    equipment: {},
    startedAt: Date.now(),
    kills: 0,
    itemsFound: [],
  };
}

/** Hydrate memory state from a saved run. Used on CONTINUE. */
export function adoptSave(save: SaveData) {
  inMemory = { ...save };
}

export function getRunState(): SaveData | null {
  return inMemory;
}

export function recordKill() {
  if (inMemory) inMemory.kills += 1;
}

export function recordItemFound(itemId: string) {
  if (!inMemory) return;
  if (!inMemory.itemsFound.includes(itemId)) inMemory.itemsFound.push(itemId);
}

/**
 * Snapshot the current world state into the save record + persist.
 * Called by the level loader at floor transitions. The caller provides
 * the current floor id (we're about to enter), the player HP at the
 * MOMENT OF ENTRY, and the current inventory + equipment.
 */
export function commitFloorEntry(args: {
  floorId: string;
  depth: number;
  hp: number;
  inventory: Record<string, number>;
  equipment: Partial<Record<EquipSlot, string>>;
}) {
  if (!inMemory) return;
  inMemory.floorId = args.floorId;
  inMemory.depth = args.depth;
  inMemory.hp = args.hp;
  inMemory.inventory = { ...args.inventory };
  inMemory.equipment = { ...args.equipment };
  persist();
}

// ── Persistence ─────────────────────────────────────────────────────

function persist() {
  if (!inMemory) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(inMemory));
  } catch {
    // Quota exceeded / disabled — ignore. We just won't have resume.
  }
}

export function loadSave(): SaveData | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SaveData;
    if (parsed.version !== SAVE_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  inMemory = null;
}

/** Format elapsed time since run start as M:SS. */
export function elapsedString(): string {
  if (!inMemory) return '0:00';
  const ms = Date.now() - inMemory.startedAt;
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
