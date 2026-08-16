// ── VIEW KNOBS ───────────────────────────────────────────────────────────────
//
// Josh, tuning surfaces: *"probably hide the viewmodel ... maybe make a toggle
// for viewmodel etc."*
//
// The hands and the weapon occupy the bottom third of the frame and throw their
// own light, which is exactly what you want while playing and exactly what you
// do not want while judging whether a wall is too glossy. This is the first
// knob that is not a material property — it is about what the SCREEN shows —
// so it gets its own group rather than being smuggled into 'Relief'.
//
// Registered here rather than in render-frame.ts because that file is on the
// production render path and this is purely an inspection affordance. The
// visibility flag it flips is the one Three already honours; nothing about the
// viewmodel's update loop changes, so toggling it back leaves everything where
// it was.
import { getViewmodelRoots } from '../style/render-frame';
import { setCameraPitch } from '../controls/camera';
import { tuneNumber, onKnobChange, getKnob } from './tuning';

const SHOW_VM = 'showvm';
const PITCH = 'pitch';

tuneNumber({
  id: SHOW_VM, group: 'View', label: 'Show viewmodel', min: 0, max: 1, value: 1, step: 1,
  // 'live' — nothing is baked or rebuilt, it is just a visibility flag, and
  // labelling it 'rebake' would make the panel run a pointless texture pass.
  apply: 'live',
  hint: '0 hides the hands and weapon',
});

// ── LOOK PITCH — so the FLOOR can be judged in the same lab ──────────────────
// Josh: *"maybe you need a way to in the same scenario snapshot the floor."*
//
// The surface lab is walkable, which is right — relief needs a grazing view and
// colour needs a face-on one — but a walkable scenario has no authored camera
// angle, only a spawn position and a yaw. There is nowhere to say "and look
// down at the flagstones", and on a touch build getting a repeatable downward
// angle by dragging is guesswork.
//
// A pitch that can be TYPED (or dragged, or seeded from the URL as ?pitch=-0.7)
// makes the floor shot repeatable — the same angle before and after a change,
// which is the whole point of a lab. It writes the camera module's own pitch
// rather than camera.rotation.x, because the look code reads that variable
// every frame and would overwrite anything set on the object directly.
//
// Not clamped tighter than the camera's own limit: looking straight down at
// your boots is a legitimate way to inspect a floor texture.
tuneNumber({
  id: PITCH, group: 'View', label: 'Look pitch', min: -1.5, max: 1.5, value: 0,
  apply: 'live', hint: 'negative looks down at the floor; a drag overrides it',
});

onKnobChange((k) => {
  if (k.spec.id === SHOW_VM) apply();
  if (k.spec.id === PITCH) setCameraPitch(k.get());
});

function apply(): void {
  const k = getKnob(SHOW_VM);
  if (!k) return;
  const show = k.get() > 0.5;
  for (const root of getViewmodelRoots()) root.visible = show;
}

// ── APPLY THE SEEDED VALUE, NOT JUST CHANGES ─────────────────────────────────
// The first version only listened for CHANGES, so ?showvm=0 registered the knob
// at 0 and then never did anything with it — the hands stayed up and the URL
// looked broken. Registration seeds a value; something still has to act on it.
//
// It also cannot act immediately: this module is imported when the panel opens,
// which may be before the viewmodel exists, and a root created later defaults
// to visible. So re-apply on a short poll for the first few seconds, then rely
// on the change hook and reapplyViewKnobs().
if (typeof window !== 'undefined') {
  let tries = 0;
  const t = window.setInterval(() => { apply(); if (++tries > 40) window.clearInterval(t); }, 250);
  // Pitch is NOT polled. It is a camera angle, and re-asserting it every 250ms
  // would yank the view out from under anyone who looked somewhere else. It is
  // applied at the one moment that clobbers it instead — main.ts calls
  // reapplyViewKnobs() right after its level-entry setCameraPitch(0).
}

/** Re-apply after anything that rebuilds the viewmodel or resets the camera —
 *  a weapon swap replaces the roots (and a fresh root defaults to visible), and
 *  entering a level zeroes the pitch. Called from those sites so the knobs are
 *  not silently undone by whatever ran last. */
export function reapplyViewKnobs(): void {
  apply();
  const p = getKnob(PITCH);
  // Zero means "wherever the game put you" — asserting it would fight the
  // level-entry reset it is meant to survive, and win nothing.
  if (p && Math.abs(p.get()) > 1e-4) setCameraPitch(p.get());
}
