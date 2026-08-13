import * as THREE from 'three';

// WHAT WAS THE PLAYER LOOKING AT?
//
// A bug report already carries the seed, the depth and the camera pose — enough
// to rebuild the floor and stand in the right place. What it never carried is
// the thing the report is ABOUT. So a report reads "some rare corridors and
// doors generate faulty", and turning that into an addressable ticket means a
// conversation: which corridor, which door, whose geometry.
//
// This closes that gap by asking the scene. One ray straight down the camera's
// forward axis, and we report what it hits — by NAME, by the ancestor chain
// that says which system owns it, and by world position. "A doorway is half
// inside the corridor" stops being prose and becomes
// `doorway-arch < Group < level-poly-2 @ (12.4, 0, -8.1)`.
//
// WHY THE ANCESTOR CHAIN IS THE PAYLOAD. A leaf mesh is often unnamed — three
// gives you `Mesh`. The chain up to the level root is what identifies the
// producer, because this codebase names its groups after the system that built
// them (`static-batch-world`, `level-poly-2`, `fixtures-merged`, an
// interactable's built group). The chain is the thing that tells a reader which
// file to open.
//
// SEVERAL HITS, NOT ONE. The nearest hit is frequently a wall the player is
// standing against, or the very floor tile under the crosshair, while the thing
// they mean is just behind it. Reporting the first few hits along the ray costs
// nothing and removes a whole class of "that's not what I meant".

export interface LookHit {
  /** Mesh name, or the object type when three never named it. */
  name: string;
  /** Ancestor names from the hit up toward the scene root — who built this. */
  owner: string;
  /** Metres from the camera along the view ray. */
  distance: number;
  /** World-space point the ray struck. */
  point: { x: number; y: number; z: number };
  geometry: string | null;
  material: string | null;
}

/** One family of geometry near the aim point, collapsed to a single line. */
export interface NearbyGroup {
  /** The ancestor chain shared by every mesh in this group — who built them. */
  owner: string;
  /** How many meshes of this family sit in the vicinity. */
  count: number;
  /** Distance from the aim point to the closest of them, metres. */
  nearest: number;
  /** A representative mesh name (they share an owner, not always a name). */
  example: string;
}

export interface LookTarget {
  /** Where the camera stood, and the direction it faced. */
  from: { x: number; y: number; z: number };
  forward: { x: number; y: number; z: number };
  /** Nearest first. Empty when the player was staring into the void. */
  hits: LookHit[];
  /** The point the vicinity sweep is centred on — the first solid hit, or a
   *  fixed distance down the view ray when the ray hit nothing. */
  aim: { x: number; y: number; z: number };
  /**
   * EVERYTHING AROUND THE AIM POINT, not just what the crosshair touched.
   *
   * Precise aim is the wrong thing to ask of a thumb on a phone, and it is the
   * wrong thing to ask of these bugs in particular: a void gap, a doorway that
   * doesn't meet its corridor, a step that is really a floor ledge — the defect
   * is usually BESIDE the thing you can actually point at, and a hole has no
   * geometry to hit at all. So the report also sweeps a sphere around the aim
   * point and lists what lives there, grouped by owner so a wall of a hundred
   * batched meshes reads as one line.
   */
  nearby: NearbyGroup[];
}

const raycaster = new THREE.Raycaster();
const _dir = new THREE.Vector3();
const _from = new THREE.Vector3();

/** How far down the view ray to look. Past this and the fog owns it anyway. */
const MAX_DISTANCE = 24;
/** Enough to see past a wall the player is pressed against, few enough to read. */
const MAX_HITS = 4;
/** Radius of the vicinity sweep around the aim point, metres. A room is ~8m
 *  across, so this is "this corner of this room" — wide enough that pointing
 *  roughly at the problem is enough, tight enough to still be an answer. */
const NEARBY_RADIUS = 3;
/** Where to centre the sweep when the ray gives us nothing nearer. Also the CAP
 *  on a hit distance: a ray that punches 20m down a corridor is not describing
 *  what the player meant by "this". */
const AIM_DISTANCE = 3.5;
/** Bounding radius past which a mesh is a level-spanning BATCH, not a thing.
 *  Those touch every point in the room, so they rank 0m against any aim point
 *  and crowd out the discrete geometry the report is actually about. They are
 *  still named in `hits` when the ray lands on one. */
const BATCH_RADIUS = 8;
/** Owner families to report. Beyond this the list stops being a reading. */
const MAX_NEARBY = 10;

/** Names of ancestors up to (not including) the scene root, nearest first. */
function ownerChain(hit: THREE.Object3D, scene: THREE.Object3D): string {
  const parts: string[] = [];
  for (let o: THREE.Object3D | null = hit; o && o !== scene; o = o.parent) {
    const label = o.name || o.type;
    // Collapse runs of the same label — a chain of five unnamed `Group`s says
    // nothing five times.
    if (parts[parts.length - 1] !== label) parts.push(label);
    if (parts.length >= 6) break;
  }
  return parts.join(' < ');
}

/**
 * Raycast down the camera's forward axis and describe what is there.
 *
 * Deliberately reads the LIVE scene rather than any game-side registry: the
 * whole point is to catch geometry that no system claims (a doorway placed by
 * the wrong producer, a mesh left at the origin), which a registry lookup would
 * be blind to by construction.
 */
export function captureLookTarget(scene: THREE.Object3D, camera: THREE.Camera): LookTarget {
  camera.getWorldPosition(_from);
  camera.getWorldDirection(_dir);
  raycaster.set(_from, _dir);
  raycaster.far = MAX_DISTANCE;

  const hits: LookHit[] = [];
  try {
    for (const i of raycaster.intersectObject(scene, true)) {
      if (hits.length >= MAX_HITS) break;
      const o = i.object as THREE.Mesh;
      // Sprites/points carry no useful identity here, and the viewmodel (the
      // player's own sword and lamp, parented to the camera) would otherwise
      // win every ray.
      if (!o.isMesh) continue;
      let onCamera = false;
      for (let p: THREE.Object3D | null = o; p; p = p.parent) {
        if ((p as THREE.Camera).isCamera) { onCamera = true; break; }
      }
      if (onCamera) continue;
      const mat = o.material as THREE.Material | THREE.Material[] | undefined;
      hits.push({
        name: o.name || o.type,
        owner: ownerChain(o, scene),
        distance: Math.round(i.distance * 100) / 100,
        point: {
          x: Math.round(i.point.x * 100) / 100,
          y: Math.round(i.point.y * 100) / 100,
          z: Math.round(i.point.z * 100) / 100,
        },
        geometry: o.geometry?.type ?? null,
        material: Array.isArray(mat) ? 'multi' : (mat?.name || mat?.type || null),
      });
    }
  } catch { /* a malformed geometry must not cost the player their report */ }

  // AIM AT ARM'S LENGTH, NOT AT WHATEVER THE RAY FOUND.
  //
  // Two reasons the first hit is the wrong centre. A miss is common and
  // meaningful — the bug is often a HOLE, which has no geometry to hit, and
  // batched world geometry does not always answer a raycast at all. And a hit
  // can be 20m down a corridor, which is not what the player meant by "this".
  // So: a fixed distance ahead, pulled closer if something solid is nearer.
  const reach = hits.length ? Math.min(hits[0].distance, AIM_DISTANCE) : AIM_DISTANCE;
  const aim = _from.clone().addScaledVector(_dir, reach);

  const byOwner = new Map<string, { count: number; nearest: number; example: string }>();
  const _c = new THREE.Vector3();
  try {
    scene.updateMatrixWorld(true);
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      let onCamera = false;
      for (let p: THREE.Object3D | null = m; p; p = p.parent) {
        if ((p as THREE.Camera).isCamera) { onCamera = true; break; }
      }
      if (onCamera) return;
      // Bounding-sphere centre in world space: cheap, and right for the
      // question "is this piece of geometry around here".
      const geo = m.geometry;
      if (!geo) return;
      if (!geo.boundingSphere) geo.computeBoundingSphere();
      const bs = geo.boundingSphere;
      if (!bs) return;
      _c.copy(bs.center).applyMatrix4(m.matrixWorld);
      // Subtract the radius so a large batched mesh counts by how close it
      // REACHES, not by where its centre happens to average out.
      const radius = bs.radius * Math.max(m.scale.x, m.scale.y, m.scale.z);
      if (radius > BATCH_RADIUS) return;   // a batch, not a thing — see BATCH_RADIUS
      const d = Math.max(0, _c.distanceTo(aim) - radius);
      if (d > NEARBY_RADIUS) return;
      const owner = ownerChain(m, scene);
      const prev = byOwner.get(owner);
      if (prev) { prev.count++; prev.nearest = Math.min(prev.nearest, d); }
      else byOwner.set(owner, { count: 1, nearest: d, example: m.name || m.type });
    });
  } catch { /* never cost the player their report */ }

  const nearby: NearbyGroup[] = [...byOwner.entries()]
    .map(([owner, v]) => ({ owner, count: v.count, nearest: Math.round(v.nearest * 100) / 100, example: v.example }))
    .sort((a, b) => a.nearest - b.nearest)
    .slice(0, MAX_NEARBY);

  return {
    from: { x: +_from.x.toFixed(2), y: +_from.y.toFixed(2), z: +_from.z.toFixed(2) },
    forward: { x: +_dir.x.toFixed(3), y: +_dir.y.toFixed(3), z: +_dir.z.toFixed(3) },
    hits,
    aim: { x: +aim.x.toFixed(2), y: +aim.y.toFixed(2), z: +aim.z.toFixed(2) },
    nearby,
  };
}
