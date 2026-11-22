// BAKED TORCHLIGHT — static lights lit through baked wall visibility.
//
// Opt-in (?bake=1) while it is judged on a phone against live lights. Off, no
// shader changes and nothing below runs.
//
// What it replaces: every static environment light (torch, sconce, brazier,
// candle stack, room fill) used to compete for a live PointLight slot, and each
// bound slot was evaluated by every lit fragment through the clustered / tiled
// light loop. Live lights also pass straight through walls (the director only
// dimmed one with no line of sight).
//
// What it does instead:
//   1. When a floor is built, scene/light-bake.ts bakes where each static
//      light can reach — a top-down visibility texture over the floor, four
//      CHANNELS wide — and which light owns each channel there.
//   2. Every frame the light director (scene/light-pool.ts) still decides each
//      baked light's LIVE intensity exactly as before — flicker, room-mood
//      tint, arena boost, the gate fade, the torch-strength setting, the flame
//      wobble — and writes it here instead of into a PointLight slot.
//   3. Every lit material, in its lighting model's indirect() stage, samples
//      the two textures at the fragment and runs three's own point-light math
//      (directPointLight → the material's direct()) for each channel: identical
//      falloff, banding and specular to a live light, times the baked
//      visibility.
//
// Lights the bake can't fit in a channel stay ordinary live lights. Lights
// registered after the bake (a boss bonfire, a revealed chest) are live too.
//
// The per-light data rides frame-group UNIFORM ARRAYS, not a DataTexture: that
// is the path scene/tiled-lighting.ts found builds and binds correctly through
// every compile path including the boot warm. The two baked textures are
// swapped per floor by replacing the texture node's value.

import * as THREE from 'three';
import { PhysicalLightingModel } from 'three/webgpu';
import {
  Fn, If, int, float, vec4, texture, uniform, uniformArray, frameGroup,
  positionWorld, positionView, normalWorld, cameraViewMatrix, directPointLight,
} from 'three/tsl';
import { bakeLightVisibility, type LightBake, type BakeLight, type BakeWall } from './light-bake';
import { forEachLight, setBakedLightWriter, getEnvRangeMul } from './light-pool';
import { disposeGpu } from './gpu-dispose';

/** Live array capacity: the most static lights one floor may bake. A floor
 *  with more keeps the rest live (as for lights the channels can't fit).
 *  Sized to real floors (19-31 static lights, depths 1-12): the array is a
 *  uniform BUFFER three re-uploads every time a pass binds it (CLAUDE.md, TSL
 *  uniforms) — at 96 slots × two arrays a phone recording paid ~20 KB and ~17
 *  extra uploads a frame for it (2026-11-22). */
export const BAKE_MAX_SLOTS = 32;
const CHANNELS = 4;

let requested: boolean | null = null;
/** ?bake=1 turns the bake on. Read once: it changes every lit shader, so it is
 *  decided before the first material compiles and never flips mid-run. */
export function lightBakeEnabled(): boolean {
  if (requested === null) {
    try {
      requested = typeof location !== 'undefined'
        && new URLSearchParams(location.search).get('bake') === '1';
    } catch { requested = false; }
  }
  return requested;
}

// ── GPU state (created on first use) ────────────────────────────────────────

function blankTexture(filter: THREE.MagnificationTextureFilter): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.magFilter = filter;
  t.minFilter = filter;
  t.generateMipmaps = false;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
let visTex: THREE.DataTexture | null = null;
let idTex: THREE.DataTexture | null = null;
let visNode: any = null;
let idNode: any = null;
// Grid mapping — one value for the whole frame (frameGroup: one upload, not
// one per drawn object; see CLAUDE.md "TSL uniforms default to PER-OBJECT").
const uOrigin = (uniform as any)(new THREE.Vector2(0, 0)).setGroup(frameGroup);
const uInvSize = (uniform as any)(new THREE.Vector2(1, 1)).setGroup(frameGroup);
const uHalfCell = (uniform as any)(0.125).setGroup(frameGroup);
// Per baked light, interleaved in ONE array (one buffer, one upload per bind):
// [2i] = (x, y, z, cutoff), [2i+1] = (r·I, g·I, b·I, decay). World space; the
// shader moves the position into view space itself, so the values never depend
// on when in the frame the camera pose was read.
const lightData: THREE.Vector4[] = Array.from({ length: BAKE_MAX_SLOTS * 2 }, () => new THREE.Vector4());
const pos = (i: number): THREE.Vector4 => lightData[i * 2];
const col = (i: number): THREE.Vector4 => lightData[i * 2 + 1];
const lightArr = (uniformArray as any)(lightData, 'vec4').setGroup(frameGroup);

function ensureTextures(): void {
  if (visTex) return;
  visTex = blankTexture(THREE.LinearFilter);
  idTex = blankTexture(THREE.NearestFilter);
  visNode = (texture as any)(visTex);
  idNode = (texture as any)(idTex);
}

// ── The shader hook ─────────────────────────────────────────────────────────

let installed = false;
/** Patch every PhysicalLightingModel (the stock one and DELVE's banded / lean /
 *  stone subclasses) so its indirect() stage first lights the fragment with the
 *  baked lights. Call once at boot, before any material compiles. No-op unless
 *  ?bake=1. */
export function installBakedLighting(): void {
  if (installed || !lightBakeEnabled()) return;
  installed = true;
  ensureTextures();
  const proto = (PhysicalLightingModel as any).prototype;
  const origIndirect = proto.indirect;
  proto.indirect = function (this: any, builder: any) {
    const reflectedLight = builder.context.reflectedLight;
    (Fn as any)(() => {
      // Sample half a texel off the surface along its normal, so a wall face
      // reads the texel on ITS side of the wall line, not a mix with the rock.
      const p: any = (positionWorld as any).xz.add((normalWorld as any).xz.mul(uHalfCell));
      const uv: any = p.sub(uOrigin).mul(uInvSize);
      const vis: any = visNode.sample(uv).toVar();
      const ids: any = idNode.sample(uv).toVar();
      // Fixed component accessors, unrolled — dynamic vector indexing on
      // sampled values is unreliable through the WGSL lowering (tiled-lighting.ts).
      for (const comp of ['x', 'y', 'z', 'w'] as const) {
        const slot: any = (int as any)(ids[comp].mul(255).add(0.5)).toVar();
        (If as any)(slot.greaterThan((int as any)(0)), () => {
          const i: any = slot.sub((int as any)(1)).mul((int as any)(2));
          const P: any = lightArr.element(i);
          const C: any = lightArr.element(i.add((int as any)(1)));
          const lightPosView: any = (cameraViewMatrix as any).mul((vec4 as any)(P.xyz, (float as any)(1))).xyz;
          const { lightDirection, lightColor } = (directPointLight as any)({
            color: C.rgb.mul(vis[comp]),
            lightVector: lightPosView.sub(positionView),
            cutoffDistance: P.w,
            decayExponent: C.w,
          });
          this.direct({ lightDirection, lightColor, reflectedLight }, builder);
        });
      }
    }, 'void')();
    return origIndirect.call(this, builder);
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ── Per floor ───────────────────────────────────────────────────────────────

let current: LightBake | null = null;
/** DEV: scales every baked light (0 = baked lights off) to prove what they carry. */
let devScale = 1;

/** Bake the floor that was just built: every static environment light
 *  registered so far, against the floor's walls. Uploads the textures and
 *  points the light director at the baked set. No-op unless ?bake=1. */
export function bakeFloorLights(walls: readonly BakeWall[]): LightBake | null {
  if (!lightBakeEnabled()) return null;
  ensureTextures();
  const lights: BakeLight[] = [];
  forEachLight('environment', (s) => {
    lights.push({
      id: s.id, x: s.position.x, z: s.position.z, range: s.distance,
      // Flicker peaks ~1.2× base: size the reach for the brightest it gets.
      intensity: s.intensity * 1.2, decay: s.decay,
    });
  });
  const bake = bakeLightVisibility(lights, walls, {
    channels: CHANNELS, maxSlots: BAKE_MAX_SLOTS, rangeMul: getEnvRangeMul(),
  });
  current = bake;

  const oldVis = visTex, oldIds = idTex;
  visTex = new THREE.DataTexture(bake.vis, bake.w, bake.h, THREE.RGBAFormat, THREE.UnsignedByteType);
  idTex = new THREE.DataTexture(bake.ids, bake.w, bake.h, THREE.RGBAFormat, THREE.UnsignedByteType);
  for (const [t, f] of [[visTex, THREE.LinearFilter], [idTex, THREE.NearestFilter]] as const) {
    t.magFilter = f; t.minFilter = f; t.generateMipmaps = false;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.colorSpace = THREE.NoColorSpace;
    t.needsUpdate = true;
  }
  visNode.value = visTex;
  idNode.value = idTex;
  // The old pair may still be read by a frame in flight (WebGPU renders
  // fire-and-forget): free it once the queue drains.
  disposeGpu(oldVis, oldIds);

  uOrigin.value.set(bake.originX, bake.originZ);
  uInvSize.value.set(1 / (bake.w * bake.cell), 1 / (bake.h * bake.cell));
  uHalfCell.value = bake.cell * 0.5;
  for (let i = 0; i < BAKE_MAX_SLOTS; i++) { pos(i).set(0, -1000, 0, 1); col(i).set(0, 0, 0, 2); }

  const slots = bake.slotOf.size;
  setBakedLightWriter({
    begin: () => { for (let i = 0; i < slots; i++) { const c = col(i); c.set(0, 0, 0, c.w); } },
    has: (id) => bake.slotOf.has(id),
    write: (id, x, y, z, cutoff, r, g, b, decay) => {
      const s = bake.slotOf.get(id);
      if (s === undefined) return;
      pos(s - 1).set(x, y, z, cutoff);
      col(s - 1).set(r * devScale, g * devScale, b * devScale, decay);
    },
  });
  return bake;
}

/** The current floor's bake (diagnostics). */
export function currentLightBake(): LightBake | null { return current; }

// DEV: `__lightBake()` in the console — what this floor baked, and the live
// values the director wrote this frame for the first few slots.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __lightBakeScale?: (v: number) => void }).__lightBakeScale = (v) => { devScale = v; };
  (window as unknown as { __lightBake?: () => unknown }).__lightBake = () => current && {
    ...current.stats, live: current.live,
    grid: `${current.w}x${current.h} @ ${current.cell}m`,
    slots: [...current.slotOf.entries()].slice(0, 6).map(([id, s]) => ({
      id, ch: current!.channelOf.get(id), pos: pos(s - 1).toArray().map((v) => +v.toFixed(2)),
      col: col(s - 1).toArray().map((v) => +v.toFixed(2)),
    })),
  };
}
