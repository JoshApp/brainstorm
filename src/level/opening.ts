// Unified wall-opening model. An *opening* is a gap in a room's perimeter; a
// *fitting* is whatever is installed in it — nothing/archway, a door, a
// portcullis, a boss fog-gate, a cobweb. Every opening (corridor mouth,
// authored door/cobweb tile run, boss threshold) reduces to the SAME
// { center, orientation, width } so one placement + seal path serves them all,
// instead of each system re-deriving coordinates its own way and breaking
// differently.
//
// Pure geometry: no THREE, no game state — so both the procgen layer
// (vault-compose, tilemap) and the runtime (builder, fitting) can depend on it.

export type Edge = 'N' | 'S' | 'E' | 'W';

export type FittingKind =
  | 'archway'       // frame only, always open (corridor mouths / decoration)
  | 'door-hinged'   // 'o' — swings open on interact
  | 'gate-cleared'  // 'O' — portcullis sealed until the room is cleared
  | 'gate-arena'    // 'D' — open until you enter, then slams; opens on clear
  | 'fog-gate'      // boss threshold — interact to commit, seals you in
  | 'cobweb';       // '%' — destructible curtain; slash to open

/** A gap in a room's perimeter wall, in WORLD coords. `rotY` is the wall-LINE
 *  orientation; the curtain/panel faces along its normal (openingNormal). */
export interface Opening {
  x: number;
  z: number;
  rotY: number;
  widthM: number;
  height: number;
  edge?: Edge;
}

// rotY per facing direction. Matches the tilemap stair auto-orient + the
// vault-compose STAIR_ROTY table: +Z→0, -Z→π, +X→π/2, -X→-π/2. THE single
// source for this mapping (it was duplicated across both).
const ROTY_FOR_EDGE: Record<Edge, number> = {
  S: 0, N: Math.PI, E: Math.PI / 2, W: -Math.PI / 2,
};

/** rotY whose normal points in direction `edge` (+Z=S, -Z=N, +X=E, -X=W). */
export function rotYForEdge(edge: Edge): number {
  return ROTY_FOR_EDGE[edge];
}

/** The 2D normal of an opening with this rotY: (0,0,1) rotated by rotY about
 *  Y, projected to XZ. Replaces the THREE Euler dance the fog-gate used. */
export function openingNormal(rotY: number): { x: number; z: number } {
  return { x: Math.sin(rotY), z: Math.cos(rotY) };
}

/** The wall-run orientation rule, duplicated 3× before this: a run flanked by
 *  floor to its N and S spans E↔W (the wall line runs along X, rotY 0);
 *  otherwise it spans N↔S (rotY π/2). One source for door-runs, cobweb-runs,
 *  and any future tile gate. */
export function orientationEW(floorN: boolean, floorS: boolean): boolean {
  return floorN && floorS;
}

/** rotY for a tile-run wall line: EW run → 0, NS run → π/2. */
export function rotYForRun(ew: boolean): number {
  return ew ? 0 : Math.PI / 2;
}

/** The two endpoints of an opening's gap, running ALONG the wall line
 *  (perpendicular to the normal). Used to build the seal wall-segment + the
 *  door hinge geometry from a centre+width descriptor. */
export function openingEndpoints(o: { x: number; z: number; rotY: number; widthM: number }):
  { ax: number; az: number; bx: number; bz: number } {
  // Wall-line direction = perpendicular to the normal (sin,cos): (cos,-sin).
  const hx = Math.cos(o.rotY) * o.widthM / 2;
  const hz = -Math.sin(o.rotY) * o.widthM / 2;
  return { ax: o.x - hx, az: o.z - hz, bx: o.x + hx, bz: o.z + hz };
}
