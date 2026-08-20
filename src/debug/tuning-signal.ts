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
// AT 0 BY DEFAULT, which is the rule as Josh stated it: *"you leave a room, lights are
// gone."* A doorway that has visibly lifted costs nothing, so the room you are walking into
// lights up as its veil opens, and the one behind you goes dark as its veil closes — the
// darkness taking the room back rather than a light switch. Higher values let light carry
// across thresholds that are still shut, which is the old behaviour and an A/B, not a
// default.
const lightGates = tuneNumber({
  id: 'lightgates', group: 'Dark', label: 'light · gates',
  min: 0, max: 4, step: 1, value: 0, apply: 'live',
  hint: 'closed thresholds a light carries across · 0 = only rooms whose doorway has opened',
});

// ── AND HOW FAR STONE CARRIES ────────────────────────────────────────────────
//
// Josh, reading the map: *"it shows me that we don't cull rooms based on gates at all right
// now."* He was right. The drawn set came entirely from the flood — frustum, sightlines and
// a continuous transmittance product — while gates were computed beside it and read only by
// lights, signals and props. Two encodings of "how far through the dungeon can you see",
// and rooms answered to the one that could not hear a closed door.
//
// At 0 a room past a shut threshold is not drawn at all. The veil in that doorway is 90%
// opaque anyway, so what is being dropped is the tenth of it that was still coming through —
// and the pop is masked by the same veil that caused it.
const geoGates = tuneNumber({
  id: 'geogates', group: 'Dark', label: 'stone · gates',
  min: 0, max: 3, step: 1, value: 0, apply: 'live',
  hint: 'shut thresholds that stone is still drawn through · 0 = only what you have opened',
});

// ── THE AMBIENCE FILLS, ON A SWITCH ──────────────────────────────────────────
//
// Josh: *"can you give me a toggle to disable fill lights?"* — asked on finding out they
// existed at all, which is fair. They are 1-4 INVISIBLE point lights per room
// (level/builder.ts, `fill-*`), placed on a grid derived from the room's BOUNDING BOX and
// coloured by the average tint of the torches in it. Their own comment calls them "the
// NAVIGABILITY FLOOR, not a light you notice": the light that keeps a room walkable so
// torches can be signal rather than illumination.
//
// Whether the dungeon still wants that floor, now that gates confine lighting to the space
// you are standing in, is a real question — and it cannot be answered while they are welded
// on. At 0 the game runs with no sourceless light at all, every lit surface traceable to
// something you can point at, which is what the light doctrine says it wants.
//
// Live, and applied in the pool's SELECTION phase, so it is one drag rather than a rebuild.
const fills = tuneNumber({
  id: 'fills', group: 'Dark', label: 'fill lights',
  min: 0, max: 1, step: 1, value: 0, apply: 'live',
  hint: '0 = no sourceless ambience · every lit surface traced to a visible emitter',
});

export const signalKnobs = {
  fills,
  geoGates,
  lightGates, gates };
