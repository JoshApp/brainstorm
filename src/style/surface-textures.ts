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
  // ── PER-BRICK SET-OUT ──────────────────────────────────────────────────────
  // The masonry-specific answer to "what would fit a brick wall". A domain warp
  // — even a faceted one — bends the GRID, and the grid is the one thing a
  // bricklayer got right: joints are straight because they were struck with a
  // trowel against a line. What is NOT right in a rough wall is the SET-OUT:
  // every brick sits a few millimetres off its ideal slot, so the joints wander
  // in width while staying straight, and no two courses line up perfectly.
  //
  // Shifting the brick's boundaries per cell does exactly that: bricks come out
  // slightly different sizes, the perpends stagger, and the wall reads as laid
  // by hand — with every edge still dead straight. This is the irregularity
  // masonry actually has, as opposed to the irregularity noise wants to give it.
  const jx = (dHash(idx, idy, 12.9) - 0.5) * 0.16;   // ± along the course
  const jy = (dHash(idx, idy, 4.3) - 0.5) * 0.10;    // ± in bed height
  const inbx = clampf(fract(gx) + jx, 0.001, 0.999);
  const inby = clampf(fract(gy) + jy, 0.001, 0.999);
  const dH = Math.min(inby, 1 - inby) * by, dV = Math.min(inbx, 1 - inbx) * bx;
  const vKeep = stepf(0.18, dHash(modf(Math.floor(gx + 0.5), 4), idy, 9.1));
  const dseam = Math.min(dH, vKeep > 0.5 ? dV : 1e3);
  const seamVar = mixf(0.4, 1.0, dHash(idx, idy, 2.3));
  const mortar = (1 - smooth(0.03 - aa, 0.03 + aa, dseam)) * seamVar;
  const crackable = stepf(0.92, dHash(idx, idy, 5.5));
  const cpos = mixf(0.3, 0.7, dHash(idx, idy, 7.7));
  const crack = crackable * (1 - smooth(0, 0.012 + aa, Math.abs(inbx - cpos)));
  const recess = Math.max(mortar, crack * 0.85);
  // ── THE JOINT NEEDS A SLOPE, NOT A CLIFF ───────────────────────────────────
  // Josh: *"it looks like the card stack, is there a better technique for
  // this?"* — with ~8 visible bands along each joint, and POM marching 8 steps.
  //
  // The cause is a CLIFF in the height field. `mortar` transitions over 2*aa,
  // about a texel, so the side of every joint is essentially VERTICAL. A ray
  // march samples at discrete depths, and where the surface is vertical the
  // interpolation between two samples has nothing sane to interpolate — the hit
  // snaps to whichever step straddled the cliff, and you get one band per step.
  // No step count fixes that; it just moves the bands closer together.
  //
  // The fix is to remove the cliff. A real mortar joint is not a vertical-sided
  // slot — it is raked and weathered BACK, so the stone slopes into it. Giving
  // the HEIGHT channel its own much wider ramp models that, and a ray marching
  // a slope lands where it should. The SHADE keeps the narrow ramp, so the
  // joint still reads as a crisp dark line: sharp where the eye wants an edge,
  // sloped where the march needs one.
  const hMortar = (1 - smooth(0.012, 0.085, dseam)) * seamVar;
  const hRecess = Math.max(hMortar, crack * 0.7);
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
  // SET RANGE CUT, and the reason is worth writing down. Josh: *"the relief of
  // the stones reads a bit like the stacked card deck from old windows games,
  // like its like layers visible."* Exactly right — every brick was a FLAT
  // PLATEAU at its own discrete height, and POM renders the vertical side of a
  // plateau as a hard step. A wall of plateaus at ~10 distinct heights is a
  // stack of cards, and the ray march is honest enough to show it.
  //
  // Two fixes together: halve the range so neighbouring plateaus differ by less
  // than the mortar is deep (the step then hides INSIDE the joint, where a step
  // belongs), and lean on `tilt` instead — a tilted face has no vertical side
  // to catch the light, so it reads as a stone that settled rather than a card
  // that was dealt.
  const set = mixf(-0.026, 0.020, dHash(idx, idy, 3.1));
  const tAng = dHash(idx, idy, 6.4) * Math.PI * 2;
  const tAmt = mixf(0.022, 0.075, dHash(idx, idy, 8.8));   // more lean, fewer cliffs
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
    mixf(h, 0.4, hRecess),
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
// with the tile and the texture stays seamless.
//
// Wall halved to 0.011 — Josh: *"the warp is a bit too strong on walls."* A
// floor can afford to move (it is bedded in earth); a wall that visibly bends
// stops reading as something anyone LAID. Two octaves — a slow bend and a
// finer wobble — because one frequency reads as "wavy" rather than "old".
const WARP_PERIOD = 4;          // integer → tiles cleanly over u,v in [0,1)

// ── SMOOTH vs FACETED ────────────────────────────────────────────────────────
// Josh: *"can you make the domain warp kinda instead of round like edges? or
// idk what would fit a brick wall."*
//
// Right question. The warp field is value noise with smoothstep interpolation,
// so it varies CONTINUOUSLY — every displacement is a curve, and a curve
// dragged through a brick grid gives you melted brick. Stone does not melt.
//
// Faceted mode QUANTISES the warp to a small number of levels. The displacement
// becomes piecewise CONSTANT: patches of the wall shift as rigid units with
// straight boundaries between them, instead of everything flowing. Slabs that
// settled against each other, rather than a wall made of wax — which is what a
// masonry wall actually does as its footing moves.
const WARP_LEVELS = 5;
function warpUV(u: number, v: number, amp: number, faceted: boolean): [number, number] {
  const P = WARP_PERIOD, P2 = P * 2;
  let nx = vnoiseP(u * P, v * P, P, P) * 0.68
         + vnoiseP(u * P2 + 3.1, v * P2 + 7.9, P2, P2) * 0.32;
  let ny = vnoiseP(u * P + 11.3, v * P + 5.7, P, P) * 0.68
         + vnoiseP(u * P2 + 19.7, v * P2 + 2.3, P2, P2) * 0.32;
  if (faceted) {
    // Snap to levels → flat facets with hard edges between them.
    nx = Math.floor(nx * WARP_LEVELS) / (WARP_LEVELS - 1);
    ny = Math.floor(ny * WARP_LEVELS) / (WARP_LEVELS - 1);
  }
  return [u + (nx - 0.5) * 2 * amp, v + (ny - 0.5) * 2 * amp];
}
// How far each surface bends. Walls are LAID by someone and only sag with age;
// a floor is bedded in earth and moves more. Kept small — past ~0.05 the courses
// stop reading as masonry and start reading as melted.
const WARP_AMP: Record<SurfaceKind, number> = {
  wall: 0.011, floor: 0.034, ceiling: 0.014, dressed: 0.008, grain: 0,
};
// Which surfaces settle in slabs rather than flowing. Masonry and dressed stone
// are LAID — they shift in rigid pieces. A floor bedded in earth genuinely does
// sink in curves, so it keeps the smooth field.
const WARP_FACETED: Record<SurfaceKind, boolean> = {
  wall: true, floor: false, ceiling: true, dressed: true, grain: false,
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
  // ── CELL-OUTER DAMAGE ──────────────────────────────────────────────────────
  // OpenKTG's Cells operator has two modes: CellInner (distance to the cell
  // CENTRE) and CellOuter (distance to the EDGE). We only ever used the edge
  // distance to cut a clean seam of constant width — which is a CUT, and a cut
  // is the one thing an old floor is not.
  //
  // Josh, on the stones being irregular: *"it doesnt read as damage."* Right,
  // and this is why: size variation is not damage. DAMAGE LIVES ON EDGES —
  // chipped rims, broken corners, crumbled arrises. So drive the edge field
  // itself with noise instead of thresholding it flat:
  //
  //   CHIP    the seam WIDTH varies along its length, so the gap between stones
  //           opens and closes and the edge reads as broken rather than sawn.
  //   BITE    where the rim is already thin AND the noise agrees, take a deeper
  //           bite — a corner gone, not just a wider joint. This is what POM
  //           needs to show actual missing chunks.
  //
  // Also the answer to *"the domain warp there doesnt really read"*: a 3cm
  // coordinate bend inside a 1m Voronoi cell is invisible by construction. The
  // floor's irregularity has to come from the CELLS, exactly as the wall's now
  // comes from the bricks.
  const rimN = vnoiseP(px * 5.5, py * 5.5, 32, 32) * 0.62
             + vnoiseP(px * 13.0, py * 13.0, 64, 64) * 0.38;
  const chipW = 0.03 * mixf(0.45, 2.1, rimN);          // seam width, per position
  const seam = 1 - smooth(chipW - aa, chipW + aa, edM);
  // A bite needs a thin rim AND the noise to agree, so bites are occasional and
  // sit on corners rather than ringing every stone.
  const bite = smooth(0.10, 0.0, edM) * smooth(0.72, 0.95, rimN);
  const recess = Math.max(seam, missing);
  // Sloped gap walls for the height channel — see the note in brickCPU. The
  // shade keeps the narrow seam so the joint stays a crisp line.
  const hSeam = 1 - smooth(chipW * 0.4, chipW + 0.075, edM);
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
  const h = clampf(1.0 + set + tilt - pit - bite * 0.30, 0.12, 1.15);
  return [
    mixf(tone, 0.5, seam) * mixf(1.0, 0.42, missing) * mixf(1.0, 0.70, bite),
    mixf(h, 0.35, hSeam),
    dHash(gx, gy, 4.2),                          // VARIANT — this flag's colour
    clampf(dHash(gx, gy, 9.6) + missing * 0.4 + bite * 0.3, 0, 1),  // WEAR — broken stone + bare earth are rough
  ];
}

// ── OPERATOR: DIRECTIONAL BLUR ───────────────────────────────────────────────
// The second werkkzeug operator. Blurring a field ALONG A DIRECTION, rather
// than evenly, is what turns isotropic noise into something that looks like it
// was ACTED ON: water running, grit dragged, a face worn by whatever passes it.
// Their plywood example is dots → directional blur → distort, and the blur is
// the step that makes it grain rather than spots.
//
// Wraps at the edges, because everything here has to keep tiling.
function dirBlurWrap(src: Float32Array, W: number, H: number,
                     dx: number, dy: number, taps: number): Float32Array {
  const out = new Float32Array(W * H);
  const inv = 1 / taps;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let acc = 0;
      for (let t = 0; t < taps; t++) {
        const sx = (((Math.round(x + dx * t) % W) + W) % W);
        const sy = (((Math.round(y + dy * t) % H) + H) % H);
        acc += src[sy * W + sx];
      }
      out[y * W + x] = acc * inv;
    }
  }
  return out;
}

// ── OPERATOR: CHAINED EROSION ────────────────────────────────────────────────
// The werkkzeug weathering loop, and the last of the operators worth borrowing:
// BLUR → RE-THRESHOLD → DISTORT, repeated. One pass of any of them is a hint;
// three iterations is geology.
//
// Why the loop does something a single bigger blur cannot:
//   BLUR alone converges. Keep blurring and every field marches toward its own
//   average — flat grey. The information dies.
//   RE-THRESHOLD is what makes it survive: after each blur, push the values
//   back apart so the smeared field regains hard edges. Blur smears, threshold
//   re-crisps, and the pair leaves a shape that is neither the original nor
//   mush — it is the original DIGESTED.
//   DISTORT then bends the result before the next pass, so the second blur runs
//   along a slightly different path than the first. That is what stops it
//   looking like a directional smear and starts it looking like flow.
//
// Iterations shrink as they go: the first carves broad channels, the last adds
// fine branching. Large features first is how erosion actually proceeds, and
// doing it the other way round just sands the detail off again.
function sampleWrapBilinear(f: Float32Array, W: number, H: number, x: number, y: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const ix0 = ((x0 % W) + W) % W, iy0 = ((y0 % H) + H) % H;
  const ix1 = (ix0 + 1) % W, iy1 = (iy0 + 1) % H;
  return mixf(
    mixf(f[iy0 * W + ix0], f[iy0 * W + ix1], fx),
    mixf(f[iy1 * W + ix0], f[iy1 * W + ix1], fx),
    fy,
  );
}
/** Resample a field through a periodic noise displacement — the DISTORT step. */
function distortField(src: Float32Array, W: number, H: number, amp: number, per: number): Float32Array {
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W, v = y / H;
      const dx = (vnoiseP(u * per, v * per, per, per) - 0.5) * 2 * amp * W;
      const dy = (vnoiseP(u * per + 5.3, v * per + 9.1, per, per) - 0.5) * 2 * amp * H;
      out[y * W + x] = sampleWrapBilinear(src, W, H, x + dx, y + dy);
    }
  }
  return out;
}
function chainedErosion(
  src: Float32Array, W: number, H: number,
  dx: number, dy: number, taps: number, iters: number,
): Float32Array {
  let f = src;
  for (let i = 0; i < iters; i++) {
    const shrink = Math.pow(0.55, i);                 // each pass finer than the last
    const t = Math.max(2, Math.round(taps * shrink));
    // Rotate the flow slightly each pass so the second smear does not simply
    // retrace the first — real runs braid, they do not stack.
    const ang = (i - (iters - 1) / 2) * 0.22;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    f = dirBlurWrap(f, W, H, dx * ca - dy * sa, dx * sa + dy * ca, t);
    // RE-THRESHOLD around the field's own mean, so the pass cannot drift bright
    // or dark over iterations — it only ever redistributes.
    let mean = 0;
    for (let k = 0; k < f.length; k++) mean += f[k];
    mean /= f.length;
    // BAND WIDTH is what decides whether this reads as weathering or as
    // holstein. Josh: *"it reads like cow pattern, but its a lead."* A tight
    // band around the mean turns the smear into a two-tone mask — big soft
    // blobs with hard shoulders, i.e. cow. Widening it keeps the field
    // CONTINUOUS, so the erosion comes out as a gradient of staining with a few
    // strong runs in it rather than patches of on and off. The band also widens
    // per iteration, so early passes shape and later ones only shade.
    const band = 0.34 + i * 0.10;
    const lo = mean - band, hi = mean + band;
    for (let k = 0; k < f.length; k++) f[k] = smooth(lo, hi, f[k]);
    if (i < iters - 1) f = distortField(f, W, H, 0.012 * shrink, 6);
  }
  return f;
}

// ── OPERATOR: COLOUR / TONE REMAP ────────────────────────────────────────────
// The third werkkzeug operator, and the cheapest of the lot: push a monochrome
// field through a curve. Generators produce values spread evenly across their
// range because that is what the maths does; real stone does not — most of a
// wall sits in a narrow band of mid-tone with a few bright faces and a few
// genuinely dark holes.
//
// This remaps the shade so the mid-tones COMPRESS and the extremes SEPARATE:
// the wall stops looking like a smooth ramp of greys and starts having a few
// stones that catch the eye against a mass that does not. An S-curve around a
// pivot, which is a levels adjustment by another name.
function toneRemap(v: number, pivot: number, contrast: number): number {
  const d = v - pivot;
  const s = d >= 0 ? 1 : -1;
  return clampf(pivot + s * Math.pow(Math.abs(d) / Math.max(1e-4, s > 0 ? 1 - pivot : pivot), contrast)
    * (s > 0 ? 1 - pivot : pivot), 0, 1);
}

// Per-surface operator settings. Erosion runs ALONG a direction: down a wall
// (water), and across a floor (traffic).
const EROSION: Record<SurfaceKind, { dx: number; dy: number; taps: number; amt: number; iters: number }> = {
  wall:    { dx: 0.12, dy: 1, taps: 18, amt: 0.20, iters: 3 },   // runs DOWN the wall
  floor:   { dx: 1, dy: 0.35, taps: 12, amt: 0.16, iters: 3 },   // dragged across
  ceiling: { dx: 0, dy: 1, taps: 8, amt: 0.10, iters: 2 },
  dressed: { dx: 0.1, dy: 1, taps: 8, amt: 0.10, iters: 2 },
  grain:   { dx: 0, dy: 0, taps: 1, amt: 0, iters: 0 },
};
const TONE: Record<SurfaceKind, { pivot: number; contrast: number }> = {
  wall:    { pivot: 0.62, contrast: 0.80 },
  floor:   { pivot: 0.58, contrast: 0.78 },
  ceiling: { pivot: 0.60, contrast: 0.92 },
  dressed: { pivot: 0.66, contrast: 0.90 },
  grain:   { pivot: 0.5, contrast: 1 },
};

function bakeSurfaceCPU(kind: SurfaceKind): THREE.DataTexture {
  const tile = SURFACE_TILE[kind];
  const aa = (tile[0] / CPU_TEX) * 0.7;
  const N = CPU_TEX * CPU_TEX;
  const buf = new Uint8Array(N * 4);

  // ── PASS 1 · GENERATE ──────────────────────────────────────────────────────
  // The bake is now a CHAIN OF PASSES rather than one per-pixel loop, which is
  // the werkkzeug architecture and not just a refactor: a blur cannot be done
  // per-pixel-in-isolation, it needs the whole field, so every operator after
  // "generate" was structurally impossible until this existed.
  const shadeF = new Float32Array(N), heightF = new Float32Array(N);
  const variantF = new Float32Array(N), wearF = new Float32Array(N);
  const eroF = new Float32Array(N);
  for (let yi = 0; yi < CPU_TEX; yi++) {
    for (let xi = 0; xi < CPU_TEX; xi++) {
      const u0 = (xi + 0.5) / CPU_TEX, v0 = (yi + 0.5) / CPU_TEX;
      // WARP FIRST, then evaluate the pattern in the bent coordinates.
      const [u, v] = WARP_AMP[kind] > 0
        ? warpUV(u0, v0, WARP_AMP[kind], WARP_FACETED[kind]) : [u0, v0];
      const px = u * tile[0], py = v * tile[1];
      let shade = 1, height = 1, variant = 0.5, wear = 0.5;
      if (kind === 'wall') [shade, height, variant, wear] = brickCPU(px, py, aa);
      else if (kind === 'floor') [shade, height, variant, wear] = flagCPU(px, py, aa);
      else if (kind === 'ceiling') [shade, height, variant, wear] = cofferCPU(px, py, aa);
      else if (kind === 'dressed') [shade, height, variant, wear] = dressedCPU(px, py, aa);
      else [shade, height, variant, wear] = grainCPU(u, v);
      const i = yi * CPU_TEX + xi;
      shadeF[i] = shade; heightF[i] = height; variantF[i] = variant; wearF[i] = wear;
      // The field the erosion pass will smear. Periodic so it keeps tiling.
      eroF[i] = vnoiseP(u0 * 12, v0 * 12, 12, 12) * 0.6
              + vnoiseP(u0 * 27, v0 * 27, 27, 27) * 0.4;
    }
  }

  // ── PASS 2 · ERODE (directional blur) ──────────────────────────────────────
  // Smear the noise ALONG a direction, then use the smear to eat into the
  // surface: darker and lower where the run passed. Down a wall, because that
  // is where water goes; across a floor, because that is where feet go. This is
  // the operator that makes a surface look ACTED ON rather than merely noisy.
  const ero = EROSION[kind];
  if (ero.amt > 0) {
    const smear = chainedErosion(eroF, CPU_TEX, CPU_TEX, ero.dx, ero.dy, ero.taps, ero.iters);
    for (let i = 0; i < N; i++) {
      // Only the strong end of the smear cuts — otherwise it is a grey veil
      // over everything instead of distinct runs.
      const cut = smooth(0.38, 1.0, smear[i]) * ero.amt;   // gentler shoulder
      shadeF[i] *= mixf(1, 0.62, cut);
      heightF[i] -= cut * 0.22;
      wearF[i] = clampf(wearF[i] + cut * 0.5, 0, 1);   // eroded stone is rougher
    }
  }

  // ── PASS 3 · REMAP + PACK ──────────────────────────────────────────────────
  const tone = TONE[kind];
  for (let i = 0; i < N; i++) {
    const o = i * 4;
    // R = shade, G = variant, B = wear, A = height. G and B are NOT copies of
    // R — they carry per-stone identity (see the Cell note above), so the
    // shader must read shade as `.r` broadcast, never `.rgb`.
    buf[o] = clampf(toneRemap(clampf(shadeF[i], 0, 1), tone.pivot, tone.contrast), 0, 1) * 255;
    buf[o + 1] = clampf(variantF[i], 0, 1) * 255;
    buf[o + 2] = clampf(wearF[i], 0, 1) * 255;
    buf[o + 3] = clampf(heightF[i], 0, 1) * 255;
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
