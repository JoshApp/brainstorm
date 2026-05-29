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
import { levelForXp, xpInLevel, xpForNextLevel } from './leveling';

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

/** Start a fresh run. Wipes save, initializes memory state. Pass
 *  `seed` to make procgen deterministic (used by ?seed=N URL flag) —
 *  defaults to Date.now() which is also what procgen reads from
 *  startedAt during play, so a seeded run reproduces byte-identical
 *  floors on every boot.
 *
 *  Pass `depth` for seeded-jump entry — the run starts at that depth
 *  rather than the default 1. Used by ?depth=N URL flag (gated to
 *  harness/dev mode so players can't level-skip). */
export function startNewRun(initialFloorId: string, opts?: { seed?: number; depth?: number }) {
  inMemory = {
    version: SAVE_VERSION,
    floorId: initialFloorId,
    depth: opts?.depth ?? 1,
    hp: 0,  // populated at first commit
    inventory: {},
    equipment: {},
    startedAt: opts?.seed ?? Date.now(),
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
// Pure curve math lives in state/leveling.ts (unit-tested). These wrap it
// with the live XP total. The late-floor mob XP scaling matches the curve so
// the level number tracks "how deep have you gone."

/** Current level given the live XP total. Level 1 starts at 0 XP. */
export function getLevel(): number {
  return levelForXp(getXp());
}

/** XP earned WITHIN the current level (0 ... xpForNextLevel-1). */
export function getXpInLevel(): number {
  return xpInLevel(getXp());
}

/** XP needed to FINISH the current level (i.e. the size of the bar). */
export function getXpForNextLevel(): number {
  return xpForNextLevel(getXp());
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
      // Repair off-by-one depth in saves written before the level
      // loader was fixed to increment currentDepth BEFORE emitting
      // level:loaded. The floorId is always authoritative ('depth-N'
      // means depth N), so trust it over the stored depth field.
      // Idempotent for correct saves; rescues broken ones.
      const m = parsed.floorId.match(/^depth-(\d+)$/);
      if (m) {
        const fromId = parseInt(m[1], 10);
        if (Number.isFinite(fromId) && fromId > 0) parsed.depth = fromId;
      }
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
