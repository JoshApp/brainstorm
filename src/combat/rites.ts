// RITE executor — the thin imperative layer over the rite DATA (content/rites.ts).
// Builds HUNGER from combat (the meter), and fires the equipped rite when asked:
// resolve its live form by your domain commitment, pay the costs (Hunger + your
// own blood), erupt on everyone near, take the blood back. Carrier of the active
// lane; the rite itself is data, this just enacts it on the world.

import type { Enemy } from '../mobs/enemy';
import { on } from '../broadcast/event-bus';
import { RITES, resolveRite } from '../content/rites';
import { heldDomainCount } from '../content/cards';
import {
  getHunger, grantHunger, spendHunger, getEquippedRite, getHeldCards,
} from '../state/run-state';
import { bleedPlayer, healPlayer } from '../player/health';
import { get } from '../ecs/world';
import { applyBuff } from '../ecs/buffs';
import { kickShake } from './screen-shake';

interface RiteDeps {
  /** Player position source (the erupt centre). */
  getCenter: () => { x: number; z: number };
  /** Live enemy list on the current floor. */
  getEnemies: () => readonly Enemy[];
}

let deps: RiteDeps | null = null;

// Hunger gain per combat beat. Kills feed most (you're rewarded for finishing),
// hits a trickle, crits a touch more — so ~5 kills or sustained aggression banks
// a Hemorrhage (cost 50). Tunable.
const HUNGER_ON_KILL = 10;
const HUNGER_ON_HIT = 2;
const HUNGER_ON_CRIT = 1;

/** Wire the rite system: bank Hunger from combat, and remember how to reach the
 *  world (player position + enemies) for activation. Called once at boot. */
export function initRites(d: RiteDeps): void {
  deps = d;
  on((e) => {
    if (e.type === 'enemy:killed') grantHunger(HUNGER_ON_KILL);
    else if (e.type === 'attack:hit') {
      grantHunger(HUNGER_ON_HIT);
      if (e.crit) grantHunger(HUNGER_ON_CRIT);
    }
  });
}

/** Fire the equipped rite if one's slotted and Hunger affords it. Returns
 *  whether it fired. Deterministic given the world state — no RNG. */
export function tryActivateRite(): boolean {
  const id = getEquippedRite();
  if (!id || !deps) return false;
  const spec = RITES[id];
  if (!spec || getHunger() < spec.hungerCost) return false;

  const r = resolveRite(spec, heldDomainCount(getHeldCards(), spec.domain));
  spendHunger(spec.hungerCost);
  if (r.selfHpCost > 0) bleedPlayer(r.selfHpCost);   // erupt cost (floored at 1 HP)

  const c = deps.getCenter();
  const r2 = r.radius * r.radius;
  let caught = 0;
  for (const enemy of deps.getEnemies()) {
    if (!enemy.alive) continue;
    const dx = enemy.position.x - c.x;
    const dz = enemy.position.z - c.z;
    if (dx * dx + dz * dz > r2) continue;
    enemy.takeDamage({ source: 'player', target: enemy.entityId, base: r.damage, type: 'physical' });
    if (r.applyBleed) {
      const ent = get(enemy.entityId);
      if (ent) applyBuff(ent, 'bleed', 4, 'player');
    }
    caught++;
  }
  // Take the blood back — a combat heal (Red Thirst can't suppress this).
  if (caught > 0 && r.healPerHit > 0) healPlayer(caught * r.healPerHit, 'combat');

  kickShake(0.55, 0.18);   // the erupt punches the screen
  return true;
}
