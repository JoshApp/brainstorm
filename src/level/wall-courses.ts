import * as THREE from 'three';

// ── COURSED MASONRY ──────────────────────────────────────────────────────────
//
// Josh: *"I would like to know if we can make the room itself damaged / worn or
// slightly warped — the shell itself doesn't look the same all the time."*
//
// A polygon room's wall is currently ONE plane per span with a low-frequency
// wave baked into it. It is a slab. In torchlight a slab has exactly one
// brightness, because every point on it faces the same way — so a room reads as
// an extruded outline no matter how good its shape is, and no amount of props
// standing in front of it fixes that.
//
// THE WHOLE TRICK IS THAT LIGHT NEEDS EDGES. A wall laid in COURSES has a
// horizontal step every half metre, and a step catches a lamp: the underside
// goes dark, the top edge goes bright, and the wall reads as depth instead of
// as paint. That is the entire change here, and it is why it comes before any
// prop work — it changes every wall in the game, and props only change the room
// they are in.
//
// ── IT IS ALSO CHEAPER THAN WHAT IT REPLACES ─────────────────────────────────
//
// The obvious construction — one box per block — is ~10 triangles a block and
// hundreds a wall. This one exploits the fact that a course is a STRIPE: one
// quad spans the whole course at that course's depth, and one more quad is the
// step down to the course below. Two quads a course, nine courses, 36 triangles
// — against 128 for the subdivided plane it replaces. Individual blocks are
// spent only where WEAR asks for them.
//
// Local frame matches `makeJitteredPlane`, which this stands in for:
//   +X along the wall, +Y up, +Z INTO the room.
// The caller rotates it into place. Depth is therefore +Z = proud of the wall,
// −Z = recessed into it.

/** Depth of the deepest recess, metres. Beyond this the joint reads as a hole
 *  rather than as masonry, and you start seeing daylight at grazing angles. */
const RECESS_MAX = 0.055;
/** How far a block may stand PROUD. Small on purpose: the wall's collision stays
 *  on the nominal plane, so anything proud is stone the player can stand a
 *  centimetre inside. At 3cm nobody will ever know; at 10cm they would. */
const PROUD_MAX = 0.030;

export interface CoursedWallOpts {
  /** Nominal course height. Real courses vary around it — a perfectly regular
   *  course pattern is the other way to read as wallpaper. */
  courseH?: number;
  /**
   * 0..1, how ruined this wall is.
   *
   * Drives everything: how far courses wander in depth, how often a single
   * block breaks the line, and how strong the slow bow across the wall is. 0 is
   * dressed ashlar in a place somebody still maintains; 1 is a wall holding
   * itself up out of habit.
   */
  wear?: number;
  /** Deterministic stream. The SAME wall must come out the same every time the
   *  floor is built, or a room changes shape when you walk back into it. */
  rand: () => number;
}

/**
 * A wall face laid in courses.
 *
 * Drop-in for `makeJitteredPlane(len, height, { wavy: true })` — same local
 * frame, same attribute set (position / uv / normal / colour, indexed), so it
 * merges into the same batch.
 */
export function makeCoursedWall(
  len: number, height: number, opts: CoursedWallOpts,
): THREE.BufferGeometry {
  const rand = opts.rand;
  const wear = Math.max(0, Math.min(1, opts.wear ?? 0.35));
  const courseH = opts.courseH ?? 0.42;

  // ── THE COURSES ────────────────────────────────────────────────────
  // Heights vary ±18% and the last one absorbs the remainder, so the top of the
  // wall is always exactly `height` — a wall that overshoots pokes through the
  // ceiling and one that falls short shows the void above it.
  const rows: number[] = [0];
  let y = 0;
  while (height - y > courseH * 1.55) {
    y += courseH * (0.82 + rand() * 0.36);
    rows.push(y);
  }
  rows.push(height);

  // A slow bow across the wall, on top of the per-course wander. Two things at
  // different frequencies is what stops a procedural surface reading as noise:
  // the eye finds the long shape first and the detail second.
  const bowPhase = rand() * Math.PI * 2;
  const bowAmp = 0.012 + wear * 0.028;
  const bowAt = (x: number) => Math.sin(x / Math.max(1.2, len * 0.31) + bowPhase) * bowAmp;

  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const push = (
    p0: [number, number, number], p1: [number, number, number],
    p2: [number, number, number], p3: [number, number, number],
  ) => {
    const base = pos.length / 3;
    pos.push(...p0, ...p1, ...p2, ...p3);
    // UVs in wall metres, so a material that ever wants a texture gets a scale
    // that doesn't stretch on a long wall.
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };

  // Depth per course. Recesses run deeper than prouds because a wall wears
  // INWARD — stone falls out, it does not grow.
  const depth: number[] = [];
  for (let c = 0; c + 1 < rows.length; c++) {
    const r = (rand() - 0.5) * 2;
    depth.push(r < 0 ? r * RECESS_MAX * (0.35 + wear) : r * PROUD_MAX * (0.35 + wear));
  }

  const half = len / 2;
  // Sample the bow along the wall so a long course is not one flat facet. Four
  // segments is enough at this scale and keeps a course at two quads' worth of
  // triangles when the wall is short.
  const segs = Math.max(1, Math.min(6, Math.round(len / 1.6)));

  for (let c = 0; c + 1 < rows.length; c++) {
    const y0 = rows[c], y1 = rows[c + 1];
    const d = depth[c];
    const dBelow = c === 0 ? 0 : depth[c - 1];
    for (let s = 0; s < segs; s++) {
      const x0 = -half + (len * s) / segs, x1 = -half + (len * (s + 1)) / segs;
      const z0 = d + bowAt(x0), z1 = d + bowAt(x1);
      // The course face.
      push([x0, y0, z0], [x1, y0, z1], [x1, y1, z1], [x0, y1, z0]);
      // THE STEP down to the course below — this is the part that catches the
      // light, and the reason the whole file exists. Wound so it faces up-and-in
      // when this course stands proud of the one under it, which is the common
      // case and the one you see from a torch on the floor.
      const b0 = dBelow + bowAt(x0), b1 = dBelow + bowAt(x1);
      push([x0, y0, b0], [x1, y0, b1], [x1, y0, z1], [x0, y0, z0]);
    }
  }

  // ── BROKEN BLOCKS ──────────────────────────────────────────────────
  //
  // Single stones that have not worn back flush with their course. Only ever
  // PROUD, never recessed, and the reason is geometric rather than aesthetic: a
  // proud block can be laid over the course face and stay watertight, while a
  // recessed one would need the course split around it to be visible at all.
  // A wall wants a handful of these, not a field of them — the course line is
  // the shape, and a block is a place the line is interrupted.
  const blocks = Math.round(wear * rows.length * 0.55);
  for (let i = 0; i < blocks; i++) {
    const c = Math.floor(rand() * (rows.length - 1));
    const y0 = rows[c], y1 = rows[c + 1];
    const w = 0.45 + rand() * 0.7;
    if (w > len - 0.2) continue;
    const x0 = -half + rand() * (len - w), x1 = x0 + w;
    const d = depth[c] + 0.012 + rand() * PROUD_MAX;
    const zc = (x: number) => depth[c] + bowAt(x);
    const z0 = d + bowAt(x0), z1 = d + bowAt(x1);
    push([x0, y0, z0], [x1, y0, z1], [x1, y1, z1], [x0, y1, z0]);          // face
    push([x0, y0, zc(x0)], [x1, y0, zc(x1)], [x1, y0, z1], [x0, y0, z0]);  // under
    push([x0, y1, z0], [x1, y1, z1], [x1, y1, zc(x1)], [x0, y1, zc(x0)]);  // over
    push([x0, y0, zc(x0)], [x0, y0, z0], [x0, y1, z0], [x0, y1, zc(x0)]);  // left
    push([x1, y0, z1], [x1, y0, zc(x1)], [x1, y1, zc(x1)], [x1, y1, z1]);  // right
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Colour is LOAD-BEARING, not decoration: every wall material in this game
  // runs `vertexColors: true`, and a geometry without the attribute leaves the
  // slot unbound — the shader reads undefined memory and multiplies it into
  // albedo. See the same warning in poly-room-shell.ts.
  //
  // The gradient is worth having on its own: courses near the floor are dirtier
  // than courses near the ceiling, which is true of every real wall and reads
  // instantly as age.
  const count = pos.length / 3;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const vy = pos[i * 3 + 1] / Math.max(0.001, height);
    const grime = 0.80 + vy * 0.14;
    const v = grime * (0.94 + rand() * 0.12);
    colors[i * 3] = v; colors[i * 3 + 1] = v; colors[i * 3 + 2] = v;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

/**
 * How ruined is this particular wall?
 *
 * PER EDGE, not per room, and that is the point: a room with one collapsing
 * wall and three sound ones is a place something happened to. A room with a
 * uniform wear value is a room with a filter over it.
 *
 * The base comes from the ROOM (so a room still reads as one place) and each
 * edge wanders around it. Deterministic from the room's own seeded stream.
 */
export function wallWear(roomBase: number, rand: () => number): number {
  return Math.max(0, Math.min(1, roomBase + (rand() - 0.5) * 0.5));
}

// ── FLAGSTONES ───────────────────────────────────────────────────────────────
//
// The floor has the same disease the walls had and you look at it more: one
// plate, one brightness, per-vertex noise that averages to grey at any distance
// past a metre. A dungeon floor is LAID — in slabs, by somebody, badly — and a
// slab reads because its neighbour is a slightly different colour, not because
// it is a slightly different height.
//
// Height is deliberately NOT touched. The existing comment on `makeJitteredPlane`
// is right: a bumpy floor reads as warped beside the dead-flat stairwell rooms,
// and lumps push the player up. This is tint only, so it costs one attribute
// rewrite and cannot affect movement.
//
// The trick is that the tint must be CONSTANT ACROSS A SLAB. Per-vertex noise
// on a subdivided plate gives you a gradient, which the eye integrates into
// nothing. Quantising the triangle's centroid to a jittered grid and hashing
// the cell gives every triangle in a slab the same value — and a hard edge
// between slabs is the thing you actually see.

/** Nominal slab size. Jittered per row/column so the grid never reads as one. */
const FLAG_SIZE = 1.15;

/**
 * Re-tint a floor plate as laid slabs.
 *
 * Expects a DE-INDEXED geometry (the subdivision pass already de-indexes), so
 * each triangle owns its vertices and can hold its own flat colour. Silently
 * does nothing on an indexed one rather than producing a gradient, because a
 * gradient here looks like a bug and is hard to spot.
 *
 * `wear` darkens and spreads: a worn floor has more contrast between its slabs
 * (some scoured pale, some black with filth) than a maintained one.
 */
export function tintAsFlagstones(
  geo: THREE.BufferGeometry, wear: number, seed: number,
): void {
  if (geo.index) return;
  const pos = geo.getAttribute('position');
  const n = pos.count;
  const colors = new Float32Array(n * 3);
  // Cheap stable hash — the same slab must be the same colour every build, and
  // a floor rebuilt mid-run that repaints itself is worse than a flat one.
  const hash = (a: number, b: number): number => {
    let h = (a * 374761393 + b * 668265263 + seed * 2246822519) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const spread = 0.10 + wear * 0.16;
  for (let t = 0; t < n; t += 3) {
    // Centroid in the plate's own shape space.
    let cx = 0, cy = 0;
    for (let k = 0; k < 3; k++) { cx += pos.getX(t + k); cy += pos.getY(t + k); }
    cx /= 3; cy /= 3;
    // Rows shift sideways by a per-row amount, so the joints do not line up
    // into long straight seams across the room — that reads as tiling.
    const row = Math.floor(cy / FLAG_SIZE);
    const col = Math.floor((cx + hash(0, row) * FLAG_SIZE) / FLAG_SIZE);
    const v = 0.80 + (hash(col, row) - 0.5) * 2 * spread;
    // One slab in twenty is much darker — a stone that cracked and filled with
    // whatever runs down here. Rare on purpose: it is a punctuation mark, and a
    // floor of them is just a noisy floor again.
    const dark = hash(col + 7717, row - 313) < 0.05 ? 0.55 : 1;
    const c = Math.max(0.25, Math.min(1.1, v * dark));
    for (let k = 0; k < 3; k++) {
      colors[(t + k) * 3] = c; colors[(t + k) * 3 + 1] = c; colors[(t + k) * 3 + 2] = c;
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}
