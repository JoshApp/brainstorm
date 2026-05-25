import { emit } from '../broadcast/event-bus';

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

/** Add an item and fire the pickup event (notification toast triggers). */
export function addItem(itemId: string) {
  counts.set(itemId, (counts.get(itemId) ?? 0) + 1);
  emit({ type: 'item:picked-up', itemId });
  notify();
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
