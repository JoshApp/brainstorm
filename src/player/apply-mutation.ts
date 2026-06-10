import { get } from '../ecs/world';
import { getPlayerMaxHp } from './health';
import { playBuffApply } from '../audio/sfx';
import { showNote } from '../ui/note-card';
import { getMutation } from '../content/tainted-mutations';
import { addMutation } from '../state/run-mutations';

// One door for every Faustian source — tainted fountains, phials,
// future pacts and corpse-altars all apply a permanent run mutation
// through here, so the HP-reconcile rule and the reveal moment stay
// identical no matter where the brand came from.

/** Apply a permanent run mutation with the full feedback beat (sfx +
 *  the brand's flavor note) and the HP reconcile rule:
 *
 *  Positive max-hp deltas top the player up by exactly the gain (a
 *  +4 KINDNESS feels like a reward, not a missed window). Negative
 *  deltas leave current HP ALONE — a brand that cuts your cap should
 *  cut your cap, not also damage you.
 */
export function applyMutationWithFeedback(mutationId: string): void {
  const mutation = getMutation(mutationId);
  if (!mutation) return;
  addMutation(mutation.id);

  let maxHpDelta = 0;
  for (const m of mutation.modifiers) {
    if (m.kind === 'max-hp') maxHpDelta += m.amount;
  }
  if (maxHpDelta > 0) {
    const player = get('player');
    if (player?.hp) {
      const newMax = getPlayerMaxHp();
      player.hp.current = Math.min(newMax, player.hp.current + maxHpDelta);
    }
  }

  playBuffApply();
  showNote(`${mutation.flavor}\n\n— ${mutation.name} —`);
}
