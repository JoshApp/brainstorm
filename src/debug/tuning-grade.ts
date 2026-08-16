// ── EXPOSURE, IN THE PANEL ───────────────────────────────────────────────────
//
// This exists to make ONE experiment draggable: the albedo-to-specular ratio.
//
// Measured on 2026-08-16 (see the note on uStoneLift in style/surface-detail.ts):
// the stone materials' base colour is ~0.004 in linear space, so every colour
// operation in the surface shader lands underneath the specular term, and every
// colour knob in the game reads at the noise floor while every roughness knob
// is strong. The fix is to lift the albedo — but albedo up without light down
// just blows the picture out, because the torch intensities and this grade's
// exposure were both set against a near-black surface.
//
// So the two have to move together, and the only way to find the pair is to
// drag them together. Stone albedo is in the Stone group; this is its other
// half.
//
// ── A CORRECTION TO MY OWN EARLIER TEST ──────────────────────────────────────
// The first time I demonstrated this I ran `__gradeSet({ exposure: 0.12 })`.
// The override key is `expo`, not `exposure` — `getActiveGrade` reads `o.expo`
// — so that call did nothing at all and the lift was measured UNCOMPENSATED.
// The finding survives (lifting albedo made colour visible), but the pairing
// was never actually tested, and I reported it as though it had been. Hence
// this file: a knob cannot be passed the wrong key.
//
// Deliberately NOT auto-coupled to the albedo lift. I do not know the right
// curve — the total brightness change is a function of the diffuse/specular mix
// at every pixel, which varies with roughness, angle and distance — and a
// made-up coupling would be a guess wearing the costume of a feature. Two
// honest sliders beat one dishonest one.
import { setGradeOverrides, getActiveGrade } from '../style/grade-presets';
import { rebuildWebGPUPipeline } from '../style/render-webgpu';
import { tuneNumber, onKnobChange } from './tuning';

const EXPO = 'expo';
const SAT = 'gsat';

// The baseline grade's own exposure, captured before anything overrides it, so
// the knob's default is the shipped look rather than whatever a previous
// session left in the overrides.
const BASE_EXPOSURE = getActiveGrade().exposure;
const BASE_SAT = getActiveGrade().saturation;

tuneNumber({
  id: EXPO, group: 'Stone', label: 'Exposure', min: 0.04, max: 0.9, value: BASE_EXPOSURE,
  apply: 'live',
  hint: 'pull DOWN as Stone albedo goes up; rebuilds the pipeline',
});

// ── SATURATION, and why it got louder without anyone touching it ────────────
// Josh, repeatedly and from the very start of this thread: *"does something pull
// everything into amber?"* and now *"it's like yellow."*
//
// Measured today: mean frame saturation is ~0.61, which is a lot, and the
// crevice work is not the cause (with it off, 0.612; with it on, 0.575).
//
// The part worth naming is that the albedo rebalance MADE THIS WORSE, and
// unavoidably so. Before it, these surfaces were mostly a specular lobe, and a
// dielectric's specular is near-white — so the walls returned a fairly neutral
// highlight regardless of the torch. Lifting the albedo means the DIFFUSE term
// now dominates, and diffuse multiplies the light's own colour. The stone
// correctly returns more of the torch, so the room went warmer as a direct
// consequence of the surface starting to work. Physics, not a bug — but it lands
// on top of a grade already at saturation 1.15 with an amber tint.
//
// Two levers and they do different things: THIS one pulls the whole image back
// toward neutral, while Stone hue spread (Stone tab) breaks the amber MASS into
// different-coloured rocks. The second is usually the better answer — and note
// it only started working today, so it has never actually been tried at strength.
let pending = 0;
function applyGrade(o: { expo?: number; sat?: number }): void {
  setGradeOverrides(o);
  if (pending) window.clearTimeout(pending);
  pending = window.setTimeout(() => { pending = 0; rebuildWebGPUPipeline(); }, 140);
}

tuneNumber({
  id: SAT, group: 'Stone', label: 'Saturation', min: 0.3, max: 1.6, value: BASE_SAT,
  apply: 'live',
  hint: 'pulls the whole image toward neutral; rebuilds the pipeline',
});

onKnobChange((k) => {
  if (k.spec.id === EXPO) applyGrade({ expo: k.get() });
  if (k.spec.id === SAT) applyGrade({ sat: k.get() });
});

// Apply a URL- or save-seeded value once at startup. Unlike the camera pitch
// this has nothing racing it — the grade is read at every pipeline build, so
// setting the override early is enough and there is no later writer to lose to.
if (typeof window !== 'undefined') {
  window.setTimeout(() => {
    const k = (window as unknown as { __tune?: { get(id: string): number | undefined } }).__tune;
    const e = k?.get(EXPO), s = k?.get(SAT);
    const o: { expo?: number; sat?: number } = {};
    if (typeof e === 'number' && Math.abs(e - BASE_EXPOSURE) > 1e-4) o.expo = e;
    if (typeof s === 'number' && Math.abs(s - BASE_SAT) > 1e-4) o.sat = s;
    if (Object.keys(o).length) applyGrade(o);
  }, 1200);
}
