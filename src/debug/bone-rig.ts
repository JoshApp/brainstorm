// ── RIGGING BY CHAIN ORDER, NOT BY DISTANCE OR BY NAME ───────────────────────
//
// Josh: *"if we have the joint mapping we could kinda have the hand grab a thing … at least
// the hand kinda tries to grab the weapon."*
//
// Three ways to rig 27 anonymous bone shells onto a hand. This file has now been through all
// of them, so the reasoning is worth keeping.
//
// BY NAME — decide that this shell is the index proximal phalanx, from its size and position.
// Every such rule is a heuristic, the failure mode is a mangled hand, and a wrong name is
// invisible until something animates. Not attempted, on purpose.
//
// BY DISTANCE — give each shell to the nearest joint of the authored rig. Elegant, needs no
// anatomy, and it MEASURABLY DOES NOT WORK: four joints of sixteen received bones, with whole
// fingers collapsing onto their MCP. An anatomical skeleton and a stylised authored hand do
// not agree dimensionally — the rig's PIP and DIP sit within two centimetres of each other,
// while a real phalanx chain is longer and differently proportioned, so its distal bones land
// past the end of the rig and snap to whatever happens to be nearest. Borrowing the rig's
// joint POSITIONS was the mistake.
//
// BY CHAIN ORDER — what this does. The rig is used for the one thing it is reliable about:
//
//   WHICH FINGER — decided LATERALLY, by which chain's base a shell sits nearest in the plane
//   across the hand. Fingers are far apart sideways, and that separation is unambiguous in
//   any hand, stylised or anatomical.
//
//   HOW FAR OUT — decided by ORDER, never by distance. Sort a finger's shells outward from
//   the wrist, hand them to that finger's joints outward in the same order, furthest bone to
//   furthest joint. Whatever is left over at the base is metacarpal and carpal — bones a
//   finger sits ON rather than bones that bend — and goes to the wrist.
//
// So the two hands never have to agree about lengths, only about which finger is which and
// which way is out. That is why this survives a skeleton whose proportions are nothing like
// the rig's, where matching by distance could not.
//
// The grip still comes free: these are the joints adjustFingersForGrip rotates, so a bone
// given to finger_index_pip curls with the finger it replaced.

import * as THREE from 'three';
import type { FittedShell } from './bone-fit';

/** Which finger a slot belongs to, or null if it is not a bendable joint. Deliberately
 *  excludes palm_anchor, palm_up, blade_emerge and the contact_* points — those mark intent,
 *  not bone, and geometry hung on them would move when a WEAPON changes rather than when a
 *  finger does. */
function fingerOf(name: string): string | null {
  if (!name.startsWith('finger_') || name.includes('contact')) return null;
  // finger_index_pip → index · finger_thumb_ip → thumb · finger_ring → ring
  return name.slice('finger_'.length).split('_')[0] || null;
}

export interface RigResult {
  /** joint name → how many shells landed there. The check that the mapping is sane. */
  assigned: Record<string, number>;
  /** Shells that found no chain at all. Should be zero. */
  orphans: number;
}

interface Joint { name: string; node: THREE.Object3D; pos: THREE.Vector3 }

export function rigShellsToJoints(
  source: THREE.BufferGeometry,
  material: THREE.Material | THREE.Material[],
  shells: FittedShell[],
  toFitted: THREE.Matrix4,
  slots: Map<string, THREE.Object3D>,
  wrist: THREE.Object3D,
): RigResult {
  // ── STRAIGHTEN FIRST ────────────────────────────────────────────────────
  //
  // The authored rest pose is already a relaxed curl — its DIP sits BELOW its MCP, because it
  // is a hand shaped to hold something — while the bone mesh is splayed open. "Outward" only
  // means the same thing on both when the rig is straight. Restored immediately: nothing
  // renders in between, and `attach` bakes world placement at this moment, so a later curl
  // moves the bones exactly as it moves the fingers they replaced.
  const posed: Array<{ node: THREE.Object3D; q: THREE.Quaternion }> = [];
  for (const [name, node] of slots) {
    if (!fingerOf(name)) continue;
    posed.push({ node, q: node.quaternion.clone() });
    node.quaternion.identity();
  }
  const restore = () => {
    for (const p of posed) p.node.quaternion.copy(p.q);
    wrist.updateMatrixWorld(true);
  };

  wrist.updateMatrixWorld(true);
  const wristInv = new THREE.Matrix4().copy(wrist.matrixWorld).invert();
  const jointPos = (node: THREE.Object3D): THREE.Vector3 => {
    node.updateMatrixWorld(true);
    return new THREE.Vector3().setFromMatrixPosition(
      new THREE.Matrix4().multiplyMatrices(wristInv, node.matrixWorld),
    );
  };

  // ── THE FINGER CHAINS, ORDERED OUTWARD ──────────────────────────────────
  const chains = new Map<string, Joint[]>();
  for (const [name, node] of slots) {
    const f = fingerOf(name);
    if (!f) continue;
    const list = chains.get(f) ?? [];
    list.push({ name, node, pos: jointPos(node) });
    chains.set(f, list);
  }
  // Outward = furthest from the wrist. MEASURED, not read off the _pip/_dip suffix, so a rig
  // that adds a joint or renames one still orders correctly.
  for (const list of chains.values()) list.sort((a, b) => b.pos.lengthSq() - a.pos.lengthSq());

  if (chains.size === 0) { restore(); return { assigned: {}, orphans: shells.length }; }

  const wristNode = slots.get('wrist') ?? wrist;
  const byJoint = new Map<string, { node: THREE.Object3D; tris: number[] }>();
  const assigned: Record<string, number> = {};
  const give = (name: string, node: THREE.Object3D, tris: number[]) => {
    let g = byJoint.get(name);
    if (!g) { g = { node, tris: [] }; byJoint.set(name, g); }
    g.tris.push(...tris);
    assigned[name] = (assigned[name] ?? 0) + 1;
  };

  // ── WHICH FINGER: laterally only ────────────────────────────────────────
  //
  // Only the across-hand components are compared. Radial distance is precisely what the two
  // hands disagree about, so including it is what broke the previous attempt.
  const flat = (v: THREE.Vector3) => new THREE.Vector3(v.x, 0, v.z);
  const bases = [...chains.entries()].map(([f, list]) => ({ f, at: flat(list[list.length - 1].pos) }));
  const columns = new Map<string, FittedShell[]>();
  for (const sh of shells) {
    const c = flat(sh.centroid);
    let bestF: string | null = null;
    let bestD = Infinity;
    for (const b of bases) {
      const d = b.at.distanceToSquared(c);
      if (d < bestD) { bestD = d; bestF = b.f; }
    }
    if (!bestF) continue;
    const list = columns.get(bestF) ?? [];
    list.push(sh);
    columns.set(bestF, list);
  }

  // ── HOW FAR OUT: by ORDER along the chain ───────────────────────────────
  let orphans = 0;
  for (const [f, list] of columns) {
    const chain = chains.get(f);
    if (!chain) { orphans += list.length; continue; }
    const outward = [...list].sort((a, b) => b.centroid.y - a.centroid.y);
    for (let i = 0; i < outward.length; i++) {
      if (i < chain.length) give(chain[i].name, chain[i].node, outward[i].tris);
      else give('wrist', wristNode, outward[i].tris);
    }
  }

  // ── ONE MESH PER JOINT, BUILT IN WRIST SPACE, THEN REPARENTED ───────────
  //
  // Shells sharing a joint merge into one mesh, so twenty-seven bones cost about sixteen
  // draws. `attach` preserves world placement across the reparent, so nothing shifts.
  for (const [, g] of byJoint) {
    const geo = source.clone();
    geo.setIndex(g.tris);
    const mesh = new THREE.Mesh(geo, material);
    mesh.applyMatrix4(toFitted);
    mesh.userData.dbgKind = 'bone-hand';
    wrist.add(mesh);
    wrist.updateMatrixWorld(true);
    g.node.attach(mesh);
  }

  restore();
  return { assigned, orphans };
}
