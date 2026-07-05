import { Vector2, Vector3, Vector4, Lighting, LightsNode, NodeUpdateType } from 'three/webgpu';
import {
  nodeProxy, int, uniform, uniformArray, positionView,
  Fn, If, screenCoordinate, directPointLight,
} from 'three/tsl';

// Tiled (Forward+-lite) lighting for DELVE's custom PSX RenderPipeline —
// CPU-BINNED, uniform-array-backed. A rewrite of the earlier compute-shader
// approach after three hard lessons from the bench (?scenario=perf-lights):
//
//   1. Three's stock TiledLightsNode over-dispatches its binning compute 32×
//      (width*height/tileSize invocations for width*height/tileSize² tiles)
//      and sizes its grid off the CANVAS while our scene renders into the
//      0.4× pass — wrong tiles, wasted compute.
//   2. Pipelines compiled through the boot warm (compileAsync) bound the
//      binning compute's STORAGE buffer before its first dispatch — the bind
//      groups referenced a stale buffer and read ZEROS forever (world dark,
//      only runtime-compiled materials lit). DataTexture light data silently
//      failed the same way. UNIFORM ARRAYS are the one data path proven to
//      build + bind correctly through every compile path (lean-lights runs
//      on them) — so tiles live in uniforms now.
//   3. A compute pass can never run on the WebGL2 fallback backend anyway;
//      CPU binning works identically on both backends.
//
// HOW IT WORKS: updateBefore packs live lights into view-space uniform arrays
// (exactly like lean-lights), then bins them on the CPU: each light's screen-
// projected circle marks the pass-pixel tiles it can reach; each tile stores
// up to 8 light indices in a uniform vec4 pair. The fragment reads its tile's
// slots and runs the stock directPointLight math on just those lights. The
// per-fragment win over the lean rolled loop: fragments pay only for lights
// whose projected footprint overlaps their tile, instead of range-testing
// every live light.
//
// The tile grid adapts to the ACTIVE render target (the PSX pass) each frame;
// grid dims are uniforms, so resolution changes never recompile materials.
// CPU cost: ~lights × coveredTiles rect fills, ≈0.05ms at 30 lights.
//
// Light routing matches lean-lights: the lamp (userData.noTile) and any
// SHADOW-CASTING light stay on the material path (the tiled loop samples no
// shadow maps); everything else point-shaped goes through the tiles.
//
// ROLE (since the 2026-07-05 path cull): the WebGL2 fallback light loop —
// clustered (the WebGPU default) needs a compute pass the WebGL backend
// can't run — and the ?clustered=0 A/B escape hatch.
// Bench: ?scenario=perf-lights&n=<N> (debug/scenarios.ts).

const MAX_LIGHTS = 64;
const TILE_LIGHT_COUNT = 8;  // max lights binned per tile (2 × vec4 slots)
// Uniform-size budget: MAX_TILES × 2 vec4 × 16B = 32KB (limit is 64KB).
// At the 0.4× pass a 32px tile grid is ~27×17 = 459 tiles; the tile size
// scales up automatically if a huge target would overflow the budget.
const MAX_TILES = 1024;
const BASE_TILE_SIZE = 32;   // px per tile side, in PASS pixels

const _v3 = /*@__PURE__*/ new Vector3();
const _size = /*@__PURE__*/ new Vector2();
const _proj = /*@__PURE__*/ new Vector4();

/* eslint-disable @typescript-eslint/no-explicit-any */
class DelveTiledLightsNode extends (LightsNode as any) {
  tiledLights: any[];
  materialLights: any[];
  _lightsCount: any;
  _tilesX: any;
  _tileSizeU: any;
  _pos: Vector4[];
  _col: Vector4[];
  _posArr: any;
  _colArr: any;
  _tiles: Vector4[];        // 2 per tile: 8 float-encoded light slots (0 = empty)
  _tilesArr: any;
  _dropped = 0;

  constructor() {
    super();
    this.tiledLights = [];
    this.materialLights = [];
    this._lightsCount = (uniform as any)(0, 'int');
    this._tilesX = (uniform as any)(1, 'int');
    this._tileSizeU = (uniform as any)(BASE_TILE_SIZE);
    this.updateBeforeType = (NodeUpdateType as any).RENDER;

    // Light data in VIEW space (xyz + range / premultiplied rgb + decay) —
    // lean-lights' proven structure.
    this._pos = Array.from({ length: MAX_LIGHTS }, () => new Vector4());
    this._col = Array.from({ length: MAX_LIGHTS }, () => new Vector4());
    this._posArr = (uniformArray as any)(this._pos, 'vec4');
    this._colArr = (uniformArray as any)(this._col, 'vec4');

    // Tile slots as float vec4 pairs (indices ≤64 are exact in f32). 0 = empty,
    // else lightIndex+1 — same sentinel scheme as Three's tiled node.
    this._tiles = Array.from({ length: MAX_TILES * 2 }, () => new Vector4());
    this._tilesArr = (uniformArray as any)(this._tiles, 'vec4');
  }

  // Routing — identical policy to lean-lights: lamp (noTile) + shadow casters
  // take the material path (tiles sample no shadow maps); the torch crowd tiles.
  setLights(lights: any[]): any {
    const { tiledLights, materialLights } = this;
    let ti = 0, mi = 0;
    for (const light of lights) {
      if (light.isPointLight === true && !(light.userData && light.userData.noTile) && light.castShadow !== true) {
        if (ti < MAX_LIGHTS) tiledLights[ti++] = light;
      } else {
        materialLights[mi++] = light;
      }
    }
    tiledLights.length = ti;
    materialLights.length = mi;
    return (LightsNode as any).prototype.setLights.call(this, materialLights);
  }

  // r185's renderer Lighting helper SAVE/RESTOREs the light list around some
  // passes: `cache.push(node.getLights())` … `node.setLights(cache.pop())`.
  // The base getLights() returns only what super stores — our MATERIAL split —
  // so the restore fed the truncated list back through the splitter and the
  // tiled lights were permanently dropped (the r185 bump's silent-black-world:
  // __tiledInfo read `lights: 0` with 11 active in the pool). Return the FULL
  // original set so the round-trip is lossless.
  getLights(): any[] {
    return [...this.tiledLights, ...(LightsNode as any).prototype.getLights.call(this)];
  }

  updateBefore(frame: any): void {
    const { renderer, camera } = frame;

    // 1. Pack LIVE lights (skip parked intensity-0 pool slots) in view space.
    let count = 0;
    const lights = this.tiledLights;
    for (let i = 0; i < lights.length; i++) {
      const light = lights[i];
      if (light.intensity <= 0.0001) continue;
      if (count >= MAX_LIGHTS) break;
      _v3.setFromMatrixPosition(light.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
      this._pos[count].set(_v3.x, _v3.y, _v3.z, light.distance);
      this._col[count].set(light.color.r * light.intensity, light.color.g * light.intensity, light.color.b * light.intensity, light.decay);
      count++;
    }
    this._lightsCount.value = count;

    // 2. Grid = the ACTIVE render target (the 0.4× PSX pass), not the canvas —
    // screenCoordinate in the shading pass is pass-local. Tile size grows if a
    // huge target would blow the MAX_TILES uniform budget.
    const rt = renderer.getRenderTarget();
    let w: number, h: number;
    if (rt) { w = rt.width; h = rt.height; }
    else { renderer.getDrawingBufferSize(_size); w = _size.x; h = _size.y; }
    let tileSize = BASE_TILE_SIZE;
    while (Math.ceil(w / tileSize) * Math.ceil(h / tileSize) > MAX_TILES) tileSize *= 2;
    const tilesX = Math.max(1, Math.ceil(w / tileSize));
    const tilesY = Math.max(1, Math.ceil(h / tileSize));
    this._tilesX.value = tilesX;
    this._tileSizeU.value = tileSize;

    // 3. CPU binning: clear the used tiles, then rasterize each light's
    // projected bounding rect into the grid. Per-tile slot cursors in a
    // scratch array; slots hold lightIndex+1 (0 = empty).
    const tileCount = tilesX * tilesY;
    for (let t = 0; t < tileCount; t++) {
      this._tiles[t * 2].set(0, 0, 0, 0);
      this._tiles[t * 2 + 1].set(0, 0, 0, 0);
    }
    const cursors = DelveTiledLightsNode._cursors;
    cursors.fill(0, 0, tileCount);
    this._dropped = 0;   // light-tile bins lost to the per-tile slot cap this frame
    const proj = camera.projectionMatrix.elements;
    // Bin NEAREST-TO-CAMERA FIRST. When a tile overflows its slot cap, insertion
    // order decides which lights survive — and pack order is arbitrary (pool /
    // scene order). Nearest-first makes overflow drop the lights whose
    // contribution to the visible fragments is smallest (a far torch already
    // beyond its cutoff for near pixels), instead of randomly dropping the very
    // lights illuminating the camera's surroundings.
    const order = DelveTiledLightsNode._order;
    for (let i = 0; i < count; i++) order[i] = i;
    const posRef = this._pos;
    if (count > 1) {
      order.length = count;
      order.sort((a, b) => {
        const pa = posRef[a], pb = posRef[b];
        return (pa.x * pa.x + pa.y * pa.y + pa.z * pa.z) - (pb.x * pb.x + pb.y * pb.y + pb.z * pb.z);
      });
    }
    for (let o = 0; o < count; o++) {
      const i = order[o];
      const p = this._pos[i];   // view-space (x, y, z, range)
      const range = p.w;
      let x0: number, x1: number, y0: number, y1: number;
      if (p.z >= -0.05) {
        // At/behind the eye plane: projection is unusable. If the light can
        // still reach the eye plane it may light near geometry → bin everywhere
        // (rare: a torch you just walked past); else skip.
        if (Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z) > range) continue;
        x0 = 0; y0 = 0; x1 = tilesX - 1; y1 = tilesY - 1;
      } else {
        // Project the view-space centre; radius in NDC ≈ range / -z scaled by
        // the projection's focal terms (conservative: use the larger).
        _proj.set(p.x, p.y, p.z, 1).applyMatrix4(camera.projectionMatrix);
        const invW = 1 / _proj.w;
        const sx = (_proj.x * invW * 0.5 + 0.5) * w;
        // NDC y is up; pass pixel y is down.
        const sy = (1 - (_proj.y * invW * 0.5 + 0.5)) * h;
        const rNdcX = (range / -p.z) * proj[0] * 0.5;   // proj[0] = focal x
        const rNdcY = (range / -p.z) * proj[5] * 0.5;   // proj[5] = focal y
        const rx = rNdcX * w, ry = rNdcY * h;
        x0 = Math.max(0, Math.floor((sx - rx) / tileSize));
        x1 = Math.min(tilesX - 1, Math.floor((sx + rx) / tileSize));
        y0 = Math.max(0, Math.floor((sy - ry) / tileSize));
        y1 = Math.min(tilesY - 1, Math.floor((sy + ry) / tileSize));
        if (x1 < x0 || y1 < y0) continue;
      }
      for (let ty = y0; ty <= y1; ty++) {
        for (let tx = x0; tx <= x1; tx++) {
          const t = tx + ty * tilesX;
          const c = cursors[t];
          if (c >= TILE_LIGHT_COUNT) { this._dropped++; continue; }
          const vec = this._tiles[t * 2 + (c >> 2)];
          const comp = c & 3;
          if (comp === 0) vec.x = i + 1; else if (comp === 1) vec.y = i + 1; else if (comp === 2) vec.z = i + 1; else vec.w = i + 1;
          cursors[t] = c + 1;
        }
      }
    }
    this._debugDump(tilesX, tilesY, tileSize, count);
  }

  static _cursors = new Uint8Array(MAX_TILES);
  static _order: number[] = [];

  _debugDump(tilesX: number, tilesY: number, tileSize: number, count: number): void {
    if (!import.meta.env.DEV || typeof window === 'undefined') return;
    (window as unknown as { __tiledInfo?: unknown }).__tiledInfo = {
      tilesX, tilesY, tileSize, lights: count, dropped: this._dropped,
      nonEmpty: this._tiles.slice(0, tilesX * tilesY * 2).filter((v, i) => i % 2 === 0 && v.x !== 0).length,
      light0: this._pos[0].toArray().map((n: number) => Math.round(n * 10) / 10),
      tileMid: this._tiles[(Math.floor(tilesY / 2) * tilesX + Math.floor(tilesX / 2)) * 2].toArray(),
    };
  }

  setupLights(builder: any, lightNodes: any): void {
    const rl = builder.context.reflectedLight;
    rl.directDiffuse.toStack();
    rl.directSpecular.toStack();

    // Material lights (the lamp + shadow casters) keep the normal node path.
    (LightsNode as any).prototype.setupLights.call(this, builder, lightNodes);

    const tilesArr = this._tilesArr;
    const posArr = this._posArr;
    const colArr = this._colArr;

    (Fn as any)(() => {
      // Fragment's tile — pass-local coordinates against the live grid uniforms.
      const screenTile: any = (screenCoordinate as any).div(this._tileSizeU).floor();
      const tileBase: any = ((int as any)(screenTile.x).add((int as any)(screenTile.y).mul(this._tilesX)))
        .mul((int as any)(2)).toVar();
      const blockA: any = tilesArr.element(tileBase).toVar();
      const blockB: any = tilesArr.element(tileBase.add((int as any)(1))).toVar();
      // The 8 slots UNROLLED with fixed component accessors — dynamic component
      // indexing (vec[i]) on uniform values is unreliable through the WGSL
      // lowering; fixed .x/.y/.z/.w is always sound. An empty slot (0) simply
      // skips its If — no Break needed, checks are ~free.
      const comps: Array<'x' | 'y' | 'z' | 'w'> = ['x', 'y', 'z', 'w'];
      for (const block of [blockA, blockB]) {
        for (const comp of comps) {
          const slot: any = (int as any)(block[comp]).toVar();
          (If as any)(slot.notEqual((int as any)(0)), () => {
            const idx: any = slot.sub((int as any)(1));
            const p: any = posArr.element(idx);
            const c: any = colArr.element(idx);
            builder.lightsNode.setupDirectLight(builder, this, (directPointLight as any)({
              color: c.rgb,
              lightVector: p.xyz.sub(positionView),
              cutoffDistance: p.w,
              decayExponent: c.w,
            }));
          });
        }
      }
    }, 'void')();
  }

  get hasLights(): boolean {
    return (super.hasLights as boolean) || this.tiledLights.length > 0;
  }
}

const delveTiledLights = (nodeProxy as any)(DelveTiledLightsNode);

/** Drop-in for the renderer's `.lighting`. `renderer.lighting = new DelveTiledLighting()`. */
export class DelveTiledLighting extends (Lighting as any) {
  createNode(lights: any[] = []): any {
    return delveTiledLights().setLights(lights);
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
