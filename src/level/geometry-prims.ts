import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CONFIG } from '../config';
import { buildRng } from '../engine/rng';
import { reinstallSurfaceDetail } from '../style/surface-detail';

// Pure procedural-geometry factories for level assembly. Extracted from
// builder.ts — these take plain dimensions and return THREE geometry/material
// with no game-state coupling, so they're easy to read and test in isolation.
// builder.ts composes the live level by calling these.

// === Baked AO model (shared by walls, floors, prop contact) ===
// Occlusion ∈ [0,1] lerps a surface's vertex colour toward SHADOW_TINT — a COOL,
// desaturated dark rather than pure black, so a shadowed face reads as
// "stone in shadow", not "brightness turned down". This is the single shadow
// colour every AO source agrees on, and the seam where the coherent moss/grime
// colour pass plugs in next (docs/surface-richness.md).
const SHADOW_TINT = [0.40, 0.45, 0.55] as const;   // r,g,b multiplier at full occlusion
const aoClamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const aoSmooth = (t: number): number => { const c = aoClamp01(t); return c * c * (3 - 2 * c); };
/** Multiply rgb (in place) toward SHADOW_TINT by occlusion amount `occ`. */
function applyOcc(rgb: [number, number, number], occ: number): void {
  const o = aoClamp01(occ);
  rgb[0] *= 1 + (SHADOW_TINT[0] - 1) * o;
  rgb[1] *= 1 + (SHADOW_TINT[1] - 1) * o;
  rgb[2] *= 1 + (SHADOW_TINT[2] - 1) * o;
}

/** Floor mesh with rectangular holes punched for stairwells. Each hole
 *  is a polygon in shape-space (x, y) where shape Y maps to world -Z
 *  after the floor's -π/2 X rotation. Holes are passed in pre-projected
 *  to those coords. No vertex jitter on this path — losing the slight
 *  ripple is acceptable for rooms containing stairs, which is rare. */
export function makeFloorWithHoles(
  width: number,
  height: number,
  holes: Array<Array<[number, number]>>,
): THREE.ShapeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, -height / 2);
  shape.lineTo( width / 2, -height / 2);
  shape.lineTo( width / 2,  height / 2);
  shape.lineTo(-width / 2,  height / 2);
  shape.closePath();
  for (const h of holes) {
    const path = new THREE.Path();
    for (let i = 0; i < h.length; i++) {
      const [px, py] = h[i];
      if (i === 0) path.moveTo(px, py);
      else path.lineTo(px, py);
    }
    path.closePath();
    shape.holes.push(path);
  }
  const geo = new THREE.ShapeGeometry(shape);
  // Per-vertex color: the floor material renders with vertexColors:true,
  // and a geometry WITHOUT a color attribute leaves the attribute slot
  // UNBOUND — undefined contents, driver-dependent garbage tint that
  // silently multiplies into the albedo (sage-green floors on ANGLE,
  // black on others) and eats every albedo effect: room tints, splat
  // stains, surface detail. Bake the same gentle random tint the
  // no-holes floor path gets (AO comes separately from contact bakes).
  {
    const count = geo.getAttribute('position').count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const base = 0.85 + buildRng() * 0.15;
      colors[i * 3 + 0] = base;
      colors[i * 3 + 1] = base;
      colors[i * 3 + 2] = base;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }
  return geo;
}

export function makeJitteredPlane(
  width: number, height: number,
  /** Walls bake a smooth low-frequency wave into the surface (`wavy`) so
   *  they don't read as flat slabs. Floors pass `flat` to skip ALL vertex
   *  displacement (no wave, no jitter) — a bumpy floor reads as warped next
   *  to the dead-flat stairwell-room floors (makeFloorWithHoles), and lumps
   *  push the player up. Flat floors keep the per-vertex colour tint below,
   *  so they still have surface variation without geometry warp. */
  opts: { wavy?: boolean; flat?: boolean } = {},
): THREE.PlaneGeometry {
  const geo = new THREE.PlaneGeometry(
    width,
    height,
    CONFIG.WALL_SUBDIVISIONS_X,
    CONFIG.WALL_SUBDIVISIONS_Y,
  );
  const pos = geo.attributes.position;
  const jitter = CONFIG.WALL_VERTEX_JITTER;
  // Per-plane random phase so neighbouring walls don't share
  // the same wave pattern — every wall slab gets its own
  // unique warp.
  const wavy = !!opts.wavy;
  const flat = !!opts.flat;
  const wavePhaseA = buildRng() * 100;
  const wavePhaseB = buildRng() * 100;
  const WAVE_AMPL = 0.045;        // peak displacement in metres
  const WAVE_SCALE_X = 1.2;       // metres / radian along the wall
  const WAVE_SCALE_Y = 0.9;
  const WAVE_SCALE_X2 = 0.55;     // higher-freq overlay
  const WAVE_SCALE_Y2 = 0.7;
  const EDGE_FADE = 0.5;          // metres from edge where wave fades to 0
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const onEdgeX = Math.abs(Math.abs(x) - width / 2) < 1e-4;
    const onEdgeY = Math.abs(Math.abs(y) - height / 2) < 1e-4;
    if (onEdgeX || onEdgeY) continue;
    if (flat) continue;   // dead-flat surface; colour tint below still applies
    let z = (buildRng() - 0.5) * 2 * jitter;
    if (wavy) {
      // Two superimposed waves — a slow primary undulation +
      // a faster overlay — give a non-repeating warp pattern.
      const waveLow  = Math.sin(x / WAVE_SCALE_X + wavePhaseA)
                     * Math.cos(y / WAVE_SCALE_Y + wavePhaseB);
      const waveHigh = Math.sin(x / WAVE_SCALE_X2 + wavePhaseB * 0.7 + y * 0.6)
                     * 0.45;
      // Taper toward the edges so neighbouring wall segments
      // line up cleanly with no visible seam.
      const dx = Math.min(width / 2 + x, width / 2 - x);
      const dy = Math.min(height / 2 + y, height / 2 - y);
      const fade = Math.min(1, dx / EDGE_FADE) * Math.min(1, dy / EDGE_FADE);
      z += (waveLow + waveHigh) * WAVE_AMPL * fade;
    }
    pos.setZ(i, z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();

  // Per-vertex color: a gentle random tint × BAKED wall AO. WALLS occlude toward
  // the FLOOR (strong), gently toward the CEILING, and toward their VERTICAL
  // ENDS (room corners / doorway jambs) — so shadow pools in every edge where a
  // wall meets another surface. Smooth (smoothstep) falloff + cool SHADOW_TINT,
  // free per-frame, no depth-buffer streaks.
  //
  // FLOORS get only the random tint here — their AO is WALL-CONTACT, baked
  // separately (bakeFloorContactAO) from the room's real wall segments so it
  // skips open passages and floors flow seamlessly room↔corridor.
  const H2 = height / 2, W2 = width / 2;
  // Wall AO tunables. Walls stand local-Y up (bottom = -H2), run along local X.
  const FLOOR_OCC = 0.85, FLOOR_FADE = 1.3;    // base: strength, fade metres
  const CEIL_OCC = 0.45, CEIL_FADE = 1.0;      // top: gentler
  const CORNER_OCC = 0.6, CORNER_FADE = 0.7;   // vertical ends (corners/jambs)
  const colors = new Float32Array(pos.count * 3);
  const rgb: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < pos.count; i++) {
    const base = 0.85 + buildRng() * 0.15;
    rgb[0] = base * (0.96 + buildRng() * 0.04);
    rgb[1] = base * (0.96 + buildRng() * 0.04);
    rgb[2] = base * (0.96 + buildRng() * 0.04);
    if (wavy) {            // WALL — combine the three edge occlusions (take max)
      const py = pos.getY(i), px = pos.getX(i);
      const floorOcc  = aoSmooth(1 - (py + H2) / FLOOR_FADE) * FLOOR_OCC;
      const ceilOcc   = aoSmooth(1 - (H2 - py) / CEIL_FADE) * CEIL_OCC;
      const cornerOcc = aoSmooth(1 - (W2 - Math.abs(px)) / CORNER_FADE) * CORNER_OCC;
      applyOcc(rgb, Math.max(floorOcc, ceilOcc, cornerOcc));
    }
    colors[i * 3 + 0] = rgb[0];
    colors[i * 3 + 1] = rgb[1];
    colors[i * 3 + 2] = rgb[2];
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  return geo;
}

export interface PropContact { x: number; z: number; r: number; }

/**
 * Bake PROP-CONTACT ambient occlusion into a floor mesh: darken floor vertices
 * around each prop's footprint, strongest right at the prop's edge and fading
 * out over `band` metres — the contact shadow that grounds a free-standing prop
 * sitting in open floor (no extra draws, no blob decal). Multiplies the existing
 * colour, so wall-contact AO + the SURFACE AO slider both still compose.
 *
 * Each contact is a circle (footprint centre + radius r); occlusion is driven by
 * distance-to-edge (dist − r), so it hugs the footprint regardless of prop size
 * and a vertex UNDER the prop is fully occluded.
 */
export function bakeFloorPropContactAO(
  geo: THREE.BufferGeometry,
  origin: { x: number; z: number },
  contacts: PropContact[],
  band = 0.5,
  occ = 0.72,
): void {
  const color = geo.getAttribute('color') as THREE.BufferAttribute | undefined;
  const pos = geo.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!color || !pos || contacts.length === 0) return;
  const rgb: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < pos.count; i++) {
    const wx = origin.x + pos.getX(i);
    const wz = origin.z - pos.getY(i);
    let edge = Infinity;
    for (const c of contacts) {
      const e = Math.hypot(wx - c.x, wz - c.z) - c.r;
      if (e < edge) edge = e;
    }
    if (edge >= band) continue;                            // out of reach
    rgb[0] = color.getX(i); rgb[1] = color.getY(i); rgb[2] = color.getZ(i);
    applyOcc(rgb, aoSmooth(1 - edge / band) * occ);         // edge<=0 (under prop) → full
    color.setXYZ(i, rgb[0], rgb[1], rgb[2]);
  }
  color.needsUpdate = true;
}

/** XZ distance from point (px,pz) to segment (ax,az)-(bx,bz). */
function distPointSeg(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 1e-9 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + t * dx, cz = az + t * dz;
  return Math.hypot(px - cx, pz - cz);
}

export interface WallSeg { ax: number; az: number; bx: number; bz: number; }

/**
 * Bake WALL-CONTACT ambient occlusion into a floor mesh's vertex colours:
 * darken floor vertices within `radius` of a real wall segment, strongest right
 * at the wall. Unlike a per-plate edge band, this is driven by the room's actual
 * solid walls — so OPEN passages (no wall) stay full-bright and the floor flows
 * seamlessly into the next room/corridor with no false seam.
 *
 * Floor is a plane rotated −90° about X at world `origin`, so a local vertex
 * (lx,ly) sits at world (origin.x+lx, origin.z−ly). Multiplies the existing
 * colour (tint), so the SURFACE AO slider still scales it.
 */
export function bakeFloorContactAO(
  geo: THREE.BufferGeometry,
  origin: { x: number; z: number },
  segments: WallSeg[],
  radius = 0.85,
  occ = 0.8,
): void {
  const color = geo.getAttribute('color') as THREE.BufferAttribute | undefined;
  const pos = geo.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!color || !pos || segments.length === 0) return;
  const rgb: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < pos.count; i++) {
    const wx = origin.x + pos.getX(i);
    const wz = origin.z - pos.getY(i);
    let dmin = Infinity;
    for (const s of segments) {
      const d = distPointSeg(wx, wz, s.ax, s.az, s.bx, s.bz);
      if (d < dmin) dmin = d;
    }
    if (dmin >= radius) continue;                          // beyond reach — untouched
    rgb[0] = color.getX(i); rgb[1] = color.getY(i); rgb[2] = color.getZ(i);
    applyOcc(rgb, aoSmooth(1 - dmin / radius) * occ);       // 1 at wall → 0 beyond
    color.setXYZ(i, rgb[0], rgb[1], rgb[2]);
  }
  color.needsUpdate = true;
}

// Double-sided clone of the ceiling material for vaulted/pitched ceilings.
// Double-sided so the custom arch geometry is robust to winding direction
// (it can never render as an invisible black hole), and MeshStandard flips
// the normal per-face so lighting reads correctly from below either way.
// Cached (re-cloned only if the base material instance changes across a
// rebuild) so we don't leak a material per room.
let _archCeilMat: THREE.Material | null = null;
let _archCeilBase: THREE.Material | null = null;
export function archCeilingMaterial(base: THREE.Material): THREE.Material {
  if (_archCeilBase !== base || !_archCeilMat) {
    _archCeilMat = base.clone();
    _archCeilMat.side = THREE.DoubleSide;
    // clone() does NOT carry the base's onBeforeCompile, so the cloned arch
    // material would lose the baked ceiling detail (tilted ceilings rendered
    // flat). Re-install from the base's registered config (same texture + live
    // toggle uniform) so the arch reads as coffered stone like the flat ceiling.
    reinstallSurfaceDetail(_archCeilMat, base);
    _archCeilBase = base;
  }
  return _archCeilMat;
}

// Build a barrel (curved) or pitched (A-frame) ceiling as ONE BufferGeometry:
// an arch that springs from the wall-top height H along the longer axis and
// rises to H+rise at the crown, PLUS the two end tympana that fill the arch
// profile above the short walls (no gap). World-Y coords — place the mesh at
// (rect.x, 0, rect.z) with no rotation.
export function makeArchedCeilingGeometry(
  W: number, D: number, H: number, rise: number, profile: 'barrel' | 'pitched',
): THREE.BufferGeometry {
  // Arch across the SHORTER horizontal axis; run flat along the longer one.
  const curveX = W <= D;                       // true → arch spans X, runs along Z
  const acrossHalf = (curveX ? W : D) / 2;
  const alongHalf = (curveX ? D : W) / 2;
  const NA = 16;                               // segments across the arch (smoothness)
  const NB = Math.max(1, Math.round((alongHalf * 2) / 3));   // along the run
  const shape = (t: number) =>
    profile === 'barrel' ? Math.cos(t * Math.PI / 2) : 1 - Math.abs(t);
  const xz = (a: number, b: number): [number, number] => (curveX ? [a, b] : [b, a]);

  const pos: number[] = [];
  const idx: number[] = [];

  // ── Arched surface ──
  const rowLen = NA + 1;
  for (let j = 0; j <= NB; j++) {
    const b = -alongHalf + (j / NB) * (alongHalf * 2);
    for (let i = 0; i <= NA; i++) {
      const a = -acrossHalf + (i / NA) * (acrossHalf * 2);
      const y = H + rise * shape(a / acrossHalf);
      const [x, z] = xz(a, b);
      pos.push(x, y, z);
    }
  }
  for (let j = 0; j < NB; j++) {
    for (let i = 0; i < NA; i++) {
      const v0 = j * rowLen + i;
      const v2 = v0 + rowLen;
      idx.push(v0, v2, v0 + 1, v0 + 1, v2, v2 + 1);
    }
  }

  // ── End tympana: fill above the short walls (between y=H and the arch) ──
  for (const bEnd of [-alongHalf, alongHalf]) {
    const base = pos.length / 3;
    for (let i = 0; i <= NA; i++) {
      const a = -acrossHalf + (i / NA) * (acrossHalf * 2);
      const yTop = H + rise * shape(a / acrossHalf);
      const [x, z] = xz(a, bEnd);
      pos.push(x, H, z);       // bottom — wall-top line
      pos.push(x, yTop, z);    // top — arch
    }
    for (let i = 0; i < NA; i++) {
      const b0 = base + i * 2, t0 = base + i * 2 + 1;
      const b1 = base + (i + 1) * 2, t1 = base + (i + 1) * 2 + 1;
      idx.push(b0, b1, t0, t0, b1, t1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

// Mine-shaft timber bracing: square support frames (two posts + a lintel)
// spanning the room's SHORTER axis at intervals along the longer one, all
// merged into ONE geometry (one draw call). The iconic "dug tunnel" read.
// World-space coords — the mesh sits at origin.
export function makeBracedFramesGeometry(rect: { x: number; z: number; w: number; d: number }, H: number): THREE.BufferGeometry | null {
  const longAxisX = rect.w >= rect.d;
  const longLen = longAxisX ? rect.w : rect.d;
  const shortLen = longAxisX ? rect.d : rect.w;
  const POST = 0.14;                       // beam thickness
  const spanHalf = shortLen / 2 - 0.08;    // pull off the wall a touch
  const lintelY = H - 0.22;
  const frameCount = Math.max(1, Math.round(longLen / 2.6) - 1);
  const geos: THREE.BufferGeometry[] = [];
  const m4 = new THREE.Matrix4();
  const pushBox = (w: number, h: number, d: number, px: number, py: number, pz: number) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.applyMatrix4(m4.makeTranslation(px, py, pz));
    geos.push(g);
  };
  for (let i = 1; i <= frameCount; i++) {
    const along = -longLen / 2 + (i / (frameCount + 1)) * longLen;
    const cx = rect.x + (longAxisX ? along : 0);
    const cz = rect.z + (longAxisX ? 0 : along);
    for (const s of [-spanHalf, spanHalf]) {                 // two posts
      pushBox(POST, H, POST, cx + (longAxisX ? 0 : s), H / 2, cz + (longAxisX ? s : 0));
    }
    pushBox(                                                  // lintel across the top
      longAxisX ? POST : spanHalf * 2 + POST, POST, longAxisX ? spanHalf * 2 + POST : POST,
      cx, lintelY, cz,
    );
  }
  return geos.length ? mergeGeometries(geos, false) : null;
}

/** Per-vertex darkness fade for shaft/drop geometry: full-bright at
 *  `brightY`, easing to pure black `fadeM` metres away (in world Y).
 *  The chasm material renders with vertexColors:true, so black vertex
 *  colour = zero albedo = the void. Walls need enough height segments
 *  for the quadratic ease to actually curve (linear interpolation
 *  between just two vertex rows would read as a flat gradient). */
function applyDepthFade(geo: THREE.BufferGeometry, brightY: number, fadeM: number): void {
  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, Math.abs(pos.getY(i) - brightY) / fadeM);
    const c = (1 - t) * (1 - t);   // ease-in — dives toward black early
    colors[i * 3 + 0] = c;
    colors[i * 3 + 1] = c;
    colors[i * 3 + 2] = c;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

// Chasm drop geometry — for each void, four inward pit walls descending from
// the floor (y=0) to y=-drop plus a dark bottom, all merged into ONE mesh.
// Walls carry a depth fade to pure black (vertex colours; the chasm material
// renders vertexColors:true) so the pit reads as an abyss, not a lit box —
// brick detail survives near the rim where the lamp catches it, then nothing.
export function makeChasmDropGeometry(
  voids: { x: number; z: number; w: number; d: number }[],
  drop: number,
  /** Metres below the rim where the walls reach pure black. */
  fadeM: number,
): THREE.BufferGeometry | null {
  const geos: THREE.BufferGeometry[] = [];
  const m4 = new THREE.Matrix4();
  const ySegs = Math.max(4, Math.ceil(drop / 0.75));
  for (const v of voids) {
    const { x, z, w, d } = v;
    const bottom = new THREE.PlaneGeometry(w, d);   // faces up
    m4.makeRotationX(-Math.PI / 2); m4.setPosition(x, -drop, z); bottom.applyMatrix4(m4);
    geos.push(bottom);
    const wall = (len: number, yaw: number, px: number, pz: number) => {
      const g = new THREE.PlaneGeometry(len, drop, 1, ySegs);
      m4.makeRotationY(yaw); m4.setPosition(px, -drop / 2, pz); g.applyMatrix4(m4);
      geos.push(g);
    };
    wall(w, 0, x, z - d / 2);            // north edge
    wall(w, Math.PI, x, z + d / 2);      // south edge
    wall(d, Math.PI / 2, x - w / 2, z);  // west edge
    wall(d, -Math.PI / 2, x + w / 2, z); // east edge
  }
  if (!geos.length) return null;
  const merged = mergeGeometries(geos, false);
  applyDepthFade(merged, 0, fadeM);      // rim (y=0) bright → black below
  return merged;
}

/** Ceiling shaft — a clean rectangular well rising above a room's ceiling,
 *  walls fading up into black. Where the ceiling BREACH says "collapse",
 *  the shaft says "deliberate architecture: the level above exists".
 *  World coords; pair with a hole cut in the ceiling at the same rect.
 *  The near-black cap closing the top is the caller's job (so a stray
 *  ray can't see out of the world). */
export function makeCeilingShaftGeometry(
  cx: number, cz: number, w: number, d: number,
  lipY: number, rise: number, fadeM: number,
): THREE.BufferGeometry {
  const geos: THREE.BufferGeometry[] = [];
  const m4 = new THREE.Matrix4();
  const ySegs = Math.max(4, Math.ceil(rise / 0.75));
  const midY = lipY + rise / 2;
  const wall = (len: number, yaw: number, px: number, pz: number) => {
    const g = new THREE.PlaneGeometry(len, rise, 1, ySegs);
    m4.makeRotationY(yaw); m4.setPosition(px, midY, pz); g.applyMatrix4(m4);
    geos.push(g);
  };
  wall(w, 0, cx, cz - d / 2);             // north edge
  wall(w, Math.PI, cx, cz + d / 2);       // south edge
  wall(d, Math.PI / 2, cx - w / 2, cz);   // west edge
  wall(d, -Math.PI / 2, cx + w / 2, cz);  // east edge
  const merged = mergeGeometries(geos, false);
  applyDepthFade(merged, lipY, fadeM);    // lip bright → black above
  return merged;
}
