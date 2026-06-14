import { applyBuff } from '../ecs/buffs';
import { get } from '../ecs/world';
import { gameRngChance } from '../engine/rng';
import type { CombatVerb } from '../content/items';

// Combat-verb firing — the ONE place that turns an item's authored CombatVerb
// (on a riposte / perfect dodge / empowered hit) into a real effect. The
// combat layer calls fireCombatVerb at each event hook; the content layer just
// declares the verb on the weapon. Buff-based today (reuses content/buffs.ts),
// so a verb resolves to "apply this buff to the player or to the foe".

/**
 * Fire an item's combat verb.
 * @param verb          the authored verb (no-op if undefined)
 * @param enemyId       the foe involved in the event (for 'enemy'-target verbs)
 * @param defaultTarget who it lands on when the verb omits its own target —
 *                      the hook's natural default (riposte/empowered → 'enemy',
 *                      perfect-dodge → 'self')
 */
export function fireCombatVerb(
  verb: CombatVerb | undefined,
  enemyId: string | undefined,
  defaultTarget: 'self' | 'enemy',
): void {
  if (!verb) return;
  if (verb.chance !== undefined && !gameRngChance(verb.chance)) return;
  const targetId = (verb.target ?? defaultTarget) === 'self' ? 'player' : enemyId;
  if (!targetId) return;
  const ent = get(targetId);
  if (ent) applyBuff(ent, verb.buffId, verb.duration, 'player');
}
