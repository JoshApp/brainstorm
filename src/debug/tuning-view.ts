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
import { getViewmodelRoots, onViewmodelRegistered } from '../style/render-frame';
import { setLampHandVisible } from '../player/lamp-hand';
import { setCameraPitch, setCameraYaw } from '../controls/camera';
import { tuneNumber, onKnobChange, getKnob, markTransient } from './tuning';

const SHOW_VM = 'showvm';
const LAMP_HAND = 'lamphand';
const PITCH = 'pitch';
const YAW = 'yaw';

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
// ── THE LANTERN WITHOUT A BEARER ─────────────────────────────────────────────
//
// Josh: *"can we remove the left hand hlding the lamp and make the lamp just float on its own?
// like give me a toggle for that in the view tab of tune."*
//
// The lantern belongs to handheld-lamp.ts and the hand merely follows it to the bail, so hiding
// the hand leaves the light burning exactly where it was and carried by nothing. Separate from
// 'Show viewmodel', which hides the whole viewmodel including the weapon: this is about what is
// HOLDING the light, and a floating lamp is a real look for this game rather than only an
// inspection view.
tuneNumber({
  id: LAMP_HAND, group: 'View', label: 'Lamp hand', min: 0, max: 1, value: 0, step: 1,
  apply: 'live',
  hint: '0 = the lantern floats on its own',
});

tuneNumber({
  id: PITCH, group: 'View', label: 'Look pitch', min: -1.5, max: 1.5, value: 0,
  apply: 'live', hint: 'negative looks down at the floor; a drag overrides it',
});

// Yaw for the same reason, and it arrived the moment a shot needed a CORNER:
// a walkable scenario's authored yaw points you down one axis, and anything
// framed off-axis — a corner, a wall seen raking rather than face-on — is
// unreachable without dragging, which is not repeatable. Same setter story as
// pitch: write the camera module's own variable, because the look code
// overwrites camera.rotation.y every frame from it.
tuneNumber({
  id: YAW, group: 'View', label: 'Look yaw', min: -Math.PI, max: Math.PI, value: 0,
  apply: 'live', hint: 'turn on the spot; positive turns left',
});

// Pitch and yaw are verbs, not settings — see markTransient. A drag still moves the camera
// and `?yaw=-0.7` still poses a shot, but neither is saved, so nothing steers the camera on
// a later boot. Josh: *"my camera position in the loading screen changed, I am no longer
// looking at the bonfire"* — a yaw dragged once, remembered forever, re-asserted on the
// title vignette's own level entry.
markTransient(PITCH);
markTransient(YAW);

onKnobChange((k) => {
  if (k.spec.id === SHOW_VM) apply();
  if (k.spec.id === LAMP_HAND) setLampHandVisible(k.get() > 0.5);
  // ── ZERO MEANS "WHEREVER THE GAME PUT YOU" ─────────────────────────────────
  //
  // These used to assert unconditionally, which was harmless while the only caller was a
  // slider drag — you cannot drag to a value you did not want. Then reapplyKnobs() started
  // firing every hook once at boot so URL- and save-seeded values would actually reach
  // their systems, and this hook stamped pitch 0 / yaw 0 over the title vignette's authored
  // camera. Josh: *"my camera position in the loading screen changed, I am no longer
  // looking at the bonfire."*
  //
  // Same rule reapplyViewKnobs() already documents and for the same reason: the scenario's
  // authored pose is a real decision, and a knob sitting at its default has no opinion to
  // override it with. A non-zero value is someone actually asking.
  if (k.spec.id === PITCH && Math.abs(k.get()) > 1e-4) setCameraPitch(k.get());
  if (k.spec.id === YAW && Math.abs(k.get()) > 1e-4) setCameraYaw(k.get());
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
// tuning.ts owns that now (reapplyKnobs, called once from main at boot), so the
// change hook above is the only path a value takes to get here.
//
// What that cannot cover is geometry built LATER: a weapon swap replaces the
// roots and a fresh root defaults to visible. This used to be a 250ms poll,
// forty times — which fixed the first ten seconds and let every swap after that
// put the hands back up. The roots announce themselves instead, so a new one is
// told what the knob says at the moment it is registered, forever.
//
// Pitch and yaw are NOT re-asserted here. They are camera angles, and a
// viewmodel swap is no reason to move the view; main.ts calls
// reapplyViewKnobs() at the one moment that clobbers them, its level-entry
// setCameraPitch(0).
onViewmodelRegistered((root) => {
  const k = getKnob(SHOW_VM);
  if (k) root.visible = k.get() > 0.5;
});

/** Re-apply after anything that rebuilds the viewmodel or resets the camera —
 *  a weapon swap replaces the roots (and a fresh root defaults to visible), and
 *  entering a level zeroes the pitch. Called from those sites so the knobs are
 *  not silently undone by whatever ran last. */
export function reapplyViewKnobs(): void {
  apply();
  // Zero means "wherever the game put you" — asserting it would fight the
  // level-entry reset it is meant to survive, and win nothing. Yaw especially:
  // the scenario's authored startPos.yaw is a real decision.
  const p = getKnob(PITCH);
  if (p && Math.abs(p.get()) > 1e-4) setCameraPitch(p.get());
  const y = getKnob(YAW);
  if (y && Math.abs(y.get()) > 1e-4) setCameraYaw(y.get());
}
