import * as THREE from 'three';
import { Vector4 } from 'three/webgpu';
import { uniform, uniformArray, Fn, Loop, If, Break, int, float, vec3, positionWorld, normalWorld, luminance, mix, frameGroup } from 'three/tsl';
import { groundYAt } from '../level/elevation';
import { DEV } from '../debug/dev';

// ── WEBGPU-NATIVE GORE ───────────────────────────────────────────────────────
//
// The classic gore (scene/splat-map.ts) stamps blood decals into a render-target
// via a mid-frame renderer.render() of ShaderMaterial quads — which fights the
// WebGPU node pipeline (the mid-frame render-to-target is the same nested-render
// hazard that crashed the vase, and ShaderMaterial isn't supported under
// WebGPURenderer). So on WebGPU we DON'T stamp a texture at all.
//
// Instead: keep the live splats in a small UNIFORM ARRAY and evaluate them
// PER-FRAGMENT in the banded lighting model's finish() — the same hazard-free
// pattern as the lean lights node. No render target, no ShaderMaterial, no
// drying pass (the dry fade is computed CPU-side into each splat's alpha each
// frame). A fragment loops the active splats, accumulates blood coverage by
// world-XZ proximity (with a height fade so the FLOOR pools fully and prop/mob
// BASES merely creep), and the lit colour is recoloured toward blood — luminance-
// preserving, so the lighting survives and only the hue shifts (matching the GLSL
// composite-stage recolour).

const MAX_GORE = 48;          // floor splats — ring buffer; oldest evicted past this
const MAX_WALL = 16;          // wall arcs — rarer (deaths/crits), smaller buffer
const DRY_FULL_S = 75;        // seconds to fully dry (fade toward a faint dried stain)
const HEIGHT_FADE_M = 0.55;   // blood creeps this far up a surface above the splat's floor
const GORE_STRENGTH = 0.9;    // how strongly full coverage recolours the surface

interface Splat { x: number; y: number; z: number; r: number; cr: number; cg: number; cb: number; a: number; born: number; }
const splats: Splat[] = [];
// Wall arc: a blood splotch on a vertical wall plane (axis 0 = X-facing wall, plane
// is its X coord + along is Z; axis 1 = Z-facing, plane is Z + along is X).
interface WallSplat { axis: number; plane: number; along: number; y: number; r: number; cr: number; cg: number; cb: number; a: number; born: number; }
const walls: WallSplat[] = [];

/* eslint-disable @typescript-eslint/no-explicit-any */
// GPU mirror — floor: A = (worldX, worldY, worldZ, radius); B = (r, g, b, effAlpha).
const _pos = Array.from({ length: MAX_GORE }, () => new Vector4());
const _col = Array.from({ length: MAX_GORE }, () => new Vector4());
// ── ONE BUFFER FOR THE SCENE, NOT ONE PER OBJECT ─────────────────────────────
//
// `uniformArray()` builds a BufferNode, which extends UniformNode and therefore
// defaults to `objectGroup` — a per-object group. Worse, a raw UniformBuffer
// binding does not value-compare like a UniformsGroup does: three's Buffer
// .update() returns TRUE unconditionally, so it re-uploads every frame whether
// or not a single byte moved.
//
// Together that means each of these arrays was copied into EVERY drawn object's
// own buffer and re-sent every frame, forever. A phone capture caught it exactly:
// 367 of 830 upload calls were `object · NO BYTES CHANGED (uploaded anyway)` —
// 44% of the frame's uploads carrying data that was already there. The gore
// graph is compiled into the wall and floor materials, which is most of what a
// floor draws, which is why it scaled with drawn-object count and looked like
// "objects are moving" from every angle we measured it.
//
// frameGroup is a sharedUniformGroup: one buffer for the whole scene. The
// unconditional re-upload remains (that is three's, not ours) but it is now
// five buffers a frame instead of five per drawn object.
const posArr = (uniformArray as any)(_pos, 'vec4').setGroup(frameGroup);
const colArr = (uniformArray as any)(_col, 'vec4').setGroup(frameGroup);
const countU = (uniform as any)(0, 'int').setGroup(frameGroup);   // global — see surface-detail.ts
// GPU mirror — wall: WA = (axisFlag, plane, along, height); WB = (r,g,b,effAlpha);
// WR = (radius, 0, 0, 0).
const _wpos = Array.from({ length: MAX_WALL }, () => new Vector4());
const _wcol = Array.from({ length: MAX_WALL }, () => new Vector4());
const _wrad = Array.from({ length: MAX_WALL }, () => new Vector4());
const wposArr = (uniformArray as any)(_wpos, 'vec4').setGroup(frameGroup);
const wcolArr = (uniformArray as any)(_wcol, 'vec4').setGroup(frameGroup);
const wradArr = (uniformArray as any)(_wrad, 'vec4').setGroup(frameGroup);
const wcountU = (uniform as any)(0, 'int').setGroup(frameGroup);   // global — see surface-detail.ts

let nowS = 0;   // updated each tick; avoids per-call performance.now()

/** Queue a floor blood splat at world (x,z). Y is sampled from the floor. */
export function stampGoreWebGPU(x: number, z: number, r: number, colorHex: number, a = 0.8): void {
  const c = new THREE.Color(colorHex);
  splats.push({ x, y: groundYAt(x, z), z, r, cr: c.r, cg: c.g, cb: c.b, a, born: nowS });
  if (splats.length > MAX_GORE) splats.shift();
}

/** Queue a wall blood arc. axis: 'x' = X-facing wall (plane = its X), 'z' = Z-facing
 *  (plane = its Z); along = position along the wall; y = impact height; r = size. */
export function stampWallGoreWebGPU(axis: 'x' | 'z', plane: number, along: number, y: number, r: number, colorHex: number, a = 0.8): void {
  const c = new THREE.Color(colorHex);
  walls.push({ axis: axis === 'x' ? 0 : 1, plane, along, y, r, cr: c.r, cg: c.g, cb: c.b, a, born: nowS });
  if (walls.length > MAX_WALL) walls.shift();
}

/** Wipe all gore (per-floor reset). */
export function resetGoreWebGPU(): void {
  splats.length = 0; countU.value = 0;
  walls.length = 0; wcountU.value = 0;
}

/** Per-frame: drop fully-dried splats and repack the uniform arrays with the
 *  live ones (alpha pre-multiplied by the dry fade). Cheap — a few dozen entries. */
export function tickGoreWebGPU(): void {
  nowS = performance.now() / 1000;
  for (let i = splats.length - 1; i >= 0; i--) {
    if (nowS - splats[i].born > DRY_FULL_S * 1.3) splats.splice(i, 1);
  }
  let k = 0;
  for (const s of splats) {
    if (k >= MAX_GORE) break;
    const dry = Math.max(0, 1 - (nowS - s.born) / DRY_FULL_S);   // 1 fresh → 0 dried
    _pos[k].set(s.x, s.y, s.z, s.r);
    // Dried blood doesn't vanish — it leaves a faint matte stain (keep ~35%).
    _col[k].set(s.cr, s.cg, s.cb, s.a * (0.35 + 0.65 * dry));
    k++;
  }
  countU.value = k;

  // Walls: same dry/evict + repack.
  for (let i = walls.length - 1; i >= 0; i--) {
    if (nowS - walls[i].born > DRY_FULL_S * 1.3) walls.splice(i, 1);
  }
  let w = 0;
  for (const s of walls) {
    if (w >= MAX_WALL) break;
    const dry = Math.max(0, 1 - (nowS - s.born) / DRY_FULL_S);
    _wpos[w].set(s.axis, s.plane, s.along, s.y);
    _wcol[w].set(s.cr, s.cg, s.cb, s.a * (0.35 + 0.65 * dry));
    _wrad[w].set(s.r, 0, 0, 0);
    w++;
  }
  wcountU.value = w;
}

// TSL: recolour `outgoing` toward blood where active splats cover this fragment.
// Luminance-preserving (keeps the lighting, shifts hue to blood).
const goreFn = (Fn as any)(([outgoing]: any) => {
  const fx = (positionWorld as any).x, fy = (positionWorld as any).y, fz = (positionWorld as any).z;
  const acc = (vec3 as any)(0, 0, 0).toVar();
  const cov = (float as any)(0).toVar();
  (Loop as any)(MAX_GORE, ({ i }: any) => {
    (If as any)((int as any)(i).greaterThanEqual(countU), () => { (Break as any)(); });
    const A = posArr.element(i);   // x,y,z,r
    const B = colArr.element(i);   // r,g,b,alpha
    const dx = fx.sub(A.x), dz = fz.sub(A.z);
    const d2 = dx.mul(dx).add(dz.mul(dz));
    const r = A.w;
    (If as any)(d2.lessThan(r.mul(r)), () => {
      // Broad flat pool with a soft edge — a wet puddle, not a pinprick. The
      // inner ~70% is near-full coverage, only the rim feathers out.
      const t = d2.sqrt().div(r);                         // 0 centre → 1 edge
      const fall = t.smoothstep(1.0, 0.55);              // 1 inside 0.55r → 0 at the rim
      const hf = fy.sub(A.y).div(HEIGHT_FADE_M).oneMinus().clamp(0, 1);  // floor full, up the wall fades
      const w = fall.mul(B.w).mul(hf);
      acc.addAssign(B.rgb.mul(w));
      cov.addAssign(w);
    });
  });
  // WALL arcs — only vertical surfaces, only the matching wall plane (so a stain
  // on one wall never ghosts onto the floor or a parallel wall). Spreads along +
  // up, and drips further DOWN. normalWorld.y ~0 = wall, ~1 = floor/ceiling.
  const vertMask = (normalWorld as any).y.abs().smoothstep(0.6, 0.35);
  (Loop as any)(MAX_WALL, ({ i }: any) => {
    (If as any)((int as any)(i).greaterThanEqual(wcountU), () => { (Break as any)(); });
    const WA = wposArr.element(i);   // axisFlag, plane, along, height
    const WB = wcolArr.element(i);   // r,g,b,alpha
    const rad = wradArr.element(i).x;
    const isX = WA.x.lessThan(0.5);
    const perp = isX.select(fx, fz);
    const al = isX.select(fz, fx);
    const planeMask = perp.sub(WA.y).abs().smoothstep(0.22, 0.08);   // 1 near the plane
    const alongFall = al.sub(WA.z).abs().div(rad).smoothstep(1.0, 0.4);
    const dV = fy.sub(WA.w);
    const dvN = dV.greaterThan(0.0).select(dV.div(rad), dV.negate().div(rad.mul(2.2)));  // up vs drip-down
    const vFall = dvN.smoothstep(1.0, 0.0);
    const w = vertMask.mul(planeMask).mul(alongFall).mul(vFall).mul(WB.w);
    acc.addAssign(WB.rgb.mul(w));
    cov.addAssign(w);
  });
  const totalCov = cov.min(1.0);
  const bloodHue: any = acc.div(cov.max(0.0001));        // coverage-weighted blood colour
  // Recolour toward blood: keep the lit brightness (so blood respects torchlight)
  // but give wet blood a faint floor of presence so a fresh pool reads even on dim
  // stone — and DARKEN slightly (blood pools are darker than the stone they sit on).
  const lum = (luminance as any)(outgoing).add(0.12);
  const tinted = bloodHue.mul(lum).mul(1.7);
  return (mix as any)(outgoing, tinted, totalCov.mul(GORE_STRENGTH));
}) as (outgoing: any) => any;

/** Apply gore recolour to a lit-colour node (called from the banded lighting finish). */
export function applyGoreWebGPU(outgoing: any): any { return goreFn(outgoing); }

if (DEV && typeof window !== 'undefined') {
  (window as any).__goreState = () => ({
    floor: countU.value, walls: wcountU.value, n: splats.length, nWall: walls.length,
    p0: _pos[0].toArray(), c0: _col[0].toArray(),
  });
  (window as any).__goreClear = () => { resetGoreWebGPU(); return 'cleared'; };
  // Stamp a pool at an absolute world (x,z) — for verification away from emitters.
  (window as any).__goreAt = (x: number, z: number, r = 1.2) => { stampGoreWebGPU(x, z, r, 0x8a1812, 0.9); return [x, z]; };
  // Stamp a wall arc at an absolute plane/along/height.
  (window as any).__goreWall = (axis: 'x' | 'z' = 'x', plane = 0, along = 0, y = 1.2, r = 0.6) => {
    stampWallGoreWebGPU(axis, plane, along, y, r, 0x8a1812, 0.9); return [axis, plane, along, y];
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
