// Death-payoff registry — the substrate PAYOFF hook (docs/BUILD-ECONOMY.md).
//
// Every enemy death funnels through one chokepoint (mobs/enemy.ts, before the
// entity is destroyed), which calls fireDeathPayoffs with the DYING entity — its
// buffs still live — and its world position. Handlers inspect the dying entity's
// STATUSES and fire "on death while afflicted" effects. This is the hook that
// turns statuses from apply-and-tick into a COMBINATION engine: a dying bleeder
// chains bleed to its neighbours and feeds the blood-drinker.
//
// Handlers are registered ONCE (at combat init) and stat-gate themselves, so a
// handler is inert unless the player's build enables it — same shape as the
// on-kill lifesteal listener. Adding a new status axis (poison-detonate,
// burn-spread) is just another handler; no engine change.

import type * as THREE from 'three';
import type { Entity } from '../ecs/types';
import { DEV } from '../debug/dev';

export type DeathPayoff = (dying: Entity, pos: THREE.Vector3) => void;

const payoffs = new Set<DeathPayoff>();

/** Register a payoff fired at every enemy death (register once; stat-gate inside). */
export function registerDeathPayoff(fn: DeathPayoff): void {
  payoffs.add(fn);
}

/** Drop all payoffs (test/hot-reload hygiene). */
export function resetDeathPayoffs(): void {
  payoffs.clear();
}

/** Fire every payoff for a dying enemy. Called at the death chokepoint BEFORE
 *  the entity is destroyed, so `dying.buffs` is still valid. A throwing payoff
 *  is swallowed — a bad relic must never break the death sequence. */
export function fireDeathPayoffs(dying: Entity, pos: THREE.Vector3): void {
  if (payoffs.size === 0) return;
  for (const fn of payoffs) {
    try { fn(dying, pos); }
    catch (err) { if (DEV) console.error('[death-payoff] threw', err); }
  }
}
