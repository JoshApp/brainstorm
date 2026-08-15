import { Lighting, Vector2 } from 'three/webgpu';
import { Fn, screenCoordinate, positionView, float, int, log, clamp, uniform, frameGroup } from 'three/tsl';
// No DefinitelyTyped entry yet for the r185 lighting addons — runtime module is real.
// @ts-expect-error — untyped examples/jsm module
import ClusteredLightsNode from 'three/examples/jsm/tsl/lighting/ClusteredLightsNode.js';
import { sceneTargetSize } from '../style/render-webgpu';

// ── OFFICIAL Forward+ clustered lighting, DELVE-sized ────────────────────────
//
// Replaces the hand-rolled DelveTiledLighting as the default (2026-07-05).
// Three r185 ships ClusteredLightsNode as a maintained addon — the same
// architecture we built (point lights culled per screen region, shadow
// casters on the per-light material path, the toStack() ordering trick), but:
//   - 3D clusters (tiles × exponential DEPTH slices), not 2D tiles;
//   - the culling runs in a GPU COMPUTE pass, not a per-frame CPU loop;
//   - 16 lights per cluster (our 8-per-tile cap dropped 420 far-torch bins in
//     one spar frame — distant torches losing their cast in busy rooms);
//   - upstream-maintained: its getLights() already round-trips r185's
//     Lighting save/restore, the exact contract change that silently broke
//     our subclass this morning. Every release we DON'T maintain this is the
//     point.
//
// The legacy tiled node stays for the WebGL fallback (no compute there) and
// ?clustered=0 A/B — see create-renderer's lighting selection.
//
// Params: DELVE pools ≤~20 lights (LIGHT_SLOTS + lamp + specials) → 32 max;
// 32px tiles match the old grid; 12 depth slices span our ~13m far plane;
// 16 per cluster doubles the old cap. Buffers at the PSX target size come to
// a few tens of KB; the culling dispatch is a few hundred threads.

const MAX_LIGHTS = 32;
const TILE_SIZE = 32;
const Z_SLICES = 12;
const MAX_PER_CLUSTER = 16;

/* eslint-disable @typescript-eslint/no-explicit-any */

// THE DELVE ADAPTATION — a FIXED canonical grid, created once, never re-sized.
//
// The stock addon grids the drawing buffer and RE-CREATES the grid whenever
// the size changes. That re-create is poison for us, because `create()` bakes
// NX / NX*NY / NZ into the WGSL of `_screenClusterIndex` as LITERALS — and
// every lit material's fragment shader samples that node. Consequences we
// measured (compile-guard SHADER-VARIANT verdicts, 2026-07-05):
//   - the boot warm renders at 0.05× scale (WARM_RES_SCALE) → different (or
//     absent) grid → every warmed pipeline differs from live by the cluster
//     block → 10-24 IN-PLAY recompiles per descent, warm effectively dead;
//   - adaptive resolution / DPR / resize during play → grid re-create → new
//     literals → a MASS recompile of every lit material, mid-fight.
//
// Fix: the cluster grid does not need to match the render-target's pixels at
// all. The compute side already bins lights in NDC (resolution-independent),
// and the fragment side only needs "which screen REGION am I in" — so we
// create the grid ONCE at a canonical size and map fragments to tiles by
// normalizing the fragment coordinate against a live pass-size UNIFORM. The
// WGSL literals are then constants for the whole session: warm pipelines are
// byte-identical to live, and no resize can ever re-bake materials.
//
// (The original per-size version also carried a NaN guard — the first
// updateProgram could run before any valid size existed and bake `NaN.0`
// into the compute WGSL. Create-once at fixed dims makes that moot.)

// Canonical grid: 20×10 tiles × 12 depth slices (create() derives NX/NY from
// this size ÷ TILE_SIZE). Chosen to match the old live grid at 0.4× phone
// landscape (~605×280 px → 18×8) with a little headroom.
const CANON_W = 640;
const CANON_H = 320;

// ?fixedgrid=0 — kill switch back to the stock per-target-size grid (the
// behaviour before 2026-07-05). For A/B if the fixed grid is ever suspected
// in a lighting artefact or the flaky depth/output usage-scope storm (which
// pre-dates this change — it appears on the stock path too, just rarer in
// our samples; tracked separately).
const FIXED_GRID = typeof location === 'undefined'
  || new URLSearchParams(location.search).get('fixedgrid') !== '0';

class DelveClusteredLightsNode extends (ClusteredLightsNode as any) {
  private _delveGridReady = false;
  // Live scene-pass size in pixels — feeds the fragment tile mapping's
  // normalization uniform. Mutated in place each updateBefore.
  private readonly _delvePassSize = new Vector2(CANON_W, CANON_H);

  /** Create the canonical grid + swap the fragment→cluster mapping from the
   *  stock pixel-based one (only correct at exactly CANON_W×CANON_H) to a
   *  normalized live-size mapping. */
  private ensureFixedGrid(): void {
    if (this._delveGridReady) return;
    this.create(CANON_W, CANON_H);
    const NX = Math.floor(CANON_W / TILE_SIZE);
    const NY = Math.floor(CANON_H / TILE_SIZE);
    const NZ = this.zSlices as number;
    const near = this._cameraNear;
    const far = this._cameraFar;
    // The live pass size, as OUR OWN uniform (updated each updateBefore).
    // Deliberately NOT TSL's `screenUV`/`screenSize` singletons — those are
    // also baked into the post pass, and sharing node subtrees across passes
    // is a needless variable; `screenCoordinate` is exactly what the stock
    // node uses.
    // frameGroup — this is the FRAME's pass size, one number for every object.
    // A TSL uniform defaults to `objectGroup`, which is not shared: the value
    // is packed into EVERY render object's own uniform buffer, so mutating it
    // each updateBefore re-uploads every LIT OBJECT IN THE SCENE, every frame.
    // Clustered is the default WebGPU lighting path, so that is nearly the whole
    // visible world. Same bug, same fix as the seep clock in
    // style/surface-detail.ts — see that file for the phone measurement that
    // found the pattern.
    const passSize = (uniform as any)(this._delvePassSize).setGroup(frameGroup);
    const index = (Fn as any)(() => {
      // Normalize the builtin fragment coordinate by the live pass size —
      // resolution-agnostic (y=0 at the top, matching the compute's cy=0 =
      // top row convention).
      const u = (screenCoordinate as any).x.div(passSize.x);
      const v = (screenCoordinate as any).y.div(passSize.y);
      const tx = (clamp as any)(u.mul(NX).floor(), 0, NX - 1);
      const ty = (clamp as any)(v.mul(NY).floor(), 0, NY - 1);
      // Exponential Z slice — same math as the stock node, same uniforms.
      const viewDepth = (positionView as any).z.negate();
      const invLogFarOverNear = (float as any)(1).div((log as any)(far.div(near)));
      const sliceFloat = (log as any)(viewDepth.div(near)).mul(invLogFarOverNear).mul((float as any)(NZ));
      const zSlice = (clamp as any)(sliceFloat.floor(), (float as any)(0), (float as any)(NZ - 1));
      return (int as any)(tx)
        .add((int as any)(ty).mul((int as any)(NX)))
        .add((int as any)(zSlice).mul((int as any)(NX * NY)));
    });
    this._screenClusterIndex = index().toVar();
    this._delveGridReady = true;
  }

  /** The pre-fixed-grid behaviour (?fixedgrid=0): grid the scene-pass target,
   *  re-creating on size change; NaN-guarded (an invalid first size used to
   *  bake `NaN.0` into the culling compute's WGSL). */
  private updateSizedGrid(renderer: any): void {
    const st = sceneTargetSize();
    let w: number, h: number;
    if (st) { w = st.w; h = st.h; }
    else {
      renderer.getDrawingBufferSize(_size2);
      w = _size2.x; h = _size2.y;
    }
    if (!Number.isFinite(w) || !Number.isFinite(h) || w < TILE_SIZE || h < TILE_SIZE) return;
    const width = this.getBufferFitSize(w);
    const height = this.getBufferFitSize(h);
    if (!this._bufferSize || this._bufferSize.width !== width || this._bufferSize.height !== height) {
      this.create(width, height);
    }
  }

  updateProgram(renderer: any): void {
    if (FIXED_GRID) this.ensureFixedGrid();
    else this.updateSizedGrid(renderer);
  }

  updateBefore(frame: any): void {
    this.updateProgram(frame.renderer);
    if (FIXED_GRID) {
      // Track the live pass size (the PSX scene target; falls back to the
      // drawing buffer pre-pipeline). Grid + WGSL never change — only this
      // normalization uniform does.
      const st = sceneTargetSize();
      if (st) this._delvePassSize.set(st.w, st.h);
      else frame.renderer?.getDrawingBufferSize?.(this._delvePassSize);
    }
    if (!this._compute) return;
    super.updateBefore(frame);
  }
}

const _size2 = new Vector2();

/** Drop-in for the renderer's `.lighting`. */
export class DelveClusteredLighting extends (Lighting as any) {
  createNode(lights: any[] = []): any {
    return new (DelveClusteredLightsNode as any)(MAX_LIGHTS, TILE_SIZE, Z_SLICES, MAX_PER_CLUSTER).setLights(lights);
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
