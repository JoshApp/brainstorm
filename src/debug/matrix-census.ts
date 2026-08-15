// ── WHOSE MATRIX IS CHANGING? ────────────────────────────────────────────────
//
// A phone capture pinned 45% of every frame's GPU uploads on Three's built-in
// per-object uniform group — one buffer per DRAWN OBJECT, every frame, holding
// model / modelView / normal matrices. Three compares matrix values before
// writing, so those matrices are genuinely changing while the player stands
// still. The open question is which of two worlds we are in:
//
//   THE CAMERA MOVES — modelView is cameraViewInverse × matrixWorld, so a
//   camera that drifts by any amount dirties EVERY drawn object at once. That
//   would be a bug with a fix.
//
//   OBJECTS MOVE — flames, creatures, sprites, anything animating. That is
//   inherent, and the only lever is drawing fewer of them.
//
// The two produce identical upload counts and are indistinguishable from
// outside, which is why five reasoned guesses missed. This measures instead:
// per frame, for every DRAWN object, is matrixWorld bit-identical to last
// frame? Bucketed by what the object is, so the answer names names.
//
// Armed for a couple of frames on the same timer as the other censuses, so the
// walk costs nothing the rest of the time. Ships behind PROFILER TOOLS (the
// phone runs a production build, so a DEV gate would put it out of reach).

import type * as THREE from 'three';

const CENSUS_FRAMES = 3;

export interface MatrixCensusBucket {
  /** What the object is — nearest named/dbgKind ancestor. */
  owner: string;
  /** Drawn objects of this kind whose matrixWorld CHANGED since last frame. */
  changed: number;
  /** Drawn objects of this kind, total. */
  drawn: number;
}

export interface MatrixCensusResult {
  frames: number;
  /** Drawn objects walked, per frame (mean). */
  drawn: number;
  /** Of those, how many had a changed matrixWorld (mean per frame). */
  changed: number;
  /** Frames in the sample where the CAMERA's own matrixWorld changed. If this
   *  is every frame, the camera explains every object's dirty modelView on its
   *  own and nothing else needs explaining. */
  cameraMovedFrames: number;
  buckets: MatrixCensusBucket[];
}

type Provider = () => { scene: THREE.Object3D; camera: THREE.Object3D } | null;
let provider: Provider | null = null;
/** main.ts hands over the live scene + camera (same shape as the scene audit). */
export function setMatrixCensusProvider(fn: Provider): void { provider = fn; }

let active = false;
let framesLeft = 0;
let frameIndex = 0;
let cameraMovedFrames = 0;
let drawnTotal = 0;
let changedTotal = 0;
let result: MatrixCensusResult | null = null;
const prev = new WeakMap<THREE.Object3D, Float64Array>();
const buckets = new Map<string, { changed: number; drawn: number }>();

function ownerOf(o: THREE.Object3D, root: THREE.Object3D): string {
  let p: THREE.Object3D | null = o;
  while (p && p !== root) {
    const ud = p.userData as { dbgKind?: string; dbgSource?: string } | undefined;
    const k = p.name || ud?.dbgKind || ud?.dbgSource;
    if (k) return String(k).split('·')[0].trim();
    p = p.parent;
  }
  return 'untagged';
}

/** True when `m` differs from the copy kept for `o`, and stores the new one. */
function changedSince(o: THREE.Object3D, m: THREE.Matrix4): boolean {
  const e = m.elements;
  let last = prev.get(o);
  if (!last) {
    last = new Float64Array(16);
    for (let i = 0; i < 16; i++) last[i] = e[i];
    prev.set(o, last);
    return false;   // first sight is not a change
  }
  let diff = false;
  for (let i = 0; i < 16; i++) {
    if (last[i] !== e[i]) { diff = true; last[i] = e[i]; }
  }
  return diff;
}

export function armMatrixCensus(): void {
  if (active || !provider) return;
  active = true;
  framesLeft = CENSUS_FRAMES;
  frameIndex = 0;
  cameraMovedFrames = 0;
  drawnTotal = 0;
  changedTotal = 0;
  buckets.clear();
}

/** Call once per frame while a recording runs. Ends on its own. */
export function tickMatrixCensus(): void {
  if (!active) return;
  const live = provider?.();
  if (!live) { active = false; return; }
  const { scene, camera } = live;

  if (changedSince(camera, camera.matrixWorld)) cameraMovedFrames++;

  let drawn = 0, changed = 0;
  const visit = (o: THREE.Object3D): void => {
    if (!o.visible) return;   // culled subtrees are not drawn, so not counted
    const d = o as THREE.Object3D & { isMesh?: boolean; isSprite?: boolean; isPoints?: boolean };
    if (d.isMesh || d.isSprite || d.isPoints) {
      drawn++;
      const moved = changedSince(o, o.matrixWorld);
      if (moved) changed++;
      const key = ownerOf(o, scene);
      let b = buckets.get(key);
      if (!b) { b = { changed: 0, drawn: 0 }; buckets.set(key, b); }
      b.drawn++;
      if (moved) b.changed++;
    }
    for (const c of o.children) visit(c);
  };
  visit(scene);
  drawnTotal += drawn;
  changedTotal += changed;

  frameIndex++;
  if (--framesLeft > 0) return;
  active = false;
  const list: MatrixCensusBucket[] = [];
  for (const [owner, b] of buckets) list.push({ owner, changed: b.changed, drawn: b.drawn });
  // Sort by what MOVED — that is the whole question.
  list.sort((a, b) => b.changed - a.changed);
  result = {
    frames: frameIndex,
    drawn: Math.round(drawnTotal / frameIndex),
    changed: Math.round(changedTotal / frameIndex),
    cameraMovedFrames,
    buckets: list.slice(0, 24),
  };
  buckets.clear();
}

export function takeMatrixCensus(): MatrixCensusResult | null { return result; }

export function resetMatrixCensus(): void {
  active = false;
  buckets.clear();
  result = null;
}
