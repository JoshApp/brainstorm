// ── HOW DARK IT IS, ON SLIDERS ───────────────────────────────────────────────
//
// Josh: *"we need a solution for the darkness — the crush to black is too hard. Can you
// give me sliders for all the visibility things in tabs, so I can tune the max visible
// distance and the crush to darkness, all aspects?"*
//
// Every knob that decides how far you can see and how fast it goes black, in one tab, so
// they can be read against each other. That last part is the point of the grouping rather
// than the sliders: the dungeon is darkened by FOUR independent systems that do not know
// about one another, and tuning any one of them alone moves the wall instead of removing
// it.
//
// ── THE FOUR, AND HOW THEY STACK ─────────────────────────────────────────────
//
//   1. FOG — linear, to pure black (FOG_COLOR is 0x000000), reaching full at `fog far`.
//      This also sets the camera's far plane, so `fog far` IS the max visible distance:
//      there is no second distance to raise. (scene/sight-distance.ts)
//   2. DEPTH CRUSH — the whole frame multiplied toward `crush floor` over
//      `crush start`→`crush end` metres. Independent of fog, and at the shipped values
//      (0.16 over 6→12m) it is the harsher of the two. `crush floor` at 1.00 removes it.
//   3. DAYLIGHT LEGIBILITY — a black-point pedestal and a shadow-toe gamma, scaled by the
//      WHERE YOU'RE PLAYING setting. This is the one that lifts crushed blacks back up,
//      so it fights (2) rather than adding to it. (style/render-webgpu.ts)
//   4. THE LIGHT ITSELF — ambient fill, and the lamp's own intensity and reach. Raising
//      these changes what there is to crush, which is a different lever from how hard the
//      crush is, and the two are easy to confuse while dragging.
//
// A surface at 9m today is fogged to black AND cut to 16%. So `fog far` alone reads as
// "nothing changed", which is exactly the loop this tab exists to break.
//
// ── WHY THESE ARE LIVE AND NOT REBAKES ──────────────────────────────────────
//
// All of them push into uniforms already in the pipeline, so a drag is visible in the
// frame it happens. A darkness knob you can only judge by reloading and walking back to
// the same corridor is a knob nobody tunes — which is how three baked constants ended up
// deciding the game's whole visibility budget with no way to compare them.
import { CONFIG } from '../config';
import { setWebGPUDarkness, webGPUDarknessAuthored } from '../style/render-webgpu';
import { tuneNumber, onKnobChange } from './tuning';

/** The tab these all land in. Fog's two knobs join it from scene/sight-distance.ts. */
export const DARK_GROUP = 'Dark';

const A = webGPUDarknessAuthored();

// ── THE CRUSH ────────────────────────────────────────────────────────────────
const crushFloor = tuneNumber({
  id: 'crushfloor', group: DARK_GROUP, label: 'crush floor',
  min: 0, max: 1, step: 0.005, value: A.crushFloor, apply: 'live',
  hint: 'what distance multiplies colour DOWN to · 1.00 removes the crush entirely',
});
const crushStart = tuneNumber({
  id: 'crushstart', group: DARK_GROUP, label: 'crush start',
  min: 0, max: 24, step: 0.5, value: A.crushStart, apply: 'live',
  hint: 'metres before the crush begins — nothing nearer than this is darkened',
});
const crushEnd = tuneNumber({
  id: 'crushend', group: DARK_GROUP, label: 'crush end',
  min: 1, max: 48, step: 0.5, value: A.crushEnd, apply: 'live',
  hint: 'metres by which the crush is at full strength',
});

// ── THE PEDESTAL THAT FIGHTS IT ─────────────────────────────────────────────
const legFloor = tuneNumber({
  id: 'legfloor', group: DARK_GROUP, label: 'black point',
  min: 0, max: 0.6, step: 0.005, value: A.legFloor, apply: 'live',
  hint: 'lifts pure black off zero · scaled by WHERE YOU’RE PLAYING, so 0 there hides this',
});
const legGamma = tuneNumber({
  id: 'leggamma', group: DARK_GROUP, label: 'shadow toe',
  min: 0.3, max: 1, step: 0.01, value: A.legGamma, apply: 'live',
  hint: 'opens the shadows without touching white · 1.00 is no lift',
});

// ── WHAT THERE IS TO CRUSH ──────────────────────────────────────────────────
const ambient = tuneNumber({
  id: 'ambient', group: DARK_GROUP, label: 'ambient fill',
  min: 0, max: 6, step: 0.05, value: CONFIG.AMBIENT_INTENSITY, apply: 'live',
  hint: 'the cool floor under everything · raising it flattens form, it does not reveal it',
});
const lampIntensity = tuneNumber({
  id: 'lampint', group: DARK_GROUP, label: 'lamp strength',
  min: 0, max: 300, step: 5, value: CONFIG.LAMP_INTENSITY, apply: 'live',
  hint: 'the hip lantern — the BASELINE everything else is a signal against',
});
const lampDistance = tuneNumber({
  id: 'lampdist', group: DARK_GROUP, label: 'lamp reach',
  min: 1, max: 20, step: 0.25, value: CONFIG.LAMP_DISTANCE, apply: 'live',
  hint: 'metres the lantern carries · past this you are relying on the room’s own light',
});

// ── AND THE ADAPTATION, SO IT CAN BE TURNED OFF ─────────────────────────────
//
// Dark adaptation ramps a warm lift into the near-black over ~4s of standing in the dark
// and takes it away fast when you step back into light. Josh is weighing replacing it with
// a reveal-on-entry system — *"we have this darkness adaptation feature, but what if we
// remove that and instead make it so a room gets revealed when you enter?"* — and that is
// not a judgement anyone can make while it is welded on. At 0 the game runs with no
// adaptation at all, which is the comparison the decision needs.
//
// A multiplier on the SIGNAL rather than on the shader lift, so it also takes the
// lamp-reveal's adaptation-boosted base hint with it. Otherwise "off" would still leave
// runes brightening as your eyes adjusted, and the A/B would be dishonest.
const adaptMul = tuneNumber({
  id: 'adaptmul', group: DARK_GROUP, label: 'eye adaptation',
  min: 0, max: 1, step: 0.05, value: 1, apply: 'live',
  hint: '0 = off entirely · the whole feature, signal and shader lift and rune hint',
});

/** Live values, for the systems that write these every frame. */
export const darkKnobs = {
  ambient,
  lampIntensity,
  lampDistance,
  adaptMul,
};

// One push per change, into the uniforms that are already in the pipeline.
function apply(): void {
  setWebGPUDarkness({
    crushFloor: crushFloor(), crushStart: crushStart(), crushEnd: crushEnd(),
    legFloor: legFloor(), legGamma: legGamma(),
  });
}

onKnobChange((k) => {
  if (k.spec.group === DARK_GROUP) apply();
});

// And once at startup, so a URL- or save-seeded value is in the pipeline before the first
// frame rather than waiting for someone to touch a slider.
apply();
