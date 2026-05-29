import type { ItemSpec, ItemKind } from '../content/items';
import type { AffixInstance } from '../content/affixes';
import type { StatModifier } from '../combat/modifiers';
import { collectActiveSetBonuses } from '../content/sets';

// Equipment slots. Four slots total: weapon, armor, ring1, ring2. Each
// slot holds at most one ItemSpec (or null).
//
// On pickup, ItemKind determines which slot the item targets:
//   'weapon'   -> weapon slot (always swaps; old weapon goes to inventory)
//   'armor'    -> armor slot  (auto-equip if empty, else inventory)
//   'ring'     -> first empty ring slot (auto-equip if either empty)
//   'consumable' -> inventory only (never auto-equip)
//
// The actual "what's in inventory" tracking lives in src/player/inventory.ts —
// this module only owns what's CURRENTLY EQUIPPED. Pickup logic decides
// auto-equip; whatever doesn't auto-equip stays in inventory.

export type EquipSlot =
  | 'weapon' | 'armor' | 'ring1' | 'ring2'
  | 'helmet' | 'amulet' | 'gloves' | 'boots' | 'offhand';

export interface Equipment {
  weapon:  ItemSpec | null;
  armor:   ItemSpec | null;
  ring1:   ItemSpec | null;
  ring2:   ItemSpec | null;
  helmet:  ItemSpec | null;
  amulet:  ItemSpec | null;
  gloves:  ItemSpec | null;
  boots:   ItemSpec | null;
  offhand: ItemSpec | null;
}

const slots: Equipment = {
  weapon:  null,
  armor:   null,
  ring1:   null,
  ring2:   null,
  helmet:  null,
  amulet:  null,
  gloves:  null,
  boots:   null,
  offhand: null,
};

// ── Affix sidecar ────────────────────────────────────────────────────
// Per-slot rolled affixes from the most recent pickup. Cleared whenever
// a slot is replaced via setSlot or unequipped via unequipSlot.
// Aggregated by src/combat/modifiers.ts into the central stat pipeline,
// and read by the inventory panel to display "scimitar of the keening".
const slotAffixes: Record<EquipSlot, AffixInstance[]> = {
  weapon:  [], armor:   [], ring1:   [], ring2:   [],
  helmet:  [], amulet:  [], gloves:  [], boots:   [], offhand: [],
};

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
  return out;
}

/** Modifiers from every ACTIVE set bonus (enough pieces equipped). Same
 *  central-pipeline citizen as affix + buff modifiers; consumed by
 *  src/combat/modifiers.ts. */
export function aggregateSetModifiers(): StatModifier[] {
  const setIds = (Object.keys(slots) as EquipSlot[]).map((s) => slots[s]?.setId);
  const out: StatModifier[] = [];
  for (const b of collectActiveSetBonuses(setIds)) {
    if (b.modifiers) out.push(...b.modifiers);
  }
  return out;
}

export interface PlayerOnHit { buffId: string; chance: number; duration: number; }

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
  const setIds = (Object.keys(slots) as EquipSlot[]).map((s) => slots[s]?.setId);
  for (const b of collectActiveSetBonuses(setIds)) if (b.onHit) out.push(b.onHit);
  return out;
}

/**
 * Try to auto-equip an item into an empty slot. Returns true if equipped,
 * false if no slot was available (caller should leave the item in inventory).
 *
 * Rules:
 *   weapon     -> always equips into the weapon slot (old weapon is returned
 *                 via the equipped-slot's previous value, caller decides what
 *                 to do — typically pushed back into inventory).
 *   armor      -> equips into armor slot iff empty.
 *   ring       -> equips into ring1 if empty, else ring2 if empty, else nope.
 *   consumable -> never auto-equipped (returns false).
 */
export function tryAutoEquip(item: ItemSpec, affixes: AffixInstance[] = []): boolean {
  switch (item.kind) {
    case 'weapon':  return autoFillSingle('weapon', item, affixes);
    case 'armor':   return autoFillSingle('armor', item, affixes);
    case 'helmet':  return autoFillSingle('helmet', item, affixes);
    case 'amulet':  return autoFillSingle('amulet', item, affixes);
    case 'gloves':  return autoFillSingle('gloves', item, affixes);
    case 'boots':   return autoFillSingle('boots', item, affixes);
    case 'offhand': return autoFillSingle('offhand', item, affixes);
    case 'ring': {
      if (!slots.ring1) { slots.ring1 = item; slotAffixes.ring1 = affixes; notify(); return true; }
      if (!slots.ring2) { slots.ring2 = item; slotAffixes.ring2 = affixes; notify(); return true; }
      return false;
    }
    case 'consumable':
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
    case 'armor':      return ['armor'];
    case 'helmet':     return ['helmet'];
    case 'amulet':     return ['amulet'];
    case 'gloves':     return ['gloves'];
    case 'boots':      return ['boots'];
    case 'offhand':    return ['offhand'];
    case 'ring':       return ['ring1', 'ring2'];
    case 'consumable': return [];
  }
}

/**
 * Equip an item INTO a specific slot (or the natural slot for its kind).
 * The previous occupant is returned so the caller can put it back in the
 * inventory bag. Used by the inventory panel's tap-to-equip handler.
 *
 * If no specific slot is given:
 *   - weapon -> weapon slot
 *   - armor -> armor slot
 *   - ring -> first empty ring slot, else ring1 (replace, return old)
 *   - consumable -> not equippable; returns null
 */
export function equipFromInventory(item: ItemSpec, targetSlot?: EquipSlot): ItemSpec | null {
  let slot: EquipSlot | null = null;
  if (targetSlot) {
    slot = targetSlot;
  } else {
    switch (item.kind) {
      case 'weapon':  slot = 'weapon'; break;
      case 'armor':   slot = 'armor'; break;
      case 'helmet':  slot = 'helmet'; break;
      case 'amulet':  slot = 'amulet'; break;
      case 'gloves':  slot = 'gloves'; break;
      case 'boots':   slot = 'boots'; break;
      case 'offhand': slot = 'offhand'; break;
      case 'ring':    slot = !slots.ring1 ? 'ring1' : !slots.ring2 ? 'ring2' : 'ring1'; break;
      case 'consumable': return null;
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
