import { emit } from '../broadcast/event-bus';
import { ITEMS } from '../content/items';

// Player inventory bag — multiset of item ids the player CURRENTLY holds
// but doesn't have equipped. Equipped items live in src/player/equipment.ts
// instead; the inventory module only tracks the "bag" contents.
//
// Flow:
//   pickup           -> addItem (count++)
//                       caller may then move it to equipment via
//                       equipFromInventory (which calls removeItem here)
//   equip a bag item -> removeItem (count--), equipment.equipFromInventory
//   unequip a slot   -> equipment.unequipSlot, then addItemSilently (count++)
//   use a potion     -> removeItem (count--)

const counts = new Map<string, number>();
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

/** Subscribe to inventory changes. Returns unsubscribe. */
export function onInventoryChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** True if the player is already holding the carry cap for this item. */
export function isAtCarryLimit(itemId: string): boolean {
  const limit = ITEMS[itemId]?.carryLimit;
  return limit != null && (counts.get(itemId) ?? 0) >= limit;
}

/** Add an item and fire the pickup event (notification toast triggers).
 *  Optional displayName lets callers (e.g. affix-rolled pickups) pass
 *  the decorated name so the toast can show "scimitar of the keening"
 *  instead of the plain base name. Returns false (and adds nothing) when
 *  the item is at its carry cap — callers leave the world pickup in place. */
export function addItem(itemId: string, displayName?: string): boolean {
  // The bag holds consumables, keys, and quest oddments — never gear. Weapons,
  // offhands and vestments equip straight from the world (player/ground-equip.ts)
  // and never sit in a bag to be juggled. This is the hard backstop: if a stray
  // caller tries to bag a piece of gear, refuse it here rather than let a phantom
  // weapon accumulate somewhere the player can't wear it.
  const kind = ITEMS[itemId]?.kind;
  if (kind === 'weapon' || kind === 'offhand' || kind === 'vestment') return false;
  if (isAtCarryLimit(itemId)) return false;
  counts.set(itemId, (counts.get(itemId) ?? 0) + 1);
  emit({ type: 'item:picked-up', itemId, displayName });
  notify();
  return true;
}

/** Add an item without firing the pickup event (used when un-equipping). */
export function addItemSilently(itemId: string) {
  counts.set(itemId, (counts.get(itemId) ?? 0) + 1);
  notify();
}

export function getCount(itemId: string): number {
  return counts.get(itemId) ?? 0;
}

/** Decrement the count for an item; safe to call when count is 0. */
export function removeItem(itemId: string) {
  const c = counts.get(itemId) ?? 0;
  if (c <= 0) return;
  if (c === 1) counts.delete(itemId);
  else counts.set(itemId, c - 1);
  notify();
}

export function getAllItems(): Array<{ id: string; count: number }> {
  return [...counts.entries()].map(([id, count]) => ({ id, count }));
}

export function clearInventory() {
  counts.clear();
  notify();
}
