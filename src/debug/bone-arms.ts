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

/** ── THE SIXTH AXIS IS SOLVED NOW; THIS IS A NUDGE ──────────────────────────
 *
 * Josh: *"with 0 palm roll it faces forward … I don't know how the thing in general is
 * posed."* Correct, and my fault: aligning the arm to +Y pins ONE axis and leaves the whole
 * rotation about it free, so a slider was the only way back from wherever the exporter left
 * the palm.
 *
 * The palm normal is measurable — a hand is thinnest through the palm — so it is measured now
 * (bone-fit.ts) and aligned to the authored hand's own `palm_up`. Zero should be right. This
 * stays for the case where it is not.
 */
const roll = tuneNumber({
  id: 'boneroll', group: GROUP, label: 'palm roll', min: -3.2, max: 3.2, step: 0.02, value: 0,
  apply: 'live', hint: 'nudge — the fit aligns the palm to the authored hand’s palm_up',
});
/** A plane has TWO normals and nothing in the geometry says which side the back of the hand
 *  is on. One binary choice, rather than a continuous fight with the roll slider. */
const flipPalm = tuneNumber({
  id: 'boneflip', group: GROUP, label: 'flip palm', min: 0, max: 1, step: 1, value: 0,
  apply: 'live', hint: 'the palm normal’s sign is ambiguous by construction — flip if inside-out',
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

/**
 * The authored hand's palm normal, expressed in WRIST space.
 *
 * `palm_up`'s +Y is the live palm normal (content/hand.ts says so in as many words), and it
 * is a child of palm_anchor, so its orientation carries the wrist's authored twist. Read from
 * the built model rather than copied out of the spec, so it tracks whatever that file does
 * next.
 */
let authoredPalm: THREE.Vector3 | null = null;
function authoredPalmNormal(): THREE.Vector3 {
  if (authoredPalm) return authoredPalm;
  const built = buildModel(HAND_RIGHT);
  built.group.updateMatrixWorld(true);
  const wrist = built.slots.get('wrist') ?? built.group;
  const up = built.slots.get('palm_up');
  authoredPalm = new THREE.Vector3(0, 1, 0);
  if (up) {
    const m = new THREE.Matrix4().copy(wrist.matrixWorld).invert().multiply(up.matrixWorld);
    authoredPalm.set(0, 1, 0).transformDirection(m).normalize();
  }
  return authoredPalm;
}

function rebuild(): void {
  if (!sourceMesh) return;
  for (const m of mounted) {
    m.bone.removeFromParent();
    const fitted = fitBoneHand(sourceMesh, true, handOnly() > 0.5, authoredHandLength() * sizeNudge());
    if (!fitted) continue;

    // ── SOLVE THE ROTATION ABOUT THE ARM ──────────────────────────────────
    //
    // Two correspondences make a full rotation: the fingers already run up +Y after the fit,
    // and the measured palm normal goes onto the authored `palm_up`. Both are orthogonalised
    // against the finger axis first, so the finger alignment the fit already earned is not
    // disturbed by a palm normal that is a degree or two off perpendicular.
    const fingers = new THREE.Vector3(0, 1, 0);
    const srcPalm = new THREE.Vector3().fromArray(fitted.report.palmNormal)
      .projectOnPlane(fingers).normalize();
    if (flipPalm() > 0.5) srcPalm.negate();
    const dstPalm = authoredPalmNormal().clone().projectOnPlane(fingers).normalize();
    if (srcPalm.lengthSq() > 0.1 && dstPalm.lengthSq() > 0.1) {
      // Rotate about the finger axis by the signed angle between the two palm normals.
      const angle = Math.atan2(
        new THREE.Vector3().crossVectors(srcPalm, dstPalm).dot(fingers),
        srcPalm.dot(dstPalm),
      );
      fitted.group.rotateOnAxis(fingers, angle);
      fitted.group.userData.solvedRoll = angle;
    }

    m.bone = fitted.group;
    m.wrist.add(fitted.group);
    // eslint-disable-next-line no-console
    console.log('[bone-arms] fit', fitted.report,
      'solvedRoll', (fitted.group.userData.solvedRoll ?? 0).toFixed(3));
  }
  applyLive();
}

function applyLive(): void {
  const keepOld = showAuthored() > 0.5;
  for (const m of mounted) {
    // The solved rotation lives on the group's quaternion; the nudge rides on a child-free
    // extra spin about the same axis, so dragging it cannot destroy what the fit worked out.
    const solved = (m.bone.userData.solvedRoll as number | undefined) ?? 0;
    m.bone.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), solved + roll());
    for (const o of m.authored) o.visible = keepOld;
  }
}

onKnobChange((k) => {
  if (k.spec.group !== GROUP) return;
  if (k.spec.id === 'bonehandonly' || k.spec.id === 'bonesize' || k.spec.id === 'boneflip') rebuild();
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
