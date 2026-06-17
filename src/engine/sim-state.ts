// The run-state reset registry — the single authority for "bring all
// sim-affecting module-global state back to its run-start values."
//
// WHY THIS EXISTS (the third inversion of deterministic replay).
// A run is (seed, intentTape); replay re-derives the world from those two
// inputs. That ONLY holds if the world's ENTIRE mutable surface is captured at
// run-start. Entity state is — it lives in the ECS world Map, cleared
// atomically by world.clear(). But a lot of SIM-affecting state lives as
// module-level `let`s scattered across combat/, player/, mobs/ (i-frames,
// dodge/parry beats, cooldowns, boss-encounter flags). Before this registry the
// ONLY thing that reset them was a hand-maintained imperative list inside
// loadLevel — which every OTHER boot path (the headless replay runner, the
// sim-stepper) had to duplicate and inevitably drifted from. A new combat
// system that added a module-`let` silently widened the determinism gap.
//
// The fix: each module that owns sim-affecting state registers its reset ONCE,
// at module load, NEXT TO the state it clears. resetSimState() walks them all.
// Every boot path that starts/loads a run calls the one authority, so a new
// stateful system can't silently break determinism — it registers beside its
// state and all boot paths pick it up for free.
//
// SIM vs PRESENT: this registry is for state the SIM reads (it gates damage,
// dodge, cooldowns, AI). Presentation-only resets (camera FOV/vignette restore,
// breath puffs, the camera-stumble lurch) are NOT here — they're read only in
// the present pass, which a headless replay never runs, so they can't perturb
// the sim digest. loadLevel keeps those as an explicit, separately-labelled
// block. The split mirrors the engine's existing `kind: 'sim' | 'present'`
// system tag.

type ResetFn = () => void;

const resets: ResetFn[] = [];

/** Register a reset that brings one module's sim-affecting state back to its
 *  run-start value. Call ONCE at module load, beside the state it clears. */
export function registerSimReset(fn: ResetFn): void {
  resets.push(fn);
}

/** Bring all registered sim state to run-start. Called by every boot path that
 *  starts or loads a run (loadLevel, the headless replay runner). The resets
 *  are independent global clears, so registration order does not matter. */
export function resetSimState(): void {
  for (const fn of resets) fn();
}
