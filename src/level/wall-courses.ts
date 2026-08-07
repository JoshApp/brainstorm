import * as THREE from 'three';

import { clearance } from './floor-region';
import type { Poly } from './room-shape';

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

// ── THE COLLAPSED PATCH ──────────────────────────────────────────────────────
//
// Courses and wear make a wall look OLD. They do not make it look like anything
// HAPPENED to it, because nothing about them is local — the whole wall is
// equally worn, so the eye reads a material rather than an event.
//
// A collapse is local by definition. One patch of one wall has lost its stones:
// there are holes where they were, and the stones themselves are lying at the
// foot of the wall. That pairing is the entire read. A hole with no rubble is a
// texture; rubble with no hole is a prop somebody put there.
//
// WHY THE HOLES ARE POCKETS AND NOT BREACHES. A polygon room's wall runs from
// the floor to the ceiling — the wall top IS the ceiling line, and past it is
// the void. Anything that opens the wall THROUGH is a hole you can see the
// outside of the world through at some angle, and "at some angle" on a floor
// generated a thousand ways means "on a phone, eventually". So a missing stone
// is a POCKET: a closed box recessed into the wall, unlit at the back. At
// torchlight range a 30cm pocket reads as blackness you can't see the end of,
// which is the thing we actually wanted, and it cannot leak.
//
// WHO DECIDES. Not this function — the ROOM does, and it picks one wall. Rolled
// per wall it came out at 10% of walls, which sounds restrained and means 65% of
// rooms have a hole in them, because a room has six or eight walls. A dungeon
// where every room has collapsed is a dungeon where none has. So `collapse` is
// an instruction from above, and the room hands it to exactly one wall.
//
// Minimum length is this function's own business, though: a 2m return between
// two doorways has no room for a patch that reads as anything.
const COLLAPSE_MIN_LEN = 3.4;
/** How deep a fallen stone leaves its hole. Enough to read as dark, not so deep
 *  it reaches the back of a 25cm wall. */
const POCKET_DEPTH = 0.16;
/** How far the rubble spills into the room. The wall's collision stays on the
 *  nominal plane, so this is stone the player can walk a little way into — at
 *  ankle height, under the camera, where the wall face already hides it. Larger
 *  than this and you notice your shins passing through a boulder. */
const TALUS_REACH = 0.30;

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
  /** Give this wall the collapsed patch — a cluster of missing stones and the
   *  rubble they left. The ROOM decides which of its walls gets one (see
   *  COLLAPSE_MIN_LEN above); a wall too short to carry it declines. */
  collapse?: boolean;
}

/**
 * A wall face laid in courses.
 *
 * Drop-in for `makeJitteredPlane(len, height, { wavy: true })` — same local
 * frame, same attribute set (position / uv / normal / colour, indexed), so it
 * merges into the same batch.
 *
 * SAME LOCAL FRAME MEANS CENTRED. `makeJitteredPlane` returns a PlaneGeometry,
 * and a PlaneGeometry is centred on its origin — callers place a wall by
 * putting its MIDDLE at `baseY + H/2`. Courses are far easier to author from
 * the floor up, so this builds in 0..height and recentres at the end. The first
 * version skipped that step and shipped: every polygon wall's face sat half a
 * room too high, missing below and through the ceiling above, and what you saw
 * from inside the room was the outside of the world where the bottom half of
 * the wall should have been. It looked like a lighting bug, which is why it
 * survived a screenshot.
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
  // Per-vertex shade multiplier, filled in alongside the positions. The colour
  // pass at the bottom is a height gradient and knows nothing about which quad
  // it is looking at; a pocket's back face has to be able to say "I am the
  // inside of a hole, paint me black" at the moment it is built.
  const shade: number[] = [];
  const push = (
    p0: [number, number, number], p1: [number, number, number],
    p2: [number, number, number], p3: [number, number, number],
    sh = 1,
  ) => {
    const base = pos.length / 3;
    pos.push(...p0, ...p1, ...p2, ...p3);
    // UVs in wall metres, so a material that ever wants a texture gets a scale
    // that doesn't stretch on a long wall.
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    shade.push(sh, sh, sh, sh);
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

  // Does this wall have a patch that came down? Decided before the course loop
  // because it changes how finely the courses are cut: a missing stone has to
  // line up with a whole face cell, so the cells have to be stone-sized.
  const collapsing = !!opts.collapse && len >= COLLAPSE_MIN_LEN && rows.length >= 3;
  // Sample the bow along the wall so a long course is not one flat facet. Four
  // segments is enough at this scale and keeps a course at two quads' worth of
  // triangles when the wall is short — except on a collapsing wall, where the
  // cells double as the grid the missing stones are cut out of.
  const segs = collapsing
    ? Math.max(4, Math.min(12, Math.round(len / 0.9)))
    : Math.max(1, Math.min(6, Math.round(len / 1.6)));

  // WHICH STONES ARE GONE. A cluster, not a scatter: one centre cell and a
  // falloff around it, so the hole reads as one failure spreading rather than
  // as woodworm. Skewed UP the wall (the courses that carry least come away
  // first) and kept off the very bottom course, which is where the rubble goes.
  const gone = new Set<number>();
  let talusFrom = 0, talusTo = 0;
  if (collapsing) {
    const cellKey = (c: number, s: number) => c * 1000 + s;
    const sc = 1 + Math.floor(rand() * (segs - 2));
    const cc = Math.max(1, Math.floor(rows.length * (0.35 + rand() * 0.45)));
    const spread = 1 + Math.floor(rand() * 2);
    for (let c = Math.max(1, cc - spread); c <= Math.min(rows.length - 2, cc + spread); c++) {
      for (let s = Math.max(0, sc - spread); s <= Math.min(segs - 1, sc + spread); s++) {
        const dist = Math.abs(c - cc) + Math.abs(s - sc);
        if (rand() < 0.95 - dist * 0.3) gone.add(cellKey(c, s));
      }
    }
    // The rubble sits under the hole, spilling a little wider than it — stone
    // that falls off a wall does not land in a neat column.
    const cw = len / segs;
    talusFrom = -half + (sc - spread - 0.6) * cw;
    talusTo = -half + (sc + spread + 1.6) * cw;
    talusFrom = Math.max(-half, talusFrom);
    talusTo = Math.min(half, talusTo);
    if (talusTo - talusFrom < 0.6) { talusFrom = talusTo = 0; }
  }
  const isGone = (c: number, s: number) => gone.has(c * 1000 + s);

  for (let c = 0; c + 1 < rows.length; c++) {
    const y0 = rows[c], y1 = rows[c + 1];
    const d = depth[c];
    const dBelow = c === 0 ? 0 : depth[c - 1];
    for (let s = 0; s < segs; s++) {
      const x0 = -half + (len * s) / segs, x1 = -half + (len * (s + 1)) / segs;
      const z0 = d + bowAt(x0), z1 = d + bowAt(x1);
      if (isGone(c, s)) {
        // A POCKET where the stone was. Closed box: back, then the four
        // reveals joining it to the face. Only the reveals a NEIGHBOUR hasn't
        // already opened — two adjacent holes are one bigger hole, and a
        // reveal between them is a pane of stone floating in the middle of it.
        const p0 = z0 - POCKET_DEPTH, p1 = z1 - POCKET_DEPTH;
        push([x0, y0, p0], [x1, y0, p1], [x1, y1, p1], [x0, y1, p0], 0.28);
        if (!isGone(c - 1, s)) push([x0, y0, p0], [x1, y0, p1], [x1, y0, z1], [x0, y0, z0], 0.45);
        if (!isGone(c + 1, s)) push([x0, y1, z0], [x1, y1, z1], [x1, y1, p1], [x0, y1, p0], 0.38);
        if (!isGone(c, s - 1)) push([x0, y0, p0], [x0, y0, z0], [x0, y1, z0], [x0, y1, p0], 0.5);
        if (!isGone(c, s + 1)) push([x1, y0, z1], [x1, y0, p1], [x1, y1, p1], [x1, y1, z1], 0.5);
        continue;
      }
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

  // ── WHERE THE STONES WENT ──────────────────────────────────────────
  //
  // A talus against the foot of the wall, under the hole. Built as a strip:
  // one sloped face from a ragged crest down to the floor a little way out,
  // plus a cap on each end. Cheap, and the only face you can see from inside
  // the room is the sloped one, which is the one doing the work.
  if (talusTo > talusFrom) {
    const mid = (talusFrom + talusTo) / 2, spanW = (talusTo - talusFrom) / 2;
    const steps = Math.max(3, Math.round((talusTo - talusFrom) / 0.35));
    // Height and reach both peak under the hole and die at the ends, so the
    // heap has a shape instead of being a kerb.
    const peak = 0.34 + wear * 0.36;
    const profile = (x: number) => {
      const t = 1 - Math.abs(x - mid) / Math.max(0.001, spanW);
      return Math.max(0, t);
    };
    // Sampled first, then stitched — a crest height belongs to a POINT along
    // the wall, and reusing the previous point's height for this point's edge
    // is how you get a staircase instead of a heap.
    const samples: Array<{ x: number; h: number; out: number }> = [];
    for (let i = 0; i <= steps; i++) {
      const x = talusFrom + ((talusTo - talusFrom) * i) / steps;
      const t = profile(x);
      samples.push({
        x,
        h: peak * t * (0.55 + rand() * 0.9),
        out: TALUS_REACH * t * (0.6 + rand() * 0.7),
      });
    }
    for (let i = 1; i < samples.length; i++) {
      const p = samples[i - 1], q = samples[i];
      // The slope: crest against the wall, toe out on the floor. Wound to face
      // into the room. Darker than the wall — loose stone lying in its own
      // shadow, and it wants to separate from the face behind it rather than
      // blend into one grey mass.
      push([p.x, 0, p.out], [q.x, 0, q.out], [q.x, q.h, bowAt(q.x)], [p.x, p.h, bowAt(p.x)], 0.72);
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
    const v = grime * (0.94 + rand() * 0.12) * (shade[i] ?? 1);
    colors[i * 3] = v; colors[i * 3 + 1] = v; colors[i * 3 + 2] = v;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  // Into the caller's frame. See the note on this function about what happened
  // the one time this line was missing.
  g.translate(0, -height / 2, 0);
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

// ── EDGE GRIME ───────────────────────────────────────────────────────────────
//
// The reason a real floor's middle reads as a floor is that its EDGES don't.
// Nobody sweeps a corner; water runs to the wall and stops; the mop, if there
// ever was one, never got closer than an arm's length of the skirting. So the
// perimeter is a band of filth and the traffic lane is scoured pale — and it is
// that CONTRAST, not the absolute brightness, that tells you which part of the
// room people walked through.
//
// It also does the room's silhouette a favour. A polygon's shape is legible
// from a metre off the ground only where a wall interrupts your sightline; a
// dark ribbon following the outline draws the plan on the floor, so an apse or
// a notch reads as a shape even when the wall above it is out of the lamp.
//
// Per SLAB, like everything else here — the band steps in slab units rather
// than fading smoothly, because a smooth fade is a vignette and a vignette
// reads as a post effect. Reach is jittered per slab so the ribbon has a ragged
// inner edge instead of a constant offset from the wall.
const GRIME_REACH = 1.6;
/** How much darker the filthiest slab against a wall goes. */
const GRIME_DEPTH = 0.4;

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
 *
 * `outline` is the room's boundary IN THE PLATE'S OWN SHAPE SPACE — the caller
 * flips the sign, because only the caller knows whether this plate faces up or
 * down. Passing it turns on the perimeter grime band; omitting it leaves the
 * slabs uniformly distributed, which is what you want for a plate whose edges
 * aren't walls.
 */
export function tintAsFlagstones(
  geo: THREE.BufferGeometry, wear: number, seed: number, outline?: Poly,
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
  // One clearance query per SLAB, not per triangle — a subdivided plate has
  // dozens of triangles to a slab and `clearance` walks every polygon edge.
  const grimeBySlab = new Map<number, number>();
  const grimeOf = (row: number, col: number, shift: number): number => {
    if (!outline) return 1;
    const key = (row + 4096) * 8192 + (col + 4096);
    const memo = grimeBySlab.get(key);
    if (memo !== undefined) return memo;
    // The slab's own centre, undoing the row shift — so the whole slab is
    // judged by one distance and darkens as a unit.
    const sx = (col + 0.5) * FLAG_SIZE - shift;
    const sy = (row + 0.5) * FLAG_SIZE;
    const dist = Math.max(0, clearance(outline, sx, sy));
    // Ragged inner edge: each slab decides for itself how far the filth
    // reached, so the band is not a constant-width outline of the room.
    const reach = GRIME_REACH * (0.55 + hash(col + 991, row + 77) * 0.9);
    const t = Math.max(0, 1 - dist / reach);
    const g = 1 - GRIME_DEPTH * t * t * (0.6 + wear * 0.7);
    grimeBySlab.set(key, g);
    return g;
  };
  for (let t = 0; t < n; t += 3) {
    // Centroid in the plate's own shape space.
    let cx = 0, cy = 0;
    for (let k = 0; k < 3; k++) { cx += pos.getX(t + k); cy += pos.getY(t + k); }
    cx /= 3; cy /= 3;
    // Rows shift sideways by a per-row amount, so the joints do not line up
    // into long straight seams across the room — that reads as tiling.
    const row = Math.floor(cy / FLAG_SIZE);
    const shift = hash(0, row) * FLAG_SIZE;
    const col = Math.floor((cx + shift) / FLAG_SIZE);
    const v = 0.80 + (hash(col, row) - 0.5) * 2 * spread;
    // One slab in twenty is much darker — a stone that cracked and filled with
    // whatever runs down here. Rare on purpose: it is a punctuation mark, and a
    // floor of them is just a noisy floor again.
    const dark = hash(col + 7717, row - 313) < 0.05 ? 0.55 : 1;
    const c = Math.max(0.25, Math.min(1.1, v * dark * grimeOf(row, col, shift)));
    for (let k = 0; k < 3; k++) {
      colors[(t + k) * 3] = c; colors[(t + k) * 3 + 1] = c; colors[(t + k) * 3 + 2] = c;
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}
