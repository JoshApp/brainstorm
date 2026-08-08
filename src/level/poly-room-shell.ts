import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { RoomSpec } from './types';
import type { WallSegment } from './walkable';
import type { StyleMaterials } from '../style/materials';
import { groundYAt } from './elevation';
import { makeJitteredPlane, makeArchedCeilingGeometry, archCeilingMaterial } from './geometry-prims';
import { buildRng } from '../engine/rng';
import { polyBounds, pointInPoly, type Poly } from './room-shape';
import { planWallRing, WALL_T, type OpeningRect, type WallSpan } from './poly-shell-plan';
import { wallCutsFor } from './portals';
import { describeWalls } from './wall-surfaces';
import { buildPolyDressing } from './poly-dressing';
import { makeCoursedWall, wallWear, tintAsFlagstones } from './wall-courses';

// ── BUILDING A POLYGON ROOM ──────────────────────────────────────────────────
//
// Where room-shape.ts's polygons become geometry you can stand in.
//
// Deliberately a SEPARATE function from `buildRoomShell`, not surgery inside it.
// That one is ~400 lines of rect-derived special cases — floor grates, ceiling
// shafts, skirting and cornice trim, braced variants, ramp handling — every one
// of which assumes four axis-aligned sides.
//
// Being separate is not a licence to be different, though, and the first version
// of this file was, in three ways that all showed up on a phone at once:
//
//   1. NO `color` ATTRIBUTE. Every wall/floor material in this game runs
//      `vertexColors: true`. A geometry without a colour attribute leaves that
//      slot UNBOUND, and the driver hands the shader garbage that multiplies
//      into albedo — black patches, wrong tints, surfaces that read as holes.
//      makeFloorWithHoles carries a long comment about exactly this trap. Every
//      geometry built here now carries colours.
//   2. A MIRRORED CEILING. The floor's shape is authored with −z and rotated
//      −π/2 about X. Reusing that same shape with a +π/2 rotation does NOT flip
//      it face-down, it flips it in Z — so on a room that isn't symmetric front
//      to back (an apse very much isn't) the ceiling sat over the wrong end and
//      the room was open to the void. Textbook axis confusion.
//   3. SLABS, NOT A RING. See poly-shell-plan.ts.
//
// What this still deliberately does NOT do: grates, ceiling shafts, barrel and
// pitched vaults. Those come with the generator. (Trim and engaged piers arrived
// with poly-dressing.ts — a shaped room with no coursework read as an extruded
// rectangle standing next to real masonry, which is a worse look than the shape
// is a better one.)

/**
 * Wall thickness in metres — matches the visual weight of the rect shell.
 *
 * DEFINED IN `poly-shell-plan` (a leaf module with no imports of its own) and
 * re-exported here, which is where everything has always imported it from. It
 * had to move: this file is the THREE-heavy builder and it imports `portals`,
 * so anything pure that wanted the thickness — `corridor-trim`, and now
 * `portals` itself — could only get it by closing a cycle back through the
 * renderer. The constant belongs with the wall PLAN, not with the thing that
 * builds meshes from it.
 *
 * Still exported so an audit can plan the SAME ring this builds rather than a
 * copy of it: a connectivity check that guesses the thickness is measuring its
 * own guess (docs/DESIGN-METHOD.md).
 */
export { WALL_T };
/** A room this worn or worse has one wall that has partly come down. Sits inside
 *  `shellWear`'s [0.18, 0.68] range, so roughly a third of rooms get one — often
 *  enough to be part of the dungeon's vocabulary, rare enough to still land. */
const COLLAPSE_ROOM_WEAR = 0.5;
/** Floor triangles get subdivided until no edge is longer than this. Baked AO
 *  and every contact darkening in the game are PER-VERTEX; a raw ShapeGeometry
 *  is a dozen huge triangles, so the darkening either vanishes or smears across
 *  metres as a wedge. The rect path gets this for free from PlaneGeometry. */
const FLOOR_MAX_EDGE = 0.8;

/**
 * Build floor, walls and ceiling for a polygon room.
 *
 * Emits one `WallSegment` per wall span. That is what actually contains the
 * player: `walkable.ts` rejects any move whose path crosses a wall segment
 * (segmentsIntersect), so an arbitrary-angle wall blocks exactly like an
 * axis-aligned one with no extra work. The room's `rect` stays as the permissive
 * bounding box for everything else that reads it.
 */
export function buildPolyRoomShell(
  root: THREE.Object3D,
  room: RoomSpec & { poly: Poly },
  materials: StyleMaterials,
  wallSegmentsOut: WallSegment[],
  /** Rects that should CUT this room's walls — the corridors meeting it. Each
   *  span where a rect crosses an edge becomes a doorway. */
  openingRects: ReadonlyArray<OpeningRect> = [],
  /** Floor holes in floor-shape coords — stairwells and chasm voids. Same
   *  format and same producer as the rect path's, so the two shells cannot
   *  disagree about where a hole is. Without these, a polygon room's stairwell
   *  descends into a solid slab: the shaft is built and then paved over. */
  floorHoles: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [],
): void {
  const poly = room.poly;
  if (poly.length < 3) return;
  const H = room.height;
  const rect = room.rect;
  const elev = room.elevation ?? groundYAt(rect.x, rect.z);

  // Everything below is authored in coordinates LOCAL to the room's rect centre,
  // matching the rect path — that is what lets the shared post-passes (floor
  // contact AO, prop contact AO) find these meshes via `aoRect` and read their
  // vertices with the same origin arithmetic they use on every other floor.
  const local: Poly = poly.map(([x, z]) => [x - rect.x, z - rect.z] as const);

  // HOW RUINED IS THIS ROOM. One number, seeded from the room's id, shared by
  // the floor and by every wall — a room whose floor is filthy and whose walls
  // are crisp is two rooms in one place. Each WALL then wanders around it (see
  // the ring below), which is where a room gets one side that is coming down.
  // A room may also just SAY how ruined it is (RoomSpec.wear) — that is the
  // seam the content layer authors against when a room's condition is a
  // statement rather than weather. The stream is still advanced either way, so
  // an authored room and a derived one make the same downstream draws.
  const wearRand = seededRand(room.id);
  const derivedWear = 0.18 + wearRand() * 0.5;
  const shellWear = Math.max(0, Math.min(1, room.wear ?? derivedWear));

  // ── FLOOR ──────────────────────────────────────────────────────────
  // A hole whose vertex lands ON the contour makes earcut silently DROP it —
  // the floor comes back as a solid plate with no opening and no error. The
  // rect path insets by 2cm against its bounding box for exactly this; a
  // polygon's contour is wherever the outline is, so the check has to be
  // against the outline. Anything that doesn't sit cleanly inside is refused
  // rather than gambled on.
  const safeHoles = floorHoles.filter((h) => h.length >= 3 && h.every(([hx, hy]) =>
    // hole coords are (x, −z) in local space; the outline is (x, z)
    pointInPoly(poly, hx + rect.x, rect.z - hy)));
  const floorGeo = plateGeometry(local, 'up', safeHoles);
  subdivideToMaxEdge(floorGeo, FLOOR_MAX_EDGE);
  // LAID, not poured. Same reasoning as the coursed walls, applied to the
  // surface the player looks at most — see tintAsFlagstones. Tint only: the
  // floor stays dead flat, so nothing here can push a player up or make a room
  // read as warped beside the hand-authored ones.
  // The outline in the plate's OWN space (floor plates mirror Y — see
  // plateGeometry), so the grime band can ask "how far from a wall is this
  // slab" without the caller and the tinter disagreeing about a sign.
  const floorOutline: Poly = local.map(([x, z]) => [x, -z] as const);
  // Shape space → WORLD. The flagstone Voronoi the shader draws is projected in
  // world XZ, so the tint has to be asked there or it colours a different set of
  // slabs from the ones whose seams the player can see.
  tintAsFlagstones(floorGeo, shellWear, hashKey(room.id), floorOutline,
    (sx, sy) => [rect.x + sx, rect.z - sy]);
  const floor = new THREE.Mesh(floorGeo, materials.floor);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(rect.x, elev, rect.z);
  floor.receiveShadow = true;
  floor.name = `polyfloor:${room.id}`;
  // Opt into the wall-contact and prop-contact AO post-passes, which find their
  // subjects by userData.aoRect and read vertices in this un-rotated shape space.
  floor.userData.aoRect = { x: rect.x, z: rect.z, w: rect.w, d: rect.d };
  floor.userData.dbgKind = 'floor';
  floor.userData.dbgSource = `polyfloor · ${room.id}`;
  root.add(floor);

  // ── CEILING ────────────────────────────────────────────────────────
  // Authored face-DOWN (see plateGeometry) rather than by re-rotating the floor,
  // which mirrors it in Z. The rect path gets away with the re-rotation only
  // because a rectangle is symmetric; a polygon is not.
  const style = room.ceilingStyle ?? 'flat';
  let ceiling: THREE.Mesh;
  if (style === 'flat') {
    const ceilGeo = plateGeometry(local, 'down');
    // Subdivided so the slab tint has faces to colour, and so the per-vertex
    // contact darkening passes have vertices where they need them. Coarser
    // than the floor's: a ceiling is four metres away in the dark, and detail
    // you cannot resolve is triangles you are paying for and not seeing.
    subdivideToMaxEdge(ceilGeo, FLOOR_MAX_EDGE * 2);
    // Ceiling plates are NOT mirrored, so `local` is already their shape space.
    // The band here is soot rather than filth — smoke rises, hits the slab and
    // crawls outward to the walls, so the corners are the black part.
    tintAsFlagstones(ceilGeo, shellWear * 0.7, hashKey(room.id) ^ 0x5eed, local,
      (sx, sy) => [rect.x + sx, rect.z + sy]);
    ceiling = new THREE.Mesh(ceilGeo, materials.ceiling);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(rect.x, elev + H, rect.z);
  } else {
    // VAULTED. The same arch the rect path builds, spanning this room's
    // BOUNDING BOX rather than its outline — a barrel over a chamfered plan is
    // still a barrel, and the corner overhang sits above the wall's top cap
    // where nothing standing in the room can see it.
    //
    // Not a nicety: measured over 288 generated floors, 67% of the rooms the
    // chamfer pass refused were refused for having a vault. Excluding them
    // meant "polygon rooms in the dungeon" converted 1% of rooms, which is a
    // feature that isn't in the game.
    ceiling = new THREE.Mesh(
      makeArchedCeilingGeometry(rect.w, rect.d, H, room.ceilingRise ?? (style === 'barrel' ? 1.3 : 1.0), style),
      archCeilingMaterial(materials.ceiling),
    );
    ceiling.position.set(rect.x, elev, rect.z);   // geometry is already in world Y
  }
  ceiling.receiveShadow = true;
  ceiling.name = `polyceil:${room.id}`;
  ceiling.userData.dbgKind = 'ceiling';
  ceiling.userData.dbgSource = `polyceil · ${room.id}`;
  root.add(ceiling);

  // ── WALLS ──────────────────────────────────────────────────────────
  // ONE OPENING, COMPUTED ONCE (level/portals.ts). The ring used to clip the
  // corridor rects itself, padded by the wall thickness — which widened every
  // doorway by 0.5m and punched a second hole whenever a corridor grazed a
  // corner. The portal planner already answers both questions correctly.
  const spans = planWallRing(poly, WALL_T, openingRects, undefined, wallCutsFor(poly, openingRects));
  // HOW RUINED IS THIS ROOM, and then how ruined is each of its walls. Two
  // levels on purpose: one number per room and the room reads as one place;
  // one number per wall and a room can have three sound sides and a fourth
  // that is coming down, which is a room something happened to.
  //
  // Seeded from the room's id so a floor rebuilds identically — a wall that
  // changes shape when you walk back into it is worse than a flat one.
  //
  // AND AT MOST ONE OF THEM HAS COME DOWN. A collapsed patch (missing stones
  // plus the rubble under them — see wall-courses.ts) is the strongest single
  // signal that something HAPPENED in a room rather than that the room is old,
  // and it only works while it is rare. Rolled per wall it read as woodworm;
  // decided here it is one wall, in a minority of rooms, and it is the wall you
  // remember the room by. Long walls only, and the LONGEST eligible one, so the
  // patch lands where there is space to see it.
  const collapseSpan = shellWear > COLLAPSE_ROOM_WEAR
    ? spans.reduce<{ i: number; len: number }>((best, s, i) => {
      const l = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
      return l > best.len ? { i, len: l } : best;
    }, { i: -1, len: 0 }).i
    : -1;
  const pieces: THREE.BufferGeometry[] = [];
  for (let i = 0; i < spans.length; i++) {
    const s = spans[i];
    pieces.push(...spanGeometry(s, elev, H, wallWear(shellWear, wearRand), wearRand, i === collapseSpan));
    // THE thing that makes the room solid — and the thing that makes a doorway
    // real, since a span with no segment is a span the player can cross. The
    // movement code already refuses any step that crosses a segment.
    wallSegmentsOut.push({ ax: s.a[0], az: s.a[1], bx: s.b[0], bz: s.b[1] });
  }
  if (pieces.length > 0) {
    const merged = mergeGeometries(pieces, false);
    for (const g of pieces) g.dispose();
    if (merged) {
      const walls = new THREE.Mesh(merged, materials.wall);
      walls.castShadow = true;
      walls.receiveShadow = true;
      walls.name = `polywalls:${room.id}`;
      walls.userData.dbgKind = 'wall';
      walls.userData.dbgSource = `polywalls · ${room.id}`;
      // WHICH span came down, as a fact on the mesh rather than a thing an
      // audit has to re-derive. A report that recomputes "did this room
      // collapse" from wear constants is measuring its own copy of the rule
      // (docs/DESIGN-METHOD.md); this is the rule's own answer.
      walls.userData.collapsedSpan = collapseSpan;
      root.add(walls);
    }
  }

  // ── DRESSING ───────────────────────────────────────────────────────
  // Skirting, cornice and engaged piers, in dressed stone. Every rect room in
  // the game has had trim for months; a polygon room without it reads as an
  // extruded rectangle standing next to real masonry, which is a worse look
  // than the shape is a better one. Derived from the same wall surfaces the
  // placers use, so it follows a chamfer and breaks at a doorway for free.
  const dressing = buildPolyDressing(
    describeWalls({ poly, height: H, elevation: elev, thickness: WALL_T, openings: openingRects }),
    H, elev,
  );
  if (dressing) {
    const trim = new THREE.Mesh(dressing, materials.dressed);
    trim.receiveShadow = true;
    trim.castShadow = false;
    trim.name = `polytrim:${room.id}`;
    trim.userData.dbgKind = 'wall';
    trim.userData.dbgSource = `polytrim · ${room.id}`;
    root.add(trim);
  }
}

// ── plates ───────────────────────────────────────────────────────────────────

/**
 * A horizontal polygon plate, in the SHAPE space the mesh's ±π/2 X rotation
 * expects, facing the way you asked.
 *
 * The handedness is the whole reason this is a named function. A shape point
 * (x, Y) becomes world (x, ·, −Y) under rotX(−π/2) and world (x, ·, +Y) under
 * rotX(+π/2). So an up-facing plate must author Y = −z and a down-facing plate
 * must author Y = +z, or the two disagree about where the room is.
 */
function plateGeometry(
  local: Poly, facing: 'up' | 'down',
  /** Holes, ALREADY in floor-shape coordinates (X = world_x − rect.x,
   *  Y = −(world_z − rect.z)) — the same space builder.ts builds stairwell and
   *  void holes in for the rect path, so both shells consume one format. Only
   *  meaningful for the floor: a stairwell does not cut the ceiling. */
  holes: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [],
): THREE.ShapeGeometry {
  const sy = facing === 'up' ? -1 : 1;
  const shape = new THREE.Shape();
  shape.moveTo(local[0][0], local[0][1] * sy);
  for (let i = 1; i < local.length; i++) shape.lineTo(local[i][0], local[i][1] * sy);
  shape.closePath();
  for (const h of holes) {
    if (h.length < 3) continue;
    const path = new THREE.Path();
    path.moveTo(h[0][0], h[0][1]);
    for (let i = 1; i < h.length; i++) path.lineTo(h[i][0], h[i][1]);
    path.closePath();
    shape.holes.push(path);
  }
  return new THREE.ShapeGeometry(shape);
}

/**
 * Split triangles until none has an edge longer than `maxEdge`.
 *
 * Plain 4-way midpoint subdivision on a de-indexed geometry. Not adaptive and
 * not clever: a room floor is a few hundred triangles either way, and the
 * per-vertex darkening passes only need vertices to exist where the darkening
 * varies.
 */
function subdivideToMaxEdge(geo: THREE.BufferGeometry, maxEdge: number): void {
  let pos = (geo.index ? geo.toNonIndexed() : geo).getAttribute('position') as THREE.BufferAttribute;
  let tris: number[] = Array.from(pos.array as Float32Array);
  const longest = (o: number): number => {
    let m = 0;
    for (let e = 0; e < 3; e++) {
      const i = o + e * 3, j = o + ((e + 1) % 3) * 3;
      m = Math.max(m, Math.hypot(tris[i] - tris[j], tris[i + 1] - tris[j + 1]));
    }
    return m;
  };
  for (let pass = 0; pass < 6; pass++) {
    if (!tris.some((_, k) => k % 9 === 0 && longest(k) > maxEdge)) break;
    const next: number[] = [];
    for (let o = 0; o < tris.length; o += 9) {
      if (longest(o) <= maxEdge) { next.push(...tris.slice(o, o + 9)); continue; }
      const v = [0, 1, 2].map((e) => tris.slice(o + e * 3, o + e * 3 + 3));
      const m = [0, 1, 2].map((e) => {
        const p = v[e], q = v[(e + 1) % 3];
        return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2];
      });
      next.push(
        ...v[0], ...m[0], ...m[2],
        ...m[0], ...v[1], ...m[1],
        ...m[2], ...m[1], ...v[2],
        ...m[0], ...m[1], ...m[2],
      );
    }
    tris = next;
  }
  geo.deleteAttribute('normal');
  geo.deleteAttribute('uv');
  geo.setIndex(null);
  geo.setAttribute('position', new THREE.Float32BufferAttribute(tris, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(
    tris.flatMap((_, k) => (k % 3 === 0 ? [tris[k] * 0.25, tris[k + 1] * 0.25] : [])), 2,
  ));
  geo.computeVertexNormals();
}

// ── the ring ─────────────────────────────────────────────────────────────────

/**
 * The faces of one wall span: the room-side surface, its back, the top, and a
 * jamb cap at any end that a doorway cut.
 *
 * The room-side face is built by the SAME `makeJitteredPlane` every other wall
 * in the game uses, so a polygon room's walls carry the identical surface wave
 * and baked edge AO — this is a shell for the existing look, not a second one.
 * The back, top and jambs are plain quads: they exist so the shell is a closed
 * solid, and only the jambs are ever looked at closely.
 */
/** FNV-1a over a string — one stable integer per room id. */
function hashKey(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** A stable stream from a string key — same room, same walls, every build. */
function seededRand(key: string): () => number {
  let x = hashKey(key);
  return () => {
    x += 0x6D2B79F5;
    let t = x;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function spanGeometry(
  s: WallSpan, baseY: number, H: number, wear: number, rand: () => number,
  collapse = false,
): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const dx = s.b[0] - s.a[0], dz = s.b[1] - s.a[1];
  const len = Math.hypot(dx, dz);
  if (len < 1e-4) return out;

  // Inward normal — a plane's local +Z must end up pointing INTO the room.
  // Rotation about Y by θ maps (0,0,1) to (sin θ, 0, cos θ), so θ = atan2 of the
  // inward normal's components in that order. (Its local +X then lands on the
  // edge direction, which is the consistency check that this is the right θ.)
  const ix = -dz / len, iz = dx / len;
  // COURSED, not a slab. See wall-courses.ts — the short version is that a flat
  // plane has one brightness in torchlight however it is warped, and a course
  // line has two.
  // baseY is LOAD-BEARING, not bookkeeping: the courses snap to the world-Y
  // grid the stone texture is projected on. See style/stone-grid.ts.
  const face = makeCoursedWall(len, H, { wear, rand, collapse, baseY });
  const m = new THREE.Matrix4().makeRotationY(Math.atan2(ix, iz));
  m.setPosition((s.a[0] + s.b[0]) / 2, baseY + H / 2, (s.a[1] + s.b[1]) / 2);
  face.applyMatrix4(m);
  out.push(face);

  const lo = baseY, hi = baseY + H;
  // Back face, wound so it faces away from the room.
  out.push(quad(
    [s.ob[0], lo, s.ob[1]], [s.oa[0], lo, s.oa[1]],
    [s.oa[0], hi, s.oa[1]], [s.ob[0], hi, s.ob[1]],
  ));
  // Top cap.
  out.push(quad(
    [s.a[0], hi, s.a[1]], [s.b[0], hi, s.b[1]],
    [s.ob[0], hi, s.ob[1]], [s.oa[0], hi, s.oa[1]],
  ));
  // Jambs — only where a doorway cut the span. A mitred corner must NOT get one:
  // its end vertices are shared with the neighbouring span, and capping there
  // would build a pane of stone across the inside of the corner.
  if (s.jambA) {
    out.push(quad(
      [s.oa[0], lo, s.oa[1]], [s.a[0], lo, s.a[1]],
      [s.a[0], hi, s.a[1]], [s.oa[0], hi, s.oa[1]],
    ));
  }
  if (s.jambB) {
    out.push(quad(
      [s.b[0], lo, s.b[1]], [s.ob[0], lo, s.ob[1]],
      [s.ob[0], hi, s.ob[1]], [s.b[0], hi, s.b[1]],
    ));
  }
  return out;
}

/** A world-space quad with the attribute set `mergeGeometries` needs to fold it
 *  in beside a jittered plane: position, normal, uv AND colour. */
function quad(
  p0: [number, number, number], p1: [number, number, number],
  p2: [number, number, number], p3: [number, number, number],
): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([...p0, ...p1, ...p2, ...p3], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  // Indexed, because `makeJitteredPlane` is — mergeGeometries refuses a batch
  // that mixes indexed and non-indexed geometry, and it fails by returning null
  // rather than throwing, which reads downstream as "the room has no walls".
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.computeVertexNormals();
  tintVertices(g, 0.62);
  return g;
}

/**
 * The gentle per-vertex tint every surface in this game carries.
 *
 * Not decoration — LOAD-BEARING. The floor, wall and ceiling materials all set
 * `vertexColors: true`, and a geometry that ships without a colour attribute
 * leaves that slot unbound: the shader reads undefined memory and multiplies it
 * into the albedo. It is driver-dependent, so it can look fine in one browser
 * and paint black holes in another. `scale` darkens the faces you are not meant
 * to be looking at (a wall's back, the top of the ring).
 */
function tintVertices(geo: THREE.BufferGeometry, scale = 1): void {
  const count = geo.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const base = (0.85 + buildRng() * 0.15) * scale;
    colors[i * 3] = base; colors[i * 3 + 1] = base; colors[i * 3 + 2] = base;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

/** The bounding rect a polygon room should advertise, so everything that still
 *  thinks in rects (elevation, nav bbox, the walkable union) keeps working. */
export function polyRoomRect(poly: Poly): { x: number; z: number; w: number; d: number } {
  const b = polyBounds(poly);
  return {
    x: (b.minX + b.maxX) / 2,
    z: (b.minZ + b.maxZ) / 2,
    w: b.maxX - b.minX,
    d: b.maxZ - b.minZ,
  };
}
