// ── THE BONE HAND ────────────────────────────────────────────────────────────
//
// Josh generated skeletal forearms in Tripo3D and wants them as the viewmodel. The first
// attempt hung the bones off the AUTHORED hand and tried to match one to the other at runtime,
// which he called correctly: *"its like the whole idea to fit it to what we have is weird cant
// we just start a new with this new bone hand?"*
//
// Right. The fitting only ever existed because the model arrived as 62 anonymous shells with
// no skeleton, so something had to reconstruct one. It has a skeleton now. So the bone hand is
// not fitted to a hand — it IS the hand, and this file is a loader.
//
// ── WHY THERE IS NO MATH HERE ───────────────────────────────────────────────
//
// scripts/blender/rig-bone-hand.py bakes the asset into content/hand.ts's OWN convention:
// wrist at the origin, fingers up +Y, every joint carrying its position with an identity
// rotation, scaled so the middle knuckle lands exactly on the authored one. It reads that
// convention from scripts/blender/hand-frame.json, which scripts/hand-frame.ts MEASURES off
// the real HAND_RIGHT — so the target can never quietly drift from the code that defines it.
//
// The nodes are named for the slots they are: `wrist`, `palm_anchor`, `finger_index`,
// `finger_index_pip`, … So this module loads the file and hands back a BuiltModel. Everything
// downstream — the weapon grip alignment, adjustFingersForGrip, the arm IK, the wrist solver —
// works because it is looking at the same slot names it always was.
//
// ── AND THE CHARTER ─────────────────────────────────────────────────────────
//
// Pillar 6 says no model files, no texture pipelines. This is the trial of whether that should
// move. DECIDED 2026-08-20: this is the viewmodel now, so the module lives in content/ rather
// than debug/ and loads unconditionally. `?bonearm=0` is the escape hatch back to the authored
// primitive hands. What an imported
// mesh does not get, and would be owed: the lamp-reveal shader, the mood tint, the prop-class
// shadow policy — all keyed off ModelSpec. If it survives, the end state is a conversion that
// emits these shells as a ModelSpec, not a runtime GLTF load. The asset ships either way while
// the flag exists: public/ is copied wholesale.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildModel, type BuiltModel } from '../ecs/build-model';
import { HAND_RIGHT } from '../content/hand';
import type { ModelSpec } from '../ecs/model-types';
import { DEV } from '../debug/dev';

/** Slot names the rest of the game asks this hand for. Anything in the GLB matching one of
 *  these becomes a slot; everything else is a part. Kept as a list rather than inferred from
 *  the node names so a typo'd export FAILS a check instead of quietly losing a joint. */
const SLOT_NAMES: readonly string[] = [
  'wrist', 'palm_anchor', 'palm_up', 'grip_axis',
  'finger_thumb', 'finger_thumb_ip', 'finger_thumb_tip',
  ...['index', 'middle', 'ring', 'pinky'].flatMap((f) => [
    `finger_${f}`, `finger_${f}_pip`, `finger_${f}_dip`, `finger_${f}_tip`,
  ]),
];

export type Side = 'right' | 'left';

const source: Record<Side, THREE.Object3D | null> = { right: null, left: null };
let loading: Promise<void> | null = null;
const listeners: Array<() => void> = [];

/** Run `fn` once the asset is in — immediately if it already is. The viewmodel builds its arm
 *  at construction, long before a GLB can land, so the bone meshes are swapped in on this. */
export function onBoneHandLoaded(fn: () => void): void {
  if (source.right) { fn(); return; }
  listeners.push(fn);
}

/**
 * Start loading. Safe to call repeatedly — the load happens once.
 *
 * Kicked off at boot rather than on first compose: composeHeldWeapon is synchronous, so a hand
 * asked for before the file lands has to fall back to the authored one, and every frame spent
 * waiting is a frame of the wrong hand.
 */
export function preloadBoneHand(): Promise<void> {
  if (loading) return loading;
  const loader = new GLTFLoader();
  const one = (side: Side): Promise<void> => new Promise((resolve) => {
    loader.load(
      `${import.meta.env.BASE_URL}models/bone-hand-${side}.glb`,
      (gltf) => {
        source[side] = gltf.scene;
        gltf.scene.updateMatrixWorld(true);
        const missing = SLOT_NAMES.filter((n) => !gltf.scene.getObjectByName(n));
        if (missing.length) {
          console.warn(`[bone-hand] ${side} glb is missing slots`, missing,
            '— re-run scripts/blender/rig-bone-hand.py');
        }
        resolve();
      },
      undefined,
      (err) => { console.warn(`[bone-hand] ${side} load failed`, err); resolve(); },
    );
  });
  loading = Promise.all([one('right'), one('left')]).then(() => {
    for (const fn of listeners.splice(0)) fn();
  });
  return loading;
}

/**
 * A fresh bone hand, shaped like anything `buildModel` returns.
 *
 * Null until the asset has loaded, in which case callers fall back to the authored hand; a late
 * arrival is picked up on the next weapon swap, which recomposes anyway.
 */
export function buildBoneHand(side: Side = 'right', pose: ModelSpec = HAND_RIGHT): BuiltModel | null {
  const scene = source[side];
  if (!scene) return null;

  // The HAND is the `wrist` subtree specifically: the right file also carries three loose arm
  // bones, and cloning the whole scene would drag a floating forearm into the palm.
  const wristNode = scene.getObjectByName('wrist');
  if (!wristNode) { console.warn('[bone-hand] no `wrist` node in the glb'); return null; }

  // ── THE ROOT AND THE WRIST MUST BE TWO NODES ──────────────────────────────
  //
  // Tempting to return the wrist clone as the group — the bake put it at the origin with an
  // identity transform, so it would work. It does not: viewmodel.ts writes the wrist solver's
  // output onto hand.group's quaternion EVERY FRAME, and the authored hand only survives that
  // because its root and its wrist are different objects. Collapse them and the wrist's own
  // NEW_WRIST_ROT is overwritten on the first frame, and `_palmInHandRoot` gets measured in the
  // wrist frame instead of the root frame — the hand turns and the grip slides off the hilt.
  const group = new THREE.Group();
  group.name = 'bone-hand';
  const wrist = wristNode.clone(true);
  group.add(wrist);
  const parts = new Map<string, THREE.Object3D>();
  const slots = new Map<string, THREE.Object3D>();
  const hitTargets: THREE.Object3D[] = [];
  const materials = new Map<string, THREE.Material>();

  const wanted = new Set(SLOT_NAMES);
  wrist.traverse((o) => {
    if (!o.name) return;
    if (wanted.has(o.name)) slots.set(o.name, o);
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    parts.set(o.name, o);
    hitTargets.push(o);
    const mat = mesh.material as THREE.Material;
    if (mat) materials.set(mat.uuid, mat);
  });
  if (!slots.has('wrist')) slots.set('wrist', wrist);

  // ── THE REST POSE COMES FROM content/hand.ts ──────────────────────────────
  //
  // The asset is exported FLAT — every joint identity — because a flat hand is the honest bind
  // pose for a skeleton, and baking a grip into the file would freeze one weapon's pose into
  // the geometry. The curl is authored, not modelled: HAND_RIGHT's slots carry the MCP/PIP/DIP
  // rest rotations that make a fist, and adjustFingersForGrip nudges from there per grip
  // radius. Reading them off the live spec means the bone hand tracks any repose of the
  // authored one for free, and there is still exactly one place a finger curl is decided.
  const authored = pose.slots ?? {};
  for (const [name, node] of slots) {
    const rot = authored[name]?.rot;
    if (rot) node.rotation.set(rot[0], rot[1], rot[2]);
  }

  return { group, parts, slots, materials, hitTargets };
}

/**
 * The three arm bones, ready for viewmodel.ts's `poseBone`.
 *
 * These are NOT rigged like the hand. `poseBone` puts a bone mesh at the midpoint of two IK
 * endpoints, aims its local +Y along them and leaves the height alone — so the bake centres each
 * bone on its own origin, lays its long axis on +Y, and stretches it to the IK segment length.
 * Nothing here needs a transform; the viewmodel overwrites position and quaternion every frame.
 *
 * Keyed by the same part names ARM_RIGHT uses, so the caller swaps by name.
 */
export function buildBoneArmParts(side: Side = 'right'): Map<string, THREE.Mesh> | null {
  const scene = source[side];
  if (!scene) return null;
  const out = new Map<string, THREE.Mesh>();
  for (const part of ['humerus', 'radius', 'ulna']) {
    const node = scene.getObjectByName(`arm_${part}`);
    if (node && (node as THREE.Mesh).isMesh) out.set(part, (node as THREE.Mesh).clone());
  }
  return out.size ? out : null;
}

/** Is the trial on? Read by the composition, so nothing else has to know about the flag. */
export function boneArmsWanted(): boolean {
  // ── THE SCANNED HANDS ARE THE HANDS NOW ────────────────────────────────────
  //
  // This was `DEV && ?bonearm=1` while it was a trial. Josh, after it shipped behind the flag:
  // *"can we make the bonehand and lantern also default on main like switch to that."*
  //
  // So it returns true, and `?bonearm=0` turns it off — the flag inverts from opt-in to escape
  // hatch, which is what a decided feature's flag is for. Kept rather than deleted because the
  // authored primitive hands are still built and still correct, and an A/B against them is the
  // only way to answer "is the scan actually better" on a phone in a dark room.
  if (typeof window === 'undefined') return true;
  return new URLSearchParams(window.location.search).get('bonearm') !== '0';
}

/** Is the side-by-side view on? */
export function boneViewWanted(): boolean {
  return DEV && typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('boneview') === '1';
}

// ── THE LOOK-AT-IT LOOP ──────────────────────────────────────────────────────
//
// Josh: *"cant you bench the thing until it looks right or something?"* — right, and that is
// what the bench is for. It cannot take this one: it resolves static ModelSpecs and this
// arrives asynchronously from a file.
//
// So this is the equivalent, and it exists because iterating through the GAME was the slow
// part — the composed hand only exists once a weapon is equipped, so every look cost a descent
// and an equip. `?boneview=1` hangs the bone hand and the authored hand side by side in front
// of the camera, present from the first frame, weapon or no weapon. Re-bake, reload, look.
//
// Both at the same scale and the same origin, because the only honest way to judge a hand that
// claims to be a drop-in replacement is against the thing it is replacing.
export function mountBoneView(camera: THREE.Object3D): void {
  if (!DEV) return;
  // Close and scaled up until the two hands FILL the frame. At the viewmodel's own distance
  // both are a centimetre of pixels and every difference that matters is invisible.
  const stage = new THREE.Group();
  stage.position.set(0, -0.02, -0.30);
  stage.scale.setScalar(1.8);
  camera.add(stage);

  const authoredHand = buildModel(HAND_RIGHT);
  authoredHand.group.position.x = -0.075;
  stage.add(authoredHand.group);

  const slotHost = new THREE.Group();
  slotHost.position.x = 0.075;
  stage.add(slotHost);

  const show = (): void => {
    slotHost.clear();
    const bone = buildBoneHand();
    if (!bone) return;
    slotHost.add(bone.group);
    // Compare what the bake actually guarantees: wrist → middle knuckle. A bounding box does
    // NOT measure size here — it measures POSE, and an open hand reads three times a fist. That
    // cost a round of chasing a scale bug that was never there.
    const reach = (m: BuiltModel): string => {
      m.group.updateMatrixWorld(true);
      const w = m.slots.get('wrist') ?? m.group;
      const k = m.slots.get('finger_middle');
      if (!k) return 'n/a';
      const local = w.matrixWorld.clone().invert().multiply(k.matrixWorld);
      return new THREE.Vector3().setFromMatrixPosition(local).length().toFixed(4);
    };
    // eslint-disable-next-line no-console
    console.log('[bone-hand] wrist→knuckle  bone', reach(bone), ' authored', reach(authoredHand));
  };
  void preloadBoneHand().then(show);
}
