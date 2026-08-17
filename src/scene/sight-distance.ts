import * as THREE from 'three';
import { CONFIG } from '../config';
import { tuneNumber, onKnobChange } from '../debug/tuning';

// ── HOW FAR YOU CAN SEE — ONE NUMBER, ONE OWNER ──────────────────────────────
//
// Josh: *"i would like to kinda revisit the way distance shadow and fog work,
// because the poly rooms made everything bigger and some settings are a little
// off — it feels a little bit too narrow, but we have to see."*
//
// He is right, and it measures (scripts/_room-scale.ts, 1557 generated rooms):
//
//     room long side   p50 13.0m   p90 16.5m      FOG_FAR = 9m
//     room diagonal    p50 16.4m   p90 21.2m
//
//     84% of rooms are LONGER than the fog can reach.
//     99% have a diagonal beyond it.
//
// So in nearly every room in the game you cannot see the room. The far end is
// not dim, it is absent — and a space whose far end is absent reads as a
// corridor you happen to be standing in. That is exactly "too narrow", and it
// also means the polygon-room work is invisible: the shapes exist and are never
// seen as shapes. The fog was last tuned at 7 → 9 for "larger procgen rooms";
// the rooms then grew past it again and the number did not follow.
//
// WHY THIS IS A MODULE AND NOT A CONFIG BUMP. The sight distance is read by
// three systems that must agree:
//
//   · the FOG          — where the black wall is
//   · the CAMERA's far plane — what is even submitted
//   · the ROOM CULLER  — which rooms are flooded to through doorways
//
// Each read CONFIG independently, and two of them cached it in a module-level
// const at import. So there was no way to change the sight distance at runtime,
// and a config bump that missed one of the three would produce geometry clipped
// inside visible fog (or fog drawn over culled rooms) — a bug you would chase in
// the wrong file. They now ask this module, and it tells them when it changes.
//
// That makes it draggable, which is the point: this is a feel question, and the
// answer is found by looking, not by me picking a number. See the Sight group in
// the TUNE panel.
//
// COST IS REAL AND IS THE REASON THE NUMBER IS LOW. There is no occlusion
// culling here, so a sightline down several aligned doorways submits every room
// it reaches. That is what cut the far plane to 10 in the first place. Raising
// this raises draw calls on exactly the sightlines that were already worst, so
// move it with the ATTR sweep open rather than by feel alone.

let near = CONFIG.FOG_NEAR;
let far = CONFIG.FOG_FAR;

const listeners: Array<() => void> = [];
let fog: THREE.Fog | null = null;
let camera: THREE.PerspectiveCamera | null = null;

/** Where the fog reaches full opacity. Past this there is nothing to see. */
export function sightFar(): number { return far; }
/** Where the fog starts to bite. */
export function sightNear(): number { return near; }

/** Register the scene fog + camera this governs. Called once at boot. */
export function bindSight(f: THREE.Fog, c: THREE.PerspectiveCamera): void {
  fog = f;
  camera = c;
  apply();
}

/** Notified whenever the distance changes — for anything that caches it. */
export function onSightChange(cb: () => void): void { listeners.push(cb); }

function apply(): void {
  if (fog) { fog.near = near; fog.far = far; }
  if (camera) {
    // The far plane sits JUST past the fog wall. Fog is already fully opaque at
    // `far`, so the cushion only keeps a hard clip edge from landing exactly on
    // it; it is not extra visibility.
    camera.far = far + 1;
    camera.updateProjectionMatrix();
  }
  for (const cb of listeners) cb();
}

export function setSight(n: number, f: number): void {
  near = n; far = f;
  apply();
}

// The dials. Live tier: nothing here rebuilds a shader — the fog values are
// uniforms, the far plane is a matrix, and the culler recomputes every frame.
const nearKnob = tuneNumber({
  id: 'fognear', group: 'Dark', label: 'Fog near', min: 0, max: 12, value: CONFIG.FOG_NEAR,
  hint: 'where the dark starts closing in',
});
const farKnob = tuneNumber({
  id: 'fogfar', group: 'Dark', label: 'Fog far', min: 4, max: 40, value: CONFIG.FOG_FAR,
  hint: 'the black wall. p50 room is 13m long, p90 is 16.5m',
});
onKnobChange(() => setSight(nearKnob(), farKnob()));
