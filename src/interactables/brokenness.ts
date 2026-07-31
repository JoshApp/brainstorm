import * as THREE from 'three';

// Half-broken art treatment — the shared "everything down here is ruined" pass.
//
// Applies DECAY to a built prop as pure TRANSFORM edits: parts tilt, settle,
// chip (scale down a face), and occasionally a small piece is missing. It never
// touches materials — events share pooled materials (materials.wall is one
// instance across every wall), so darkening/recolouring here would bleed onto
// the whole dungeon. Transform-only keeps it local and safe, and a tilted,
// chipped, gap-toothed altar already reads as ancient without any texture work.
//
// Deterministic given `rand` (pass the level seed stream so a re-render of the
// same floor decays identically). `level` is 0..1 — how ruined:
//   0.0  pristine (no-op)   0.3  weathered   0.6  broken   1.0  wrecked
//
// Call AFTER the model is built + positioned, on the built group (or any
// sub-root). Skips the group's own root transform (so the prop stays where the
// event placed it) and decays the CHILDREN.

export function applyBrokenness(root: THREE.Object3D, level: number, rand: () => number = Math.random): void {
  if (level <= 0) return;
  const L = Math.min(1, level);

  // Collect direct mesh children (the parts). We keep the overall silhouette by
  // never removing more than one small piece and never touching the largest part.
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.parent) meshes.push(o as THREE.Mesh); });
  if (meshes.length === 0) return;

  // Rank by rough size so we protect the biggest part (the plinth/body) and only
  // chip/drop the smaller decorative bits.
  const sized = meshes.map((m) => {
    m.geometry.computeBoundingBox?.();
    const bb = m.geometry.boundingBox;
    const vol = bb ? (bb.max.x - bb.min.x) * (bb.max.y - bb.min.y) * (bb.max.z - bb.min.z) : 0;
    return { m, vol };
  }).sort((a, b) => b.vol - a.vol);
  const biggest = sized[0]?.m;

  // A whole-prop lean — settled into the floor over centuries. Subtle; scales
  // with level. Applied to the root's rotation on top of its placed rotation.
  root.rotation.x += (rand() - 0.5) * 0.10 * L;
  root.rotation.z += (rand() - 0.5) * 0.10 * L;

  let droppedOne = false;
  for (const { m } of sized) {
    // Per-part tilt + settle — each block shifted a little off true.
    m.rotation.x += (rand() - 0.5) * 0.22 * L;
    m.rotation.z += (rand() - 0.5) * 0.22 * L;
    m.position.y -= rand() * 0.03 * L;                 // sink into the settle
    m.position.x += (rand() - 0.5) * 0.02 * L;
    m.position.z += (rand() - 0.5) * 0.02 * L;

    // Chip: shave a part down on one axis so it reads as broken-off, not resized.
    if (m !== biggest && rand() < 0.35 * L) {
      const axis = rand() < 0.5 ? 'x' : 'z';
      m.scale[axis] *= 1 - rand() * 0.35 * L;
    }
    // Missing piece: hide exactly ONE small, non-primary part (a knocked-off
    // finial / corner stone). Only at higher decay, only once, never the body.
    if (!droppedOne && m !== biggest && rand() < 0.25 * L && L > 0.4) {
      m.visible = false;
      droppedOne = true;
    }
  }
}
