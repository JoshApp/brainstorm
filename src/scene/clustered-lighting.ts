import { Lighting, Vector2 } from 'three/webgpu';
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

// Two DELVE adaptations over the stock addon, both in updateProgram (the
// only method that measures the render size):
//  1. GRID DOMAIN — the addon grids `renderer.getDrawingBufferSize()` (the
//     canvas), assuming render-to-canvas. Our scene pass renders into the
//     0.4× PSX target, and `screenCoordinate` there is PASS-LOCAL — a
//     canvas-sized grid would mis-cull everything toward one corner. Grid
//     the scene pass target instead (same fix our legacy tiled node carries).
//  2. NaN GUARD — the first updateProgram can run before any valid size
//     exists; the stock code bakes `2.0 / NX` into the culling compute's
//     WGSL, so a NaN width became a literal `NaN.0` in the shader and the
//     compute pipeline failed for the whole session (observed on first
//     integration). Skip invalid sizes; the grid builds on the first valid
//     frame and rebuilds on real size changes (fragment side reads the grid
//     via uniforms, so rebuilds are safe).
class DelveClusteredLightsNode extends (ClusteredLightsNode as any) {
  updateProgram(renderer: any): void {
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

  updateBefore(frame: any): void {
    // The stock updateBefore dispatches the culling compute unconditionally —
    // guard for the frames before the first valid grid exists.
    this.updateProgram(frame.renderer);
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
