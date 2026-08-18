// ── THE BONE ARMS, ON TRIAL ──────────────────────────────────────────────────
//
// Josh generated a skeletal forearm-and-hands model in Tripo3D and wants to see whether it
// works as the viewmodel before committing to anything: *"i wanna see if this works … just
// start and lets see how it goes."*
//
// This is the TRIAL, deliberately: a DEV-only loader behind `?bonearm=1`, with the pose on
// sliders so the thing can be sized and placed by eye in the game it has to live in, rather
// than by me guessing numbers into a spec. Nothing here ships and nothing else depends on it.
//
// ── WHAT THE FILE ACTUALLY IS ───────────────────────────────────────────────
//
// Measured before writing a line (scripts/inspect-glb, and a connected-component pass):
//
//   1 node · 1 mesh · 1 primitive · 4,637 tris · 7,442 verts · 384 KB
//   skins 0, animations 0, attrs POSITION/NORMAL/TEXCOORD_0 — NO skeleton at all
//   62 SEPARATE SHELLS, 31 either side of centre — two complete arms, not mirrored copies
//   (280 vs 278 tris on the paired long bones: independently meshed)
//
// Thirty-one shells per arm is anatomically complete: radius, ulna, eight carpals, five
// metacarpals, fourteen phalanges. So the bones are already apart, and rigging this needs no
// weight painting — each shell parents to a joint and moves rigidly, which is what the
// creature renderer already does. That is the next step and it is not this file.
//
// ── AND THE CHARTER ─────────────────────────────────────────────────────────
//
// Pillar 6 says no model files and no texture pipelines. This is a trial of whether that
// pillar should move, so it is worth being exact about what would be owed if it did: an
// imported mesh does not get the lamp-reveal shader, the mood tint, the prop-class shadow
// policy, or the palm/grip slots the weapon attaches to — all of those key off ModelSpec. The
// honest end state is a CONVERSION that emits the shells into the existing pipeline, not a
// runtime GLTF load. This file is the look-first step, not that.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DEV } from './dev';
import { registerViewmodel, unregisterViewmodel } from '../style/render-frame';
import { tuneNumber, onKnobChange } from './tuning';

const GROUP = 'Bone';

// Pose on sliders, because the only honest way to size a foreign asset against a first-person
// camera is to look at it. Ranges are deliberately wide: the file's own units put the whole
// two-arm bbox at ~1.0 and its longest bone at 0.449, where a real forearm is about 0.25m, so
// the scale it wants is unknown until someone drags it.
const scale = tuneNumber({
  id: 'bonescale', group: GROUP, label: 'scale', min: 0.02, max: 2, step: 0.01, value: 0.35,
  apply: 'live', hint: 'the file is in arbitrary units — a real forearm is ~0.25m',
});
const posX = tuneNumber({ id: 'bonex', group: GROUP, label: 'x', min: -1, max: 1, step: 0.01, value: 0.18, apply: 'live' });
const posY = tuneNumber({ id: 'boney', group: GROUP, label: 'y', min: -1.5, max: 0.5, step: 0.01, value: -0.42, apply: 'live' });
const posZ = tuneNumber({ id: 'bonez', group: GROUP, label: 'z', min: -1.5, max: 0.5, step: 0.01, value: -0.45, apply: 'live' });
const rotX = tuneNumber({ id: 'bonerx', group: GROUP, label: 'pitch', min: -3.2, max: 3.2, step: 0.02, value: 0, apply: 'live' });
const rotY = tuneNumber({ id: 'bonery', group: GROUP, label: 'yaw', min: -3.2, max: 3.2, step: 0.02, value: 0, apply: 'live' });
const rotZ = tuneNumber({ id: 'bonerz', group: GROUP, label: 'roll', min: -3.2, max: 3.2, step: 0.02, value: 0, apply: 'live' });
/** 0 = both arms, 1 = only the shells left of centre, 2 = only those right of centre. */
const side = tuneNumber({
  id: 'boneside', group: GROUP, label: 'side', min: 0, max: 2, step: 1, value: 0, apply: 'live',
  hint: '0 both · 1 left-of-centre · 2 right-of-centre',
});

let root: THREE.Group | null = null;
let leftHalf: THREE.Object3D | null = null;
let rightHalf: THREE.Object3D | null = null;

function applyPose(): void {
  if (!root) return;
  root.scale.setScalar(scale());
  root.position.set(posX(), posY(), posZ());
  root.rotation.set(rotX(), rotY(), rotZ());
  const s = Math.round(side());
  if (leftHalf) leftHalf.visible = s === 0 || s === 1;
  if (rightHalf) rightHalf.visible = s === 0 || s === 2;
}

onKnobChange((k) => { if (k.spec.group === GROUP) applyPose(); });

/**
 * Split the single primitive into its two halves by vertex X, so the `side` knob can show one
 * arm at a time. NOT the per-bone split — that needs the connected-component pass and a bone
 * naming step, and both belong with the rigging work rather than with looking at it.
 */
function splitHalves(mesh: THREE.Mesh): { left: THREE.Mesh; right: THREE.Mesh } | null {
  const geo = mesh.geometry;
  const pos = geo.getAttribute('position');
  const index = geo.getIndex();
  if (!index) return null;
  geo.computeBoundingBox();
  const mid = (geo.boundingBox!.min.x + geo.boundingBox!.max.x) / 2;

  const l: number[] = [], r: number[] = [];
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i);
    // Whole triangle by its first vertex: bones do not straddle the centre line, so this
    // cannot split one of them.
    (pos.getX(a) < mid ? l : r).push(a, index.getX(i + 1), index.getX(i + 2));
  }
  const make = (list: number[]) => {
    const g2 = geo.clone();
    g2.setIndex(list);
    const m = new THREE.Mesh(g2, mesh.material);
    return m;
  };
  return { left: make(l), right: make(r) };
}

export function mountBoneArms(camera: THREE.Camera): void {
  if (!DEV || root) return;
  new GLTFLoader().load(
    `${import.meta.env.BASE_URL}models/bone-arms.glb`,
    (gltf) => {
      const src = gltf.scene.getObjectByProperty('type', 'Mesh') as THREE.Mesh | undefined;
      if (!src) { console.warn('[bone-arms] no mesh in the glb'); return; }
      root = new THREE.Group();
      const halves = splitHalves(src);
      if (halves) {
        leftHalf = halves.left; rightHalf = halves.right;
        root.add(halves.left, halves.right);
      } else {
        root.add(src);
      }
      // Re-centre on the model's own middle so the pose knobs move it about a sensible
      // origin rather than about whatever corner the exporter chose.
      const box = new THREE.Box3().setFromObject(root);
      const c = box.getCenter(new THREE.Vector3());
      for (const child of root.children) child.position.sub(c);

      camera.add(root);
      registerViewmodel(root);
      applyPose();
      // eslint-disable-next-line no-console
      console.log(`[bone-arms] mounted · bbox ${box.getSize(new THREE.Vector3()).toArray().map((n) => n.toFixed(2)).join(' x ')}`);
    },
    undefined,
    (err) => console.warn('[bone-arms] load failed', err),
  );
}

export function unmountBoneArms(): void {
  if (!root) return;
  unregisterViewmodel(root);
  root.removeFromParent();
  root = null; leftHalf = null; rightHalf = null;
}
