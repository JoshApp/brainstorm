import * as THREE from 'three';
import type { DelveRenderer } from '../scene/create-renderer';
import { BRICK_W, COURSE_H, FLAG_CELL, FLAG_PERIOD, stoneHash } from './stone-grid';

// Baked, MIPMAPPED tiling stone textures for the big surfaces. The patterns used
// to be evaluated procedurally per-pixel in the surface material — which aliased
// badly: the scene renders at 0.4x resolution (see render-target.ts), so thin
// mortar lines were undersampled and CRAWLED under motion, and the relief's
// screen-space derivative buzzed. Baking the same patterns to tiling textures
// lets the GPU's mipmap + anisotropic filtering resolve them per-pixel — the
// textbook fix for that crawl — and the relief reads off a (mip-filtered, hence
// stable) height channel instead of a hard per-pixel function.
//
// One RGBA texture per surface: RGB = albedo shade (a grayscale multiplier the
// material's base colour tints), A = surface height (1 = proud block face,
// low = recessed seam / gap), used for the normal relief at runtime.
//
// WALLS = brick running-bond. FLOOR = irregular Voronoi flagstones (uneven
// slabs, ~7% missing). CEILING = coffered panels (raised beam grid, recessed
// panels) — its own architectural language, distinct from the floor.

export type SurfaceKind = 'wall' | 'floor' | 'ceiling' | 'dressed' | 'grain';

// World-space repeat period (metres) of each baked texture. Chosen so the
// pattern tiles seamlessly: walls = 4 bricks x 8 courses, floor = 5x5 flagstone
// cells, ceiling = 3x3 coffer panels, dressed = 3x4 ashlar blocks, grain = fine.
export const SURFACE_TILE: Record<SurfaceKind, [number, number]> = {
  wall: [4.6, 4.8],
  floor: [5.25, 5.25],
  ceiling: [4.8, 4.8],
  dressed: [4.8, 3.2],
  grain: [1.5, 1.5],
};

// ── CPU bake — the sole surface-texture generator ────────────────────────────
// Generates the tiling stone patterns (brick / flagstone / coffer / dressed /
// grain) on the CPU into a DataTexture at load — no GL, no readback. (This was
// once a GLSL render-target bake; the WebGPU migration replaced it with this CPU
// port, which is now the only path.)
const CPU_TEX = 512;   // 512 (256 was visibly blurry on walls)
const fract = (x: number) => x - Math.floor(x);
const modf = (x: number, y: number) => x - y * Math.floor(x / y);
const mixf = (a: number, b: number, t: number) => a + (b - a) * t;
const stepf = (e: number, x: number) => (x < e ? 0 : 1);
const clampf = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const smooth = (e0: number, e1: number, x: number) => { const t = clampf((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
// The one hash, shared with stone-grid.ts so a cell id computed at runtime and
// a cell id baked into the texture are the same cell.
const dHash = stoneHash;
function brickCPU(px: number, py: number, aa: number): [number, number] {
  // SHARED WITH THE GEOMETRY. wall-courses.ts lays its real courses on this same
  // grid — see style/stone-grid.ts for why the two must not each pick a number.
  const bx = BRICK_W, by = COURSE_H;
  let gx = px / bx; const gy = py / by; const row = Math.floor(gy);
  gx += 0.5 * modf(row, 2);
  const idx = modf(Math.floor(gx), 4), idy = modf(row, 8);
  const inbx = fract(gx), inby = fract(gy);
  const dH = Math.min(inby, 1 - inby) * by, dV = Math.min(inbx, 1 - inbx) * bx;
  const vKeep = stepf(0.18, dHash(modf(Math.floor(gx + 0.5), 4), idy, 9.1));
  const dseam = Math.min(dH, vKeep > 0.5 ? dV : 1e3);
  const seamVar = mixf(0.4, 1.0, dHash(idx, idy, 2.3));
  const mortar = (1 - smooth(0.03 - aa, 0.03 + aa, dseam)) * seamVar;
  const crackable = stepf(0.92, dHash(idx, idy, 5.5));
  const cpos = mixf(0.3, 0.7, dHash(idx, idy, 7.7));
  const crack = crackable * (1 - smooth(0, 0.012 + aa, Math.abs(inbx - cpos)));
  const recess = Math.max(mortar, crack * 0.85);
  const tone = mixf(0.86, 1.0, dHash(idx, idy, 3.7));
  return [mixf(tone, 0.5, recess), mixf(1.0, 0.4, recess)];
}
function cofferCPU(px: number, py: number, aa: number): [number, number] {
  const PAN = 1.6; const gx = px / PAN, gy = py / PAN;
  const idx = modf(Math.floor(gx), 3), idy = modf(Math.floor(gy), 3);
  const inbx = fract(gx), inby = fract(gy);
  const dB = Math.min(Math.min(inbx, 1 - inbx), Math.min(inby, 1 - inby)) * PAN;
  const beam = 1 - smooth(0.16 - aa, 0.16 + aa, dB);
  const tone = mixf(0.8, 1.0, dHash(idx, idy, 4.2));
  return [mixf(tone * 0.78, tone, beam), mixf(0.45, 1.0, beam)];
}
function dressedCPU(px: number, py: number, aa: number): [number, number] {
  const bx = 1.6, by = 0.8; let gx = px / bx; const gy = py / by; const row = Math.floor(gy);
  gx += 0.5 * modf(row, 2);
  const idx = modf(Math.floor(gx), 3), idy = modf(row, 4);
  const inbx = fract(gx), inby = fract(gy);
  const dseam = Math.min(Math.min(inby, 1 - inby) * by, Math.min(inbx, 1 - inbx) * bx);
  const joint = 1 - smooth(0.018 - aa, 0.018 + aa, dseam);
  const tone = mixf(0.92, 1.0, dHash(idx, idy, 3.1));
  return [mixf(tone, 0.62, joint), mixf(1.0, 0.65, joint)];
}
function vnoiseP(x: number, y: number, Px: number, Py: number): number {
  const ix = Math.floor(x), iy = Math.floor(y); let fx = fract(x), fy = fract(y);
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = dHash(modf(ix, Px), modf(iy, Py), 0.7), b = dHash(modf(ix + 1, Px), modf(iy, Py), 0.7);
  const c = dHash(modf(ix, Px), modf(iy + 1, Py), 0.7), d = dHash(modf(ix + 1, Px), modf(iy + 1, Py), 0.7);
  return mixf(mixf(a, b, fx), mixf(c, d, fx), fy);
}
function grainCPU(u: number, v: number): [number, number] {
  const n = vnoiseP(u * 16, v * 2, 16, 2) * 0.7 + vnoiseP(u * 32, v * 4, 32, 4) * 0.3;
  return [mixf(0.92, 1.05, n), mixf(0.48, 0.52, n)];
}
function flagCPU(px: number, py: number, aa: number): [number, number] {
  // Periodic Voronoi (period 5), faithful 2-pass: nearest point then edge dist.
  const FLAG = FLAG_CELL, P = FLAG_PERIOD; const x = px / FLAG, y = py / FLAG;
  const ipx = Math.floor(x), ipy = Math.floor(y), fpx = fract(x), fpy = fract(y);
  let mrx = 0, mry = 0, mgx = 0, mgy = 0, md = 9;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = modf(ipx + i, P), cy = modf(ipy + j, P);
    const ox = 0.5 + 0.42 * (dHash(cx, cy, 0.13) * 2 - 1), oy = 0.5 + 0.42 * (dHash(cx, cy, 4.71) * 2 - 1);
    const rx = i + ox - fpx, ry = j + oy - fpy; const dd = rx * rx + ry * ry;
    if (dd < md) { md = dd; mrx = rx; mry = ry; mgx = ipx + i; mgy = ipy + j; }
  }
  let ed = 9;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = modf(ipx + i, P), cy = modf(ipy + j, P);
    const ox = 0.5 + 0.42 * (dHash(cx, cy, 0.13) * 2 - 1), oy = 0.5 + 0.42 * (dHash(cx, cy, 4.71) * 2 - 1);
    const rx = i + ox - fpx, ry = j + oy - fpy; const dx = rx - mrx, dy = ry - mry;
    const dl = dx * dx + dy * dy;
    if (dl > 1e-5) { const nl = Math.sqrt(dl); ed = Math.min(ed, 0.5 * (mrx + rx) * (dx / nl) + 0.5 * (mry + ry) * (dy / nl)); }
  }
  const gx = modf(mgx, P), gy = modf(mgy, P);
  const edM = ed * FLAG;
  const bt = dHash(gx, gy, 1.3), missing = stepf(0.93, dHash(gx, gy, 8.1));
  const seam = 1 - smooth(0.03 - aa, 0.03 + aa, edM);
  const recess = Math.max(seam, missing);
  const tone = mixf(0.78, 1.0, bt);
  return [mixf(tone, 0.5, recess) * mixf(1.0, 0.45, missing), mixf(1.0, 0.35, recess)];
}
function bakeSurfaceCPU(kind: SurfaceKind): THREE.DataTexture {
  const tile = SURFACE_TILE[kind];
  const aa = (tile[0] / CPU_TEX) * 0.7;
  const buf = new Uint8Array(CPU_TEX * CPU_TEX * 4);
  for (let yi = 0; yi < CPU_TEX; yi++) {
    for (let xi = 0; xi < CPU_TEX; xi++) {
      const u = (xi + 0.5) / CPU_TEX, v = (yi + 0.5) / CPU_TEX;
      const px = u * tile[0], py = v * tile[1];
      let shade = 1, height = 1;
      if (kind === 'wall') [shade, height] = brickCPU(px, py, aa);
      else if (kind === 'floor') [shade, height] = flagCPU(px, py, aa);
      else if (kind === 'ceiling') [shade, height] = cofferCPU(px, py, aa);
      else if (kind === 'dressed') [shade, height] = dressedCPU(px, py, aa);
      else [shade, height] = grainCPU(u, v);
      const o = (yi * CPU_TEX + xi) * 4;
      const s = clampf(shade, 0, 1) * 255;
      buf[o] = buf[o + 1] = buf[o + 2] = s; buf[o + 3] = clampf(height, 0, 1) * 255;
    }
  }
  const tex = new THREE.DataTexture(buf, CPU_TEX, CPU_TEX, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  // ANISOTROPY — walls are seen at grazing angles, where isotropic mip filtering
  // collapses to a blur. The GLSL bake used max anisotropy; match it (clamped to
  // the hardware max). This is the single biggest "blurry wall" fix.
  tex.anisotropy = 16;
  tex.needsUpdate = true;
  return tex;
}

export function bakeSurfaceTexture(_renderer: DelveRenderer, kind: SurfaceKind): THREE.DataTexture {
  // The GLSL bake (ShaderMaterial + readRenderTargetPixels) was WebGL-only; the
  // sole (WebGPU) path generates the SAME patterns on the CPU (bakeSurfaceCPU) —
  // faithful, one-time, no GL/readback.
  return bakeSurfaceCPU(kind);
}
