import { Vector3, Vector4, LightsNode, NodeUpdateType, Lighting } from 'three/webgpu';
import { nodeProxy, int, float, Loop, If, Break, positionView, Fn, uniform, uniformArray, directPointLight } from 'three/tsl';

// Custom LightsNode — the "lean lights" parity experiment (?leanlights=1).
//
// Three's default node lighting emits ONE PointLightNode PER light: with DELVE's
// ~13 pooled point lights that's 13 UNROLLED straight-line blocks in the fragment
// shader, each with its own light vector + attenuation. Unrolling that many lights
// is heavy on REGISTER PRESSURE, and high register pressure can drop GPU occupancy
// (fewer warps in flight) — which on a mobile/tiled GPU shows up as throughput loss
// (lean-Lambert WebGPU still slower than full-PBR WebGL: the BRDF wasn't the cost,
// the per-light scaffolding × 13 was).
//
// This node evaluates all the pooled lights in ONE ROLLED Loop over a small UNIFORM
// ARRAY instead. Trades a little loop overhead for far lower register pressure (the
// loop body's temporaries are reused every iteration → higher occupancy). The light
// data is a uniform array (NOT a DataTexture — at this light count, per-light
// texture fetches cost more than uniform reads; texture-backed is only worth it at
// the thousands-of-lights scale TiledLightsNode targets). Attenuation is the STOCK
// `directPointLight` — identical math, so the LOOK is byte-identical; the ONLY
// change vs the default is unrolled-N → rolled-loop. It also never recompiles when
// the torch count changes (the loop is bounded by a constant, gated by a uniform
// count).
//
// Like the tiled node, the player's lamp (userData.noTile) stays on the normal
// material path so it keeps its shadow + standard attenuation; the many torches /
// candles / pickups go through the lean loop.

const MAX_LEAN_LIGHTS = 64;
const _v = /*@__PURE__*/ new Vector3();

/* eslint-disable @typescript-eslint/no-explicit-any */
class LeanLightsNode extends (LightsNode as any) {
  leanLights: any[];
  materialLights: any[];
  _count: any;
  _pos: Vector4[];   // xyz = view-space position, w = cutoff distance
  _col: Vector4[];   // rgb = color * intensity, w = decay exponent
  _posArr: any;
  _colArr: any;

  constructor() {
    super();
    this.leanLights = [];
    this.materialLights = [];
    this._count = (uniform as any)(0, 'int');
    this._pos = Array.from({ length: MAX_LEAN_LIGHTS }, () => new Vector4());
    this._col = Array.from({ length: MAX_LEAN_LIGHTS }, () => new Vector4());
    this._posArr = (uniformArray as any)(this._pos, 'vec4');
    this._colArr = (uniformArray as any)(this._col, 'vec4');
    this.updateBeforeType = (NodeUpdateType as any).RENDER;
  }

  // Split: point lights (minus the lamp) go lean; everything else (the lamp with
  // its shadow, ambient, etc.) stays on the normal node path via super.setLights.
  setLights(lights: any[]): any {
    const lean = this.leanLights, mat = this.materialLights;
    let li = 0, mi = 0;
    for (const light of lights) {
      if (light.isPointLight === true && !(light.userData && light.userData.noTile)) {
        if (li < MAX_LEAN_LIGHTS) lean[li++] = light;
      } else {
        mat[mi++] = light;
      }
    }
    lean.length = li;
    mat.length = mi;
    return super.setLights(mat);
  }

  // Repack the live light data each frame into the uniform arrays (view-space
  // position follows the parked/bound pool slots + camera; intensity follows torch
  // flicker). View-space computed CPU-side so the shader does no per-light matrix
  // mul — matching the default path, so the comparison isolates the loop structure.
  updateBefore(frame: any): void {
    const camera = frame.camera;
    // Pack only LIVE torches — skip parked pool slots (intensity 0) entirely so the
    // rolled loop iterates the active count, not the full 13-slot pool. The pool keeps
    // dead slots resident to avoid shader recompiles on torch-count change; here they
    // cost nothing (not packed, not iterated). The per-fragment distance cull then
    // handles active-but-out-of-range torches on top of this.
    let k = 0;
    const src = this.leanLights, n = src.length;
    for (let i = 0; i < n; i++) {
      const light = src[i];
      const I = light.intensity;
      if (I <= 0.0001) continue;   // parked slot — don't pack it
      _v.setFromMatrixPosition(light.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
      this._pos[k].set(_v.x, _v.y, _v.z, light.distance);
      this._col[k].set(light.color.r * I, light.color.g * I, light.color.b * I, light.decay);
      k++;
    }
    this._count.value = k;
  }

  setupLights(builder: any, lightNodes: any): void {
    // Force the accumulators to declare before the loop (matches TiledLightsNode).
    const rl = builder.context.reflectedLight;
    rl.directDiffuse.toStack();
    rl.directSpecular.toStack();

    // Material lights (the lamp + its shadow) keep the normal unrolled node path.
    super.setupLights(builder, lightNodes);

    // The lean torches: one rolled loop over the uniform arrays. Bound by the
    // constant MAX so it stays a real WGSL for-loop (not unrolled); the uniform
    // count breaks early at the live torch count.
    (Fn as any)(() => {
      (Loop as any)(MAX_LEAN_LIGHTS, ({ i }: any) => {
        (If as any)((int as any)(i).greaterThanEqual(this._count), () => { (Break as any)(); });
        const p = this._posArr.element(i);
        const c = this._colArr.element(i);
        const lv = p.xyz.sub(positionView);
        const cutoff = p.w;
        // IN-SHADER LIGHT CULLING — skip lights that contribute EXACTLY zero to this
        // fragment: Three's distance attenuation reaches 0 at/beyond cutoffDistance,
        // so evaluating a light farther than its range is wasted work with no visual
        // effect. This skips both the parked pool slots (positioned far away) AND
        // out-of-range torches, per fragment — so each pixel only pays for the torches
        // actually reaching it. Byte-identical look; the win is that the 13-slot pool
        // no longer costs 13 BRDFs everywhere. (cutoff<=0 = infinite range → never cull.)
        const cull2 = (cutoff.lessThanEqual(0) as any).select((float as any)(1e12), cutoff.mul(cutoff));
        (If as any)((lv.dot(lv) as any).lessThan(cull2), () => {
          // Stock directPointLight → identical attenuation/look; only the iteration
          // structure differs from the default per-light-node path.
          builder.lightsNode.setupDirectLight(builder, this, (directPointLight as any)({
            color: c.rgb,
            lightVector: lv,
            cutoffDistance: cutoff,
            decayExponent: c.w,
          }));
        });
      });
    }, 'void')();
  }

  get hasLights(): boolean {
    return (super.hasLights as boolean) || this.leanLights.length > 0;
  }
}

const leanLightsNode = (nodeProxy as any)(LeanLightsNode);

/** Drop-in for the renderer's `.lighting`. `renderer.lighting = new DelveLeanLighting()`. */
export class DelveLeanLighting extends (Lighting as any) {
  createNode(lights: any[] = []): any {
    return leanLightsNode().setLights(lights);
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
