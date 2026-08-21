import * as THREE from 'three';
import { uniform, texture as tslTexture, vec2 } from 'three/tsl';
import { DEV } from '../debug/dev';

// ── THE CORNER FIELD — where the masonry knows it is turning ─────────────────
//
// A world-space scalar over the whole floor, sampled by the wall shader at
// world XZ: 0 out on an open wall, rising to 1 at a room's corners.
//
// ── WHY THIS EXISTS AT ALL ──────────────────────────────────────────────────
//
// Josh, 2026-08-16, on why polygon rooms read busy where the test chamber read
// clean: *"every polygon transition creates another vertical architectural
// line"*, with the proposal that masonry near a corner should go larger and
// calmer so that the wall itself says THIS IS A CORNER — architectural structure
// with no extra geometry, which is exactly what a room stripped back to walls
// and floor needs.
//
// The obstacle is that our masonry is a TILING BAKE. The stone layout is
// generated once into a tile that repeats in world space, so the layout cannot
// know where it is: there is no "make this stone bigger here" available, because
// "here" is not an input.
//
// ── AND WHY IT IS A TEXTURE RATHER THAN THE OTHER TWO OPTIONS ───────────────
//
// A per-fragment fact about a WORLD PLACE has three possible carriers, and the
// other two were both worse:
//
//   A VERTEX ATTRIBUTE would be the obvious answer, and it is a trap here.
//   mergeGeometries silently returns NULL when its inputs disagree about
//   attributes — this codebase has been bitten by that before — and wall
//   geometry comes from two independent builders (poly-room-shell for rooms,
//   builder's bakeWallSegmentGeometry for rects) whose outputs merge together.
//   Adding a channel means changing both in lockstep and every future wall
//   emitter forever, with a silent whole-floor blackout as the failure mode.
//
//   A UNIFORM ARRAY, the way the gore buffer carries its stamps, is an O(N)
//   loop per fragment. Gore gets away with it at a handful of live splats. A
//   floor has fifty to a hundred corners and they are all permanent.
//
//   A TEXTURE costs one tap, is written once at build time on the CPU, needs no
//   cooperation from any geometry builder, and works identically for both wall
//   paths and for anything else that later wants to ask a question about a
//   place. That last part is the real argument: this is the world-space data
//   seam that carved runes and damage events have been waiting on, and they
//   want a texture too.
//
// ── WHAT IT IS NOT ──────────────────────────────────────────────────────────
//
// Not a corner DETECTOR. It is written from the room polygons the generator
// already produced, so it agrees with the geometry by construction rather than
// by inferring corners back out of it.
//
// Not lighting, not occlusion, not AO. It carries one fact — "how cornered is
// this place" — and the shader decides what that should mean.

/**
 * Metres per texel.
 *
 * WAS 0.35, ON THE ARGUMENT THAT THE FIELD IS SMOOTH so a coarse grid plus
 * bilinear filtering would reconstruct it. The argument is fine and the number
 * was wrong: the falloff is only REACH_M across, so 0.35 gave barely TWO texels
 * from a corner's peak to zero. At that rate the sampled peak depends on how
 * close the corner happened to land to a texel centre — the unit test on a plain
 * 10m square measured 0.80 where a corner that landed dead on a centre measured
 * 1.00.
 *
 * That is a 20% swing in quoin strength keyed to a world-space grid rather than
 * to anything about the wall, which is the exact species of artefact this
 * feature exists to remove. 0.2 gives ~4 texels of support and the swing drops
 * under 5%.
 */
const TEXEL_M = 0.2;
/** How far a corner's influence reaches along each wall, in metres. About one
 *  large stone — a quoin is a stone, not a zone. */
const REACH_M = 0.75;
/** Cap, so a pathological floor cannot allocate an enormous buffer. At 0.2m
 *  this covers a 128m floor — a measured procgen floor needs 141x179 at this
 *  resolution — and the worst case costs 640^2 x 4 = 1.6MB, once, per floor. */
const MAX_DIM = 640;

/** Turn angle (radians) below which a polygon vertex is not really a corner —
 *  poly outlines carry near-collinear vertices from clipping, and stamping a
 *  quoin on one would put a mystery pier in the middle of a flat wall. ~11°. */
const MIN_TURN = 0.2;

let tex: THREE.DataTexture | null = null;
let lastCornerCount = 0;

// The shader reads these three every frame; they are swapped per floor. A 1x1
// black texture is installed up front so the node graph is valid before any
// level exists (the bench, the title screen) — `on` at 0 makes it inert anyway,
// but a null texture in a bound group is a validation error, not a no-op.
const blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
blank.needsUpdate = true;
const fieldTex = (tslTexture as any)(blank);
const uOrigin = (uniform as any)(new THREE.Vector2(0, 0));
const uInvSize = (uniform as any)(new THREE.Vector2(1, 1));
const uOn = (uniform as any)(0);

export interface CornerFieldInput {
  /** Room outlines, world XZ. Every sufficiently sharp vertex becomes a quoin. */
  polys: ReadonlyArray<ReadonlyArray<readonly [number, number]>>;
}

/**
 * Build the field for a floor. Call once per level build, after the room
 * polygons are final and before the first frame.
 *
 * Cheap: a few hundred corners, each touching a ~4x4 texel neighbourhood.
 */
export function buildCornerField(input: CornerFieldInput): void {
  const corners: Array<{ x: number; z: number; convex: boolean }> = [];
  for (const poly of input.polys) {
    const n = poly.length;
    if (n < 3) continue;
    for (let i = 0; i < n; i++) {
      const p = poly[(i + n - 1) % n], c = poly[i], q = poly[(i + 1) % n];
      const ax = c[0] - p[0], az = c[1] - p[1];
      const bx = q[0] - c[0], bz = q[1] - c[1];
      const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz);
      if (la < 1e-4 || lb < 1e-4) continue;
      // The turn between the two edges. Taken from the DOT rather than the
      // cross, because a quoin does not care WHICH WAY the wall turns — a corner
      // needs a bonded stone whether it turns into the room or away from it, and
      // in a dungeon almost every corner turns the same way anyway.
      const cosT = (ax * bx + az * bz) / (la * lb);
      const turn = Math.acos(Math.max(-1, Math.min(1, cosT)));
      if (turn < MIN_TURN) continue;
      // ── AND WHICH WAY IT TURNS, WHICH THE QUOIN DID NOT NEED ────────────
      //
      // Josh: *"can we kinda bevel edges that are inwards? currently the edges are sharp."*
      // A quoin is the same stone whichever way a wall turns, which is why this was taken from
      // the dot alone. Rounding an arris is NOT: a convex edge rounds by splaying its normals
      // AWAY from the corner and a concave one by drawing them toward it, so getting the sign
      // wrong does not soften an edge, it sharpens it into a crease.
      //
      // The cross gives it, and it costs one multiply. Stored in the field's GREEN channel,
      // which has been sitting there unused since the texture is RGBA and only red was ever
      // written — no new buffer, no new upload, no second sampler.
      const cross = ax * bz - az * bx;
      corners.push({ x: c[0], z: c[1], convex: cross < 0 });
    }
  }

  lastCornerCount = corners.length;
  if (!corners.length) { clearCornerField(); return; }

  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const poly of input.polys) for (const [x, z] of poly) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  // Margin so a corner on the outline still has its full falloff inside the
  // buffer — the wall itself stands OUTSIDE the polygon, so this is not slack.
  const M = REACH_M + 1;
  minX -= M; minZ -= M; maxX += M; maxZ += M;
  const w = Math.min(MAX_DIM, Math.max(2, Math.ceil((maxX - minX) / TEXEL_M)));
  const h = Math.min(MAX_DIM, Math.max(2, Math.ceil((maxZ - minZ) / TEXEL_M)));
  // Recover the real metres-per-texel after the clamp, so a floor that hit the
  // cap gets a coarser field rather than a field that lies about where it is.
  const mx = (maxX - minX) / w, mz = (maxZ - minZ) / h;

  const data = new Uint8Array(w * h * 4);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;

  for (const c of corners) {
    const rx = Math.ceil(REACH_M / mx), rz = Math.ceil(REACH_M / mz);
    const cx = Math.floor((c.x - minX) / mx), cz = Math.floor((c.z - minZ) / mz);
    for (let j = cz - rz; j <= cz + rz; j++) {
      if (j < 0 || j >= h) continue;
      for (let i = cx - rx; i <= cx + rx; i++) {
        if (i < 0 || i >= w) continue;
        const wx = minX + (i + 0.5) * mx, wz = minZ + (j + 0.5) * mz;
        const d = Math.hypot(wx - c.x, wz - c.z);
        if (d >= REACH_M) continue;
        // smoothstep falloff, so the quoin fades into the wall instead of
        // ending on a ring the eye can find.
        const t = 1 - d / REACH_M;
        const v = t * t * (3 - 2 * t);
        const k = (j * w + i) * 4;
        // MAX, not add: two corners a metre apart (a chamfer's two ends) should
        // read as one continuous corner, not as a double-bright hotspot.
        const cur = data[k] / 255;
        // The winning corner owns the SIGN too. Writing green only when red wins keeps the two
        // channels describing the SAME corner — a texel whose strength came from one corner and
        // whose sign came from another would round an edge the wrong way exactly where two
        // corners meet, which is where it shows most.
        if (v > cur) {
          data[k] = Math.round(v * 255);
          data[k + 1] = c.convex ? 255 : 0;
        }
      }
    }
  }

  tex?.dispose();
  tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;

  fieldTex.value = tex;
  uOrigin.value.set(minX, minZ);
  uInvSize.value.set(1 / (maxX - minX), 1 / (maxZ - minZ));
  uOn.value = 1;
}

/** Drop the field — a floor with no polygon rooms, or teardown. */
export function clearCornerField(): void {
  uOn.value = 0;
  lastCornerCount = 0;
  fieldTex.value = blank;
  tex?.dispose();
  tex = null;
}

/**
 * The field at a world position, as a TSL node in 0..1.
 *
 * `worldPos` is a vec3 node; only XZ is read, because a corner is a VERTICAL
 * EDGE — its influence is the same at the floor and at the ceiling, which is
 * what makes a 2D field the right shape for it rather than a compromise.
 */
export function cornerFieldNode(worldPos: any): any {
  const uv = (vec2 as any)(
    worldPos.x.sub(uOrigin.x).mul(uInvSize.x),
    worldPos.z.sub(uOrigin.y).mul(uInvSize.y),
  );
  return (fieldTex as any).sample(uv).r.mul(uOn);
}

/**
 * Which way the nearest corner turns, as -1 (concave, folding into the room) .. +1 (convex).
 *
 * Paired with `cornerFieldNode`: that says HOW MUCH corner, this says WHICH KIND. Both read the
 * same texel of the same texture, so they cannot disagree about which corner they are describing.
 * Zero where there is no field at all, which is the "leave it alone" value for anything that
 * multiplies by it.
 */
export function cornerTurnNode(worldPos: any): any {
  const uv = (vec2 as any)(
    worldPos.x.sub(uOrigin.x).mul(uInvSize.x),
    worldPos.z.sub(uOrigin.y).mul(uInvSize.y),
  );
  return (fieldTex as any).sample(uv).g.mul(2).sub(1).mul(uOn);
}

/** DEV readout: what the field currently covers. */
export function cornerFieldInfo(): {
  on: boolean; w: number; h: number; corners: number; peak: number;
} {
  const d = tex?.image.data as Uint8Array | undefined;
  let peak = 0;
  if (d) for (let i = 0; i < d.length; i += 4) if (d[i] > peak) peak = d[i];
  return {
    on: uOn.value === 1,
    w: tex?.image.width ?? 0, h: tex?.image.height ?? 0,
    corners: lastCornerCount, peak: peak / 255,
  };
}

// A field that builds but is entirely ZERO renders exactly like a field that
// never built, so "no error" is not evidence it worked. `peak` is the cheap
// distinguisher — it should be 1.0 on any floor with a real corner in it.
// `DEV` from debug/dev.ts rather than the bare literal: this module is imported
// by its own test under the tsx runner, where `import.meta.env` is undefined and
// a bare `.DEV` throws at module load. The re-export carries a typeof guard and
// still constant-folds to false in the production bundle.
if (DEV && typeof window !== 'undefined') {
  (window as unknown as { __cornerField: unknown }).__cornerField = cornerFieldInfo;
}
