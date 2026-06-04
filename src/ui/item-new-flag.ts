// "NEW" item flagging for the inventory — so the player instantly sees
// what they just picked up (playtest ask). Items picked up while the
// menu is closed accumulate as PENDING; opening the GEAR tab promotes
// them to the current view's "new" set (badge + sorted first) and clears
// pending, so they read as new exactly once.

const pending = new Set<string>();   // picked up, not yet surfaced
let inView = new Set<string>();      // new as of the current inventory open

/** Flag an item id as newly acquired (call on pickup). */
export function markItemNew(id: string): void {
  pending.add(id);
}

/** Promote pending → the current view (call once when the bag opens). */
export function openInventoryView(): void {
  inView = new Set(pending);
  pending.clear();
}

/** Is this id NEW for the current inventory view? (badge + sort). */
export function isNewInView(id: string): boolean {
  return inView.has(id);
}

/** Are there pending new items? (for a future HUD dot on the satchel). */
export function hasPendingNew(): boolean {
  return pending.size > 0;
}
