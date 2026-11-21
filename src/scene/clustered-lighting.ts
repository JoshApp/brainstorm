// Typed since @types/three r187 (it was an untyped examples/jsm module on r185).
import { ClusteredLighting } from 'three/examples/jsm/lighting/ClusteredLighting.js';

// ── OFFICIAL Forward+ clustered lighting, DELVE-sized ────────────────────────
//
// three's maintained ClusteredLighting addon: point lights culled into 3D
// clusters (screen tiles × exponential depth slices) by a GPU compute pass,
// shadow casters (the lamp) left on the per-light material path. It replaced
// our hand-rolled DelveTiledLighting as the WebGPU default on 2026-07-05.
//
// ── WHY THERE IS NO SUBCLASS ANY MORE (2026-11-21, three r187) ──────────────
//
// On r185/r186 this file carried a ~100-line DelveClusteredLightsNode. The
// stock node baked the cluster grid's NX / NX*NY / NZ into the WGSL as
// literals and re-created the grid whenever the render size changed, so the
// warm (rendered at WARM_RES_SCALE) produced different shaders than live play
// and every adaptive-resolution step mass-recompiled every lit material. Our
// subclass created the grid once at a canonical size and mapped fragments
// through a pass-size uniform instead.
//
// r187 fixed this upstream: "grid dimensions as uniforms: shaders do not
// depend on the drawing buffer size" (ClusteredLightsNode._create), with the
// grid refitted to the current render target at the start of each render
// (ClusteredLighting.beginRender → node.updateSize) and rebuilt only when its
// storage must grow. The same release renamed every internal our subclass
// overrode (updateProgram → _initGrid/_fitToRenderer, create(w,h) →
// _create(clusterCount)), so the subclass threw inside updateBefore and the
// whole scene rendered black — found by bisecting three to #34930. Using the
// stock class gets the fix and removes the surface that broke.
//
// r187 also gives the node spot lights and a WebGL2 path (#34978), which is
// what could one day retire DelveTiledLighting on the WebGL2 backend.
//
// Params: DELVE pools ≤~20 lights (LIGHT_SLOTS + lamp + specials) → 32 max;
// 32px tiles; 12 depth slices span our ~13m far plane; 16 per cluster (our old
// 8-per-tile cap dropped far torches in busy rooms).

const MAX_LIGHTS = 32;
const TILE_SIZE = 32;
const Z_SLICES = 12;
const MAX_PER_CLUSTER = 16;

/** Drop-in for the renderer's `.lighting`. */
export class DelveClusteredLighting extends ClusteredLighting {
  constructor() {
    super(MAX_LIGHTS, TILE_SIZE, Z_SLICES, MAX_PER_CLUSTER);
  }
}
