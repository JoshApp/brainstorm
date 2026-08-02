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
import { levelForXp, xpInLevel, xpForNextLevel, LEVELS_ENABLED } from './leveling';
import { serializeCharacter, type CharacterSave } from './character';
import { clearMutations, serializeMutations, hydrateMutations } from './run-mutations';
import { clearPhialIdentities, serializePhialIdentities, hydratePhialIdentities } from './phial-identities';
import { clearChoices, serializeChoices, hydrateChoices, type Choice } from './choices';
import { resetFlask, restoreFlask, serializeFlask, type FlaskState } from '../player/flask';

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
  /** Snapshot of cumulative kills/xp/gold taken at the start of the
   *  current act (i.e. when the player entered the first depth of the
   *  act they're currently in). Diff against the live totals to read
   *  "stats earned during this act" for the safe-room transition card. */
  actEntryKills?: number;
  actEntryXp?: number;
  actEntryGold?: number;
  /** Character progression snapshot (attributes, proficiencies, unspent
   *  points) at floor entry — so a reload/resume keeps your build.
   *  Optional for older saves (treated as baseline). */
  character?: CharacterSave;
  /** Active tainted-fountain mutations as ids into TAINTED_MUTATIONS.
   *  Permanent for the run, cleared on death. Optional for older saves
   *  (treated as empty). */
  mutations?: string[];
  /** Per-run phial color → mutation identities (state/phial-identities.ts).
   *  Persisted so a reload keeps what the player has LEARNED. */
  phials?: Record<string, string>;
  /** The ledger of offerings taken + declined this run (state/choices.ts) — what
   *  the deep remembers you chose at each fork. Optional for older saves. */
  choices?: Choice[];
  /** Fate cards held this run (ids into content/cards.ts) — the Spread.
   *  Optional for older saves (treated as empty). */
  cards?: string[];
  /** The HUNGER meter (0..HUNGER_MAX) — built by fighting, spent on rites. */
  hunger?: number;
  /** The equipped RITE (id into content/rites.ts) — the active-ability slot. */
  riteId?: string;
  /** Healing-flask (Estus) state — charges/capacity/heal, per-run. Refilled at
   *  the bonfire. Optional for older saves (restored to a full base flask). */
  flask?: FlaskState;
}

/** The Hunger meter's ceiling. Built by fighting, spent on rites (the active
 *  lane). Exported so the rite button can show the fill fraction. */
export const HUNGER_MAX = 100;

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
    actEntryKills: 0,
    actEntryXp: 0,
    actEntryGold: 0,
    cards: [],
    hunger: 0,
    // v1: start with Hemorrhage equipped so the rite loop is immediately
    // playable. TODO: rites become FOUND in the deep (pried from altars/
    // corpses/bosses) once the rite-drop system lands.
    riteId: 'hemorrhage',
  };
  // Fresh run = no inherited mutations. Any prior run's tainted brands
  // die with their delver.
  clearMutations();
  clearPhialIdentities();
  clearChoices();
  // Fresh, full flask (a second run in the same session mustn't inherit the
  // last delver's depleted/upgraded flask).
  resetFlask();
}

/** Hydrate memory state from a saved run. Used on CONTINUE. Fills in
 *  defaults for fields that may be missing from older save versions. */
export function adoptSave(save: SaveData) {
  inMemory = {
    ...save,
    xp: save.xp ?? 0,
    gold: save.gold ?? 0,
    hunger: save.hunger ?? 0,
    riteId: save.riteId ?? 'hemorrhage',   // v1 default; becomes a found drop later
  };
  hydrateMutations(save.mutations);
  hydratePhialIdentities(save.phials);
  hydrateChoices(save.choices);
  restoreFlask(save.flask);   // full base flask when the save predates the field
}

export function grantXp(amount: number): void {
  if (!LEVELS_ENABLED) return;   // XP/levels disabled for now (#102) — no accrual, no level:up
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

/** Fate cards held this run — the Spread (ids into content/cards.ts). */
export function getHeldCards(): string[] {
  return inMemory?.cards ?? [];
}

/** Add a fate card to the Spread (idempotent by id). */
export function grantCard(id: string): void {
  if (!inMemory) return;
  (inMemory.cards ??= []);
  if (!inMemory.cards.includes(id)) inMemory.cards.push(id);
}

// ── Hunger (the rite resource) + the equipped Rite ──────────────────────────
/** Current Hunger (0..HUNGER_MAX). */
export function getHunger(): number {
  return inMemory?.hunger ?? 0;
}

/** Feed the meter (kills/hits). Clamped to HUNGER_MAX. */
export function grantHunger(amount: number): void {
  if (!inMemory || amount <= 0) return;
  inMemory.hunger = Math.min(HUNGER_MAX, (inMemory.hunger ?? 0) + amount);
}

/** Spend Hunger if affordable. Returns true + deducts when it lands. */
export function spendHunger(amount: number): boolean {
  if (!inMemory || (inMemory.hunger ?? 0) < amount) return false;
  inMemory.hunger = (inMemory.hunger ?? 0) - amount;
  return true;
}

/** The equipped rite id (into content/rites.ts), or null when none. */
export function getEquippedRite(): string | null {
  return inMemory?.riteId ?? null;
}

/** Equip a rite into the single rite slot (the loadout — swap freely). */
export function equipRite(id: string | null): void {
  if (!inMemory) return;
  inMemory.riteId = id ?? undefined;
}

/** Attempt to spend gold. Returns true and deducts when affordable; false
 *  (no change) when the run can't afford it. The merchant/shop sink. */
export function spendGold(amount: number): boolean {
  if (!inMemory || amount <= 0) return false;
  if (inMemory.gold < amount) return false;
  inMemory.gold -= amount;
  return true;
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

/** Snapshot kills/xp/gold totals at the start of the current act.
 *  Called from the run-state listener when level:loaded crosses into
 *  the first depth of an act. Idempotent if called repeatedly on the
 *  same act-start depth — diffs come out as 0 either way. */
export function snapshotActEntry() {
  if (!inMemory) return;
  inMemory.actEntryKills = inMemory.kills;
  inMemory.actEntryXp    = inMemory.xp;
  inMemory.actEntryGold  = inMemory.gold;
}

/** Stats EARNED during the act the player is finishing — the deltas
 *  between live totals and the act-entry snapshot. Returns zeros if
 *  there's no live run (e.g. called before startNewRun). */
export function getActStats(): { kills: number; xp: number; gold: number } {
  if (!inMemory) return { kills: 0, xp: 0, gold: 0 };
  return {
    kills: inMemory.kills - (inMemory.actEntryKills ?? 0),
    xp:    inMemory.xp    - (inMemory.actEntryXp    ?? 0),
    gold:  inMemory.gold  - (inMemory.actEntryGold  ?? 0),
  };
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
  inMemory.character = serializeCharacter();   // persist the build at this floor entry
  inMemory.mutations = serializeMutations();   // persist active tainted brands
  inMemory.phials = serializePhialIdentities();  // persist phial knowledge
  inMemory.choices = serializeChoices();       // persist the ledger of what was taken/refused
  inMemory.flask = serializeFlask();           // persist flask charges/capacity
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
