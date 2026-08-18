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

// ── AND HOW FAR LIGHT CARRIES, IN THE SAME UNIT ──────────────────────────────
//
// Josh: *"when a room is culled, lights are culled the same way — you leave a room, lights
// are gone."* The first version of that read the culler's DRAWN set, which includes the
// frustum, so a torch blinked whenever strafing pushed its room off the edge of the screen.
// Gates are the frustum-free unit: a closed threshold costs one, an open one costs nothing,
// and only WALKING changes it.
//
// At 1 the room you just left keeps burning until its veil closes behind you, which is the
// version that reads as the dark taking the room back rather than as a light switch. At 0
// only the space you are standing in is lit — much harder, worth trying once the veil
// timings are settled.
const lightGates = tuneNumber({
  id: 'lightgates', group: 'Dark', label: 'light · gates',
  min: 0, max: 4, step: 1, value: 1, apply: 'live',
  hint: 'thresholds a light carries across · 0 = only your own space is lit',
});

export const signalKnobs = {
  lightGates, gates };
