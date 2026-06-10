// The structured readout — the part of the bench most native to an LLM author.
// Every render is paired with this JSON so half my "is this wrong?" questions
// get answered by PARSING TEXT instead of eyeballing pixels: dimensions, where
// each slot anchor actually sits, the material list, triangle budget. A blade
// whose tip slot is at y=0.70 but whose geometry reaches y=0.95 is a one-glance
// catch here — no render needed. (This is also where a structural validator
// would live.)

import * as THREE from 'three';
import type { BuiltModel } from '../ecs/build-model';
import type { BenchSubject } from './subjects';

export interface Readout {
  id: string;
  kind: string;
  label: string;
  dimensions: { w: number; h: number; d: number };
  boundingBox: { min: [number, number, number]; max: [number, number, number] };
  meshes: number;
  triangles: number;
  vertices: number;
  materials: string[];
  slots: Array<{ name: string; pos: [number, number, number] }>;
  /** Composition diagnostics — populated only when the bench is in
   *  `--hand` mode (hand + weapon composed). Each entry shows a
   *  notable geometric relationship (e.g. distance from a finger DIP
   *  tip to the palm anchor) so the author can VERIFY the wrap
   *  numerically instead of squinting at a screenshot. */
  /** STRUCTURAL LINTER — groups of solid meshes whose bounding boxes
   *  (padded 4mm) touch nothing else in the model. A floating island
   *  is almost always an authoring bug: a head with no neck bones, a
   *  tail cone whose rotation carried it off the rump. Glow sprites
   *  and additive/transparent quads are exempt (they hover by
   *  design). Absent when the model is fully connected. */
  floatingIslands?: Array<{ meshes: string[]; triangles: number }>;
  composition?: {
    /** Distance from named-A slot world-pos to named-B slot world-pos. */
    distances: Array<{ a: string; b: string; d: number }>;
    /** Where the weapon's grip_anchor actually landed vs the hand's
     *  palm_anchor — these should be essentially identical after
     *  alignment; non-zero means the math broke. */
    gripAlignmentError: number;
    /** Distance from each fingertip DIP/IP slot to its matching
     *  contact_* target on the grip surface. THE iteration metric —
     *  drive these to 0 and the fingers wrap perfectly. */
    fingerContactErrors: Array<{ finger: string; d: number }>;
  };
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Connected-component sweep over a model's SOLID meshes. Returns the
 *  islands beyond the largest component (the body). */
export function findFloatingIslands(
  root: THREE.Object3D,
): Array<{ meshes: string[]; triangles: number }> {
  interface Entry { box: THREE.Box3; label: string; tris: number }
  const entries: Entry[] = [];
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    // Additive / transparent quads are glow, not structure.
    const m0 = mats[0] as THREE.Material & { blending?: number };
    if (m0 && (m0.transparent || m0.blending === THREE.AdditiveBlending)) return;
    const geo = mesh.geometry as THREE.BufferGeometry;
    const pos = geo?.getAttribute?.('position');
    if (!pos) return;
    const box = new THREE.Box3().setFromObject(mesh);
    box.expandByScalar(0.004);
    const label = mesh.name || (m0 as THREE.Material)?.name || `mesh#${entries.length}`;
    entries.push({ box, label, tris: geo.index ? geo.index.count / 3 : pos.count / 3 });
  });
  if (entries.length < 2) return [];
  // Union-find over pairwise AABB overlap.
  const parent = entries.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      if (entries[i].box.intersectsBox(entries[j].box)) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, Entry[]>();
  for (let i = 0; i < entries.length; i++) {
    const root_ = find(i);
    if (!groups.has(root_)) groups.set(root_, []);
    groups.get(root_)!.push(entries[i]);
  }
  if (groups.size <= 1) return [];
  const sorted = [...groups.values()].sort((a, b) => b.length - a.length);
  return sorted.slice(1).map((g) => ({
    meshes: g.map((e) => e.label),
    triangles: Math.round(g.reduce((t, e) => t + e.tris, 0)),
  }));
}

export function computeReadout(
  subject: BenchSubject,
  built: BuiltModel,
  weapon?: BuiltModel | null,
): Readout {
  built.group.updateMatrixWorld(true);
  if (weapon) weapon.group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(built.group);
  const size = box.getSize(new THREE.Vector3());

  let triangles = 0;
  let vertices = 0;
  let meshes = 0;
  built.group.traverse((o) => {
    const geo = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
    const pos = geo?.getAttribute?.('position') as THREE.BufferAttribute | undefined;
    if (!pos) return;
    meshes += 1;
    vertices += pos.count;
    triangles += geo!.index ? geo!.index.count / 3 : pos.count / 3;
  });

  const slots: Readout['slots'] = [];
  const v = new THREE.Vector3();
  for (const [name, node] of built.slots) {
    node.getWorldPosition(v);
    slots.push({ name, pos: [r3(v.x), r3(v.y), r3(v.z)] });
  }
  // Weapon slots get a `weapon:` prefix so the two namespaces stay
  // distinct in the readout.
  if (weapon) {
    for (const [name, node] of weapon.slots) {
      node.getWorldPosition(v);
      slots.push({ name: `weapon:${name}`, pos: [r3(v.x), r3(v.y), r3(v.z)] });
    }
  }

  // ── Composition diagnostics (hand mode only) ─────────────────────
  let composition: Readout['composition'] = undefined;
  if (weapon) {
    const palmAnchor = built.slots.get('palm_anchor');
    const gripAnchor = weapon.slots.get('grip_anchor');
    const palmWorld = palmAnchor ? palmAnchor.getWorldPosition(new THREE.Vector3()) : null;
    const gripWorld = gripAnchor ? gripAnchor.getWorldPosition(new THREE.Vector3()) : null;
    const gripAlignmentError = palmWorld && gripWorld ? palmWorld.distanceTo(gripWorld) : 0;
    // Distances from each finger's DISTAL slot to palm_anchor — the
    // single number that says "fingers are wrapped" vs "fingers are
    // flailing somewhere out in front."
    const distances: Array<{ a: string; b: string; d: number }> = [];
    const fingerDips = ['finger_index_dip', 'finger_middle_dip', 'finger_ring_dip', 'finger_pinky_dip', 'finger_thumb_ip'];
    if (palmAnchor) {
      for (const tipSlot of fingerDips) {
        const node = built.slots.get(tipSlot);
        if (!node) continue;
        const tipWorld = node.getWorldPosition(new THREE.Vector3());
        distances.push({ a: tipSlot, b: 'palm_anchor', d: r3(tipWorld.distanceTo(palmWorld!)) });
      }
    }
    // THE iteration metric — fingertip → contact-target distance. Each
    // finger's DIP/IP gets paired with its semantically-named target
    // (contact_index, contact_middle, …); the readout shows the gap
    // in metres. Drive these to 0 and the wrap is geometrically
    // correct, regardless of how the eye reads the snapshot.
    const fingerPairs: Array<[string, string]> = [
      ['finger_index_dip',  'contact_index'],
      ['finger_middle_dip', 'contact_middle'],
      ['finger_ring_dip',   'contact_ring'],
      ['finger_pinky_dip',  'contact_pinky'],
      ['finger_thumb_ip',   'contact_thumb'],
    ];
    const fingerContactErrors: Array<{ finger: string; d: number }> = [];
    for (const [tipSlot, targetSlot] of fingerPairs) {
      const tipNode = built.slots.get(tipSlot);
      const targetNode = built.slots.get(targetSlot);
      if (!tipNode || !targetNode) continue;
      const tipWorld = tipNode.getWorldPosition(new THREE.Vector3());
      const targetWorld = targetNode.getWorldPosition(new THREE.Vector3());
      fingerContactErrors.push({ finger: tipSlot, d: r3(tipWorld.distanceTo(targetWorld)) });
    }
    composition = { distances, gripAlignmentError: r3(gripAlignmentError), fingerContactErrors };
  }

  const islands = findFloatingIslands(built.group);

  return {
    id: subject.id,
    kind: subject.kind,
    label: subject.label,
    dimensions: { w: r3(size.x), h: r3(size.y), d: r3(size.z) },
    boundingBox: {
      min: [r3(box.min.x), r3(box.min.y), r3(box.min.z)],
      max: [r3(box.max.x), r3(box.max.y), r3(box.max.z)],
    },
    meshes,
    triangles: Math.round(triangles),
    vertices,
    materials: [...built.materials.keys()],
    slots,
    floatingIslands: islands.length > 0 ? islands : undefined,
    composition,
  };
}
