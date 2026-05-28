// Always-imported pause + tick-budget hook for the harness.
//
// This file is the ONE harness module that gets bundled into every build,
// because world-paused.ts has to OR in `isHarnessPaused()` at the same
// composition point as the other pause sources. The rest of src/harness/*
// is dynamic-imported only when ?harness=1 is set, so a player build
// pays nothing beyond a flag and a no-op tick.
//
// The harness operates in TURN-BASED mode: world stays paused by default;
// each action requests a tick budget that briefly unpauses the world for
// either a fixed real-time window OR until a predicate fires (e.g.,
// "until the sword swing returns to idle"). The budget tick runs from
// main.ts's tick loop with realDt.

export type BudgetEndReason = 'timeout' | 'predicate' | 'cancelled';
export type BudgetEnd = { reason: BudgetEndReason; elapsed: number };

let paused = false;
let budgetActive = false;
let budgetMaxSeconds = Infinity;
let budgetElapsed = 0;
let stopPredicate: (() => boolean) | null = null;
let resolver: ((end: BudgetEnd) => void) | null = null;

export function isHarnessPaused(): boolean {
  return paused;
}

export function setHarnessPaused(p: boolean): void {
  paused = p;
}

/** Unpause for at most `maxSeconds` of real time, or until `stopWhen`
 *  returns true (checked once per frame). Resolves with the end reason
 *  + elapsed seconds. Re-pauses automatically on end. */
export function requestTickBudget(opts: {
  maxSeconds?: number;
  stopWhen?: () => boolean;
}): Promise<BudgetEnd> {
  if (budgetActive) endTickBudget('cancelled');
  budgetActive = true;
  budgetMaxSeconds = opts.maxSeconds ?? Infinity;
  budgetElapsed = 0;
  stopPredicate = opts.stopWhen ?? null;
  paused = false;
  return new Promise((resolve) => { resolver = resolve; });
}

/** Called once per frame from the main loop with realDt. Cheap when no
 *  budget is active (one branch). */
export function consumeTickBudget(realDt: number): void {
  if (!budgetActive) return;
  if (stopPredicate && stopPredicate()) { endTickBudget('predicate'); return; }
  budgetElapsed += realDt;
  if (budgetElapsed >= budgetMaxSeconds) endTickBudget('timeout');
}

function endTickBudget(reason: BudgetEndReason): void {
  const elapsed = budgetElapsed;
  budgetActive = false;
  paused = true;
  const r = resolver;
  resolver = null;
  stopPredicate = null;
  if (r) r({ reason, elapsed });
}
