// ── THE VEIL'S OWN NUMBERS ───────────────────────────────────────────────────
//
// In the Dark tab beside the crush and the fog, because those three answer one question
// between them — how far can you see — and the whole point of the veil is that it lets the
// other two be relaxed. Tuning it in another panel would be tuning it blind.
//
// The intended shape: `strength` near 1 so an unapproached doorway is genuinely black,
// `crush floor` then dragged UP toward 1 until your own room reads, and `fog far` out to
// wherever the room stops being interesting. If the veil is doing its job, distance no
// longer needs to hide anything.
import { tuneNumber } from './tuning';

const GROUP = 'Dark';

const liftNear = tuneNumber({
  id: 'veilnear', group: GROUP, label: 'veil · clear by',
  min: 0, max: 8, step: 0.1, value: 1.6, apply: 'live',
  hint: 'metres at which a doorway is fully open — you are basically in it',
});
const liftFar = tuneNumber({
  id: 'veilfar', group: GROUP, label: 'veil · full by',
  min: 0.5, max: 20, step: 0.25, value: 5.0, apply: 'live',
  hint: 'metres at which it is at full strength · the gap to `clear by` is the peek',
});
const strength = tuneNumber({
  id: 'veilstr', group: GROUP, label: 'veil · strength',
  min: 0, max: 1, step: 0.02, value: 0.92, apply: 'live',
  hint: '0 = no veils at all · 1 = a doorway you have not approached is pure black',
});

export const veilKnobs = { liftNear, liftFar, strength };
