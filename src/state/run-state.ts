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
import { emit } from '../broadcast/event-bus';

const STORAGE_KEY = 'delve:save';
const SAVE_VERSION = 2;

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
  /** Total XP earned this run. Accumulates via absorbed XP wisps. */
  xp: number;
  /** Total gold gathered this run. Currently a counter only — spending
   *  hooks come with the shop system later. */
  gold: number;
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
    xp: 0,
    gold: 0,
  };
}

/** Hydrate memory state from a saved run. Used on CONTINUE. Fills in
 *  defaults for fields that may be missing from older save versions. */
export function adoptSave(save: SaveData) {
  inMemory = {
    ...save,
    xp: save.xp ?? 0,
    gold: save.gold ?? 0,
  };
}

export function grantXp(amount: number): void {
  if (!inMemory || amount <= 0) return;
  const beforeLevel = getLevel();
  inMemory.xp += amount;
  const afterLevel = getLevel();
  // Emit one level:up event per level crossed (jumps possible if a
  // huge XP grant lands at once, e.g. a boss's wisp shower hits all at
  // once). Listeners (HUD pulse, audio sting) react per level.
  for (let L = beforeLevel + 1; L <= afterLevel; L++) {
    emit({ type: 'level:up', level: L });
  }
}

export function grantGold(amount: number): void {
  if (!inMemory || amount <= 0) return;
  inMemory.gold += amount;
}

export function getXp(): number {
  return inMemory?.xp ?? 0;
}

export function getGold(): number {
  return inMemory?.gold ?? 0;
}

// ── Leveling curve ──────────────────────────────────────────────────
// Quadratic per-level cost: gaining level L costs L * XP_PER_LEVEL XP.
// Cumulative XP to FINISH level L = XP_PER_LEVEL * L * (L+1) / 2.
// At XP_PER_LEVEL=10:
//   L1 → L2: needs 10 cumulative
//   L2 → L3: needs 30 cumulative
//   L3 → L4: needs 60 cumulative
//   L4 → L5: needs 100 cumulative
// Gentle early ramp; the late-floor mob XP scaling matches the curve so
// the level number tracks "how deep have you gone."

const XP_PER_LEVEL = 10;

/** Cumulative XP needed to BE at level L (i.e. to finish level L-1). */
function xpFloorForLevel(level: number): number {
  if (level <= 1) return 0;
  return XP_PER_LEVEL * level * (level - 1) / 2;
}

/** Current level given an XP total. Level 1 starts at 0 XP. */
export function getLevel(): number {
  const xp = getXp();
  // Invert: level is the largest L where xpFloorForLevel(L) <= xp.
  // Solving xp = k * L * (L-1) / 2 for L: L = (1 + sqrt(1 + 8 * xp / k)) / 2.
  const L = (1 + Math.sqrt(1 + 8 * xp / XP_PER_LEVEL)) / 2;
  return Math.max(1, Math.floor(L));
}

/** XP earned WITHIN the current level (0 ... xpForNextLevel-1). */
export function getXpInLevel(): number {
  const level = getLevel();
  return getXp() - xpFloorForLevel(level);
}

/** XP needed to FINISH the current level (i.e. the size of the bar). */
export function getXpForNextLevel(): number {
  const level = getLevel();
  return xpFloorForLevel(level + 1) - xpFloorForLevel(level);
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
    // Soft migration — older saves get the new counters defaulted.
    // Hard-mismatch (e.g. v0 with totally different shape) returns null.
    if (parsed.version === 1 || parsed.version === SAVE_VERSION) {
      return {
        ...parsed,
        version: SAVE_VERSION,
        xp: parsed.xp ?? 0,
        gold: parsed.gold ?? 0,
      };
    }
    return null;
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
