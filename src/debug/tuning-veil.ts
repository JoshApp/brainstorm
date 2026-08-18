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

// The A/B for the layer split itself. At 0 the veil draws OVER the signal layer again —
// the behaviour before scene/signal-layer.ts existed — so the two can be compared standing
// in one doorway rather than remembered across a rebuild. The whole claim is that darkness
// should change the CHANNEL rather than remove the information, and that claim should be
// falsifiable in one drag.
const signalThrough = tuneNumber({
  id: 'veilsig', group: GROUP, label: 'veil · signal through',
  min: 0, max: 1, step: 1, value: 1, apply: 'live',
  hint: '1 = flames, runes and glints punch through a veiled doorway · 0 = the veil eats them too',
});

// ── HOW LONG THE DARK TAKES TO GIVE, AND TO TAKE BACK ───────────────────────
//
// Time constants, not durations: each is how long the veil takes to close ~63% of the gap
// to where distance says it should be, so the tail is long and the motion has no end-stop.
//
// Opening slower than closing is the authored asymmetry — the dungeon concedes reluctantly
// and reclaims fast, which is the same shape dark-adaptation uses. Both at a very small
// value gives back the old instant behaviour if the lag turns out to read as lag.
const openTime = tuneNumber({
  id: 'veilopen', group: GROUP, label: 'veil · open time',
  min: 0.01, max: 2, step: 0.01, value: 0.42, apply: 'live',
  hint: 'seconds for the dark to give way as you approach · the reluctance',
});
const closeTime = tuneNumber({
  id: 'veilclose', group: GROUP, label: 'veil · close time',
  min: 0.01, max: 2, step: 0.01, value: 0.22, apply: 'live',
  hint: 'seconds for it to take the ground back · faster than opening, on purpose',
});

export const veilKnobs = { liftNear, liftFar, strength, signalThrough, openTime, closeTime };
