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

export interface LookTarget {
  /** Where the camera stood, and the direction it faced. */
  from: { x: number; y: number; z: number };
  forward: { x: number; y: number; z: number };
  /** Nearest first. Empty when the player was staring into the void. */
  hits: LookHit[];
}

const raycaster = new THREE.Raycaster();
const _dir = new THREE.Vector3();
const _from = new THREE.Vector3();

/** How far down the view ray to look. Past this and the fog owns it anyway. */
const MAX_DISTANCE = 24;
/** Enough to see past a wall the player is pressed against, few enough to read. */
const MAX_HITS = 4;

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

  return {
    from: { x: +_from.x.toFixed(2), y: +_from.y.toFixed(2), z: +_from.z.toFixed(2) },
    forward: { x: +_dir.x.toFixed(3), y: +_dir.y.toFixed(3), z: +_dir.z.toFixed(3) },
    hits,
  };
}
