import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mountPoints, type WallSurface } from './wall-surfaces';
import type { Volume } from './room-occupancy';
import { MAX_WALL_RECESS } from './wall-courses';
import { dressing } from './dressing';

// ── MAKING A POLYGON ROOM READ AS BUILT ──────────────────────────────────────
//
// The shell gives a room walls. This gives it ARCHITECTURE, and the difference
// is the whole reason the rect path has a trim pass: a wall with nothing on it
// reads as an extruded rectangle no matter how good its shape is. Three thin
// courses of dressed stone per wall kill that read for one merged draw — the
// oldest PS1 trick there is, and the rect rooms have had it for months while
// polygon rooms shipped bare and looked cheaper beside them.
//
// Two dressings, both derived from the ring (poly-shell-plan.ts) rather than
// from a rectangle's four sides, so they work on a chamfer and a diagonal:
//
//   TRIM       skirting where wall meets floor, cornice where it meets ceiling.
//              Follows every span, breaks at every doorway for free — because a
//              doorway is already a break in the span list.
//   PILASTERS  engaged piers standing proud of the wall at a fixed interval.
//              RHYTHM is the load-bearing idea: architecture reads as
//              architecture because things repeat at a spacing, and the single
//              biggest tell of procedural masonry is piers scattered by
//              rejection sampling. mountPoints already solves "evenly, clear of
//              the ends, or not at all", so a pilaster is just another thing
//              that mounts on a wall.
//
// Data in, geometry out. The numbers below are the whole tunable surface, which
// is the seam a content layer authors against without reading this file.

/** Skirting and cornice, matched to the rect path's courses so a polygon room
 *  and a rect room standing side by side agree about where the floor is. */
const SKIRTING = { y: 0.075, h: 0.15, depth: 0.07 };
const CORNICE = { fromTop: 0.06, h: 0.12, depth: 0.055 };
/**
 * How far a course sits proud of the wall plane.
 *
 * ── AND HOW FAR IT REACHES BACK, WHICH IS THE PART THAT WAS WRONG ────────────
 *
 * The rect path buries trim by a 12mm sliver, which is right for a wall that IS
 * the nominal plane. A coursed wall is not: its courses recess, and a slow bow
 * runs across it, so the real face can sit up to MAX_WALL_RECESS (114mm) behind
 * where the trim assumed it was. Josh, on a phone: *"the pillars embedded into
 * the walls kinda float in thin air where the walls get redacted a bit"* — and
 * he added that it was imperfect even before the coursework, which it was: the
 * old wall carried a wave of its own.
 *
 * So the FRONT face of every piece of dressing stays exactly where it was — the
 * room must look unchanged from the front — and the BACK is pushed behind the
 * deepest the masonry can ever go. The extra stone is inside the wall, where
 * nothing can see it and nothing can see past it.
 */
const BURY = 0.012;
/** Reach behind the nominal plane, with a millimetre to spare so a face exactly
 *  at the limit still overlaps rather than touching. */
const REACH_BACK = MAX_WALL_RECESS + 0.01;

/** Turn "stands `proud` metres out of the wall" into the box depth and centre
 *  offset that also reaches REACH_BACK behind it. One place, because skirting,
 *  cornice and pier all need the same arithmetic and all got it wrong the same
 *  way when they each did it themselves. */
function seatedBox(proud: number): { depth: number; out: number } {
  return { depth: proud + REACH_BACK, out: (proud - REACH_BACK) / 2 };
}
/** A span shorter than this gets no trim — a 0.4m sliver of skirting beside a
 *  doorway reads as a chipped tile, not as coursework. */
const MIN_TRIM_SPAN = 0.6;

export interface PilasterSpec {
  /** Interval band. The real spacing is chosen inside it so the run divides
   *  evenly; a leftover stub at one end is what makes a colonnade look
   *  scattered rather than built. */
  spacing: [number, number];
  /** Face width (along the wall) and how far it stands proud of it. */
  width: number;
  depth: number;
  /** Fraction of the room height the pier rises to. 1 = floor to ceiling. */
  rise: number;
  /** Shortest wall that gets any. Below this a pier is a lump, not a pier. */
  minWall: number;
}

export const PILASTER: PilasterSpec = {
  spacing: [3.0, 4.6],
  width: 0.42,
  depth: 0.16,
  rise: 1,
  minWall: 3.4,
};

/**
 * Build the dressed-stone course work for a polygon room.
 *
 * Returns ONE merged geometry (or null), because trim is the cheapest thing in
 * the room to draw and the most expensive thing to draw badly — the rect path
 * learned this and merges too.
 */
export function buildPolyDressing(
  spans: readonly WallSurface[],
  height: number,
  elevation: number,
  pilaster: PilasterSpec | null = PILASTER,
): THREE.BufferGeometry | null {
  const parts: THREE.BufferGeometry[] = [];

  // Each course asks the manifest by name, so the skirting and the cornice can be
  // decided separately — they are the same geometry doing two different jobs at
  // two different distances from the eye.
  const courses = [
    ...(dressing('shell-skirting')
      ? [{ y: elevation + SKIRTING.y, h: SKIRTING.h, depth: SKIRTING.depth }] : []),
    ...(dressing('shell-cornice')
      ? [{ y: elevation + height - CORNICE.fromTop, h: CORNICE.h, depth: CORNICE.depth }] : []),
  ];
  for (const s of spans) {
    if (s.length >= MIN_TRIM_SPAN) {
      for (const c of courses) {
        const seat = seatedBox(c.depth - BURY);
        parts.push(courseBox(s, s.length, c.h, seat.depth, c.y, seat.out));
      }
    }

  }

  for (const p of dressing('shell-pilaster') ? pilasterPlan(spans, height, elevation, pilaster) : []) {
    // SEATED HERE, not in the plan. The plan says how far the pier stands into
    // the room; the mesh is that plus a tail reaching behind the deepest the
    // masonry can go, so it meets stone wherever the courses happen to be.
    const seat = seatedBox(p.depth);
    const geo = new THREE.BoxGeometry(p.width, p.height, seat.depth);
    const m = new THREE.Matrix4().makeRotationY(p.rotY);
    // The plan's x/z is the centre of the visible part; the box's centre sits
    // further back by half the tail.
    const shift = seat.out - p.depth / 2;
    const inward: [number, number] = [Math.sin(p.rotY), Math.cos(p.rotY)];
    m.setPosition(p.x + inward[0] * shift, p.y, p.z + inward[1] * shift);
    geo.applyMatrix4(m);
    parts.push(geo);
  }

  if (parts.length === 0) return null;
  const merged = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  if (merged) tintVertices(merged);
  return merged;
}

export interface Pier {
  /**
   * Centre of the part of the pier THAT STANDS IN THE ROOM, in world space.
   *
   * The plan describes what the room sees; the mesh builder adds the tail that
   * reaches back into the masonry (see seatedBox). Keeping the split here is not
   * tidiness — every consumer of a Pier is asking a question about the ROOM.
   * `pilasterVolumes` reserves floor so nothing is placed inside one; a spawn
   * checker asks whether a point is clear. Handing those a box whose centre is
   * buried in the wall answers a question nobody asked, and both immediately
   * started reporting that piers stand outside the room they are in.
   */
  x: number; y: number; z: number;
  rotY: number;
  /** Face width along the wall, and how far it stands PROUD of the wall plane. */
  width: number; depth: number; height: number;
}

/**
 * WHERE the piers go, with no geometry involved.
 *
 * Split out from the mesh builder because the two things that need this answer
 * happen at different times: the shell builds boxes at BUILD time, and anything
 * that must avoid standing inside a pier — a chest, an altar, a spawn — is
 * placed at COMPOSE time, long before the mesh exists. A pier's position is a
 * pure function of the polygon, so both can just ask.
 *
 * (This is the shape of the fix for "placement is blind": not a repair pass
 * afterwards, but making the answer available before the decision.)
 */
export function pilasterPlan(
  spans: readonly WallSurface[],
  height: number,
  elevation: number,
  pilaster: PilasterSpec | null = PILASTER,
): Pier[] {
  if (!pilaster) return [];
  const out: Pier[] = [];
  const h = height * pilaster.rise;
  for (const s of spans) {
    if (s.length < pilaster.minWall) continue;
    // Never on a span a doorway cut: a pier at a jamb is in the doorway.
    if (s.jambA || s.jambB) continue;
    const piers = mountPoints(s, {
      spacing: pilaster.spacing,
      edgePad: Math.max(0.5, pilaster.width),
      minRun: pilaster.minWall,
      inset: 0,
    });
    // A single pier centred on a wall reads as an accident. Two or more read as
    // a rhythm, which is the entire point.
    if (piers.length < 2) continue;
    // The visible pier: from the wall plane out to `proud`. Its centre is half
    // that far into the room, which is where a Pier's x/z belong.
    const proud = pilaster.depth - BURY;
    for (const p of piers) {
      out.push({
        x: p.x + s.inward[0] * (proud / 2),
        y: elevation + h / 2,
        z: p.z + s.inward[1] * (proud / 2),
        rotY: Math.atan2(s.inward[0], s.inward[1]),
        width: pilaster.width, depth: proud, height: h,
      });
    }
  }
  return out;
}

/** The piers as reservable volumes, so nothing else is placed inside one. */
export function pilasterVolumes(
  spans: readonly WallSurface[],
  height: number,
  elevation: number,
  pilaster: PilasterSpec | null = PILASTER,
): Volume[] {
  return pilasterPlan(spans, height, elevation, pilaster).map((p) => ({
    kind: 'box' as const,
    x: p.x, z: p.z,
    halfW: p.width / 2, halfD: p.depth / 2,
    rotY: p.rotY,
    y0: p.y - p.height / 2, y1: p.y + p.height / 2,
  }));
}

/**
 * The per-vertex tint every surface in this game carries.
 *
 * `materials.dressed` does not currently read vertex colours, so this is
 * belt-and-braces — but the belt is worth wearing: a geometry shipped without
 * the attribute against a material that DOES read it leaves the slot unbound
 * and the driver multiplies undefined memory into the albedo. That failure is
 * driver-dependent, so it renders fine locally and paints black holes on a
 * phone. It has already cost this codebase one live afternoon. Adding the
 * attribute costs nothing; discovering it is missing costs a day.
 */
function tintVertices(geo: THREE.BufferGeometry): void {
  const count = geo.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const base = 0.88 + ((i * 2654435761) % 1000) / 1000 * 0.12;
    colors[i * 3] = base; colors[i * 3 + 1] = base; colors[i * 3 + 2] = base;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

/**
 * One course of stone running the length of a wall span.
 *
 * The box's local +X runs along the wall and its local +Z points into the room,
 * which is what `makeRotationY(atan2(inward.x, inward.z))` gives: a Y rotation
 * sends +Z to (sin, cos), so feeding the inward normal in that argument order
 * lands +Z on it — and lands +X on the wall direction as a consequence. Same
 * arithmetic as the shell's wall faces, deliberately, because a course that
 * disagreed with its wall by a quarter turn would still render.
 */
function courseBox(
  s: WallSurface, len: number, h: number, depth: number, y: number, out: number,
): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(len, h, depth);
  const m = new THREE.Matrix4().makeRotationY(Math.atan2(s.inward[0], s.inward[1]));
  m.setPosition(
    s.mid[0] + s.inward[0] * out,
    y,
    s.mid[1] + s.inward[1] * out,
  );
  geo.applyMatrix4(m);
  return geo;
}
