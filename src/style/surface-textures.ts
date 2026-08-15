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

// ── WHAT A BAKED TEXEL CARRIES ───────────────────────────────────────────────
// [shade, height, variant, wear]. Shade and height are as before; VARIANT and
// WEAR are new and they cost nothing, because the bake used to write
// `buf[o] = buf[o+1] = buf[o+2] = s` — G and B were duplicates of R, two whole
// channels thrown away on a greyscale value.
//
// They carry PER-STONE IDENTITY, which is the thing the shader could never do
// before: every stone in a wall or floor was the same substance at a different
// brightness, so no amount of lighting work could make it a mosaic of
// different rocks. VARIANT lets the shader give each stone its own colour;
// WEAR lets it give each stone its own roughness. Both are constant across a
// cell, so they survive mipping as a soft average rather than turning to mush.
type Cell = [shade: number, height: number, variant: number, wear: number];
function brickCPU(px: number, py: number, aa: number): Cell {
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
  // PER-BRICK SET (v3). Every brick face used to sit flush at height 1.0 —
  // only the mortar and cracks had any depth — so a wall was a flat plane with
  // lines drawn on it and each block read as a painted rectangle rather than a
  // stone. A course of masonry is not flush: blocks sit proud or sunk by a few
  // millimetres and none of them is quite level.
  //
  // `set` is the block's own plateau; `tilt` leans that plateau in a per-block
  // direction. The tilt is what matters for light — it gives every face its own
  // normal, so a single flame picks out a different sheen on each block instead
  // of washing the whole wall evenly. The step between neighbouring plateaus
  // lands inside the mortar line, which is already recessed, so it reads as
  // masonry and not as a seam artefact.
  const set = mixf(-0.055, 0.04, dHash(idx, idy, 3.1));
  const tAng = dHash(idx, idy, 6.4) * Math.PI * 2;
  const tAmt = mixf(0.012, 0.055, dHash(idx, idy, 8.8));
  const tilt = (Math.cos(tAng) * (inbx - 0.5) + Math.sin(tAng) * (inby - 0.5)) * 2 * tAmt;
  // Tone widened 0.86..1.0 → 0.80..1.06: with light now varying per block, the
  // albedo can carry more spread without the wall reading as noise.
  const tone = mixf(0.80, 1.06, dHash(idx, idy, 3.7));
  // SPALL — roughly one brick in twelve has lost its face. Until POM existed a
  // "broken" brick could only be a darker rectangle; now the height can drop
  // and the ray march carves an actual bite out of the wall.
  const spall = stepf(0.92, dHash(idx, idy, 6.9));
  const spallD = spall * mixf(0.30, 0.55, dHash(idx, idy, 1.7));
  const h = clampf(1.0 + set + tilt - spallD, 0.25, 1.15);
  return [
    mixf(tone, 0.5, recess) * mixf(1.0, 0.72, spall),
    mixf(h, 0.4, recess),
    dHash(idx, idy, 4.2),                       // VARIANT — this block's colour
    clampf(dHash(idx, idy, 9.6) + spall * 0.35, 0, 1),  // WEAR — spalled faces are rougher
  ];
}
function cofferCPU(px: number, py: number, aa: number): Cell {
  const PAN = 1.6; const gx = px / PAN, gy = py / PAN;
  const idx = modf(Math.floor(gx), 3), idy = modf(Math.floor(gy), 3);
  const inbx = fract(gx), inby = fract(gy);
  const dB = Math.min(Math.min(inbx, 1 - inbx), Math.min(inby, 1 - inby)) * PAN;
  const beam = 1 - smooth(0.16 - aa, 0.16 + aa, dB);
  const tone = mixf(0.8, 1.0, dHash(idx, idy, 4.2));
  return [mixf(tone * 0.78, tone, beam), mixf(0.45, 1.0, beam), 0.5, 0.5];
}
function dressedCPU(px: number, py: number, aa: number): Cell {
  const bx = 1.6, by = 0.8; let gx = px / bx; const gy = py / by; const row = Math.floor(gy);
  gx += 0.5 * modf(row, 2);
  const idx = modf(Math.floor(gx), 3), idy = modf(row, 4);
  const inbx = fract(gx), inby = fract(gy);
  const dseam = Math.min(Math.min(inby, 1 - inby) * by, Math.min(inbx, 1 - inbx) * bx);
  const joint = 1 - smooth(0.018 - aa, 0.018 + aa, dseam);
  const tone = mixf(0.92, 1.0, dHash(idx, idy, 3.1));
  return [mixf(tone, 0.62, joint), mixf(1.0, 0.65, joint), dHash(idx, idy, 4.2), dHash(idx, idy, 9.6)];
}
function vnoiseP(x: number, y: number, Px: number, Py: number): number {
  const ix = Math.floor(x), iy = Math.floor(y); let fx = fract(x), fy = fract(y);
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = dHash(modf(ix, Px), modf(iy, Py), 0.7), b = dHash(modf(ix + 1, Px), modf(iy, Py), 0.7);
  const c = dHash(modf(ix, Px), modf(iy + 1, Py), 0.7), d = dHash(modf(ix + 1, Px), modf(iy + 1, Py), 0.7);
  return mixf(mixf(a, b, fx), mixf(c, d, fx), fy);
}
// ── DOMAIN WARP — the .kkrieger / werkkzeug operator, borrowed ───────────────
// Josh: *"are there things used in kkrieger that we could use as well?"*
//
// The lesson from werkkzeug is not a clever noise function, it is the OPERATOR
// STACK: generate something simple, then blur it, then DISTORT it with another
// noise field, then remap its colours. Their own example is dots → directional
// blur → distort → colour map → convincing plywood. Each step is trivial; the
// richness comes from composing transformations, not from one big formula.
//
// This is the first and highest-value operator we were missing, and it is the
// direct answer to "so uniform so perfect": every generator here computes its
// pattern from ANALYTIC coordinates, so its grid is mathematically exact. Real
// masonry is not — courses sag, joints wander, stones bulge. Warping the INPUT
// COORDINATES before the pattern is evaluated bends the whole grid at once, so
// the brick courses drift and the flagstone cells deform without a single line
// of the pattern code changing.
//
// PERIODIC by construction: vnoiseP takes explicit periods, so the warp repeats
// with the tile and the texture stays seamless. Two octaves — a slow bend and a
// finer wobble — because one frequency reads as "wavy" rather than "old".
const WARP_PERIOD = 4;          // integer → tiles cleanly over u,v in [0,1)
function warpUV(u: number, v: number, amp: number): [number, number] {
  const P = WARP_PERIOD, P2 = P * 2;
  const nx = vnoiseP(u * P, v * P, P, P) * 0.68
           + vnoiseP(u * P2 + 3.1, v * P2 + 7.9, P2, P2) * 0.32;
  const ny = vnoiseP(u * P + 11.3, v * P + 5.7, P, P) * 0.68
           + vnoiseP(u * P2 + 19.7, v * P2 + 2.3, P2, P2) * 0.32;
  return [u + (nx - 0.5) * 2 * amp, v + (ny - 0.5) * 2 * amp];
}
// How far each surface bends. Walls are LAID by someone and only sag with age;
// a floor is bedded in earth and moves more. Kept small — past ~0.05 the courses
// stop reading as masonry and start reading as melted.
const WARP_AMP: Record<SurfaceKind, number> = {
  wall: 0.022, floor: 0.034, ceiling: 0.014, dressed: 0.008, grain: 0,
};

function grainCPU(u: number, v: number): Cell {
  const n = vnoiseP(u * 16, v * 2, 16, 2) * 0.7 + vnoiseP(u * 32, v * 4, 32, 4) * 0.3;
  return [mixf(0.92, 1.05, n), mixf(0.48, 0.52, n), 0.5, 0.5];
}
function flagCPU(px: number, py: number, aa: number): Cell {
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
  // PER-FLAG SET + TILT (v3). Josh: *"the floor and wall mosaic is bland."*
  // The reason was that every flagstone was perfectly flush — the Voronoi gave
  // each stone a shape and a tone, but they all lay in one plane, so the floor
  // was a pattern rather than laid stone.
  //
  // Flags get a bigger settle range than wall blocks (they're walked on, bedded
  // in dirt, and sink unevenly) and a stronger tilt. With the floor now at
  // roughness 0.72 that tilt is the whole point: each stone catches the grazing
  // sheen at its own angle, so torchlight breaks across the floor stone by
  // stone as the player moves instead of sliding over it as one sheet.
  //
  // (-mrx, -mry) is the offset from the cell centre to this pixel, so dotting
  // it with a per-cell direction leans that stone's plane.
  const set = mixf(-0.11, 0.05, dHash(gx, gy, 3.1));
  const tAng = dHash(gx, gy, 5.3) * Math.PI * 2;
  const tAmt = mixf(0.02, 0.085, dHash(gx, gy, 2.9));
  const tilt = (Math.cos(tAng) * -mrx + Math.sin(tAng) * -mry) * 2 * tAmt;
  const tone = mixf(0.70, 1.06, bt);
  // MISSING STONES ARE HOLES NOW. Josh: *"some stones are missing there but
  // even the missing texture is just flat color."* Exactly right — `missing`
  // only ever darkened the shade, so a lifted flagstone was a dark patch
  // painted on a level floor. The height never moved, because before POM there
  // was nothing that could have displayed it. Now it drops hard and the ray
  // march reads it as a pit you look down into, with the seam recess on top.
  const pit = missing * mixf(0.55, 0.78, dHash(gx, gy, 7.3));
  const h = clampf(1.0 + set + tilt - pit, 0.12, 1.15);
  return [
    mixf(tone, 0.5, seam) * mixf(1.0, 0.42, missing),
    mixf(h, 0.35, seam),
    dHash(gx, gy, 4.2),                          // VARIANT — this flag's colour
    clampf(dHash(gx, gy, 9.6) + missing * 0.4, 0, 1),   // WEAR — bare earth is rough
  ];
}
function bakeSurfaceCPU(kind: SurfaceKind): THREE.DataTexture {
  const tile = SURFACE_TILE[kind];
  const aa = (tile[0] / CPU_TEX) * 0.7;
  const buf = new Uint8Array(CPU_TEX * CPU_TEX * 4);
  for (let yi = 0; yi < CPU_TEX; yi++) {
    for (let xi = 0; xi < CPU_TEX; xi++) {
      const u0 = (xi + 0.5) / CPU_TEX, v0 = (yi + 0.5) / CPU_TEX;
      // WARP FIRST, then evaluate the pattern in the bent coordinates.
      const [u, v] = WARP_AMP[kind] > 0 ? warpUV(u0, v0, WARP_AMP[kind]) : [u0, v0];
      const px = u * tile[0], py = v * tile[1];
      let shade = 1, height = 1, variant = 0.5, wear = 0.5;
      if (kind === 'wall') [shade, height, variant, wear] = brickCPU(px, py, aa);
      else if (kind === 'floor') [shade, height, variant, wear] = flagCPU(px, py, aa);
      else if (kind === 'ceiling') [shade, height, variant, wear] = cofferCPU(px, py, aa);
      else if (kind === 'dressed') [shade, height, variant, wear] = dressedCPU(px, py, aa);
      else [shade, height, variant, wear] = grainCPU(u, v);
      const o = (yi * CPU_TEX + xi) * 4;
      // R = shade, G = variant, B = wear, A = height. G and B used to be copies
      // of R — see the Cell note above. The shader must therefore read shade as
      // `.r` broadcast, NOT `.rgb`, or it picks up the identity channels as a
      // colour cast.
      buf[o] = clampf(shade, 0, 1) * 255;
      buf[o + 1] = clampf(variant, 0, 1) * 255;
      buf[o + 2] = clampf(wear, 0, 1) * 255;
      buf[o + 3] = clampf(height, 0, 1) * 255;
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
