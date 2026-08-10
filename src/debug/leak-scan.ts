import * as THREE from 'three';
import type { LiveLevel } from '../level/builder';

// DOES THE WORLD CLOSE?
//
// Josh, on a phone shot of a doorway: *"there is a small void gap visible."*
// That is a hole in the shell — a line of sight from somewhere a player can
// stand, out of the dungeon, into nothing. The room shell has tests that assert
// closure per room (tests/poly-shell.test.ts). Nothing tests the JUNCTION, and
// the junction is where every reported gap has been: the room's wall ring and
// the corridor's end cap are cut by two different pieces of code and have to
// agree about one hole.
//
// The instrument is the definition, run backwards: stand where the player can
// stand, fire rays in every direction, and count the ones that hit NOTHING. A
// ray that escapes is a gap, and where it escapes from is where to look. No
// model of the geometry is involved, so it cannot agree with a wrong model.
//
// DEV-only — hundreds of raycasts per sample point, and it needs culling
// suspended first or it reports every culled room as a hole in the sky.
//
// ── STATUS: NOT YET TRUSTWORTHY. READ THIS BEFORE QUOTING IT ────────────────
//
// First run over two real floors said 41 of 156 standing spots leak and 10.7%
// of rays escape. That number is NOT reported as a finding, because the worst
// samples had 130 of 180 rays escaping — three quarters of every direction —
// from a point whose downward ray hit solid floor. A room you can stand in with
// a floor under you does not leak in three quarters of all directions. Either
// the sample points sit somewhere stranger than "in a room", or the fan is
// escaping through a legitimate opening the scan has no notion of (a stairwell,
// a chasm) and is counting it as a hole.
//
// What IS established: the geometry is reachable by the raycaster. Measured
// from a room centre, the 540 loose meshes under the level root return ZERO
// hits in every direction and the 18 BatchedMeshes return all of them — every
// wall, floor and ceiling now lives in the static world batch, and BatchedMesh
// raycast works. So the scan is not blind; the interpretation is unfinished.
//
// Also: Josh's report is a SLIVER at the jamb ("very close at the edge of the
// door like you couldn't get there"). A 10°-step fan cannot resolve that at
// all — finding it needs a dense fan aimed along the doorway edges, not a
// uniform sphere. That is the next move, not a wider version of this one.
//
// Left in the tree because the shape is right and the blind-spot question is
// now answered. Do not put a percentage from it in front of anyone until a
// sample with 130 escaping rays has an explanation.

export interface Leak {
  /** Where the escaping ray started. */
  x: number; z: number;
  /** Which way it left, as a compass yaw in degrees and a pitch in degrees. */
  yaw: number; pitch: number;
  /** How many rays escaped from this sample point, of how many cast. */
  rays: number; of: number;
}

export interface LeakReport {
  points: number;
  leakyPoints: number;
  raysCast: number;
  raysEscaped: number;
  /** Sample points with NO FLOOR under them — walkable space that was never built. */
  floorless: Array<{ x: number; z: number }>;
  /** Worst sample points, most escaping rays first. */
  worst: Leak[];
}

const YAW_STEPS = 36;                                  // every 10°
const PITCHES = [-0.55, -0.25, 0, 0.25, 0.55];   // radians
/** Past this, a ray that has hit nothing is out of the dungeon. Bigger than any
 *  floor's diagonal, so a long clear corridor can't be mistaken for a hole. */
const REACH = 120;

/**
 * Fire a full sphere-ish fan from each sample point and report the escapes.
 *
 * `eyeY` is the player's eye height — the gaps that matter are the ones a
 * standing delver can see, and a scan from the floor plane finds slots under
 * geometry that nobody will ever look through.
 */
export function scanForLeaks(
  level: LiveLevel, samples: ReadonlyArray<{ x: number; z: number }>, eyeY: number,
): LeakReport {
  const ray = new THREE.Raycaster();
  ray.far = REACH;
  const origin = new THREE.Vector3();
  const dir = new THREE.Vector3();
  // ONLY OPAQUE MESHES SEAL A ROOM. A god ray, a flame, a mote is a SPRITE —
  // it is see-through by construction, so counting it as a hit would let a
  // decorative quad certify a hole in the wall as closed. (Three's sprite
  // raycast also wants a camera, which a geometry audit has no business
  // holding — the error was the design telling us.) Gathered once, so the fan
  // below is a flat list intersect instead of a scene walk per ray.
  const occluders: THREE.Object3D[] = [];
  level.root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    if (mat && (mat as THREE.Material).transparent) return;
    occluders.push(m);
  });

  // THE UNAMBIGUOUS ONE, FIRST. Straight down from a point the walkable region
  // says a player can stand: if that finds nothing, the level promised floor it
  // never built, and every escaping ray from here is explained by the sample
  // sitting in the void rather than by a gap in a wall. Separating this out is
  // the difference between "the world has holes" and "my probe stood outside
  // the world", and those want completely different fixes.
  const floorless: Array<{ x: number; z: number }> = [];
  for (const s of samples) {
    origin.set(s.x, eyeY, s.z);
    ray.set(origin, dir.set(0, -1, 0));
    if (ray.intersectObjects(occluders, false).length === 0) floorless.push({ x: +s.x.toFixed(2), z: +s.z.toFixed(2) });
  }

  const worst: Leak[] = [];
  let raysCast = 0, raysEscaped = 0, leakyPoints = 0;

  for (const s of samples) {
    origin.set(s.x, eyeY, s.z);
    let escapedHere = 0;
    let firstYaw = 0, firstPitch = 0;
    let castHere = 0;
    for (let i = 0; i < YAW_STEPS; i++) {
      const yaw = (i / YAW_STEPS) * Math.PI * 2;
      for (const pitch of PITCHES) {
        const cp = Math.cos(pitch);
        dir.set(Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp).normalize();
        ray.set(origin, dir);
        castHere++;
        if (ray.intersectObjects(occluders, false).length > 0) continue;
        if (escapedHere === 0) { firstYaw = yaw; firstPitch = pitch; }
        escapedHere++;
      }
    }
    raysCast += castHere;
    raysEscaped += escapedHere;
    if (escapedHere > 0) {
      leakyPoints++;
      worst.push({
        x: +s.x.toFixed(2), z: +s.z.toFixed(2),
        yaw: Math.round(firstYaw * 180 / Math.PI), pitch: Math.round(firstPitch * 180 / Math.PI),
        rays: escapedHere, of: castHere,
      });
    }
  }
  worst.sort((a, b) => b.rays - a.rays);
  return { points: samples.length, leakyPoints, raysCast, raysEscaped, floorless, worst: worst.slice(0, 25) };
}

/**
 * Where to stand. Rect centres catch a room open to the void; doorway
 * approaches catch the junction, which is where every gap reported so far has
 * actually been — so sample both sides of every opening, close in.
 */
export function leakSamplePoints(level: LiveLevel): Array<{ x: number; z: number }> {
  const out: Array<{ x: number; z: number }> = [];
  const rects = [...level.spec.rooms.filter((r) => !r.logicalOnly), ...level.spec.corridors];
  for (const r of rects) out.push({ x: r.rect.x, z: r.rect.z });
  for (const child of level.root.children) {
    if (child.userData?.dbgKind !== 'frame') continue;
    const s = Math.sin(child.rotation.y), c = Math.cos(child.rotation.y);
    for (const d of [0.9, -0.9, 2.2, -2.2]) {
      out.push({ x: child.position.x + s * d, z: child.position.z + c * d });
    }
  }
  return out.filter((p) => level.walkable.contains(p.x, p.z, 0.25));
}
