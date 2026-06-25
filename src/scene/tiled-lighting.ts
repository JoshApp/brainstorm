import { Lighting, LightsNode } from 'three/webgpu';
import { nodeProxy } from 'three/tsl';
import TiledLightsNode from 'three/examples/jsm/tsl/lighting/TiledLightsNode.js';

// Tiled (Forward+) lighting, adapted to DELVE's custom PSX RenderPipeline.
//
// Three's stock TiledLightsNode assumes the default renderer.render() drives its
// lifecycle: setupLights() (which builds the binning compute via create()) runs
// before any material asks for the node's cache key. Our pipeline renders the
// scene through a pass() node and requests customCacheKey() at material-compile
// time — BEFORE create() has run — so the stock node dereferences a null
// `_compute` and every material fails to compile (black screen).
//
// Fix: a null-safe customCacheKey. The compute's real key folds in once create()
// has run (first frame); until then we return a stable placeholder so materials
// compile. setupLights() itself calls updateProgram()→create(), so by the time
// the light loop is actually built the compute exists.

/* eslint-disable @typescript-eslint/no-explicit-any */
class SafeTiledLightsNode extends (TiledLightsNode as any) {
  customCacheKey(): any {
    const computeKey = this._compute ? this._compute.getCacheKey() : 0;
    return computeKey + (LightsNode as any).prototype.customCacheKey.call(this);
  }
}

const safeTiledLights = (nodeProxy as any)(SafeTiledLightsNode);

/** Drop-in for the renderer's `.lighting`. `renderer.lighting = new DelveTiledLighting()`. */
export class DelveTiledLighting extends (Lighting as any) {
  createNode(lights: any[] = []): any {
    return safeTiledLights().setLights(lights);
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
