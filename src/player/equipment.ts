import type { ItemSpec, ItemKind } from '../content/items';
import type { AffixInstance } from '../content/affixes';
import type { StatModifier } from '../combat/modifiers';
import { collectActiveSetBonuses } from '../content/sets';
import { cardOnHitVictim } from '../content/cards';
import { getHeldCards } from '../state/run-state';
import { addRelic, getReliquary } from './reliquary';

// Equipment slots. Three gear slots (docs/BUILD-ECONOMY.md): weapon,
// offhand, vestment (one worn garment). Each slot holds at most one
// ItemSpec (or null).
//
// On pickup, ItemKind decides what happens:
//   'weapon' / 'offhand' / 'vestment' -> the matching slot (auto-equip if
//                                        empty; a weapon always swaps)
//   'relic'      -> never a slot: auto-collects into the reliquary
//                   (player/reliquary.ts), stacks uncapped, all apply
//   'consumable' / 'key' -> inventory only (never auto-equip)
//
// The actual "what's in inventory" tracking lives in src/player/inventory.ts —
// this module only owns what's CURRENTLY EQUIPPED. Pickup logic decides
// auto-equip; whatever doesn't auto-equip stays in inventory.
// TWO vestment slots (task #99). Vestments are no longer "armour stat sticks" —
// they're worn build pieces defined by UNIQUE EFFECTS (movespeed, lifesteal, a
// crit charm, and yes sometimes armour), mix-and-matched across the two slots.
// 'vestment' is the first slot (kept by name for save compatibility); 'vestment2'
// the second. Both are full members of `slots`, so their modifiers / on-hits /
// set-pieces flow through the aggregation exactly like the first one always did.
export type EquipSlot = 'weapon' | 'offhand' | 'vestment' | 'vestment2';

export interface Equipment {
  weapon:    ItemSpec | null;
  offhand:   ItemSpec | null;
  vestment:  ItemSpec | null;
  vestment2: ItemSpec | null;
}

const slots: Equipment = {
  weapon:    null,
  offhand:   null,
  vestment:  null,
  vestment2: null,
};

// ── Affix sidecar ────────────────────────────────────────────────────
// Per-slot rolled affixes from the most recent pickup. Cleared whenever
// a slot is replaced via setSlot or unequipped via unequipSlot.
// Aggregated by src/combat/modifiers.ts into the central stat pipeline,
// and read by the inventory panel to display "scimitar of the keening".
const slotAffixes: Record<EquipSlot, AffixInstance[]> = {
  weapon: [], offhand: [], vestment: [], vestment2: [],
};

// ── The sheathed alternate (weapon loadout — task #96) ───────────────
// A SECOND weapon the delver carries but isn't wielding. Deliberately NOT a
// member of `slots`, so it contributes ZERO stats / on-hits / set-pieces while
// sheathed (a holstered blade shouldn't buff you) — it simply isn't in the
// aggregation pipeline. `swapWeapons()` exchanges it with the drawn `weapon`
// slot, so all combat/stat code keeps reading `slots.weapon` (the drawn one)
// unchanged. Carry cap: at most weapon + sidearm = TWO weapons on the body.
let sidearm: ItemSpec | null = null;
let sidearmAffixes: AffixInstance[] = [];

/** The sheathed alternate weapon (null if only carrying one). */
export function getSidearm(): ItemSpec | null { return sidearm; }
export function getSidearmAffixes(): readonly AffixInstance[] { return sidearmAffixes; }

/** Carry a weapon as the sheathed alternate. Replaces whatever was sheathed. */
export function setSidearm(item: ItemSpec | null, affixes: AffixInstance[] = []): void {
  sidearm = item;
  sidearmAffixes = item ? affixes : [];
  notify();
}

/** Swap a NEW weapon into the sheathed slot, returning whatever was there
 *  (+ its affixes) so the caller can drop it back into the world. The drawn
 *  weapon is untouched. Used by the ground-equip swap-or-leave flow. */
export function replaceSidearmReturning(
  item: ItemSpec, affixes: AffixInstance[] = [],
): { item: ItemSpec | null; affixes: AffixInstance[] } {
  const prev = { item: sidearm, affixes: sidearmAffixes };
  sidearm = item;
  sidearmAffixes = item ? affixes : [];
  notify();
  return prev;
}

/** Swap a NEW item into a slot, returning the displaced occupant (+ affixes).
 *  Same contract as replaceSidearmReturning but for the `slots`-backed slots
 *  (drawn weapon, offhand, both vestments). The ground-equip compare uses this
 *  to eject the chosen piece onto the floor. */
export function replaceSlotReturning(
  slot: EquipSlot, item: ItemSpec, affixes: AffixInstance[] = [],
): { item: ItemSpec | null; affixes: AffixInstance[] } {
  const prev = { item: slots[slot], affixes: slotAffixes[slot] };
  slots[slot] = item;
  slotAffixes[slot] = affixes;
  notify();
  return prev;
}

/** Draw the sheathed weapon — exchange it with the wielded one (+ its affixes).
 *  The drawn weapon is always `slots.weapon`, so combat + the viewmodel listener
 *  pick up the change for free. Returns true if a swap happened (needs at least
 *  one weapon on the body). */
export function swapWeapons(): boolean {
  if (!sidearm && !slots.weapon) return false;
  const w = slots.weapon, wa = slotAffixes.weapon;
  slots.weapon = sidearm; slotAffixes.weapon = sidearmAffixes;
  sidearm = w; sidearmAffixes = wa;
  notify();
  return true;
}

type EquipListener = (eq: Readonly<Equipment>) => void;
const listeners = new Set<EquipListener>();

function notify() {
  for (const fn of listeners) fn(slots);
}

/** Subscribe to equipment changes. Returns an unsubscribe function. */
export function onEquipmentChanged(fn: EquipListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getEquipment(): Readonly<Equipment> {
  return slots;
}

export function getEquipped(slot: EquipSlot): ItemSpec | null {
  return slots[slot];
}

/** Place an item directly into a slot, replacing whatever was there.
 *  Always clears any rolled affixes on the slot — call setSlotWithAffixes
 *  if you want to install with rolled affixes attached. */
export function setSlot(slot: EquipSlot, item: ItemSpec | null) {
  slots[slot] = item;
  slotAffixes[slot] = [];
  notify();
}

/** Like setSlot but ALSO attaches rolled affixes to the slot. Used by
 *  pickup.ts when an auto-equip happens against a freshly rolled
 *  instance — preserves "scimitar of the keening" through aggregation. */
export function setSlotWithAffixes(slot: EquipSlot, item: ItemSpec | null, affixes: AffixInstance[]) {
  slots[slot] = item;
  slotAffixes[slot] = item ? affixes : [];
  notify();
}

/** Affixes currently rolled on the item occupying this slot. Empty if
 *  the slot is empty OR if the slot was filled without affix data
 *  (manual equip from bag, save restore — both bypass roll for now). */
export function getSlotAffixes(slot: EquipSlot): readonly AffixInstance[] {
  return slotAffixes[slot];
}

/** Flat list of every affix-rolled modifier across all equipped slots.
 *  Consumed by the central stat aggregator in src/combat/modifiers.ts. */
export function aggregateAffixModifiers(): StatModifier[] {
  const out: StatModifier[] = [];
  for (const slot of Object.keys(slotAffixes) as EquipSlot[]) {
    for (const a of slotAffixes[slot]) out.push(...a.modifiers);
  }
  // Relic affixes apply too (a rolled relic like a "keening" fetish).
  for (const r of getReliquary()) for (const a of r.affixes) out.push(...a.modifiers);
  return out;
}

/** Set contributions from the reliquary — DISTINCT belongings only. A
 *  duplicate relic stacks its own payload but never advances a provenance
 *  set (a second copy of the same thimble is not "two of Maren's things"). */
function relicSetIds(): (string | undefined)[] {
  const seen = new Set<string>();
  const out: (string | undefined)[] = [];
  for (const r of getReliquary()) {
    if (seen.has(r.spec.id)) continue;
    seen.add(r.spec.id);
    out.push(r.spec.setId);
  }
  return out;
}

/** Modifiers from every ACTIVE set bonus (enough pieces equipped). Same
 *  central-pipeline citizen as affix + buff modifiers; consumed by
 *  src/combat/modifiers.ts. */
export function aggregateSetModifiers(): StatModifier[] {
  const setIds: (string | undefined)[] = (Object.keys(slots) as EquipSlot[]).map((s) => slots[s]?.setId);
  setIds.push(...relicSetIds());
  const out: StatModifier[] = [];
  for (const b of collectActiveSetBonuses(setIds)) {
    if (b.modifiers) out.push(...b.modifiers);
  }
  return out;
}

export interface PlayerOnHit { buffId: string; chance: number; flurryChance?: number; duration: number; }

/** Every on-hit status the player currently inflicts, from all sources:
 *  the equipped weapon's base on-hit, any on-hit AFFIXES rolled on the
 *  weapon, and any active SET on-hit bonuses (player-wide). Combat rolls
 *  each independently on a landed hit (melee cone or ranged bolt), so a
 *  serrated venom-etched needle in the bone set bleeds AND poisons AND
 *  set-poisons. Single source of truth — see combat/attack.ts. */
export function getPlayerOnHits(): PlayerOnHit[] {
  const out: PlayerOnHit[] = [];
  const w = slots.weapon;
  if (w?.weapon?.onHit) out.push(w.weapon.onHit);
  for (const a of slotAffixes.weapon) if (a.onHit) out.push(a.onHit);
  // Item-level onHit from ANY equipped slot — amulets/rings/armor can
  // grant on-hit effects too (e.g. the Acid Tongue amulet's poison).
  // Iterates every slot, including weapon (so a weapon could carry
  // BOTH a weapon.onHit and an item.onHit — they stack independently).
  for (const slot of Object.keys(slots) as EquipSlot[]) {
    const item = slots[slot];
    if (item?.onHit) out.push(item.onHit);
  }
  // RELIQUARY on-hits — every collected relic's on-hit + its affix on-hits apply.
  for (const r of getReliquary()) {
    if (r.spec.onHit) out.push(r.spec.onHit);
    for (const a of r.affixes) if (a.onHit) out.push(a.onHit);
  }
  const setIds: (string | undefined)[] = (Object.keys(slots) as EquipSlot[]).map((s) => slots[s]?.setId);
  setIds.push(...relicSetIds());
  for (const b of collectActiveSetBonuses(setIds)) if (b.onHit) out.push(b.onHit);
  // Fate-card ON-HIT hexes (the tarot PROC, e.g. The Pyre's bleed) are just
  // another on-hit source — folded in here so combat's single on-hit loop
  // applies them to the struck enemy exactly like a serrated weapon affix.
  for (const oh of cardOnHitVictim(getHeldCards())) out.push(oh);
  return out;
}

/**
 * Try to auto-equip an item into an empty slot. Returns true if equipped,
 * false if no slot was available (caller should leave the item in inventory).
 *
 * Rules:
 *   weapon / offhand / vestment -> the matching slot iff empty (the caller
 *                 handles the always-swap weapon path via equipFromInventory).
 *   relic      -> collects into the reliquary — never a slot, always applies.
 *   consumable / key / ember -> never auto-equipped (returns false).
 */
export function tryAutoEquip(item: ItemSpec, affixes: AffixInstance[] = []): boolean {
  switch (item.kind) {
    // A found weapon fills the drawn hand if empty, else the sheathed slot if
    // empty (so a second weapon becomes your alternate automatically). Both full
    // → false, caller leaves it in the bag (the swap-or-leave cap is a follow-up).
    case 'weapon':
      if (autoFillSingle('weapon', item, affixes)) return true;
      if (!sidearm) { setSidearm(item, affixes); return true; }
      return false;
    case 'offhand':  return autoFillSingle('offhand', item, affixes);
    // A vestment fills the first free of the two slots (either, both build-defining).
    case 'vestment':
      return autoFillSingle('vestment', item, affixes) || autoFillSingle('vestment2', item, affixes);
    // Relics COLLECT into the reliquary — never a slot, always applies.
    case 'relic':    addRelic(item, affixes); return true;
    // A RITE is not equipment. Taking one adds it to the run's carried rites
    // (player/inventory.ts intercepts the pickup and calls grantRite); the
    // ACTIVE slot is chosen in the rite panel, not filled by whatever you
    // happened to walk over last. Auto-equipping it here would quietly re-arm
    // your loadout every time you found one.
    case 'rite':
    case 'consumable':
    case 'key':
    // An ember is consumed on touch (pickup.ts) and never reaches the bag or a
    // slot — it's a resource, not an item you carry.
    case 'ember':
      return false;
  }
}

function autoFillSingle(slot: EquipSlot, item: ItemSpec, affixes: AffixInstance[] = []): boolean {
  if (slots[slot]) return false;
  slots[slot] = item;
  slotAffixes[slot] = affixes;
  notify();
  return true;
}

/** Type of slot that a given item kind can go into. */
export function slotKindFor(kind: ItemKind): EquipSlot[] {
  switch (kind) {
    case 'weapon':     return ['weapon'];
    case 'offhand':    return ['offhand'];
    case 'vestment':   return ['vestment', 'vestment2'];
    // Neither relics nor rites occupy an equipment slot: relics collect into
    // the reliquary, rites into the run's carried set with one armed.
    case 'rite':
    case 'relic':
    case 'consumable':
    case 'key':
    case 'ember':      return [];
  }
}

/**
 * Equip an item INTO a specific slot (or the natural slot for its kind).
 * The previous occupant is returned so the caller can put it back in the
 * inventory bag. Used by the inventory panel's tap-to-equip handler.
 *
 * If no specific slot is given:
 *   - weapon / offhand / vestment -> the matching slot (replace, return old)
 *   - relic -> collects into the reliquary (no slot, no displacement)
 *   - consumable / key -> not equippable; returns null
 */
export function equipFromInventory(item: ItemSpec, targetSlot?: EquipSlot): ItemSpec | null {
  let slot: EquipSlot | null = null;
  if (targetSlot) {
    slot = targetSlot;
  } else {
    switch (item.kind) {
      case 'weapon':   slot = 'weapon'; break;
      case 'offhand':  slot = 'offhand'; break;
      // Equip into the first FREE vestment slot; if both full, replace the first.
      case 'vestment': slot = slots.vestment ? (slots.vestment2 ? 'vestment' : 'vestment2') : 'vestment'; break;
      // Equipping a relic from the bag = collecting it (no slot, no displacement).
      case 'relic':    addRelic(item); return null;
      case 'consumable':
      case 'key':      return null;
    }
  }
  if (!slot) return null;
  const prev = slots[slot];
  slots[slot] = item;
  // Manual equips from inventory don't carry affix data (the bag
  // doesn't track them in V1). Reset the sidecar to keep "what's in
  // this slot" and "what affixes apply" consistent.
  slotAffixes[slot] = [];
  notify();
  return prev;
}

/** Remove the item in a slot and return it. */
export function unequipSlot(slot: EquipSlot): ItemSpec | null {
  const prev = slots[slot];
  if (!prev) return null;
  slotAffixes[slot] = [];
  slots[slot] = null;
  notify();
  return prev;
}
