// ── HOW FAR THE DUNGEON WILL TALK TO YOU ─────────────────────────────────────
//
// One knob, and it is a gameplay rule rather than a graphics setting — which is why it sits
// in the Dark tab next to the veil it depends on rather than under a rendering heading.
//
// Josh: *"how about we make flames only visible if it's gated by one gate and not more? So
// you can't see it across a room and a corridor, but you have to break the corridor's
// seal."* Line of sight alone cannot express that: two doorways can line up perfectly, so
// the segment from your eye to a fire two spaces away is geometrically clear, and it draws.
// GATES are the unit the player actually feels — the corridor is one, the room past it is
// two — and stepping into the corridor is what makes the far room one.
//
// At 0 only your own space speaks to you, which is the tightest reading and probably too
// tight: a doorway with nothing behind it stops being a question. At 1 you get the peek the
// veil was built for and nothing further.
import { tuneNumber } from './tuning';

const gates = tuneNumber({
  id: 'siggates', group: 'Dark', label: 'signal · gates',
  min: 0, max: 3, step: 1, value: 1, apply: 'live',
  hint: '0 = only your own space · 1 = one threshold deep · you break the next seal by entering',
});

export const signalKnobs = { gates };
