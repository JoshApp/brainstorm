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

// The baseline grade's own exposure, captured before anything overrides it, so
// the knob's default is the shipped look rather than whatever a previous
// session left in the overrides.
const BASE_EXPOSURE = getActiveGrade().exposure;

tuneNumber({
  id: EXPO, group: 'Stone', label: 'Exposure', min: 0.04, max: 0.9, value: BASE_EXPOSURE,
  apply: 'live',
  hint: 'pull DOWN as Stone albedo goes up; rebuilds the pipeline',
});

// The grade lives in the post pipeline, which has to be rebuilt to see a new
// value — cheap, but not free, and a slider fires on every pixel of drag. One
// trailing rebuild per gesture instead of sixty.
let pending = 0;
function applyExposure(v: number): void {
  setGradeOverrides({ expo: v });
  if (pending) window.clearTimeout(pending);
  pending = window.setTimeout(() => { pending = 0; rebuildWebGPUPipeline(); }, 140);
}

onKnobChange((k) => { if (k.spec.id === EXPO) applyExposure(k.get()); });

// Apply a URL- or save-seeded value once at startup. Unlike the camera pitch
// this has nothing racing it — the grade is read at every pipeline build, so
// setting the override early is enough and there is no later writer to lose to.
if (typeof window !== 'undefined') {
  window.setTimeout(() => {
    const k = (window as unknown as { __tune?: { get(id: string): number | undefined } }).__tune;
    const v = k?.get(EXPO);
    if (typeof v === 'number' && Math.abs(v - BASE_EXPOSURE) > 1e-4) applyExposure(v);
  }, 1200);
}
