import * as THREE from 'three';
import { markGoreThrow, markGoreProbe, markGoreWall, markGoreStamp } from '../debug/gore-debug';
import { stampGoreWebGPU, stampWallGoreWebGPU, resetGoreWebGPU } from './gore-webgpu';

// ── GORE EMITTER — the floor remembers its violence ──────────────────
//
// The gameplay-facing gore API: every landed hit calls emitGoreSplash /
// stampSpray / stampBleedOut here, and the stamps land in the WebGPU
// per-fragment gore buffer (scene/gore-webgpu.ts), which the lighting
// model composites into floors and walls.
//
// HISTORY: this file used to own a WebGL render-target splat map (three
// RTs + GLSL stamp/dry ShaderMaterials rendered by flushSplats). The
// WebGPU port replaced that with the per-fragment gore buffer; the dead
// RT/ShaderMaterial machinery is gone. The uSplat* uniform refs remain
// exported (inert, always null/0) because surface-detail/build-model
// still import them; drop those imports and these refs together.
//
//   resetSplatMap(minX,minZ,w,d)      per floor (builder)
//   stampSplat(x, z, r, color, a)     stamp floor blood (any gameplay code)
//   flushSplats(renderer)             render tick drains timed bleed pulses

// Inert compat refs (see HISTORY above) — nothing writes them anymore.
export const uSplatTex = { value: null as THREE.Texture | null };
export const uSplatBounds = { value: new THREE.Vector4(0, 0, 1, 1) };  // minX, minZ, sizeX, sizeZ
export const uSplatOn = { value: 0 };
export const uSplatWallTex = { value: null as THREE.Texture | null };
export const uSplatWallIdTex = { value: null as THREE.Texture | null };

/** Wall probe — registered by main per floor. Given a point + throw
 *  direction, returns the first axis-aligned wall within reach. */
export type WallHit = { axis: 'x' | 'z'; plane: number; along: number };
let wallProbe: ((x: number, z: number, dx: number, dz: number) => WallHit | null) | null = null;
export function setSplatWallProbe(fn: typeof wallProbe): void {
  wallProbe = fn;
}

/** New floor: wipe the gore buffer and drop stale per-floor state. */
export function resetSplatMap(minX: number, minZ: number, sizeX: number, sizeZ: number): void {
  uSplatBounds.value.set(minX, minZ, Math.max(1, sizeX), Math.max(1, sizeZ));
  pendingBleeds.length = 0;   // a corpse can't bleed onto the floor below
  resetGoreWebGPU();          // wipe the WebGPU gore buffer
  wallProbe = null;   // stale probes reference the dead floor's walkable
}

/** Queue a splat. x/z world; radius metres; alpha = wetness added. */
export function stampSplat(
  x: number, z: number, radius: number, colorHex: number, alpha = 0.8,
  _dir?: { x: number; z: number } | null,
): void {
  // Feed the per-fragment gore buffer (scene/gore-webgpu.ts). emitGoreSplash /
  // stampSpray route through here, so this one hook covers all floor blood.
  stampGoreWebGPU(x, z, radius, colorHex, alpha);
}

/** THE GORE EMITTER — pseudo-physics splash from a weapon impact.
 *  The blow lands at (x, z, y) travelling (dirX, dirZ); blood bursts
 *  from that point OUTWARD, biased along the swing: a puddle at the
 *  body, a fingered streak down-throw, droplets beyond — and if the
 *  splash reaches a wall within its energy's range, the wall takes a
 *  dripping splotch scaled by the energy left when it got there.
 *  Every landed hit calls this; energy scales everything (a chip hit
 *  speckles, a heavy drenches, a kill detonates). */
export function emitGoreSplash(
  x: number, z: number, y: number,
  dirX: number, dirZ: number,
  energy: number, colorHex: number,
  opts?: { wallFallbackCardinals?: boolean; sizeMul?: number },
): void {
  const e = Math.max(0, Math.min(1.6, energy));
  if (e < 0.05) return;
  const len = Math.hypot(dirX, dirZ) || 1;
  const dx = dirX / len, dz = dirZ / len;
  if (import.meta.env.DEV) markGoreThrow(x, z, y, dx, dz, e);
  // Floor: puddle + streak + droplets, all energy-scaled and biased
  // INTO the throw — the spill belongs on the kill side, not at the
  // killer's feet.
  const r = (0.22 + 0.38 * e) * (opts?.sizeMul ?? 1);
  const px2 = x + dx * r * 0.4, pz2 = z + dz * r * 0.4;
  const sx2 = x + dx * r * 1.25, sz2 = z + dz * r * 1.25;
  if (import.meta.env.DEV) { markGoreStamp(px2, pz2, r * 0.75); markGoreStamp(sx2, sz2, r); }
  stampSplat(px2, pz2, r * 0.75, colorHex, 0.35 + 0.4 * e);
  stampSplat(sx2, sz2, r, colorHex, (0.3 + 0.4 * e), { x: dx, z: dz });
  const sats = Math.round(e * 2.2);
  for (let i = 0; i < sats; i++) {
    const t = 1.1 + Math.random() * 1.3;
    const side = (Math.random() - 0.5) * 0.7;
    stampSplat(
      x + (dx * t - dz * side) * r * 1.7,
      z + (dz * t + dx * side) * r * 1.7,
      r * (0.18 + Math.random() * 0.2),
      colorHex, 0.3 + 0.4 * e,
    );
  }
  // Wall: the splash carries ~1m per unit energy; whatever it reaches
  // gets painted, weaker with distance. Normal swings included.
  const reach = 0.6 + e * 0.9;
  // Blood sprays in a CONE, so the wall probe does too: straight down
  // the throw, then ±40° off it. A single ray missed every wall the
  // splash direction ran parallel to — which after the blade-travel
  // change was MOST walls (slashes throw sideways).
  let hit: WallHit | null = null;
  for (const off of [0, 0.7, -0.7]) {
    const c = Math.cos(off), sn = Math.sin(off);
    const pdx = dx * c - dz * sn, pdz = dz * c + dx * sn;
    hit = wallProbe?.(x, z, pdx, pdz) ?? null;
    if (import.meta.env.DEV) markGoreProbe(x, z, y, pdx, pdz, 1.35, !!hit);
    if (hit) break;
  }
  if (!hit && opts?.wallFallbackCardinals) {
    for (const [cx, cz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      hit = wallProbe?.(x, z, cx, cz) ?? null;
      if (hit) break;
    }
  }
  if (hit) {
    const dWall = Math.abs(hit.axis === 'x' ? hit.plane - x : hit.plane - z);
    if (dWall <= reach) {
      const k = 1 - (dWall / reach) * 0.6;
      if (import.meta.env.DEV) markGoreWall(hit, y, (0.3 + 0.55 * e) * k);
      stampWallArcAt(hit, y, colorHex, (0.35 + 0.5 * e) * k, (0.3 + 0.55 * e) * k);
    }
  }
}

/** Throw an arc onto the nearest wall along the throw direction
 *  (deaths + crits). Uses the per-floor wall probe; silently does
 *  nothing in open space. */
export function stampWallArc(
  x: number, z: number, y: number, dirX: number, dirZ: number,
  colorHex: number, alpha = 0.8, size = 0.55,
): void {
  if (!wallProbe) return;
  const len = Math.hypot(dirX, dirZ) || 1;
  let hit = wallProbe(x, z, dirX / len, dirZ / len);
  if (!hit) {
    for (const [cx, cz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      hit = wallProbe(x, z, cx, cz);
      if (hit) break;
    }
  }
  if (!hit) return;
  stampWallArcAt(hit, y, colorHex, alpha, size);
}

function stampWallArcAt(hit: WallHit, y: number, colorHex: number, alpha: number, size: number): void {
  // Feed the per-fragment wall-arc buffer (scene/gore-webgpu.ts).
  stampWallGoreWebGPU(hit.axis, hit.plane, hit.along, y, size, colorHex, alpha);
}

/** Directional spray: a stretched streak stamp plus satellite droplets
 *  thrown further along the direction. The shape every hit should
 *  make — blood travels AWAY from the blow. */
export function stampSpray(
  x: number, z: number, radius: number, colorHex: number, alpha: number,
  dirX: number, dirZ: number,
): void {
  const len = Math.hypot(dirX, dirZ) || 1;
  const dx = dirX / len, dz = dirZ / len;
  // Puddle AT the mob; the streak's heavy end sits on it and the
  // fingers reach outward along the throw.
  stampSplat(x, z, radius * 0.7, colorHex, alpha);
  stampSplat(x + dx * radius * 0.9, z + dz * radius * 0.9, radius, colorHex, alpha * 0.9, { x: dx, z: dz });
  const sats = 1 + Math.floor(Math.random() * 2);
  for (let i = 0; i < sats; i++) {
    const t = 1.1 + Math.random() * 1.2;
    const side = (Math.random() - 0.5) * 0.6;
    stampSplat(
      x + (dx * t - dz * side) * radius * 1.6,
      z + (dz * t + dx * side) * radius * 1.6,
      radius * (0.2 + Math.random() * 0.22),
      colorHex,
      alpha * 0.8,
    );
  }
}

// ── Bleed-out scheduler ───────────────────────────────────────────────
// A death doesn't detonate a finished pool — the corpse BLEEDS OUT: a
// few pool stamps spread over ~1.6s, each wider than the last, so the
// stain visibly grows under the body while it dissolves. Pulses are
// drained in flushSplats (called every frame by the render system).
interface BleedPulse { at: number; x: number; z: number; r: number; color: number; a: number }
const pendingBleeds: BleedPulse[] = [];

export function stampBleedOut(x: number, z: number, color: number, gore: number): void {
  const now = performance.now() / 1000;
  const pulses = 5;
  for (let i = 0; i < pulses; i++) {
    pendingBleeds.push({
      at: now + 0.15 + i * 0.34,
      x: x + (Math.random() - 0.5) * 0.14,
      z: z + (Math.random() - 0.5) * 0.14,
      r: (0.28 + i * 0.13 + Math.random() * 0.06) * gore,
      color,
      a: (i === 0 ? 0.5 : 0.34) * Math.min(1, gore),
    });
  }
}

/** Drain due bleed-out pulses into the gore buffer. Called every frame
 *  from the render system; free when nothing is bleeding. */
export function flushSplats(_renderer: THREE.WebGLRenderer): void {
  if (pendingBleeds.length === 0) return;
  const now = performance.now() / 1000;
  for (let i = pendingBleeds.length - 1; i >= 0; i--) {
    const p = pendingBleeds[i];
    if (now < p.at) continue;
    stampGoreWebGPU(p.x, p.z, p.r, p.color, p.a);
    pendingBleeds.splice(i, 1);
  }
}
