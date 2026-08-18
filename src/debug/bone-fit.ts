// ── FITTING A FOREIGN HAND INTO THE ONE WE ALREADY HAVE ──────────────────────
//
// Josh: *"i cant really do the values by hand so good … can we use the hands and i will
// position."*
//
// Six sliders is the wrong tool. Five of those six degrees of freedom are not taste, they are
// FACTS about the mesh that can be measured — which way the arm points, where the wrist is,
// how long the hand is — and asking a person to find them by dragging is asking them to
// re-derive by eye something the geometry already states.
//
// So this solves them. The authored hand (content/hand.ts) is the target frame: wrist at the
// origin, fingers running up +Y, and a known length. The bone mesh gets rotated, scaled and
// translated into that frame, and then it can hang off the composed hand's own wrist slot —
// inheriting the viewmodel placement, the weapon-grip composition and the arm IK without a
// single number being typed.
//
// What is left for a person is the one thing measurement cannot give: ROLL about the arm's
// own axis, which decides whether the palm faces the camera or the floor. That is a taste
// call and it stays on a slider.
//
// ── HOW EACH FACT IS RECOVERED ──────────────────────────────────────────────
//
// SHELLS       — the file is one primitive containing 62 disconnected pieces (measured), so
//                connectivity over welded positions gives back the individual bones. Welded,
//                because an exporter splits vertices at UV seams and index-connectivity would
//                report one bone as several.
// SIDE         — 31 shells sit either side of the model's centre. Two arms, independently
//                meshed rather than mirrored.
// ARM AXIS     — the longest dimension of one arm's bounding box. A forearm is much longer
//                than it is wide, so this is not a close call.
// WHICH END IS THE HAND — the end with MORE SHELLS. A wrist has eight carpals, five
//                metacarpals and fourteen phalanges crowded into a few centimetres; the elbow
//                end has two long bones. Counting beats measuring here.
// WRIST         — where the long bones stop. The two biggest shells are the radius and ulna,
//                so their hand-ward extreme IS the wrist, to within a knuckle.
// SCALE         — the authored hand's own bounding box, measured at runtime rather than
//                written down, so it cannot drift out of step with content/hand.ts.

import * as THREE from 'three';

export interface FittedHand {
  group: THREE.Group;
  /** For the readout: what the fit decided, so a wrong answer is legible rather than just
   *  wrong-looking. */
  report: {
    shells: number;
    sideShells: number;
    armAxis: 'x' | 'y' | 'z';
    handAtPositiveEnd: boolean;
    handShells: number;
    scale: number;
    wristToTip: number;
  };
}

interface Shell {
  tris: number[];          // index triples
  centroid: THREE.Vector3;
  box: THREE.Box3;
}

/** Disconnected pieces of one geometry, by connectivity over WELDED positions. */
function shellsOf(geo: THREE.BufferGeometry): Shell[] {
  const pos = geo.getAttribute('position');
  const index = geo.getIndex();
  if (!index) return [];
  const n = pos.count;

  // Weld: quantised position → representative vertex.
  const Q = 1e5;
  const weld = new Map<string, number>();
  const rep = new Int32Array(n);
  for (let v = 0; v < n; v++) {
    const k = `${Math.round(pos.getX(v) * Q)},${Math.round(pos.getY(v) * Q)},${Math.round(pos.getZ(v) * Q)}`;
    let r = weld.get(k);
    if (r === undefined) { r = v; weld.set(k, v); }
    rep[v] = r;
  }

  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (a: number, b: number) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };
  for (let t = 0; t < index.count; t += 3) {
    const a = rep[index.getX(t)], b = rep[index.getX(t + 1)], c = rep[index.getX(t + 2)];
    union(a, b); union(b, c);
  }

  const byRoot = new Map<number, Shell>();
  const v = new THREE.Vector3();
  for (let t = 0; t < index.count; t += 3) {
    const root = find(rep[index.getX(t)]);
    let sh = byRoot.get(root);
    if (!sh) { sh = { tris: [], centroid: new THREE.Vector3(), box: new THREE.Box3() }; byRoot.set(root, sh); }
    for (let k = 0; k < 3; k++) {
      const vi = index.getX(t + k);
      sh.tris.push(vi);
      v.set(pos.getX(vi), pos.getY(vi), pos.getZ(vi));
      sh.box.expandByPoint(v);
    }
  }
  for (const sh of byRoot.values()) sh.box.getCenter(sh.centroid);
  return [...byRoot.values()];
}

const AXES = ['x', 'y', 'z'] as const;

/**
 * Fit one arm of the bone mesh into the authored hand's frame.
 *
 * @param src       the single-primitive mesh straight out of the GLB
 * @param wantRight true for the arm on the +X side of the model
 * @param handOnly  drop everything elbow-ward of the wrist
 * @param targetLen wrist→fingertip length to match, in metres — measured from the authored
 *                  hand rather than written down, so the two cannot drift apart
 */
export function fitBoneHand(
  src: THREE.Mesh, wantRight: boolean, handOnly: boolean, targetLen: number,
): FittedHand | null {
  const geo = src.geometry;
  const all = shellsOf(geo);
  if (all.length === 0) return null;

  // ── SIDE ────────────────────────────────────────────────────────────────
  const whole = new THREE.Box3();
  for (const sh of all) whole.union(sh.box);
  const midX = (whole.min.x + whole.max.x) / 2;
  const side = all.filter((sh) => (wantRight ? sh.centroid.x >= midX : sh.centroid.x < midX));
  if (side.length === 0) return null;

  const sideBox = new THREE.Box3();
  for (const sh of side) sideBox.union(sh.box);
  const size = sideBox.getSize(new THREE.Vector3());

  // ── ARM AXIS: the long one ──────────────────────────────────────────────
  const axis = size.x >= size.y && size.x >= size.z ? 0 : size.y >= size.z ? 1 : 2;
  const axisName = AXES[axis];
  const lo = sideBox.min.getComponent(axis);
  const hi = sideBox.max.getComponent(axis);
  const span = hi - lo || 1;

  // ── WHICH END IS THE HAND: the one with more shells ─────────────────────
  const QUARTER = 0.25;
  let nearLo = 0, nearHi = 0;
  for (const sh of side) {
    const t = (sh.centroid.getComponent(axis) - lo) / span;
    if (t < QUARTER) nearLo++;
    else if (t > 1 - QUARTER) nearHi++;
  }
  const handAtPositiveEnd = nearHi >= nearLo;

  // ── WRIST: where the two longest bones stop ─────────────────────────────
  const longest = [...side].sort((a, b) => {
    const sa = a.box.getSize(new THREE.Vector3()).getComponent(axis);
    const sb = b.box.getSize(new THREE.Vector3()).getComponent(axis);
    return sb - sa;
  }).slice(0, 2);
  let wrist = handAtPositiveEnd ? -Infinity : Infinity;
  for (const sh of longest) {
    const end = handAtPositiveEnd ? sh.box.max.getComponent(axis) : sh.box.min.getComponent(axis);
    wrist = handAtPositiveEnd ? Math.max(wrist, end) : Math.min(wrist, end);
  }

  const keep = handOnly
    ? side.filter((sh) => (handAtPositiveEnd
      ? sh.centroid.getComponent(axis) > wrist
      : sh.centroid.getComponent(axis) < wrist))
    : side;
  if (keep.length === 0) return null;

  // ── BUILD THE TRIMMED GEOMETRY ──────────────────────────────────────────
  const idx: number[] = [];
  for (const sh of keep) idx.push(...sh.tris);
  const trimmed = geo.clone();
  trimmed.setIndex(idx);
  const mesh = new THREE.Mesh(trimmed, src.material);

  // ── ORIENT: arm axis, hand-ward, becomes +Y ─────────────────────────────
  const from = new THREE.Vector3();
  from.setComponent(axis, handAtPositiveEnd ? 1 : -1);
  const q = new THREE.Quaternion().setFromUnitVectors(from, new THREE.Vector3(0, 1, 0));

  const group = new THREE.Group();
  group.add(mesh);
  mesh.quaternion.copy(q);

  // ── SCALE + TRANSLATE: wrist to the origin, tip to targetLen ────────────
  mesh.updateMatrixWorld(true);
  const orientedBox = new THREE.Box3().setFromObject(mesh);
  // The wrist in the rotated frame: transform the plane point we found.
  const wristPoint = new THREE.Vector3();
  wristPoint.setComponent(axis, wrist);
  wristPoint.applyQuaternion(q);
  const wristY = wristPoint.y;
  const wristToTip = Math.max(1e-4, orientedBox.max.y - wristY);
  const s = targetLen / wristToTip;
  mesh.scale.setScalar(s);
  mesh.position.y -= wristY * s;
  // Centre the other two axes on the wrist, so roll spins about the arm rather than orbiting.
  mesh.position.x -= wristPoint.x * s;
  mesh.position.z -= wristPoint.z * s;

  return {
    group,
    report: {
      shells: all.length,
      sideShells: side.length,
      armAxis: axisName,
      handAtPositiveEnd,
      handShells: keep.length,
      scale: s,
      wristToTip,
    },
  };
}
