import { emit } from '../broadcast/event-bus';

// Player inventory — for now, just a multiset of item ids (the ModelSpec.id
// of each picked-up item). Future commits add equipment slots, stack counts,
// stat aggregation from equipped items, and a UI to view contents.
//
// For this commit, inventory exists so pickups have something to write to and
// the pickup-notification has something to read.

const counts = new Map<string, number>();

export function addItem(itemId: string) {
  counts.set(itemId, (counts.get(itemId) ?? 0) + 1);
  emit({ type: 'item:picked-up', itemId });
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
}

export function getAllItems(): Array<{ id: string; count: number }> {
  return [...counts.entries()].map(([id, count]) => ({ id, count }));
}

export function clearInventory() {
  counts.clear();
}
