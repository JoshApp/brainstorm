import type { ModelSpec } from '../ecs/model-types';

// Corridor archway — a stone gate frame at the mouth of a
// corridor where it joins a room. Sells the transition between
// chambers: instead of just stepping from one box into another,
// the player passes UNDER something, framing the next room
// cinematically.
//
// Built per-instance so columns can sit AT THE CORRIDOR EDGES
// (not at a fixed 2m apart) and the tympanum block above the
// lintel fills the wall up to the ceiling. The wall opening
// running floor→ceiling needs to be closed above the lintel
// otherwise the player sees a gap revealing the void behind
// the wall mesh.
//
// Authoring axes:
//   - +X = along the lintel (the gate's running direction)
//   - +Y = up
//   - +Z = INTO the corridor / through the gate
// Composer rotates with rotY so +X aligns with the wall the
// gate sits in.
//
// Collision: emitted via PropSpec.collision[] with two circle
// blockers at the column world positions — the composer
// computes those.

export interface ArchwayOptions {
  /** Width of the corridor opening this archway frames, in
   *  metres. Columns are positioned so their OUTER faces sit
   *  just inside the opening (~0.04m clearance). */
  width: number;
  /** Ceiling height of the abutting room. The tympanum block
   *  above the lintel fills from lintel-top to ceiling so the
   *  void behind the wall doesn't peek through. Default 3.2m. */
  ceilingHeight?: number;
  /** Interior height of the passage BEHIND the gate (the corridor's
   *  ceiling). When lower than the default lintel line, the whole
   *  frame compresses so the lintel overlaps the corridor ceiling —
   *  otherwise a slit of void shows between the corridor's ceiling
   *  plane and the lintel when looking in from the room (rolled
   *  mine-tunnel corridors are 2.3-2.6m, the default lintel is 2.55).
   *  Default: uncapped. */
  openHeight?: number;
}

const COL_HALF_THICK = 0.16;       // half of the column box X size
const COL_HEIGHT     = 2.40;       // column body height (centre at y=1.20)
const COL_DEPTH      = 0.40;       // along the corridor axis
const BASE_HEIGHT    = 0.30;
const BASE_OVERHANG  = 0.065;      // base extends this far past column on each side
const CAPITAL_HEIGHT = 0.18;
const CAPITAL_OVERHANG = 0.065;
const LINTEL_BOTTOM  = 2.55;
const LINTEL_HEIGHT  = 0.30;
const LINTEL_DEPTH   = 0.55;
const LINTEL_OVERHANG = 0.10;      // extra width past column outer edges
const KEYSTONE_W     = 0.32;
const KEYSTONE_H     = 0.28;
const KEYSTONE_D     = 0.60;

/** Top of the visible archway (lintel + keystone) — used by the
 *  tympanum to know where to start filling upward. */
export const ARCHWAY_TOP_Y = LINTEL_BOTTOM + LINTEL_HEIGHT;

/** Local-X offset from the archway centre to each column's
 *  centre, for a given opening width. The composer uses this
 *  to position the collision blockers. */
export function archwayColumnOffset(width: number): number {
  // Outer column face flush with opening edge → column centre
  // sits one column-half-thickness inside.
  return Math.max(COL_HALF_THICK + 0.02, width / 2 - COL_HALF_THICK);
}

/** Half of the passable band between the archway's column BLOCKERS
 *  (collision r 0.18 at the column centres) — the NavGate half-width
 *  pathfinding funnels through. */
export function archwayPassableHalfBand(width: number): number {
  return Math.max(0.2, archwayColumnOffset(width) - 0.18);
}

export function archway(opts: ArchwayOptions): ModelSpec {
  const width = opts.width;
  const ceiling = opts.ceilingHeight ?? 3.2;
  const colOffset = archwayColumnOffset(width);
  const lintelWidth = width + LINTEL_OVERHANG * 2;
  // Compress the frame when the passage behind is lower than the
  // default lintel line: lintel bottom sinks to 0.10m below the
  // corridor ceiling so the lintel body overlaps it — no void slit.
  const lintelBottom = opts.openHeight !== undefined
    ? Math.min(LINTEL_BOTTOM, opts.openHeight - 0.10)
    : LINTEL_BOTTOM;
  const colHeight = Math.max(1.6, lintelBottom + 0.03 - CAPITAL_HEIGHT);
  const topY = lintelBottom + LINTEL_HEIGHT;
  const tympanumHeight = Math.max(0.10, ceiling - topY);
  const tympanumCentreY = topY + tympanumHeight / 2;

  // Tag the id with the opening width + heights (rounded) so buildModel's
  // future cache layer can re-use same-sized archways. Currently
  // buildModel doesn't cache by id, but it's cheap to be ready.
  const id = `archway-w${width.toFixed(2)}-c${ceiling.toFixed(1)}-o${lintelBottom.toFixed(2)}`;

  return {
    id,
    materials: {
      stone: { color: 0x262a30, roughness: 1.0, metalness: 0.0, flatShading: true, detail: 'dressed' },
      // Lintel + keystone use this — identical to stone at rest (emissive 0),
      // but the threshold system raises its warm emissive as the player nears,
      // so the gate's crown glows to mark "a way through." Modulated by id
      // 'glow' (see builder's proximityGlow handling).
      //
      // Toned the emissive colour down from a bright orange (0xff8c3a) to
      // a more restrained warm amber (0xc05a18) — the previous tint was
      // reading as "glowing" too aggressively when the player came close.
      // The proximity system still drives the intensity up, but the peak
      // now sits in a more subtle range.
      glow: { color: 0x262a30, roughness: 1.0, metalness: 0.0, flatShading: true, emissive: 0xc05a18, emissiveIntensity: 0, detail: 'dressed' },
    },
    parts: [
      // Whole frame glows on approach (the 'glow' material) — columns,
      // plinths, capitals, lintel, keystone — a warm rim around the opening.
      // Only the tympanum wall-fill stays plain stone.
      // Left + right column shafts.
      { kind: 'box', pos: [-colOffset, colHeight / 2, 0], size: [COL_HALF_THICK * 2, colHeight, COL_DEPTH], mat: 'glow' },
      { kind: 'box', pos: [ colOffset, colHeight / 2, 0], size: [COL_HALF_THICK * 2, colHeight, COL_DEPTH], mat: 'glow' },
      // Base plinths (slightly wider feet).
      { kind: 'box', pos: [-colOffset, BASE_HEIGHT / 2, 0], size: [COL_HALF_THICK * 2 + BASE_OVERHANG * 2, BASE_HEIGHT, COL_DEPTH + 0.12], mat: 'glow' },
      { kind: 'box', pos: [ colOffset, BASE_HEIGHT / 2, 0], size: [COL_HALF_THICK * 2 + BASE_OVERHANG * 2, BASE_HEIGHT, COL_DEPTH + 0.12], mat: 'glow' },
      // Capitals at the top of each column.
      { kind: 'box', pos: [-colOffset, colHeight + CAPITAL_HEIGHT / 2, 0], size: [COL_HALF_THICK * 2 + CAPITAL_OVERHANG * 2, CAPITAL_HEIGHT, COL_DEPTH + 0.10], mat: 'glow' },
      { kind: 'box', pos: [ colOffset, colHeight + CAPITAL_HEIGHT / 2, 0], size: [COL_HALF_THICK * 2 + CAPITAL_OVERHANG * 2, CAPITAL_HEIGHT, COL_DEPTH + 0.10], mat: 'glow' },
      // Lintel across the top, spanning both columns + a bit. Glows on approach.
      { kind: 'box', pos: [0, lintelBottom + LINTEL_HEIGHT / 2, 0], size: [lintelWidth, LINTEL_HEIGHT, LINTEL_DEPTH], mat: 'glow' },
      // Keystone — small slightly-protruding block centred on the lintel. Glows.
      { kind: 'box', pos: [0, lintelBottom + KEYSTONE_H / 2, 0], size: [KEYSTONE_W, KEYSTONE_H, KEYSTONE_D], mat: 'glow' },
      // Tympanum — wall block from lintel top to ceiling. Without
      // this the player sees through the wall above the lintel
      // into the void behind. Same depth as the lintel so it
      // visually continues the gate's mass.
      { kind: 'box', pos: [0, tympanumCentreY, 0], size: [lintelWidth, tympanumHeight, LINTEL_DEPTH], mat: 'stone' },
    ],
  };
}
