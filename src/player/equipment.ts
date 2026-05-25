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

export type EquipSlot = 'weapon' | 'armor' | 'ring1' | 'ring2';

export interface Equipment {
  weapon: ItemSpec | null;
  armor:  ItemSpec | null;
  ring1:  ItemSpec | null;
  ring2:  ItemSpec | null;
}

const slots: Equipment = {
  weapon: null,
  armor:  null,
  ring1:  null,
  ring2:  null,
};

const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

/** Subscribe to equipment changes. Returns an unsubscribe function. */
export function onEquipmentChanged(fn: () => void): () => void {
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
    case 'armor': {
      if (slots.armor) return false;
      slots.armor = item;
      notify();
      return true;
    }
    case 'ring': {
      if (!slots.ring1) {
        slots.ring1 = item;
        notify();
        return true;
      }
      if (!slots.ring2) {
        slots.ring2 = item;
        notify();
        return true;
      }
      return false;
    }
    case 'consumable':
      return false;
  }
}

/** Type of slot that a given item kind can go into. */
export function slotKindFor(kind: ItemKind): EquipSlot[] {
  switch (kind) {
    case 'weapon':     return ['weapon'];
    case 'armor':      return ['armor'];
    case 'ring':       return ['ring1', 'ring2'];
    case 'consumable': return [];
  }
}
