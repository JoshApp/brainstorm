import { emit } from '../broadcast/event-bus';
import { CONFIG } from '../config';

// THE EMBER — borrowed life, spent before your own.
//
// A second, TEMPORARY health layer that sits on top of your real hearts. Damage
// eats the ember first; only when it gutters out does the blow reach you.
//
// Why this exists (docs/POWER-AND-WEAPONS.md, and the Isaac heart taxonomy):
// DELVE is building an economy where HEALTH IS A CURRENCY — toothed doorways,
// blood altars, the blood market, deals paid in flesh. With a SINGLE health pool
// that economy is a death spiral: every purchase moves you strictly closer to
// dying, so the correct play is never to buy, and the whole layer goes unused.
// A disposable buffer is what converts "pay blood for power" from suicide into a
// STRATEGY — you can run a build that farms embers and spends them freely.
//
// Rules that keep it honest:
//   - It is NOT healing. The flask, fountains and the haven basin restore your
//     real hearts and never touch the ember; you cannot top it up by resting.
//   - It only comes from the deep — bargains, offerings, the things that give
//     while taking. Borrowed, never earned.
//   - It PERSISTS across floors (it's yours until something takes it), but it
//     dies with the run. That means it SERIALIZES — see state/run-state.ts.
//   - It is spent FIRST and always: no choosing to "save" it as a damage buffer.
//     But it CAN be spent deliberately as a PRICE (spendEmber) — that's the whole
//     point of a second pool: a bargain you pay in borrowed life costs you a
//     buffer, not a step toward death.
//   - It is CAPPED. An uncapped buffer turns into invulnerability the moment a
//     build farms it; the cap is what keeps a bargain a decision.

/** Ember is measured in the same units as HP so damage maths stays one currency. */
let ember = 0;

const listeners = new Set<() => void>();
function notify() { for (const fn of listeners) fn(); }

/** Subscribe to ember changes (HUD). Returns unsubscribe. */
export function onEmberChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getEmber(): number { return ember; }

/**
 * Grant borrowed life. Sources: the bonfire, bargains, offerings — the deep's
 * gifts. Clamped to the cap, and a grant that would overflow is topped off
 * rather than refused, so the player is never punished for taking one.
 *
 * Returns how much ACTUALLY landed (0 when you were already full), so a caller
 * can say "+2 EMBER" or say nothing, instead of promising a gift the cap ate.
 */
export function grantEmber(amount: number): number {
  if (amount <= 0) return 0;
  const before = ember;
  ember = Math.min(CONFIG.EMBER_MAX, ember + amount);
  const gained = ember - before;
  if (gained <= 0) return 0;
  emit({ type: 'ember:changed', value: ember });
  notify();
  return gained;
}

/**
 * Spend ember as a PRICE (a bargain, a toll, a door that wants borrowed life).
 * All-or-nothing: returns false and takes nothing when you can't cover it, so a
 * caller never half-charges you. This is the other half of the two-pool design —
 * without it the ember is just a shield, and the "health as currency" economy it
 * exists to enable never gets a currency to spend.
 */
export function spendEmber(amount: number): boolean {
  if (amount <= 0) return true;
  if (ember < amount) return false;
  ember -= amount;
  emit({ type: 'ember:changed', value: ember });
  notify();
  return true;
}

/** Snapshot for the run save — the ember survives a descent (state/run-state). */
export function serializeEmber(): number { return ember; }

/**
 * Absorb incoming damage. Returns how much SURVIVED the ember and must be
 * applied to real health. Called by damagePlayer before it touches the pool —
 * the single place the layering is enforced.
 */
export function absorbWithEmber(amount: number): number {
  if (amount <= 0 || ember <= 0) return amount;
  const eaten = Math.min(ember, amount);
  ember -= eaten;
  emit({ type: 'ember:changed', value: ember });
  notify();
  return amount - eaten;
}

/** Set on a fresh run (0) or a save restore (the saved value). Clamped to the
 *  cap so a legacy save can't restore an impossible buffer. */
export function resetEmber(value = 0): void {
  ember = Math.max(0, Math.min(CONFIG.EMBER_MAX, value));
  notify();
}
