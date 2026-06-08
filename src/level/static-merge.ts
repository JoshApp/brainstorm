import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { LiveLevel } from './builder';

// Per-room static-fixture batching. Repeated props (torches, and any static
// decoration that opts in) are each built as a Group of separate meshes — so
// N torches in a room cost N × parts draw calls. This collapses the STATIC
// parts of those props, per room, per material, into one merged mesh each:
// a room's whole set of torch sconces/candles becomes a handful of draws
// regardless of how many torches it has.
//
// We MERGE (not InstancedMesh) on purpose: we're draw-call bound, not
// triangle-bound (phones eat millions of tris), and merge handles a mix of
// geometries + composes trivially with per-room culling. The merged mesh is
// tagged `fixtures · <roomId>` so room-culling.ts toggles it like any shell.
//
// Animated parts stay separate: torch flames (the 'flame' sphere) + the
// additive flame SPRITES keep flickering per-torch. Only the dead-static
// sconce/candle/wick geometry is batched. Runs ONCE at level load.
//
// General: besides torches, any mesh tagged userData.mergeStatic === true is
// folded in too — the opt-in seam for future static decoration.

interface Rect { id: string; cx: number; cz: number; hw: number; hd: number; }

export function batchStaticFixtures(level: LiveLevel): void {
  const rects: Rect[] = [
    ...level.spec.rooms.map((r) => ({ id: r.id, cx: r.rect.x, cz: r.rect.z, hw: r.rect.w / 2, hd: r.rect.d / 2 })),
    ...level.spec.corridors.map((c) => ({ id: c.id, cx: c.rect.x, cz: c.rect.z, hw: c.rect.w / 2, hd: c.rect.d / 2 })),
  ];

  // group key = roomId | materialSignature → { material, items }
  const groups = new Map<string, { mat: THREE.Material; items: Array<{ mesh: THREE.Mesh; geo: THREE.BufferGeometry }> }>();

  const collect = (mesh: THREE.Mesh, roomId: string) => {
    const mat = mesh.material as THREE.Material;
    const key = `${roomId}|${matSig(mat)}`;
    const geo = (mesh.geometry as THREE.BufferGeometry).clone();
    geo.applyMatrix4(mesh.matrixWorld);
    let g = groups.get(key);
    if (!g) { g = { mat, items: [] }; groups.set(key, g); }
    g.items.push({ mesh, geo });
  };

  // Torches: extract every static mesh (not the animated 'flame' sphere; the
  // flame SPRITES are THREE.Sprite, not Mesh, so they're skipped naturally).
  for (const torch of level.torches) {
    torch.group.updateMatrixWorld(true);
    const roomId = rectIdAt(rects, torch.group.position.x, torch.group.position.z);
    if (!roomId) continue;
    torch.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || m.name === 'flame') return;
      collect(m, roomId);
    });
  }

  // Opt-in static decoration: any root-level mesh tagged mergeStatic.
  level.root.updateMatrixWorld(true);
  level.root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m.userData?.mergeStatic !== true) return;
    const roomId = rectIdAt(rects, m.matrixWorld.elements[12], m.matrixWorld.elements[14]);
    if (roomId) collect(m, roomId);
  });

  // Merge each group; on success, swap the originals out for one merged mesh.
  for (const [key, { mat, items }] of groups) {
    if (items.length < 2) {            // nothing to save — drop the clones, keep originals
      for (const it of items) it.geo.dispose();
      continue;
    }
    const merged = mergeGeometries(items.map((it) => it.geo), false);
    for (const it of items) it.geo.dispose();
    if (!merged) continue;             // attribute mismatch — leave originals intact

    const roomId = key.slice(0, key.indexOf('|'));
    const mesh = new THREE.Mesh(merged, mat);
    mesh.name = 'fixtures-merged';
    mesh.userData.dbgKind = 'fixtures';
    mesh.userData.dbgSource = `fixtures · ${roomId}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    level.root.add(mesh);
    // Remove the now-batched originals (their geometry is pooled/shared — do
    // NOT dispose it; just detach the mesh).
    for (const it of items) it.mesh.removeFromParent();
  }
}

/** Stable signature for grouping visually-identical (but per-instance-cloned)
 *  materials so their geometry can share one merged mesh + one material. */
function matSig(mat: THREE.Material): string {
  const m = mat as THREE.MeshStandardMaterial;
  const col = m.color ? m.color.getHexString() : '------';
  const emi = m.emissive ? m.emissive.getHexString() : '------';
  return `${mat.type}|${col}|${emi}|${(m.roughness ?? 0).toFixed(2)}|${(m.metalness ?? 0).toFixed(2)}|${(m.emissiveIntensity ?? 0).toFixed(2)}|${mat.transparent ? 't' : 'o'}`;
}

function rectIdAt(rects: Rect[], x: number, z: number): string | null {
  let best: Rect | null = null;
  for (const r of rects) {
    if (x >= r.cx - r.hw - 0.05 && x <= r.cx + r.hw + 0.05 &&
        z >= r.cz - r.hd - 0.05 && z <= r.cz + r.hd + 0.05) {
      if (!best || r.hw * r.hd < best.hw * best.hd) best = r;
    }
  }
  return best ? best.id : null;
}
