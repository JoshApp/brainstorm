// ── THE BONE ARMS, ON TRIAL ──────────────────────────────────────────────────
//
// Josh generated skeletal forearms in Tripo3D and wants to see whether they work as the
// viewmodel: *"i wanna see if this works … just start and lets see how it goes"*, then, after
// the first look, *"i cant really do the values by hand so good … can we use the hands and i
// will position."*
//
// So this stopped being six sliders and became a FIT. debug/bone-fit.ts measures the five
// degrees of freedom that are facts about the mesh — which way the arm runs, which end is the
// hand, where the wrist is, how long the hand is, which side is which — and the bone hand is
// then hung off the composed hand's own WRIST SLOT. It inherits the viewmodel placement, the
// weapon-grip composition and the arm IK without a number being typed.
//
// One knob is left, and only one, because it is the single thing measurement cannot give:
// ROLL about the arm's axis, which decides whether the palm faces the camera or the floor.
// That is taste.
//
// ── WHAT THE FILE IS ────────────────────────────────────────────────────────
//
// Measured before any of this was written (scripts/inspect-glb + a connectivity pass):
//
//   1 node · 1 mesh · 1 primitive · 4,637 tris · 7,442 verts · 384 KB
//   skins 0, animations 0 — NO skeleton at all
//   62 SEPARATE SHELLS, 31 either side of centre: two complete arms, independently meshed
//   (280 vs 278 tris on the paired long bones), so no mirroring is needed or wanted
//
// Thirty-one per arm is anatomically complete — radius, ulna, eight carpals, five
// metacarpals, fourteen phalanges — which is why rigging this needs no weight painting: each
// shell parents to a joint and moves rigidly, the same way creature limbs already do.
//
// ── AND THE CHARTER ─────────────────────────────────────────────────────────
//
// Pillar 6 says no model files, no texture pipelines. This is the trial of whether that
// should move. What an imported mesh does NOT get, and would be owed: the lamp-reveal shader,
// the mood tint, the prop-class shadow policy, and the palm/grip slots — all keyed off
// ModelSpec. If it survives, the end state is a conversion that emits these shells into that
// pipeline, not a runtime GLTF load. And note the asset ships: public/ is copied wholesale,
// so the 384 KB is on the live site while this flag exists.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DEV } from './dev';
import { tuneNumber, onKnobChange } from './tuning';
import { buildModel } from '../ecs/build-model';
import { HAND_RIGHT } from '../content/hand';
import { fitBoneHand } from './bone-fit';

const GROUP = 'Bone';

/** The one thing the fit cannot decide. Palm toward the camera or toward the floor is taste,
 *  not geometry. */
const roll = tuneNumber({
  id: 'boneroll', group: GROUP, label: 'palm roll', min: -3.2, max: 3.2, step: 0.02, value: 0,
  apply: 'live', hint: 'the only pose value measurement cannot give — spin about the arm',
});
/** Everything else is fitted. These stay as NUDGES for when the fit is close but not right,
 *  and each defaults to "change nothing" so the fit is what you see first. */
const sizeNudge = tuneNumber({
  id: 'bonesize', group: GROUP, label: 'size ×', min: 0.4, max: 2.5, step: 0.01, value: 1,
  apply: 'live', hint: '1.00 = exactly the authored hand’s length',
});
const handOnly = tuneNumber({
  id: 'bonehandonly', group: GROUP, label: 'hand only', min: 0, max: 1, step: 1, value: 1,
  apply: 'live', hint: '1 drops the forearm bones — the wrist is found, not guessed',
});
const showAuthored = tuneNumber({
  id: 'bonekeepold', group: GROUP, label: 'keep authored hand', min: 0, max: 1, step: 1, value: 0,
  apply: 'live', hint: 'both at once, to compare the fit against the hand it is matching',
});

interface Mounted { wrist: THREE.Object3D; bone: THREE.Group; authored: THREE.Object3D[] }
const mounted: Mounted[] = [];
let sourceMesh: THREE.Mesh | null = null;
let loading = false;

/** Wrist→fingertip of the AUTHORED hand, measured rather than written down, so the fit
 *  cannot drift out of step with content/hand.ts. */
let authoredLen = 0;
function authoredHandLength(): number {
  if (authoredLen) return authoredLen;
  const built = buildModel(HAND_RIGHT);
  built.group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(built.group);
  // The hand is authored with the wrist at the origin and fingers up +Y.
  authoredLen = Math.max(0.05, box.max.y);
  return authoredLen;
}

function rebuild(): void {
  if (!sourceMesh) return;
  for (const m of mounted) {
    m.bone.removeFromParent();
    const fitted = fitBoneHand(sourceMesh, true, handOnly() > 0.5, authoredHandLength() * sizeNudge());
    if (!fitted) continue;
    m.bone = fitted.group;
    m.wrist.add(fitted.group);
    // eslint-disable-next-line no-console
    console.log('[bone-arms] fit', fitted.report);
  }
  applyLive();
}

function applyLive(): void {
  const keepOld = showAuthored() > 0.5;
  for (const m of mounted) {
    m.bone.rotation.y = roll();
    for (const o of m.authored) o.visible = keepOld;
  }
}

onKnobChange((k) => {
  if (k.spec.group !== GROUP) return;
  if (k.spec.id === 'bonehandonly' || k.spec.id === 'bonesize') rebuild();
  else applyLive();
});

/**
 * Hang the fitted bone hand off a composed hand's wrist.
 *
 * Called by the viewmodel when the trial flag is on. The authored bone meshes under that
 * wrist are hidden rather than removed, so `keep authored hand` can show both at once — which
 * is the only honest way to check a fit: against the thing it claims to match.
 */
export function attachBoneHand(wrist: THREE.Object3D, authored: THREE.Object3D[]): void {
  if (!DEV) return;
  // The viewmodel recomposes on every weapon change, so without this the list grows and the
  // fit re-runs once per stale entry — twelve times after a couple of minutes, which is how
  // this was noticed. A wrist that has left the scene graph belongs to a hand that is gone.
  for (let i = mounted.length - 1; i >= 0; i--) {
    if (!mounted[i].wrist.parent) { mounted[i].bone.removeFromParent(); mounted.splice(i, 1); }
  }
  const entry: Mounted = { wrist, bone: new THREE.Group(), authored };
  mounted.push(entry);
  wrist.add(entry.bone);
  applyLive();
  if (sourceMesh) { rebuild(); return; }
  if (loading) return;
  loading = true;
  new GLTFLoader().load(
    `${import.meta.env.BASE_URL}models/bone-arms.glb`,
    (gltf) => {
      let found: THREE.Mesh | null = null;
      gltf.scene.traverse((o) => { if (!found && (o as THREE.Mesh).isMesh) found = o as THREE.Mesh; });
      if (!found) { console.warn('[bone-arms] no mesh in the glb'); return; }
      sourceMesh = found;
      rebuild();
    },
    undefined,
    (err) => console.warn('[bone-arms] load failed', err),
  );
}

/** Is the trial on? Read by the viewmodel, so nothing else has to know about the flag. */
export function boneArmsWanted(): boolean {
  return DEV && typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('bonearm') === '1';
}
