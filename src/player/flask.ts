import { CONFIG } from '../config';

// The healing FLASK (Estus) — docs/LOOT-PUNCHLIST.md #3, charter in the loot
// economy thread. The player's PRIMARY sustain: a fixed pool of CHARGES that
// refills at the bonfire, not scattered single-use potions. This makes healing a
// managed resource — every fire is a "push deeper or bank here" decision.
//
// A first-class per-run resource (module-level state, the codebase pattern), NOT
// an inventory item — the inventory is a simple id→count multiset that can't hold
// "charges." The consumable bar renders a dedicated always-present flask button
// bound to this module (src/controls/consumable-bar.ts).
//
// Stage 1 (now): per-run charges + capacity, refilled on bonfire REST. Shards
// (grow capacity) and refill-draughts (top up) call addCapacity / addCharges in
// Stage 2. Meta capacity growth across runs is deferred (per-run only for now).

export interface FlaskState {
  charges: number;        // current uses available
  capacity: number;       // max charges (grows this run via shards)
  healPerCharge: number;  // HP restored per drink (grows this run via +heal shards)
}

const listeners = new Set<() => void>();
/** Subscribe to flask changes (the HUD button redraws its charge count). */
export function onFlaskChanged(fn: () => void): void { listeners.add(fn); }
function notify(): void { for (const fn of listeners) fn(); }

let capacity = CONFIG.FLASK.START_CAPACITY;
let charges = capacity;
let healPerCharge = CONFIG.FLASK.HEAL_PER_CHARGE;

/** Snapshot of live flask state — for the HUD readout. */
export function getFlask(): FlaskState { return { charges, capacity, healPerCharge }; }

/** True if a charge is available to spend. */
export function hasCharge(): boolean { return charges > 0; }

/** Spend one charge if available; returns true when one was consumed. The heal
 *  itself is applied by the caller (consumable-bar) — flask.ts stays pure state
 *  with no dependency on the health/transform chain (avoids an import cycle:
 *  run-state → flask must NOT pull in health). */
export function spendCharge(): boolean {
  if (charges <= 0) return false;
  charges -= 1;
  notify();
  return true;
}

/** Refill to capacity — the bonfire REST. */
export function refillFlask(): void {
  if (charges === capacity) return;
  charges = capacity;
  notify();
}

/** Add charges NOW (a refill-draught), clamped to capacity. Returns amount added. */
export function addCharges(n: number): number {
  const before = charges;
  charges = Math.max(0, Math.min(capacity, charges + n));
  if (charges !== before) notify();
  return charges - before;
}

/** Grow capacity permanently THIS RUN (a flask shard). `fill` tops up the new
 *  charge(s) so the shard feels immediately rewarding. */
export function addCapacity(n: number, fill = true): void {
  if (n <= 0) return;
  capacity += n;
  if (fill) charges = Math.min(capacity, charges + n);
  notify();
}

/** Grow heal-per-charge permanently this run (a deep-draught shard). */
export function addHealPerCharge(n: number): void {
  if (n <= 0) return;
  healPerCharge += n;
  notify();
}

/** Reset to the run baseline — full flask, base capacity. Called on a fresh run
 *  (so a second run in the same session doesn't inherit the last one's flask). */
export function resetFlask(): void {
  capacity = CONFIG.FLASK.START_CAPACITY;
  healPerCharge = CONFIG.FLASK.HEAL_PER_CHARGE;
  charges = capacity;
  notify();
}

// ── Persistence (per-run; saved at each floor entry, restored on CONTINUE) ──
export function serializeFlask(): FlaskState { return { charges, capacity, healPerCharge }; }

export function restoreFlask(s?: Partial<FlaskState>): void {
  if (!s) { resetFlask(); return; }
  capacity = s.capacity ?? CONFIG.FLASK.START_CAPACITY;
  healPerCharge = s.healPerCharge ?? CONFIG.FLASK.HEAL_PER_CHARGE;
  charges = Math.max(0, Math.min(capacity, s.charges ?? capacity));
  notify();
}
