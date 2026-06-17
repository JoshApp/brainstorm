// The sim-world boot authority — the ONE ordered place that constructs the
// shared sim subsystems a run needs to SIMULATE correctly: the pools and
// registries that enemies + combat draw on to deal damage (projectiles today,
// more later).
//
// WHY THIS EXISTS. There are two boot paths that must build the same sim world:
// main.ts (the browser) and the headless replay runner (scripts/replay-node.ts,
// the server-side validator). When these subsystem inits were loose calls
// scattered through main.ts, the headless replica silently forgot one
// (initProjectilePool + registerProjectiles) — so the stoneguard's POUND, whose
// strike fires a SHOCKWAVE PROJECTILE, never spawned headless. A run that played
// out one way in the browser replayed a different way in Node (one missing hit).
// That bug is structural: any second boot path can forget a piece, and nothing
// catches it.
//
// This is the boot twin of the sim-state reset registry (engine/sim-state.ts):
// there, per-run RESET of mutable state; here, per-session INIT of shared
// subsystems. Both exist so a second boot path CAN'T drift from the first — you
// call the one authority instead of re-listing the steps.
//
// REGISTRY vs ORDERED FUNCTION. Resets are independent, so sim-state.ts is a
// registry (order-free). Inits are NOT: the projectile pool registers its
// category lights into the light pool, so the light pool must exist first. Order
// is load-bearing, so this is an explicit ordered function. Add a new
// sim-damage subsystem HERE (in dependency order) and every boot path gets it
// for free — that's what keeps the headless validator honest.
//
// SIM vs PRESENT. Only sim-critical subsystems belong here — the pools/registries
// whose ABSENCE changes the simulation (what damage lands, where things move).
// Presentation pools (gore, blade-trail, status-VFX motes, splat map, drifting
// motes) stay in main.ts: a headless replay never renders them, so they cannot
// perturb the sim digest. Keeping the split sharp is what lets the headless
// runner stay lean while still being a faithful simulation.

import * as THREE from 'three';
import { initLightPool } from '../scene/light-pool';
import { initProjectilePool } from '../combat/projectile-pool';
import { registerProjectiles } from '../content/projectiles';

/** Construct the shared sim subsystems for a session. Idempotent at the
 *  subsystem level (each init no-ops if already built), so it's safe to call
 *  once per boot. Call BEFORE the first level builds (torches/enemies register
 *  into these pools) and BEFORE any enemy can attack. */
export function bootstrapSimWorld(scene: THREE.Scene): void {
  // Order is load-bearing: the projectile pool registers its lights into the
  // light pool, so the light pool must exist first.
  initLightPool(scene);
  initProjectilePool(scene);
  // Register the built-in projectile TYPES — without this, spawnProjectile() is
  // a silent no-op on an unknown typeId and every enemy shockwave/bolt vanishes.
  registerProjectiles();
}
