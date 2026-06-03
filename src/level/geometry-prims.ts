import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CONFIG } from '../config';
import { buildRng } from '../engine/rng';

// Pure procedural-geometry factories for level assembly. Extracted from
// builder.ts — these take plain dimensions and return THREE geometry/material
// with no game-state coupling, so they're easy to read and test in isolation.
// builder.ts composes the live level by calling these.

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

  // Per-vertex color tint jitter: each vertex gets an RGB multiplier in
  // [0.7, 1.0]. The material multiplies this against its base color, so
  // walls + floor get subtle dark/light splotches instead of one flat tone.
  // Each channel is randomized slightly independently for color drift too.
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const base = 0.7 + buildRng() * 0.3;     // overall darkness per vertex
    const tintR = base * (0.94 + buildRng() * 0.06);
    const tintG = base * (0.94 + buildRng() * 0.06);
    const tintB = base * (0.94 + buildRng() * 0.06);
    colors[i * 3 + 0] = tintR;
    colors[i * 3 + 1] = tintG;
    colors[i * 3 + 2] = tintB;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  return geo;
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

// Chasm drop geometry — for each void, four inward pit walls descending from
// the floor (y=0) to y=-drop plus a dark bottom, all merged into ONE mesh.
// Rendered with the double-sided dark ceiling material (no vertex-colour
// dependency, never culls from above) so it reads as an abyss.
export function makeChasmDropGeometry(voids: { x: number; z: number; w: number; d: number }[], drop: number): THREE.BufferGeometry | null {
  const geos: THREE.BufferGeometry[] = [];
  const m4 = new THREE.Matrix4();
  for (const v of voids) {
    const { x, z, w, d } = v;
    const bottom = new THREE.PlaneGeometry(w, d);   // faces up
    m4.makeRotationX(-Math.PI / 2); m4.setPosition(x, -drop, z); bottom.applyMatrix4(m4);
    geos.push(bottom);
    const wall = (len: number, yaw: number, px: number, pz: number) => {
      const g = new THREE.PlaneGeometry(len, drop);
      m4.makeRotationY(yaw); m4.setPosition(px, -drop / 2, pz); g.applyMatrix4(m4);
      geos.push(g);
    };
    wall(w, 0, x, z - d / 2);            // north edge
    wall(w, Math.PI, x, z + d / 2);      // south edge
    wall(d, Math.PI / 2, x - w / 2, z);  // west edge
    wall(d, -Math.PI / 2, x + w / 2, z); // east edge
  }
  return geos.length ? mergeGeometries(geos, false) : null;
}
