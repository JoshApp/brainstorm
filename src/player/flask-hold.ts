import { composeHeldWeapon, adjustFingersForGrip, type HeldWeaponCompose } from './held-weapon-compose';
import { ESTUS_FLASK } from '../content/loot-models';

// The right hand CUPPING the estus flask — the composition the drink
// viewmodel raises to the mouth (player/flask-viewmodel.ts) and the bench
// renders as `model-flask-held` (src/bench/subjects.ts).
//
// Same composeHeldWeapon path as every held weapon: the flask's grip_anchor
// (authored one bulb-radius off centre, loot-models.ts) lands on the hand's
// palm_anchor so the bulb rests AGAINST the palm. Then the finger curl is
// re-solved for the bulb's girth: a 6cm sphere is far fatter than the
// baseline sword hilt, so the fingers OPEN into a loose ball-cup instead of
// a closed fist.

/** Effective grip radius the fingers wrap. The fingers close ~0.038m above
 *  the bulb's centre, where the sphere has thinned to ~0.049m — so the wrap
 *  radius is authored to THAT circle, not the full bulb, and the fingertips
 *  press into the glass instead of hovering at the equator's tangent. Tune
 *  this first when the cup looks wrong. */
export const FLASK_GRIP_RADIUS = 0.048;
/** Extra thumb curl beyond the shared grip solve — the thumb wraps the
 *  bulb's underside where the sphere curves away faster than a cylinder
 *  grip expects (bench showed it floating ~3cm off the glass). */
const THUMB_EXTRA_CURL = 0.30;

export function composeFlaskHold(): HeldWeaponCompose {
  const composed = composeHeldWeapon(ESTUS_FLASK);
  // composeHeldWeapon curled for the inferred grip (no 'grip'-named part on
  // the flask → baseline no-op); re-solve for the bulb.
  adjustFingersForGrip(composed.hand.slots, FLASK_GRIP_RADIUS);
  const thumb = composed.hand.slots.get('finger_thumb');
  if (thumb) thumb.rotation.x -= THUMB_EXTRA_CURL;
  return composed;
}
