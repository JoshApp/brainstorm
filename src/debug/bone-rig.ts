// ── RIGGING BY PROXIMITY, NOT BY ANATOMY ─────────────────────────────────────
//
// Josh: *"if we have the joint mapping we could kinda have the hand grab a thing … at least
// the hand kinda tries to grab the weapon."*
//
// The obvious way to rig 27 anonymous bone shells is to NAME them — this is the index
// proximal phalanx, that is the third carpal — by reasoning about position and size. I
// started down that road and it is a bad road: every rule is a heuristic, the failure mode is
// a mangled hand, and a wrong name is invisible until something animates.
//
// There is a much better target sitting right there. The authored hand (content/hand.ts)
// ALREADY has a joint at every knuckle, anatomically placed and hand-tuned:
// finger_{thumb,index,middle,ring,pinky} for the MCPs, plus _pip and _dip for each. And the
// fit has already put the bone mesh in that same frame — wrist at the origin, fingers up +Y,
// real metres.
//
// So: give each shell to the joint it is NEAREST. No anatomy, no naming, no heuristics about
// what a carpal looks like. The rig's own geometry is the ground truth, and it is a better
// authority than any rule I could write about bone shapes.
//
// Three things fall out of that for free:
//
//   · A misassignment is LOCAL. One bone on the wrong knuckle, not a systematically wrong
//     hand. It is also visible immediately, because it will bend at the wrong place.
//   · The carpals and metacarpals sort themselves out. They sit nearest the wrist and the
//     MCPs, which is exactly where they should be parented, without anything knowing the
//     word "carpal".
//   · THE GRIP JUST WORKS. adjustFingersForGrip rotates those same joints, so a bone
//     parented to finger_index_pip curls with the authored finger it replaced. The hand
//     grabs the weapon because it is driven by the rig that already knew how.

import * as THREE from 'three';
import type { FittedShell } from './bone-fit';

/** Joints a bone may be attached to. Deliberately NOT palm_anchor, palm_up, blade_emerge or
 *  the contact_* points — those are intent anchors that mark meaning, not bones, and hanging
 *  geometry on them would move it when a weapon changes rather than when a finger does. */
function isBoneJoint(name: string): boolean {
  return name === 'wrist' || (name.startsWith('finger_') && !name.includes('contact'));
}

export interface RigResult {
  /** joint name → how many shells landed on it. The check that the mapping is sane. */
  assigned: Record<string, number>;
  /** Shells that found no joint at all. Should be zero. */
  orphans: number;
}

/**
 * Parent each fitted shell to the nearest joint of an already-built hand.
 *
 * `slots` is the built hand's slot map; the shells' centroids are in the wrist frame, so the
 * joints are measured there too. Geometry is built in the wrist frame and reparented with
 * `attach`, which preserves world placement — so a bone does not jump when it changes hands.
 *
 * Shells that land on the same joint are MERGED into one mesh, so twenty-seven bones cost
 * about sixteen draws rather than twenty-seven, and a curl still moves each group as a unit.
 */
export function rigShellsToJoints(
  source: THREE.BufferGeometry,
  material: THREE.Material | THREE.Material[],
  shells: FittedShell[],
  toFitted: THREE.Matrix4,
  slots: Map<string, THREE.Object3D>,
  wrist: THREE.Object3D,
): RigResult {
  // ── ASSIGN AGAINST A STRAIGHT HAND, NOT A CURLED ONE ────────────────────
  //
  // The authored hand's REST pose is already a relaxed curl — its DIP sits at y=0.121, below
  // the MCP at 0.128 — because it is a hand shaped to hold something. The bone mesh is a
  // splayed open hand. Matching one against the other put nearly every bone on a knuckle:
  // measured, five joints out of sixteen, with whole fingers collapsing onto their MCP.
  //
  // The two only correspond when both are STRAIGHT, so the finger joints are zeroed for the
  // duration of the assignment and restored immediately after. Nothing renders in between —
  // this runs inside one call — and the bones keep the placement they were given because
  // `attach` bakes world position at the moment of reparenting, in the straight pose. Curling
  // afterwards then moves them exactly as it moves the fingers they replaced.
  const posed: Array<{ node: THREE.Object3D; q: THREE.Quaternion }> = [];
  for (const [name, node] of slots) {
    if (!name.startsWith('finger_') || name.includes('contact')) continue;
    posed.push({ node, q: node.quaternion.clone() });
    node.quaternion.identity();
  }

  // Joint positions in WRIST space — the frame the fit put the shells in.
  wrist.updateMatrixWorld(true);
  const wristInv = new THREE.Matrix4().copy(wrist.matrixWorld).invert();
  const joints: Array<{ name: string; node: THREE.Object3D; pos: THREE.Vector3 }> = [];
  for (const [name, node] of slots) {
    if (!isBoneJoint(name)) continue;
    node.updateMatrixWorld(true);
    const pos = new THREE.Vector3().setFromMatrixPosition(
      new THREE.Matrix4().multiplyMatrices(wristInv, node.matrixWorld),
    );
    joints.push({ name, node, pos });
  }
  if (joints.length === 0) return { assigned: {}, orphans: shells.length };
  if (typeof console !== 'undefined') {
    const sc = shells.slice(0, 4).map((s2) => s2.centroid.toArray().map((n) => +n.toFixed(3)));
    const jj = joints.slice(0, 4).map((j) => [j.name, j.pos.toArray().map((n) => +n.toFixed(3))]);
    // eslint-disable-next-line no-console
    console.log('[bone-rig] shell centroids', JSON.stringify(sc), 'joints', JSON.stringify(jj));
  }

  // ── NEAREST JOINT PER SHELL ─────────────────────────────────────────────
  const byJoint = new Map<string, { node: THREE.Object3D; tris: number[] }>();
  const assigned: Record<string, number> = {};
  let orphans = 0;
  for (const sh of shells) {
    let best: typeof joints[0] | null = null;
    let bestD = Infinity;
    for (const j of joints) {
      const d = j.pos.distanceToSquared(sh.centroid);
      if (d < bestD) { bestD = d; best = j; }
    }
    if (!best) { orphans++; continue; }
    let g = byJoint.get(best.name);
    if (!g) { g = { node: best.node, tris: [] }; byJoint.set(best.name, g); }
    g.tris.push(...sh.tris);
    assigned[best.name] = (assigned[best.name] ?? 0) + 1;
  }

  // ── ONE MESH PER JOINT, BUILT IN WRIST SPACE, THEN REPARENTED ───────────
  for (const [, g] of byJoint) {
    const geo = source.clone();
    geo.setIndex(g.tris);
    const mesh = new THREE.Mesh(geo, material);
    mesh.applyMatrix4(toFitted);
    mesh.userData.dbgKind = 'bone-hand';
    // Into the wrist frame first, then ATTACH — which preserves world placement across the
    // reparent, so nothing shifts when it moves onto a knuckle.
    wrist.add(mesh);
    wrist.updateMatrixWorld(true);
    g.node.attach(mesh);
  }

  for (const p of posed) p.node.quaternion.copy(p.q);
  wrist.updateMatrixWorld(true);

  return { assigned, orphans };
}
