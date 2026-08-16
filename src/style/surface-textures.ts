import * as THREE from 'three';
import type { DelveRenderer } from '../scene/create-renderer';
import { BRICK_W, COURSE_H, FLAG_CELL, FLAG_PERIOD, stoneHash } from './stone-grid';
import { tuneNumber, onRebake } from '../debug/tuning';
import { DEV } from '../debug/dev';

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
// u,v are the tile-normalised coordinates the caller already computed. They are
// passed in rather than recovered from px/py because the gap generators need
// INTEGER PERIODS to stay seamless, and a period only tiles cleanly against
// [0,1) — dividing metres back out by a tile size the generator does not know
// is how a seam gets introduced by accident.
function brickCPU(px: number, py: number, aa: number, u: number, v: number): Cell {
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
  const jS = jitterAmt('wall');
  const jx = (dHash(idx, idy, 12.9) - 0.5) * 0.16 * jS;   // ± along the course
  const jy = (dHash(idx, idy, 4.3) - 0.5) * 0.10 * jS;    // ± in bed height
  const inbx = clampf(fract(gx) + jx, 0.001, 0.999);
  const inby = clampf(fract(gy) + jy, 0.001, 0.999);
  const dH = Math.min(inby, 1 - inby) * by, dV = Math.min(inbx, 1 - inbx) * bx;
  const vKeep = stepf(0.18, dHash(modf(Math.floor(gx + 0.5), 4), idy, 9.1));
  const dseam = Math.min(dH, vKeep > 0.5 ? dV : 1e3);
  // ── SEAMVAR SCALED THE MASK, WHICH IS WHY WALL JOINTS WERE BLOTCHY ────────
  // Josh: *"the crevices on walls are still quite blotchy — torn between a light
  // sandstone colour and a dark patchiness"*, and *"crevice depth and rim catch
  // dont seem to do anything on walls."* Both are this line, and they are the
  // same bug seen from two sides.
  //
  // seamVar ran 0.4..1.0 per brick and multiplied the joint MASK. A mask is
  // COVERAGE, not depth — scaling it does not make a joint shallower, it makes
  // the joint partly NOT THERE, so it blends only 40% of the way toward the
  // mortar colour and keeps 60% of the brick's own pale tone. Some joints dark,
  // some pale, per brick: exactly the light-sandstone-versus-dark patchiness.
  //
  // And it silently capped every knob downstream. Crevice depth can only reach
  // as far as the mask lets it, so on a 0.4 brick the slider had 40% of its
  // authority and read as broken. The floor has no equivalent scaling, which is
  // precisely why the same knob works there — the report and the code agree.
  //
  // Joints DO vary, but in depth and in fill colour, not in existence. So the
  // variation moves to the HEIGHT channel (below) where "shallower" is what it
  // actually means, and the per-segment tone variation mortarFill already does
  // covers the colour. The shade mask goes to full strength.
  const seamVar = mixf(0.62, 1.0, dHash(idx, idy, 2.3));
  const jW = 0.03 * jointW('wall');
  const mortar = 1 - smooth(jW - aa, jW + aa, dseam);
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
  // Sharpness narrows the ramp toward the joint: 1 = the face holds its height
  // right to the arris, 0 = the old wide fillet.
  // Scaled by the joint width so the height ramp always spans the joint — a
  // fixed ramp inside a widened joint reaches the bottom early and leaves a
  // flat-bottomed slot, which is the card-stack cliff back again.
  const eW = mixf(0.085, 0.026, edgeSharp('wall')) * jointW('wall');
  const hMortar = (1 - smooth(0.010, eW, dseam)) * seamVar;
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
  // ── DOMING (OpenKTG's CellInner) ───────────────────────────────────────────
  // Their Cells operator has two modes and we had only ever used one. CellOuter
  // (distance to the EDGE) gave the floor its chipped rims. CellInner —
  // distance to the CENTRE — is the other half, and it does something no amount
  // of noise can: it makes each face CONVEX.
  //
  // That matters because worn stone is not flat. A block that has been rained
  // on and rubbed past for centuries is highest in the middle and falls away to
  // its arrises, and a convex face turns a point light into a soft moving
  // highlight instead of a flat wash. It is the difference between a stone and
  // a tile with a stone printed on it — and unlike the tilt above, which leans
  // a flat plane, this actually curves it.
  const dcx = (inbx - 0.5) * 2, dcy = (inby - 0.5) * 2;
  const dome = Math.max(0, 1 - (dcx * dcx + dcy * dcy)) * 0.055 * domeAmt('wall');
  // Tone widened 0.86..1.0 → 0.80..1.06: with light now varying per block, the
  // albedo can carry more spread without the wall reading as noise.
  const tone = mixf(0.80, 1.06, dHash(idx, idy, 3.7));
  // SPALL — roughly one brick in twelve has lost its face. Until POM existed a
  // "broken" brick could only be a darker rectangle; now the height can drop
  // and the ray march carves an actual bite out of the wall.
  const spall = stepf(0.92, dHash(idx, idy, 6.9));
  const spallD = spall * mixf(0.30, 0.55, dHash(idx, idy, 1.7));
  // EDGE CHIPPING — measured from dseam, which is already the distance to the
  // nearest joint, so a chip reaches in from the arris exactly where one would.
  const chip = edgeChip(u, v, dseam, chipAmt('wall'));
  const brk = cornerBreak(inbx, inby, idx, idy, u, v, cornerAmt('wall'));
  const raw = Math.min(1, chip.raw + brk.raw);
  const h = clampf(1.0 + set + tilt + dome - spallD - chip.depth - brk.depth, 0.25, 1.15);
  // The joint is no longer a constant — see mortarFill.
  const m = mortarFill(gx, gy, u, v, jointTex('wall'));
  // CREVICE: the channel floor goes toward black, and the arris just outside it
  // catches. Both are scalars on SHADE, so neither can shift the hue.
  const mDark = m.tone * mixf(1, 0.26, crevDark('wall'));
  const rimLift = 1 + arrisBand(dseam, jW, aa) * 0.95 * crevRim('wall');
  return [
    // A fresh break is LIGHTER than the face around it: the inside of the
    // stone never had the soot.
    mixf(tone, mDark, recess) * mixf(1.0, 0.72, spall) * mixf(1.0, 1.14, raw) * rimLift,
    mixf(h, m.h, hRecess),
    dHash(idx, idy, 4.2),                       // VARIANT — this block's colour
    clampf(mixf(dHash(idx, idy, 9.6) + spall * 0.35 + raw * 0.75, m.wear, recess), 0, 1),
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
function warpUV(u: number, v: number, amp: number, faceted: boolean, faceKind: SurfaceKind): [number, number] {
  const P = WARP_PERIOD, P2 = P * 2;
  let nx = vnoiseP(u * P, v * P, P, P) * 0.68
         + vnoiseP(u * P2 + 3.1, v * P2 + 7.9, P2, P2) * 0.32;
  let ny = vnoiseP(u * P + 11.3, v * P + 5.7, P, P) * 0.68
         + vnoiseP(u * P2 + 19.7, v * P2 + 2.3, P2, P2) * 0.32;
  if (faceted) {
    // Snap to levels → flat facets with hard edges between them.
    const L = Math.max(2, Math.round(warpFacet(faceKind)));
    nx = Math.floor(nx * L) / (L - 1);
    ny = Math.floor(ny * L) / (L - 1);
  }
  return [u + (nx - 0.5) * 2 * amp, v + (ny - 0.5) * 2 * amp];
}
// How far each surface bends. Walls are LAID by someone and only sag with age;
// a floor is bedded in earth and moves more. Kept small — past ~0.05 the courses
// stop reading as masonry and start reading as melted.
// ── PER-SURFACE KNOB PAIRS ───────────────────────────────────────────────────
// Josh: *"is there a way to seperate the sliders for floor and wall?"* Yes, and
// they should never have shared one: a wall is LAID and weathers by water
// running down it, a floor is BEDDED and weathers by being walked on. Tuning
// them together means every value is a compromise nobody chose.
//
// One call makes both knobs and returns a lookup, so the pair cannot drift
// apart and neither can be forgotten. Ceiling and dressed stone follow the wall
// — they are vertical-ish work by the same hands.
function surfaceKnob(
  id: string, label: string, min: number, max: number,
  wallV: number, floorV: number, hint: string, step?: number,
): (kind: SurfaceKind) => number {
  const w = tuneNumber({ id: `${id}w`, group: 'Wall', label, min, max, value: wallV, hint, step });
  const f = tuneNumber({ id: `${id}f`, group: 'Floor', label, min, max, value: floorV, hint, step });
  return (kind) => (kind === 'floor' ? f() : w());
}

// ── THE WALL DEFAULTS ARE JOSH'S, FOUND BY DRAGGING ─────────────────────────
// He sent the set back on 2026-08-16 — the first look in this file arrived at
// by looking rather than by me picking a number and defending it afterwards.
// Adopted verbatim; the numbers in the `(was …)` comments are what shipped
// before, kept so the move is legible rather than silent.
//
// Worth naming what he changed, because it is consistent: doming way UP (0.20 →
// 0.61) and edges SHARPER (0.62 → 0.81), while erosion and tone contrast came
// DOWN. That is a wall of hard-arrised blocks worn convex in their middles,
// rather than soft-edged blocks with heavy staining — and both of my defaults
// were on the wrong side of it.
//
// Floor values are untouched: he tuned the wall, and quietly moving the floor
// to match would be inventing a decision he did not make.
// Floor values are his too now, from a second pass on 2026-08-16. Same shape of
// move as the wall — doming UP (0.35 → 0.66) and edges SHARPER (0.42 → 0.66) —
// which makes it a consistent preference rather than two separate opinions, and
// says my soft-and-weathered defaults were wrong on both surfaces.
//
// He also flagged the rounding: the panel's step landed a couple of values a
// hair off where he meant (warp 0.0576 for 0.058, joint width 1.786 for 1.8).
// Written as what he MEANT, not what the slider emitted — a default carrying a
// rounding artefact from the session it was found in is noise pretending to be
// a decision.
const warpAmt = surfaceKnob('warp', 'Warp', 0, 0.08, 0.0096, 0.044, 'how far the pattern bends');
const jitterAmt = surfaceKnob('setout', 'Set-out', 0, 2, 0.92, 1.28, 'how badly it was laid');
const crackAmt = surfaceKnob('cracks', 'Cracks', 0, 1, 0.635, 0.805, 'splits that ignore the joints');
const domeAmt = surfaceKnob('dome', 'Doming', 0, 1, 0.61, 0.66, 'how convex the faces are');
const eroAmt = surfaceKnob('erode', 'Erosion', 0, 3, 0.715, 1.0,
  'weathering strength — past 1 pushes beyond the per-surface base');
const eroSteep = surfaceKnob('erosteep', 'Erosion steepness', 0, 1, 0.295, 0.38, 'low = staining, high = runs');
const toneCon = surfaceKnob('tone', 'Tone contrast', 0.4, 1.6, 0.868, 0.94, 'how far stones separate in value');
// ── THE FLOOR'S FACETING KNOB WAS DEAD ──────────────────────────────────────
// Josh: *"the jaggedness for floor also does nothing while it looks good on the
// wall."* Correct, and it never could have done anything. Whether a surface
// facets at all was a hardcoded table (WARP_FACETED, below) with floor set to
// false, so warpFacet('floor') was never called — the knob existed, the panel
// showed it, dragging it changed a number nobody read. He set it to 11 and got
// nothing, which is exactly what the code does.
//
// My fault for making a per-surface PAIR out of a value only one surface
// consumed. The knob is the switch now: 0 means the smooth continuous warp,
// anything from 1 up is the number of quantisation levels. The table survives
// only for ceiling and dressed stone, which have no knobs of their own.
//
// Floor DEFAULTS TO 0 — the smooth warp it has always had. His 11 was chosen
// blind, against a control that did nothing, so adopting it would be adopting a
// number he never actually saw. It works now; it wants looking at.
const warpFacet = surfaceKnob('facet', 'Warp faceting', 0, 24, 5, 7,
  '0 = smooth bending, higher = rigid slabs settling', 1);
function warpFacetedFor(kind: SurfaceKind): boolean {
  if (kind === 'wall' || kind === 'floor') return warpFacet(kind) >= 1;
  return WARP_FACETED[kind];
}

// ── EDGE SHARPNESS ───────────────────────────────────────────────────────────
// Josh: *"everything looks like rounded edges like rounded bevel ... stones are
// sometimes rounded but this looks like someone filed them down."*
//
// Fair, and it is my doing. Killing the card-stack banding meant widening the
// height ramp at every joint from about one texel to ~70mm, which turns a sharp
// arris into a fillet on EVERY edge in the game. That fixed the march and filed
// the stone down at the same time.
//
// The two pull against each other and there is no free setting, so it becomes a
// knob rather than a number I pick: narrow ramp = crisp arrises and some
// banding, wide ramp = smooth march and soft edges. Dressed stone wants sharp,
// a worn floor wants soft, which is exactly why it is per-surface too.
const edgeSharp = surfaceKnob('edge', 'Edge sharpness', 0, 1, 0.805, 0.26,
  'high = crisp arris, low = filed down');

// ── GRIT — OpenKTG's Noise with OCTAVES, which we never actually took ────────
// Josh: *"we are able to shape the stones but it still doesnt have like
// roughness texture and grit you know."*
//
// Right, and the gap is specific. Every noise call in this file is ONE octave
// at ONE frequency — a blob generator. We used it for warping, for erosion, for
// cracks, always as a single smooth field. Their Noise operator takes an OCTAVE
// COUNT and sums the field at doubling frequencies with halving amplitude, and
// that is not a cosmetic difference: a single octave has a characteristic size,
// so the eye reads it as a pattern of things about that big. A fractal sum has
// no characteristic size, which is what makes real surfaces read as MATERIAL
// rather than as a texture of blobs.
//
// Periods are powers of two so the sum still tiles with the texture, and each
// octave is bandlimited by construction — vnoiseP interpolates between lattice
// points at exactly its period, so nothing in the sum is above the frequency
// its own octave can represent. That is what lets the mip chain average it away
// cleanly with distance instead of turning it into sparkle.
// ── AND THE STANDARD 1/f WEIGHTING IS WRONG FOR THIS JOB ────────────────────
// Josh, on the first version: *"the grit does something its just very subtle
// from on and off."* He is right and the cause is the weighting, not the
// amplitude.
//
// Textbook fBm puts HALF its energy in the lowest octave and eighths in the top
// ones, because it is usually being asked to make terrain — and terrain is
// mostly its largest feature. Here the largest octave (period 32, so ~14cm
// features on a 4.6m tile) is BLOTCHING, and this surface already has three
// separate sources of blotching: the shader's macro/meso/micro grime, the
// domain warp, and the erosion smear. Adding a fourth changed almost nothing
// visible, which is exactly the symptom.
//
// The thing that was missing is the FINE end — period 256 is ~1.8cm, which is
// what grit actually is. So the weights are near-flat with the emphasis pushed
// up, which is not standard fBm and is not meant to be: the octaves this
// surface was short of are the ones worth spending the energy on.
function gritField(u: number, v: number): number {
  return vnoiseP(u * 32, v * 32, 32, 32) * 0.20
       + vnoiseP(u * 64 + 5.3, v * 64 + 1.7, 64, 64) * 0.26
       + vnoiseP(u * 128 + 9.1, v * 128 + 4.2, 128, 128) * 0.28
       + vnoiseP(u * 256 + 2.6, v * 256 + 8.4, 256, 256) * 0.26;
}
// Range raised to 1.5: Josh landed on 1.0, and a chosen value sitting exactly
// on a slider's maximum means the range was picked wrong — you cannot tell
// whether it is where he wanted to be or where the control stopped him.
const gritAmt = surfaceKnob('grit', 'Grit', 0, 3, 1.5, 1.725,
  'micro grain and pitting in the stone itself');

// ── WHAT IS IN THE GAP ───────────────────────────────────────────────────────
// Josh: *"the texture in the gaps is still not so good, its better but still
// looking like the ABSENCE of texture rather than there being, like for the
// floor dirt or small rocks, and for the walls like mortar patchwork."*
//
// He has read the code without reading it. The gap is literally an absence:
// every generator here ends with `mixf(tone, 0.5, recess)` and `mixf(h, 0.4,
// hRecess)` — the joint is a CONSTANT, one flat grey at one flat depth. All the
// work of the last few days went into the stones; the space between them was
// never given a generator at all, and no amount of shading a constant will make
// it look like a substance.
//
// So each surface gets its own gap generator, at its own scale, masked to the
// gap — which is the werkkzeug composition move (generate two fields
// independently, combine through a mask) rather than another layer on one field.
//
// They are deliberately DIFFERENT generators, because the two gaps are not the
// same stuff. Mortar is struck by hand in segments between blocks; the dirt in
// a floor is packed and has stones in it. One shared "gap noise" would have
// been the same mistake at a smaller scale.
const jointTex = surfaceKnob('joint', 'Joint texture', 0, 3, 0.9, 1.5,
  'wall = mortar patchwork, floor = dirt and small stones');

// ── AND THE GAP HAS TO BE WIDE ENOUGH TO HOLD ANY ──────────────────────────
// The first cut of the above did almost nothing on the FLOOR, and the reason is
// arithmetic rather than art. The floor tile is 5.25m across 512 texels, so one
// texel is 10mm; the seam was 3cm wide, i.e. THREE TEXELS. Nothing can be drawn
// inside a three-texel channel — a pebble field at 4cm cells is larger than the
// gap it is supposed to fill, so each length of seam landed inside a single
// cell and came out flat.
//
// That is also the honest answer to *"it looks like the absence of texture"*:
// at that width there is no room for texture to exist, whatever we generate.
// It is why the WALL read better on the same change — mortarFill's variation is
// per-SEGMENT at half-brick pitch (~10 texels), which survives a narrow
// channel, while the aggregate inside it did not.
//
// So width becomes a dial. It is not only a workaround: flagstones bedded in
// earth genuinely sit with several centimetres of packed dirt between them, and
// the thin sawn seam we had is the less truthful of the two. Defaults nudged up
// so the texture has somewhere to be — dial back toward 1.0 for tight joints,
// at the cost of the gap going featureless again for the reason above.
const jointW = surfaceKnob('jointw2', 'Joint width', 0.4, 3.2, 1.25, 0.974,
  'narrow joints cannot hold detail — see the note in surface-textures.ts');

// ── EDGE CHIPPING — damage lives on the ARRIS ───────────────────────────────
// Josh: *"i would like something that chips edges, like wall blocks damaged
// edges, cracked or broken off, leaving rough surface beneath where the stone is
// broken."*
//
// Three separate things in that sentence, and the last one is the one I missed
// when I tried this before and had to revert it:
//
//   ON THE EDGE. A block does not break in the middle of its face — it breaks
//   where it is thin and exposed, at the arris and hardest at the corners. So
//   this reaches INWARD from the joint and dies off a few centimetres in,
//   instead of being sprinkled over the whole face.
//
//   ANGULAR. Stone parts along planes, so the bite has straight edges. A cell
//   field gives that for free: each cell is a polygon, and taking a whole cell
//   leaves the polygon's own straight boundary as the fracture line. Noise gives
//   rounded blobs, which is what makes damage read as erosion instead.
//
//   ROUGH BENEATH. The part that makes it read as BROKEN rather than as a hole.
//   The inside of a stone is not the outside of a stone: it has never been
//   dressed, never been weathered, never been rubbed by anything passing. So the
//   exposed break drives WEAR hard — which is roughness, so it kills the sheen
//   exactly where the surface is fresh — and lifts the tone slightly, because
//   the interior has not had centuries of soot on it. That contrast between a
//   worn face and a raw break is the whole read.
//
// Returns depth to remove and how exposed the break is, so the caller can spend
// the second one on wear and tone as well as height.
function edgeChip(
  u: number, v: number, distToEdge: number, amt: number,
): { depth: number; raw: number } {
  if (amt <= 0) return { depth: 0, raw: 0 };
  // How far in from the arris a chip can reach. Small on purpose: past a few
  // centimetres it stops being a chipped edge and becomes a missing block.
  // Bigger chips — Josh: *"edge chipping slightly more big chips."* Cells at
  // ~10cm instead of ~7cm (below), and the reach inward grows to match, so a
  // chip takes a real bite out of an arris rather than stippling it.
  const REACH = 0.15;
  const edgeBand = 1 - smooth(0, REACH, distToEdge);
  if (edgeBand <= 0.001) return { depth: 0, raw: 0 };
  // ~7cm cells — the size a corner of dressed stone actually comes off in.
  const c = cellField(u, v, 44);
  // Only some cells broke. Scaled by amt so the knob controls HOW MANY as well
  // as how deep — turning damage down should mean fewer chips, not shallower
  // ones everywhere, which is what a single depth multiplier would have given.
  if (dHash(c.cx, c.cy, 8.3) > 0.30 * amt) return { depth: 0, raw: 0 };
  // The WHOLE cell comes away, and its Voronoi boundary is the fracture line —
  // straight-sided, because that is how stone parts. Falls off over a narrow
  // band at the edge so the rim is crisp rather than a disc fading out from the
  // middle, which is what keying off distance-to-centre gave: a dot per cell,
  // affecting half a percent of the surface. Measured before believing it.
  const core = smooth(0.0, 0.13, c.edge);
  const bite = core * edgeBand;
  return {
    depth: bite * mixf(0.16, 0.40, dHash(c.cx, c.cy, 2.7)) * Math.min(1.6, amt),
    raw: bite,
  };
}
const chipAmt = surfaceKnob('chip', 'Edge chipping', 0, 3, 0.6, 0.45,
  'corners cracked off, raw stone underneath');

// ── THE TWO HALVES OF A LIT CREVICE, SECOND ATTEMPT ─────────────────────────
// Josh: *"we do them into pale but we could really make them dark, especially
// for walls"*, and *"your experimentation with the rim wasnt bad, it was just
// the wrong color or albedo — we could try that once more."*
//
// He is right on both counts and I know exactly what was wrong the first time.
// Three separate mistakes, all avoidable:
//
//   IT BOOSTED CHROMA on a broad band, which over-saturates toward the light's
//   own hue. That was the radioactive yellow. Gone — a rim needs no help taking
//   the torch's colour, a brighter surface does that by itself.
//
//   IT MIXED TOWARD PALE BONE — a near-white — so the arris went a different
//   COLOUR from the stone it belongs to. That is the "wrong colour" he is
//   describing. It is a scalar on SHADE now, so the rim is the same stone,
//   brighter. Hue-preserving by construction rather than by tuning.
//
//   IT LIVED IN THE SHADER, keyed off the height VALUE, which collides with any
//   fine height detail of comparable amplitude — grit at his settings swings 20%
//   of a joint's depth, so the mask fired all over the block faces. Here in the
//   BAKE the exact distance to the joint is a local, `dseam`, so there is
//   nothing to collide with and no extra texture tap. It should always have been
//   here: the rim is a property of the pattern, and this is where the pattern is.
//
// Per-surface because he asked for walls specifically, and because a wall arris
// is struck stone while a floor arris has been walked on for centuries.
const crevDark = surfaceKnob('crevdark', 'Crevice depth', 0, 1.5, 0.7, 0.45,
  'how far the bottom of the joint goes toward black');
const crevRim = surfaceKnob('crevrim', 'Rim catch', 0, 1.5, 0.5, 0.35,
  'the arris rubbed clean — this is the glow, and it stays the stone\u2019s colour');

// ── CORNER BREAKS — the LOW-frequency half of damage ────────────────────────
// Josh, after trying edge chipping: *"its good but its a high frequency chip.
// wouldnt it also be good to take whole sections of the sharp corners, like
// taking that section off and roughly bevelling it"*, and separately *"stones
// are damaged but not really in form."*
//
// Right, and the two are different events rather than two strengths of one.
// edgeChip is a cell field at ~7cm: gravel-scale, many per block, the surface
// being nibbled. This is ONE decision PER BLOCK — a corner is gone, and what is
// left is a bevel across it. That changes the block's SILHOUETTE, which is what
// "in form" means and what no amount of fine chipping can do, because averaging
// many small bites just gives you a rounded edge.
//
// Deliberately cheap and blocky: pick a corner, pick a size, cut with a diagonal.
// The cut is a straight ramp — a rough bevel, not a curve — and its line is
// wobbled by the block's own hash so the four corners of a wall do not all come
// off at the same angle. `raw` rides out with it so the exposed bevel gets the
// same never-weathered treatment as a chip: rougher, and lighter for want of
// centuries of soot.
function cornerBreak(
  inbx: number, inby: number, idx: number, idy: number,
  u: number, v: number, amt: number,
): { depth: number; raw: number } {
  if (amt <= 0) return { depth: 0, raw: 0 };
  // Roughly one block in five at amt = 1, fewer as it comes down — turning
  // damage off should remove BREAKS, not shrink every break toward invisible.
  if (dHash(idx, idy, 5.1) > 0.34 * amt) return { depth: 0, raw: 0 };
  // ── ANYWHERE ON THE PERIMETER, NOT JUST THE FOUR CORNERS ──────────────────
  // Josh: *"the edge break is really coming along but its almost always like one
  // corner — i think it could be a bit more irregular, its currently pretty
  // pattery."*
  //
  // Right, and it was structural rather than a tuning matter: the origin could
  // only ever be one of FOUR points, so every break was a triangle pinned to a
  // corner and the wall came out with the same motif repeated. Stone does not
  // only lose corners — it loses bites out of the middle of an edge too, and
  // those read completely differently.
  //
  // Pick a SIDE and then a position ALONG it. Corners still happen, because a
  // position near either end of a side is a corner, but they are now one
  // outcome among many instead of the only one.
  const side = Math.floor(dHash(idx, idy, 7.3) * 4) % 4;
  // ── BIASED TO THE ENDS, BECAUSE THAT IS WHERE STONE BREAKS ────────────────
  // Josh: *"there are barely any corners broken off ... its almost never hitting
  // the top corners."* My doing — the previous fix spread the origin uniformly
  // from 0.08 to 0.92 along a side, so it landed at an actual CORNER almost
  // never, and every break became a notch out of the middle of an edge. I traded
  // one uniform motif for another.
  //
  // The distribution is the fix, not the range. A corner is the thinnest, most
  // exposed part of a block and it is where masonry loses material first, so
  // most breaks belong at one end or the other — with mid-edge bites kept as the
  // minority they should have been all along.
  const r = dHash(idx, idy, 1.9);
  const along = r < 0.40 ? mixf(-0.06, 0.16, r / 0.40)
    : r > 0.60 ? mixf(0.84, 1.06, (r - 0.60) / 0.40)
      : mixf(0.28, 0.72, (r - 0.40) / 0.20);
  const ox = side === 0 ? along : side === 1 ? along : side === 2 ? 0 : 1;
  const oy = side === 0 ? 0 : side === 1 ? 1 : along;
  const du = Math.abs(inbx - ox), dv = Math.abs(inby - oy);
  // Asymmetric so the bevel is not a neat 45 degrees on every stone.
  const wu = mixf(0.7, 1.5, dHash(idx, idy, 4.4));
  // BIGGER. Josh: *"the small chunks look bad, the bigger missing chunks look
  // better."* A small break is indistinguishable from surface noise; a big one
  // is an event. So the low end of the range comes up rather than the high end
  // going further — the point is to stop making forgettable ones.
  const size = mixf(0.30, 0.58, dHash(idx, idy, 3.9)) * Math.min(1.2, amt);
  // The OUTLINE wobbles per facet too, so the break is a rough polygon rather
  // than a clean straight cut. Without this every break is a tidy triangle, and
  // "more irregular" cannot come from the depth alone.
  const fb = cellField(u, v, 96);
  const wob = 1 + (dHash(fb.cx, fb.cy, 6.1) - 0.5) * 0.34;
  const t = 1 - (du * wu + dv / wu) / Math.max(1e-4, size * wob);
  if (t <= 0) return { depth: 0, raw: 0 };
  // ── CLIFF, THEN PLATEAU, THEN IRREGULARITY ────────────────────────────────
  // Josh: *"corner breaks dont have to go down to 0 always, they can also leave
  // a kinda lower stone behind. now its band ramping which looks weird — it
  // would more likely be a polygon underneath than a ramp towards 0, probably
  // like a steep cliff and then a plateau and then irregularities, or just
  // chamfered towards 0."*
  //
  // Two wrong shapes in a row before this. First a linear ramp, which reads as
  // the corner SAGGING. Then quantising that ramp into three levels, which just
  // made the sag terraced — banding a wrong shape does not make it a right one.
  //
  // What a break actually leaves is a NEW SURFACE at a NEW HEIGHT: a cliff where
  // the stone parted, then a face sitting lower than the original, then the
  // roughness of the fracture on top of that. So:
  //
  //   CLIFF     the drop happens over a few per cent of the wedge, so there is a
  //             hard arris at the fracture rather than an easing-in.
  //   PLATEAU   the exposed face is FLAT and at a per-block depth, and crucially
  //             that depth is often NOT the bottom. Some blocks lose a sliver,
  //             some lose a corner outright — "a lower stone left behind".
  //   FACETS    polygonal irregularity ON the plateau, a few per cent either
  //             way, so the broken face is stone rather than a machined pocket.
  const t01 = Math.min(1, t);
  const CLIFF = 0.07;                       // fraction of the wedge the drop takes
  const plateau = smooth(0, CLIFF, t01);    // 0 at the line, 1 immediately after
  // Polygonal roughness on the exposed face — small, and quantised by the cell
  // rather than smooth, so it reads as fracture planes and not as a dent.
  const facet = (dHash(fb.cx, fb.cy, 4.4) - 0.5) * 0.16;
  const ramp = plateau * (1 + facet);
  // DEEPER THAN THE JOINT BESIDE IT, which the first cut was not: at 0.12..0.34
  // against a 0.6 joint, a "broken corner" sat SHALLOWER than the mortar line
  // next to it, so it could not read as missing stone. Measured height barely
  // moved (0.865 -> 0.862 at full strength). A corner that came off has to go
  // past the joint or it is just a dent.
  return { depth: ramp * mixf(0.14, 0.72, dHash(idx, idy, 8.7)), raw: ramp };
}
/** FLOOR equivalent. A Voronoi flag has no rectangular corners, so "a corner
 *  came off" becomes "a wedge came off ONE SIDE": pick a direction per cell, and
 *  cut inward from the rim on that side only. Same event, same silhouette
 *  change, expressed in the shape language the floor actually has.
 *
 *  Wired rather than left dead: a surfaceKnob makes a Floor slider whether or
 *  not anything reads it, and shipping one that does nothing is the exact bug
 *  the faceting knob was. */
function flagBreak(
  mrx: number, mry: number, gx: number, gy: number, edM: number,
  u: number, v: number, amt: number,
): { depth: number; raw: number } {
  if (amt <= 0) return { depth: 0, raw: 0 };
  if (dHash(gx, gy, 5.1) > 0.34 * amt) return { depth: 0, raw: 0 };
  const ang = dHash(gx, gy, 7.3) * Math.PI * 2;
  // (-mrx, -mry) is centre-to-pixel, so this is how far along the chosen
  // direction the pixel lies — positive on the side that broke.
  const along = Math.cos(ang) * -mrx + Math.sin(ang) * -mry;
  const reach = mixf(0.10, 0.30, dHash(gx, gy, 3.9)) * Math.min(1.5, amt);
  // Same shape as the wall's: a cliff at the break, a flat lower face behind it,
  // and polygonal irregularity on that face. A ramp down to nothing reads as the
  // flag sagging into the gap rather than as a piece having come off it.
  const side = smooth(0.05, 0.30, along);
  const t01 = 1 - smooth(0, reach, edM);
  if (t01 <= 0 || side <= 0) return { depth: 0, raw: 0 };
  const plateau = smooth(0, 0.10, t01) * side;
  const f = cellField(u, v, 96);
  const facet = (dHash(f.cx, f.cy, 4.4) - 0.5) * 0.16;
  const ramp = plateau * (1 + facet);
  if (ramp <= 0) return { depth: 0, raw: 0 };
  return { depth: ramp * mixf(0.14, 0.72, dHash(gx, gy, 8.7)), raw: ramp };
}

const cornerAmt = surfaceKnob('corner', 'Corner breaks', 0, 3, 0.8, 0.6,
  'whole corners off, roughly bevelled — changes the block silhouette');

/** The narrow band just OUTSIDE a joint: the arris itself. 1 at the lip, falling
 *  to 0 a couple of centimetres onto the face. `d` is distance to the joint,
 *  `jw` the joint's half-width, both in metres. */
function arrisBand(d: number, jw: number, aa: number): number {
  const RIM = 0.020;
  return smooth(jw - aa, jw + aa, d) * (1 - smooth(jw + RIM, jw + RIM * 2.4, d));
}

/** A periodic Voronoi cell field. Returns the squared distance to the nearest
 *  centre and that cell's id hashes, so a caller can give each cell its own
 *  identity. Shared by the wall's mortar aggregate and the floor's pebbles —
 *  they are the same operator at different scales, and having written it twice
 *  once already is how the two drifted apart. */
function cellField(u: number, v: number, P: number):
  { d2: number; cx: number; cy: number; edge: number } {
  const x = u * P, y = v * P;
  const ipx = Math.floor(x), ipy = Math.floor(y), fpx = fract(x), fpy = fract(y);
  let md = 9, mgx = 0, mgy = 0, mrx = 0, mry = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = modf(ipx + i, P), cy = modf(ipy + j, P);
    const ox = dHash(cx, cy, 0.31), oy = dHash(cx, cy, 5.17);
    const rx = i + ox - fpx, ry = j + oy - fpy; const dd = rx * rx + ry * ry;
    if (dd < md) { md = dd; mgx = cx; mgy = cy; mrx = rx; mry = ry; }
  }
  // ── SECOND PASS: distance to the cell EDGE, not to its centre (CellOuter) ──
  // Distance-to-centre is radial, so thresholding it gives a DISC at each cell
  // and the polygon's straight boundary never appears. The edge distance is what
  // makes a Voronoi cell read as a shape with sides — which is the whole reason
  // to use cells for fracture rather than noise. Same construction flagCPU
  // already uses for its chipped rims.
  let ed = 9;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = modf(ipx + i, P), cy = modf(ipy + j, P);
    const ox = dHash(cx, cy, 0.31), oy = dHash(cx, cy, 5.17);
    const rx = i + ox - fpx, ry = j + oy - fpy;
    const dx = rx - mrx, dy = ry - mry; const dl = dx * dx + dy * dy;
    if (dl > 1e-5) {
      const nl = Math.sqrt(dl);
      ed = Math.min(ed, 0.5 * (mrx + rx) * (dx / nl) + 0.5 * (mry + ry) * (dy / nl));
    }
  }
  return { d2: md, cx: mgx, cy: mgy, edge: ed };
}

/** WALL — mortar patchwork, keyed on the JOINT SEGMENT.
 *
 *  The word Josh used is the design: pointing is done in runs, between one pair
 *  of blocks at a time, and re-done in patches over centuries. So the unit of
 *  variation is a SEGMENT of joint, not a position along a continuous ribbon.
 *
 *  ── AND THE FIRST VERSION WAS BLOTCHY BECAUSE THAT WAS ALL IT WAS ───────────
 *  Josh: *"the floor mortar looks good but the wall doesnt ... the wall is still
 *  like bland and blotchy."* Right, and the two generators explain themselves.
 *  The floor's gap got a CELL FIELD — organic, edged, structure at pebble scale.
 *  The wall's got a per-segment hash and nothing else, which means solid
 *  rectangles of tone in a chain: blotches, by construction, at exactly the
 *  scale the eye reads as blotchy.
 *
 *  (He guessed the axis orientation. Reasonable guess — that WAS the bug for
 *  the flickering faces — but no: it is that one generator has internal
 *  structure and the other only had identity.)
 *
 *  The aggregate that was supposed to break it up could not: it ran at periods
 *  96 and 192, i.e. 5.3 and 2.7 texels, inside a joint about 4 texels wide. It
 *  was at the resolution limit before it started. So the wall gets the same
 *  cell field the floor has, at mortar-aggregate scale — sand and small stones
 *  set in lime — and the per-segment tone is pulled in hard, from a 0.74..1.30
 *  swing to 0.86..1.16. Patchwork should be a tint across a run of pointing,
 *  not a different colour of stone.
 *
 *  gx/gy are the brick-grid coordinates the caller already has, so segments
 *  land on the masonry instead of drifting across it. Periods 8 x 16 = the
 *  tile's 4 bricks x 8 courses at half-brick resolution, so it still tiles.
 */
function mortarFill(gx: number, gy: number, u: number, v: number, amt: number):
  { tone: number; h: number; wear: number } {
  const sx = modf(Math.floor(gx * 2), 8), sy = modf(Math.floor(gy * 2), 16);
  const segTone = mixf(0.86, 1.16, dHash(sx, sy, 5.9));   // re-pointed patches
  const segFill = mixf(-0.07, 0.05, dHash(sx, sy, 2.4));  // raked deep vs flush
  const gone = stepf(0.88, dHash(sx, sy, 6.6));           // this run has fallen out
  // AGGREGATE as a cell field — the grains in the mix, each with its own tone
  // and sitting slightly proud of the lime around it. ~2cm on a 4.6m tile,
  // which is about two texels: as fine as the bake can carry, and the reason
  // the joint has to be widened before any of it is visible.
  const agg = cellField(u, v, 224);
  const grain = dHash(agg.cx, agg.cy, 7.7);
  const gTone = mixf(0.82, 1.22, grain);
  const proud = (1 - smooth(0.0, 0.42, Math.sqrt(agg.d2))) * 0.05;
  // …over a continuous bed, so the joint is not purely cellular either.
  const bed = (vnoiseP(u * 72, v * 72, 72, 72) - 0.5);
  const tone = 0.5 * mixf(1, segTone, amt) * mixf(1, gTone, amt * 0.8)
             * (1 + bed * 0.30 * amt) * mixf(1, 0.62, gone * amt);
  const h = 0.4 + (segFill + proud + bed * 0.06) * amt - gone * 0.16 * amt;
  return { tone, h, wear: clampf(0.72 + bed * 0.5 - grain * 0.2 + gone * 0.2, 0, 1) };
}

/** FLOOR — packed dirt with small stones in it.
 *
 *  Not mortar: nobody pointed a floor. What sits between flagstones is earth
 *  that has been trodden into the gap, and the reason it does not read as a
 *  smooth trough is that it is full of PEBBLES. So the gap gets its own
 *  Voronoi at ~4cm — each cell a stone, each stone slightly proud of the dirt
 *  around it with its own tone — over a lumpy dirt bed rather than a clean
 *  channel.
 *
 *  A cell field rather than noise on purpose: pebbles have edges and sit
 *  against each other. Thresholded noise gives blobs, and blobs in a gap is
 *  what we already had.
 */
function gapFill(u: number, v: number, amt: number): { tone: number; h: number; wear: number } {
  // ~2.7cm cells on a 5.25m tile. Sized against the GAP, not against the
  // texture: at the widened default the gap is ~5cm, so two pebbles fit across
  // it. One texel is 10mm, so this is about as fine as the bake can carry
  // before the cells drop below Nyquist and mip to mush.
  const { d2, cx: mgx, cy: mgy } = cellField(u, v, 192);
  // Only some cells are a stone; the rest is the dirt they are bedded in.
  const isStone = stepf(0.52, dHash(mgx, mgy, 3.3));
  const stoneTone = mixf(0.78, 1.18, dHash(mgx, mgy, 7.1));
  const prouder = isStone * (1 - smooth(0.0, 0.35, Math.sqrt(d2))) * 0.13;
  // The dirt bed itself is lumpy, not flat.
  const dirt = (vnoiseP(u * 64, v * 64, 64, 64) - 0.5) * 0.6
             + (vnoiseP(u * 150 + 4.4, v * 150 + 1.2, 150, 150) - 0.5) * 0.4;
  const tone = 0.5 * mixf(1, mixf(0.86, stoneTone, isStone), amt) * (1 + dirt * 0.5 * amt);
  const h = 0.35 + (prouder + dirt * 0.12) * amt;
  return { tone, h, wear: clampf(0.80 + dirt * 0.4 - isStone * 0.25, 0, 1) };
}

function warpAmpFor(kind: SurfaceKind): number {
  if (kind === 'wall' || kind === 'floor') return warpAmt(kind);
  return WARP_AMP_BASE[kind];
}
const WARP_AMP_BASE: Record<SurfaceKind, number> = {
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
function flagCPU(px: number, py: number, aa: number, u: number, v: number): Cell {
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
  const chipW = 0.03 * jointW('floor') * mixf(0.45, 2.1, rimN);   // seam width, per position
  const seam = 1 - smooth(chipW - aa, chipW + aa, edM);
  // A bite needs a thin rim AND the noise to agree, so bites are occasional and
  // sit on corners rather than ringing every stone.
  const bite = smooth(0.10, 0.0, edM) * smooth(0.72, 0.95, rimN);
  const recess = Math.max(seam, missing);
  // Sloped gap walls for the height channel — see the note in brickCPU. The
  // shade keeps the narrow seam so the joint stays a crisp line.
  const eWf = mixf(0.075, 0.020, edgeSharp('floor'));
  const hSeam = 1 - smooth(chipW * 0.4, chipW + eWf, edM);
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
  // CellInner doming — see the note in brickCPU. Flags dome MORE than wall
  // blocks because they are the ones actually walked on, and a floor worn
  // convex is the single most legible sign that a place has been used.
  const dr2 = mrx * mrx + mry * mry;
  const dome = Math.max(0, 1 - dr2 * 3.2) * 0.075 * domeAmt('floor');
  const tone = mixf(0.70, 1.06, bt);
  // MISSING STONES ARE HOLES NOW. Josh: *"some stones are missing there but
  // even the missing texture is just flat color."* Exactly right — `missing`
  // only ever darkened the shade, so a lifted flagstone was a dark patch
  // painted on a level floor. The height never moved, because before POM there
  // was nothing that could have displayed it. Now it drops hard and the ray
  // march reads it as a pit you look down into, with the seam recess on top.
  const pit = missing * mixf(0.55, 0.78, dHash(gx, gy, 7.3));
  // EDGE CHIPPING on the flag rims — edM is already distance-to-edge in metres.
  const chip = edgeChip(u, v, edM, chipAmt('floor'));
  const brk = flagBreak(mrx, mry, gx, gy, edM, u, v, cornerAmt('floor'));
  const raw = Math.min(1, chip.raw + brk.raw);
  const h = clampf(1.0 + set + tilt + dome - pit - bite * 0.30 - chip.depth - brk.depth, 0.12, 1.15);
  // Packed dirt and pebbles rather than a constant — see gapFill. `missing`
  // uses it too: a lifted flagstone exposes the same bed the gaps are full of,
  // which is the whole reason the stone under your foot is loose.
  const g = gapFill(u, v, jointTex('floor'));
  const gapMask = Math.max(seam, missing);
  const gDark = g.tone * mixf(1, 0.26, crevDark('floor'));
  const rimLift = 1 + arrisBand(edM, chipW, aa) * 0.95 * crevRim('floor');
  return [
    mixf(tone, gDark, seam) * mixf(1.0, 0.42, missing) * mixf(1.0, 0.70, bite)
      * mixf(1.0, 1.14, raw) * rimLift,
    mixf(h, g.h, hSeam),
    dHash(gx, gy, 4.2),                          // VARIANT — this flag's colour
    clampf(mixf(dHash(gx, gy, 9.6) + missing * 0.4 + bite * 0.3 + raw * 0.75, g.wear, gapMask), 0, 1),
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


// ── OPERATOR: RIDGED NOISE (OpenKTG's NoiseAbs) ──────────────────────────────
// Their Noise operator has a mode flag we never had an equivalent for:
// NoiseDirect uses noise(x,y), NoiseAbs uses ABS(noise(x,y)). That one absolute
// value changes the SHAPE of the field completely — a smooth field has round
// hills and round valleys, an absolute one has round hills and SHARP CREASES
// where it folds through zero.
//
// Creases are what a crack is. Every noise layer in this file so far is a blob
// generator, which is why the surface could look weathered but never SPLIT.
// Ridged noise thresholded near its peak gives thin branching lines that wander
// across stones instead of following the joints — the one kind of damage that
// ignores how the wall was built, because a crack does not care where the
// bricklayer put the mortar.
function ridgedP(u: number, v: number, per: number): number {
  const n = vnoiseP(u * per, v * per, per, per);
  return 1 - Math.abs(n * 2 - 1);          // 1 along the fold, 0 at the extremes
}
function crackField(u: number, v: number): number {
  // Two octaves: the coarse one decides where a crack runs, the fine one makes
  // it wander and branch instead of reading as a drawn line.
  const a = ridgedP(u, v, 6);
  const b = ridgedP(u + 3.7, v + 1.9, 13);
  return a * 0.68 + b * 0.32;
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
      const wAmp = warpAmpFor(kind);
      const [u, v] = wAmp > 0 ? warpUV(u0, v0, wAmp, warpFacetedFor(kind), kind) : [u0, v0];
      const px = u * tile[0], py = v * tile[1];
      let shade = 1, height = 1, variant = 0.5, wear = 0.5;
      if (kind === 'wall') [shade, height, variant, wear] = brickCPU(px, py, aa, u, v);
      else if (kind === 'floor') [shade, height, variant, wear] = flagCPU(px, py, aa, u, v);
      else if (kind === 'ceiling') [shade, height, variant, wear] = cofferCPU(px, py, aa);
      else if (kind === 'dressed') [shade, height, variant, wear] = dressedCPU(px, py, aa);
      else [shade, height, variant, wear] = grainCPU(u, v);
      // ── CRACKS ─────────────────────────────────────────────────────────────
      // Applied AFTER the pattern, in unwarped coordinates, precisely because a
      // crack is not part of the masonry: it happened to it. Running it in the
      // warped frame would make it follow the courses, which is the one thing a
      // split does not do.
      const cA = crackAmt(kind);
      if (cA > 0) {
        const cf = crackField(u0, v0);
        const crack = smooth(0.86, 0.995, cf) * cA;
        shade *= mixf(1, 0.45, crack);
        height -= crack * 0.28;
        wear = clampf(wear + crack * 0.55, 0, 1);   // a split face is raw stone
      }
      // ── GRIT ───────────────────────────────────────────────────────────────
      // Applied last, in UNWARPED coordinates: grain belongs to the rock, not
      // to the grid it was laid on, so it must not stretch where the warp
      // stretches. Unwarped also keeps the finest octaves from being smeared
      // below their own Nyquist by the warp's gradient.
      //
      // WHICH CHANNEL is the whole trick. Grit in SHADE aliases into sparkle at
      // distance and reads as video noise, so it gets a token amount. It goes
      // mostly into HEIGHT, where it becomes a normal perturbation — i.e. it
      // modulates LIGHT rather than colour, so a torch rakes across it up close
      // and the mip chain flattens it to nothing far away, which is exactly how
      // real grain behaves. The rest goes into WEAR, signed so it spreads
      // roughness both ways instead of shifting the whole surface rougher.
      const gA = gritAmt(kind);
      if (gA > 0) {
        // Joints get a SANDIER grain than the faces — mortar and packed dirt
        // are aggregate, stone is crystalline, and one grain over both is the
        // tell that they are the same substance at different brightness.
        const joint = 1 - smooth(0.55, 0.95, height);
        const g = gritField(u0, v0) - 0.5;
        const sandy = vnoiseP(u0 * 48, v0 * 48, 48, 48) - 0.5;
        const grain = mixf(g, sandy, joint * 0.7);          // ±0.5, signed
        height += grain * 0.16 * gA;
        shade *= 1 + grain * 0.20 * gA;
        // ── VARIANCE → ROUGHNESS, which is what makes grit survive distance ──
        // The signed term above spreads roughness both ways, and that is the
        // part you see up close. But micro-relief in the HEIGHT channel dies
        // almost immediately as you back away: mipping averages opposing slopes
        // to flat, so the normal it derives goes smooth and the grain vanishes
        // — a metre out there is nothing left, which is the other half of why
        // the first version read as barely-there.
        //
        // Roughness does not have that problem. A mip-average of a rough patch
        // is still rough, because roughness is a STATISTIC and not a direction.
        // So the grain's MAGNITUDE (centred on its own mean, so it spreads
        // rather than shifts) is folded into wear as well: where the surface
        // has lots of fine relief, it stays rough at every distance even after
        // the relief itself has been filtered away. This is the cheap end of
        // what Toksvig/LEAN mapping does properly, done once at bake time.
        const variance = Math.abs(grain) - 0.25;            // mean |grain| ≈ 0.25
        wear = clampf(wear + grain * 0.5 * gA + variance * 1.1 * gA, 0, 1);
      }
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
  if (ero.amt > 0 && eroAmt(kind) > 0) {
    const smear = chainedErosion(eroF, CPU_TEX, CPU_TEX, ero.dx, ero.dy, ero.taps, ero.iters);
    for (let i = 0; i < N; i++) {
      // Only the strong end of the smear cuts — otherwise it is a grey veil
      // over everything instead of distinct runs.
      const cut = smooth(eroSteep(kind), 1.0, smear[i]) * ero.amt * eroAmt(kind);
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
    buf[o] = clampf(toneRemap(clampf(shadeF[i], 0, 1), tone.pivot, tone.contrast * toneCon(kind)), 0, 1) * 255;
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

// Every texture handed out, so a rebake can refresh them all in place.
const live = new Map<SurfaceKind, THREE.DataTexture>();

// ── REBAKE IN PLACE ──────────────────────────────────────────────────────────
// Copying the fresh pixels into the EXISTING DataTexture is what makes the
// 'rebake' tier feel live. Handing out a NEW texture would mean every material
// holding the old one has to be found and re-pointed, and the TSL graph that
// captured it would need rebuilding — i.e. a reload by another name. Same
// object, new bytes, needsUpdate: nothing downstream even knows.
onRebake(() => {
  for (const [kind, tex] of live) {
    const fresh = bakeSurfaceCPU(kind);
    (tex.image.data as Uint8Array).set(fresh.image.data as Uint8Array);
    tex.needsUpdate = true;
    fresh.dispose();
  }
});

// ── INSPECT WHAT THE BAKE ACTUALLY PRODUCED ─────────────────────────────────
// Every question about "does this knob do anything" so far has been answered by
// screenshotting and squinting, and torch flicker is large enough to swamp a
// pixel diff — a null control (two captures, nothing changed) came out as big
// as most of the knobs being tested. The bake output is the one place in this
// pipeline where the truth is a plain array of numbers, so make it readable.
//
// __surfTex.stats('floor') gives the channel histograms; __surfTex.mask('floor',
// lo, hi) gives the mean of the smoothstep mask the SHADER builds from the
// height channel, which is the number that decides whether a joint-masked
// effect can do anything at all.
if (DEV && typeof window !== 'undefined') {
  (window as unknown as { __surfTex?: unknown }).__surfTex = {
    kinds: () => [...live.keys()],
    stats: (kind: SurfaceKind) => {
      const t = live.get(kind);
      if (!t) return `no baked texture for '${kind}' — try __surfTex.kinds()`;
      const d = t.image.data as Uint8Array;
      const ch = ['shade', 'variant', 'wear', 'height'];
      const out: Record<string, unknown> = {};
      for (let c = 0; c < 4; c++) {
        let min = 255, max = 0, sum = 0; const n = d.length / 4;
        for (let i = c; i < d.length; i += 4) { const v = d[i]; if (v < min) min = v; if (v > max) max = v; sum += v; }
        out[ch[c]] = { min: +(min / 255).toFixed(3), mean: +(sum / n / 255).toFixed(3), max: +(max / 255).toFixed(3) };
      }
      return out;
    },
    /** Mean of smoothstep(lo,hi,height) inverted — i.e. the joint mask the
     *  shader uses. Near zero means every joint-masked knob is inert by
     *  construction, whatever its value. */
    mask: (kind: SurfaceKind, lo = 0.52, hi = 0.92) => {
      const t = live.get(kind);
      if (!t) return `no baked texture for '${kind}'`;
      const d = t.image.data as Uint8Array;
      let sum = 0, over = 0; const n = d.length / 4;
      for (let i = 3; i < d.length; i += 4) {
        const x = Math.max(0, Math.min(1, (d[i] / 255 - lo) / (hi - lo)));
        const m = 1 - x * x * (3 - 2 * x);
        sum += m; if (m > 0.5) over++;
      }
      return { meanMask: +(sum / n).toFixed(4), pctStronglyMasked: +(100 * over / n).toFixed(2) };
    },
  };
}

export function bakeSurfaceTexture(_renderer: DelveRenderer, kind: SurfaceKind): THREE.DataTexture {
  // The GLSL bake (ShaderMaterial + readRenderTargetPixels) was WebGL-only; the
  // sole (WebGPU) path generates the SAME patterns on the CPU (bakeSurfaceCPU) —
  // faithful, one-time, no GL/readback.
  const tex = bakeSurfaceCPU(kind);
  live.set(kind, tex);
  return tex;
}
