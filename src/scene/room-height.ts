// ── EVERY SHELL SURFACE CARRIES ITS ROOM'S FLOOR AND CEILING ─────────────────
//
// The dark-above effect (style/banded-lighting-webgpu.ts) eats light with height. The first
// version measured height above the CAMERA, which is wrong for the reason Josh gave: *"it
// shouldnt be above eye it should be ceiling dependant otherwhise cieling height collapses."*
//
// He is right, and the failure is specific. A camera-relative band sits at the same apparent
// height in every room, so a six-metre vaulted hall and a two-and-a-half-metre corridor go dark
// at exactly the same place in the frame — and ceiling height stops being information. In a game
// whose rooms are read by their volume, that throws away one of the few spatial cues darkness
// leaves intact.
//
// So the fade is expressed as a FRACTION of the room's own height, and each shell surface carries
// the two numbers needed to compute it: the Y of its room's floor and the Y of its ceiling. A
// tall room then keeps its walls lit far higher in absolute metres than a low one, which is
// exactly the cue that was collapsing — and the vault goes dark in both.
//
// ── WHY A VERTEX ATTRIBUTE ──────────────────────────────────────────────────
//
// A uniform would have to be the room the PLAYER is in, and the moment that matters most is
// looking THROUGH a doorway from a corridor into a hall — where a player-room uniform would
// darken the hall to the corridor's ceiling and destroy the reveal. Rooms differ per surface, so
// the data belongs on the surface.
//
// Two floats, on geometry the level build already owns. The static batcher keys its groups on
// attribute layout (scene/static-batch.ts), so tagging the shell CONSISTENTLY — floor, walls and
// ceiling of every room — keeps them in the same batches they were already in.

import * as THREE from 'three';
// `DEV`, not `import.meta.env.DEV`: this module is imported by the level builders, which the
// test runner exercises under tsx where `import.meta.env` does not exist at all. The literal
// threw on the first line that touched it and took six poly-shell assertions with it.
import { DEV } from '../debug/dev';

/** The attribute name the lighting graph reads. */
export const ROOM_Y_ATTR = 'aRoomY';

/**
 * Tag a shell mesh with the floor and ceiling Y of the room it belongs to.
 *
 * `ceilY` is the room's nominal ceiling — for an arched ceiling that is the springing height, not
 * the apex, so the apex simply sits past the end of the fade and is fully dark. That is the right
 * answer for an arch: the crown is the part that should disappear first.
 *
 * Surfaces WITHOUT this attribute read (0, 0), which the shader treats as "no room" and leaves
 * alone. That is the deliberate fallback — props, enemies, doors and anything else that never
 * goes through the room build stay lit exactly as they are, and adding the effect cannot dim
 * something nobody tagged.
 */
export function tagRoomHeight(mesh: THREE.Mesh | null | undefined, floorY: number, ceilY: number): void {
  const geo = mesh?.geometry;
  const pos = geo?.getAttribute('position');
  if (!geo || !pos) return;
  // Already tagged (a shared or re-tagged geometry) — leave the first answer standing rather than
  // have two rooms fight over one buffer.
  if (geo.getAttribute(ROOM_Y_ATTR)) return;
  const n = pos.count;
  const arr = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    arr[i * 2] = floorY;
    arr[i * 2 + 1] = ceilY;
  }
  geo.setAttribute(ROOM_Y_ATTR, new THREE.BufferAttribute(arr, 2));
  if (DEV) tagged++;
}

const _v = new THREE.Vector3();

/**
 * Tag a shell mesh whose FLOOR IS NOT LEVEL — a ramped corridor, a stair run.
 *
 * Josh: *"it doesnt properly work with corridors that have angled stair ceilings."* Right, and
 * one pair of numbers cannot describe a ramp. A stair corridor's ceiling tracks its floor's grade
 * so headroom stays constant down the slope, and tagging the whole run with the floor height at
 * its centre puts the fraction badly wrong at both ends — too high at the bottom of the run, too
 * low at the top. The dark then cuts across the stair at an angle that belongs to nothing.
 *
 * So the floor is sampled PER VERTEX from the elevation field, and the ceiling rides `height`
 * above it. A ramp is then described exactly, and a level room sampled this way just gets the
 * same answer at every vertex.
 *
 * The mesh's own local matrix is applied first: this geometry is authored in the mesh's frame
 * (the sloped ceiling is displaced in local Z and then rotated flat), so its raw vertex positions
 * are not world XZ and sampling them directly would read the elevation field in the wrong place.
 */
export function tagRoomHeightSloped(
  mesh: THREE.Mesh | null | undefined,
  height: number,
  floorAt: (x: number, z: number) => number,
): void {
  const geo = mesh?.geometry;
  const pos = geo?.getAttribute('position');
  if (!mesh || !geo || !pos) return;
  if (geo.getAttribute(ROOM_Y_ATTR)) return;
  mesh.updateMatrix();
  const n = pos.count;
  const arr = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    _v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(mesh.matrix);
    const f = floorAt(_v.x, _v.z);
    arr[i * 2] = f;
    arr[i * 2 + 1] = f + height;
  }
  geo.setAttribute(ROOM_Y_ATTR, new THREE.BufferAttribute(arr, 2));
  if (DEV) tagged++;
}

let tagged = 0;

/** DEV: how many shell meshes were tagged, and how many survived to the drawn scene. */
export function reportRoomHeightTags(root: THREE.Object3D): void {
  if (!DEV) return;
  let withAttr = 0;
  let without = 0;
  const missing: string[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.geometry) return;
    const k = String(m.userData?.dbgKind ?? '');
    if (k !== 'wall' && k !== 'ceiling') return;
    // A chasm drop hangs BELOW its room's floor, where the fade is already inert (the height
    // fraction is negative there), so it needs no room and is not a gap.
    if ((m.name || '').startsWith('chasm')) return;
    if (m.geometry.getAttribute(ROOM_Y_ATTR)) withAttr++;
    else { without++; if (missing.length < 8) missing.push(m.name || k); }
  });
  // SILENT WHEN EVERYTHING IS TAGGED. An untagged shell mesh does not fail loudly — it just
  // reads (0, 0), takes the no-room fallback and stays lit, so the effect quietly does nothing
  // for that room and looks like a broken slider instead of a missing attribute. That is exactly
  // how this shipped once: the rect builder was tagged and the POLYGON generator, which builds
  // the floors the game actually uses, was not. So the probe speaks only when there is a gap.
  // ALWAYS SAY THE COUNT. Warning only on a gap made silence ambiguous: zero untagged meshes and
  // zero MATCHED meshes print the same nothing, so a probe that found no shell at all looked
  // exactly like a probe that found everything correct.
  // eslint-disable-next-line no-console
  console.log(`[room-height] shell tagged=${tagged} · matched with=${withAttr} without=${without}`);
  if (!without) return;
  // eslint-disable-next-line no-console
  console.warn(`[room-height] ${without} shell mesh(es) carry no room height and will NOT darken`
    + ` (tagged=${tagged}, with=${withAttr}) · ${missing.join(', ')}`);
}
