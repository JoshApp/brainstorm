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
import { tuneNumber, onKnobChange, getKnob } from './tuning';

const SHOW_VM = 'showvm';

tuneNumber({
  id: SHOW_VM, group: 'View', label: 'Show viewmodel', min: 0, max: 1, value: 1, step: 1,
  // 'live' — nothing is baked or rebuilt, it is just a visibility flag, and
  // labelling it 'rebake' would make the panel run a pointless texture pass.
  apply: 'live',
  hint: '0 hides the hands and weapon',
});

onKnobChange((k) => { if (k.spec.id === SHOW_VM) apply(); });

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
}

/** Re-apply after anything that rebuilds the viewmodel (a weapon swap replaces
 *  the roots, and a fresh root defaults to visible). Called from the equip path
 *  so the toggle does not silently come undone. */
export function reapplyViewKnobs(): void {
  const k = getKnob(SHOW_VM);
  if (!k) return;
  const show = k.get() > 0.5;
  for (const root of getViewmodelRoots()) root.visible = show;
}
