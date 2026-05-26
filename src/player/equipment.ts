import type { ItemSpec, ItemKind } from '../content/items';

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

/** Place an item directly into a slot, replacing whatever was there. */
export function setSlot(slot: EquipSlot, item: ItemSpec | null) {
  slots[slot] = item;
  notify();
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
export function tryAutoEquip(item: ItemSpec): boolean {
  switch (item.kind) {
    case 'weapon': {
      slots.weapon = item;
      notify();
      return true;
    }
    case 'armor':   return autoFillSingle('armor', item);
    case 'helmet':  return autoFillSingle('helmet', item);
    case 'amulet':  return autoFillSingle('amulet', item);
    case 'gloves':  return autoFillSingle('gloves', item);
    case 'boots':   return autoFillSingle('boots', item);
    case 'offhand': return autoFillSingle('offhand', item);
    case 'ring': {
      if (!slots.ring1) { slots.ring1 = item; notify(); return true; }
      if (!slots.ring2) { slots.ring2 = item; notify(); return true; }
      return false;
    }
    case 'consumable':
      return false;
  }
}

function autoFillSingle(slot: EquipSlot, item: ItemSpec): boolean {
  if (slots[slot]) return false;
  slots[slot] = item;
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
  notify();
  return prev;
}

/** Remove the item in a slot and return it. */
export function unequipSlot(slot: EquipSlot): ItemSpec | null {
  const prev = slots[slot];
  if (!prev) return null;
  slots[slot] = null;
  notify();
  return prev;
}
