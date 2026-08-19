import * as THREE from 'three';
import { signalDrawOrder } from './signal-layer';
import { SpriteNodeMaterial } from 'three/webgpu';
import { instancedBufferAttribute, texture as textureNode, vec4 } from 'three/tsl';
import { getTexture } from '../style/procedural-textures';
import { registerWarmup } from '../content/warmup-registry';

// ── INSTANCED SPRITE BATCH — flames, wisps, glows in a handful of draws ──────
//
// The phone CPU profile (2026-07-04) showed Three's WebGPU renderer charging
// ~65µs of JS per draw, and 30-50 of our ~200 draws were individual additive
// SPRITES: torch wisps, candle flame stacks, brazier/bonfire tongues, prop
// glows — each its own THREE.Sprite with its own material, render object,
// uniform upload and draw call, every frame.
//
// This module collapses them: ONE Mesh per (texture) — an InstancedBufferGeometry
// unit quad with a SpriteNodeMaterial whose position/scale/colour ride
// per-INSTANCE attributes (the documented SpriteNodeMaterial instancing path).
// All flames on a floor become 1-2 draws, and their flicker becomes one small
// buffer write per frame instead of N scene-graph mutations.
//
// CONSUMER CONTRACT (mirrors what the Sprite versions exposed):
//  - createBatchedSprite() returns a handle whose `obj` is a plain Object3D
//    placeholder the model parents where the Sprite used to sit. World position
//    is read from the placeholder each tick (frozen static parents keep a
//    constant, valid matrixWorld; moving parents update theirs as usual).
//  - `color` / `opacity` / `scaleMul` are LIVE — the torch flicker mutates them
//    per frame exactly like it mutated SpriteMaterial.color / sprite.scale.
//    Opacity folds into the instance colour (additive blending: rgb×a is the
//    only thing that reaches the framebuffer, so tint×opacity is equivalent).
//  - Hiding any ancestor (room culler, wick states, fog-cull) hides the
//    instance — the tick walks the placeholder's parent chain; detached
//    placeholders (torn-down props, despawned models) go invisible too.
//  - setTexture() moves the entry between per-texture batches (the mood-tint
//    pass swaps flames to the neutral 'moonbeam' ramp).
//
// SCOPE: additive world sprites, in TWO fog families (see FOG below) — model
// `sprite` parts on STATIC PROPS (torches/candles/braziers/props), and
// permanently-pooled combat glows (status-vfx motes + auras). Creature
// eye-halos stay real Sprites — enemy-presentation.ts mutates their materials
// directly (eye flash) and mobs are few. Viewmodel overlay sprites (depth-off)
// and depthTest-off overlay cues (stun-stars) are different pipeline variants
// and stay as-is. NormalBlending effects (dust-puff) are a third family nobody
// has needed yet.
//
// LIFETIME: entries live until resetSpriteBatch() (level teardown). There is no
// per-entry release, so a consumer must either live for the floor (props) or be
// a FIXED POOL that hides its placeholders rather than dropping them
// (status-vfx). A spawn-per-event consumer would grow `entries` unboundedly
// within a floor — it needs a release path built first, deliberately not
// speculated on here.
//
// FOG: the two families exist because additive fog is not a cosmetic toggle.
// World flames want fog:true — they are IN the air and must haze out with the
// corridor. Combat glows want fog:false: three blends an additive fragment
// toward the fog COLOUR with distance, which on additive blending ADDS light as
// something recedes, so a distant mote brightens instead of fading. Both are
// correct for their population, and they cannot share a pipeline.
//
// Batching is opt-in per buildModel call (opts.batchSprites) and additionally
// gated on setSpriteBatchScene() having been called — the bench/viewer tools
// render models with no batch ticking, so they keep plain Sprites.

const MAX_PER_BATCH = 256;

interface Flicker { omega: number; phaseMs: number; scaleAmp: number; bobAmp: number }

export interface BatchedSprite {
  /** Placeholder Object3D — parent it where the Sprite used to sit. Carries
   *  `userData.batchedSprite` back-reference for consumers that used to walk
   *  the graph looking for Sprites (mood tint, torch flame collection). */
  obj: THREE.Object3D;
  /** Live tint — mutate freely (torch flicker writes base×brightness here). */
  color: THREE.Color;
  /** Live opacity 0..1 (folded into the additive colour on upload). */
  opacity: number;
  /** Live per-axis scale multiplier on top of the authored size (torch jitter). */
  scaleMul: THREE.Vector2;
  /** Authored base size (metres). */
  baseSize: THREE.Vector2;
  /** Swap the entry to another texture's batch (mood tint → 'moonbeam'). */
  setTexture(name: string): void;
}

interface Entry extends BatchedSprite {
  textureName: string;
  fog: boolean;
  persistent: boolean;
  flicker: Flicker | null;
  baseY: number;   // placeholder's authored local Y (bob is applied around it)
}

/** A batch serves one (texture, fog) pair — both are baked into the pipeline,
 *  so they are the key. */
function batchKey(textureName: string, fog: boolean): string {
  return `${textureName}|${fog ? 'fog' : 'nofog'}`;
}

class Batch {
  mesh: THREE.Mesh;
  pos: THREE.InstancedBufferAttribute;
  scale: THREE.InstancedBufferAttribute;
  col: THREE.InstancedBufferAttribute;
  geo: THREE.InstancedBufferGeometry;
  constructor(textureName: string, fog: boolean) {
    const plane = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = plane.index;
    geo.setAttribute('position', plane.getAttribute('position'));
    geo.setAttribute('uv', plane.getAttribute('uv'));
    this.pos = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PER_BATCH * 3), 3);
    this.scale = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PER_BATCH * 2), 2);
    this.col = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PER_BATCH * 3), 3);
    this.pos.setUsage(THREE.DynamicDrawUsage);
    this.scale.setUsage(THREE.DynamicDrawUsage);
    this.col.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aPos', this.pos);
    geo.setAttribute('aScale', this.scale);
    geo.setAttribute('aCol', this.col);
    geo.instanceCount = 0;
    this.geo = geo;

    const mat = new SpriteNodeMaterial();
    mat.transparent = true;
    mat.blending = THREE.AdditiveBlending;
    mat.depthWrite = false;
    mat.fog = fog;   // see the FOG note in the header — two families, both correct
    /* eslint-disable @typescript-eslint/no-explicit-any */
    (mat as any).positionNode = instancedBufferAttribute(this.pos);
    (mat as any).scaleNode = instancedBufferAttribute(this.scale);
    (mat as any).colorNode = (textureNode(getTexture(textureName)) as any)
      .mul((vec4 as any)(instancedBufferAttribute(this.col), 1));
    /* eslint-enable @typescript-eslint/no-explicit-any */
    const key = batchKey(textureName, fog);
    mat.name = `sprite-batch:${key}`;

    this.mesh = new THREE.Mesh(geo, mat);
    // ── THE SIGNAL LAYER, DRAW ORDER ONLY ───────────────────────────────────
    //
    // Flames and embers are what the dungeon is willing to tell you through a veiled
    // doorway, so the batch composites after the veil. ORDER ONLY: this one mesh sits at
    // the origin and holds every flame on the floor, so occlusion-testing it would ask
    // about the origin and hide or show them all together. Each instance is gated through
    // its own placeholder instead — see scene/signal-layer.ts.
    signalDrawOrder(this.mesh);
    this.mesh.frustumCulled = false;      // instances span the floor; cull per-entry via visibility
    this.mesh.matrixAutoUpdate = false;   // identity — instance positions are world-space
    this.mesh.name = `sprite-batch:${key}`;
  }
}

let batchScene: THREE.Scene | null = null;
const batches = new Map<string, Batch>();
const entries: Entry[] = [];
const _world = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _counts = new Map<string, number>();   // per-frame fill counts, reused (see tickSpriteBatch)

function batchFor(textureName: string, fog: boolean): Batch {
  const key = batchKey(textureName, fog);
  let b = batches.get(key);
  if (!b) {
    b = new Batch(textureName, fog);
    batches.set(key, b);
    batchScene?.add(b.mesh);
  }
  return b;
}

/** Enable batching (the game calls this once with the live scene; bench/viewer
 *  never do, so models built there keep plain Sprites). */
export function setSpriteBatchScene(scene: THREE.Scene): void {
  batchScene = scene;
  for (const b of batches.values()) scene.add(b.mesh);
}

export function isSpriteBatchingEnabled(): boolean { return batchScene !== null; }

/** Register a batched sprite. Caller parents `handle.obj` into its model. */
export function createBatchedSprite(opts: {
  texture: string;
  size: [number, number];
  color: number;
  opacity: number;
  /** Fog family — see the FOG note in the header. Defaults true (world flames,
   *  the original consumer); combat glows pass false. */
  fog?: boolean;
  /** APP-scoped rather than level-scoped: survives resetSpriteBatch(). For
   *  fixed pools built once at boot (status-vfx) whose owner outlives the
   *  floor. Level-scoped props leave this false so teardown still drops them. */
  persistent?: boolean;
  flicker?: { speed: number; phase?: number; scale?: number; bob?: number };
}): BatchedSprite {
  const obj = new THREE.Object3D();
  const entry: Entry = {
    obj,
    color: new THREE.Color(opts.color),
    opacity: opts.opacity,
    scaleMul: new THREE.Vector2(1, 1),
    baseSize: new THREE.Vector2(opts.size[0], opts.size[1]),
    textureName: opts.texture,
    fog: opts.fog ?? true,
    persistent: opts.persistent ?? false,
    baseY: 0,
    flicker: opts.flicker ? {
      omega: Math.PI * 2 * opts.flicker.speed,
      phaseMs: (opts.flicker.phase ?? Math.random() * 100) * 1000,
      scaleAmp: opts.flicker.scale ?? 0,
      bobAmp: opts.flicker.bob ?? 0,
    } : null,
    setTexture(name: string) { entry.textureName = name; },
  };
  obj.userData.batchedSprite = entry;
  entries.push(entry);
  batchFor(entry.textureName, entry.fog);   // ensure the batch exists (and warms) up front
  return entry;
}

/** True when every ancestor up to (and including) the batch scene is visible. */
function worldVisible(o: THREE.Object3D): boolean {
  let cur: THREE.Object3D | null = o;
  while (cur) {
    if (!cur.visible) return false;
    if (cur === (batchScene as THREE.Object3D)) return true;
    cur = cur.parent;
  }
  return false;   // detached from the scene (torn down / not yet mounted)
}

/** Per-frame: fold every live entry into its batch's instance attributes.
 *  One pass over ~60 entries + one small buffer upload per batch — replacing
 *  ~60 per-object draw submissions. */
export function tickSpriteBatch(): void {
  if (!batchScene) return;
  // Reused across frames — this runs every frame, and a fresh Map per frame is
  // exactly the kind of steady allocation the effects pools were built to avoid.
  _counts.clear();
  const now = Date.now();
  for (const e of entries) {
    if (!worldVisible(e.obj)) continue;
    const key = batchKey(e.textureName, e.fog);
    const b = batchFor(e.textureName, e.fog);
    const i = _counts.get(key) ?? 0;
    if (i >= MAX_PER_BATCH) continue;
    _counts.set(key, i + 1);

    let s = 1;
    let bob = 0;
    if (e.flicker) {
      const t = (now + e.flicker.phaseMs) / 1000;
      const a = Math.sin(e.flicker.omega * t);
      const c = Math.sin(e.flicker.omega * 1.7 * t + 1.3);
      const w = a * 0.6 + c * 0.4;
      s = 1 + w * e.flicker.scaleAmp;
      bob = w * e.flicker.bobAmp;
    }
    // WORLD SCALE, not just world position. A batched sprite's placeholder is a
    // child of the model group, so scaling that group (a big bonfire, ?bigfire=,
    // any prop with `scale`) moved every flame apart while each stayed its
    // authored size — a fire scaled to 1.5 came out as a tall thin column of
    // small flames with a gap up the middle. Read both from ONE world-matrix
    // update rather than getWorldPosition + getWorldScale, which would walk the
    // parent chain twice per sprite per frame.
    e.obj.updateWorldMatrix(true, false);
    _world.setFromMatrixPosition(e.obj.matrixWorld);
    _scale.setFromMatrixScale(e.obj.matrixWorld);
    b.pos.setXYZ(i, _world.x, _world.y + bob * _scale.y, _world.z);
    b.scale.setXY(
      i,
      e.baseSize.x * s * e.scaleMul.x * _scale.x,
      e.baseSize.y * s * e.scaleMul.y * _scale.y,
    );
    // Additive: only rgb×alpha reaches the framebuffer, so opacity folds into
    // the tint and the shader's alpha stays the texture's own.
    b.col.setXYZ(i, e.color.r * e.opacity, e.color.g * e.opacity, e.color.b * e.opacity);
  }
  for (const [key, b] of batches) {
    const n = _counts.get(key) ?? 0;
    // Hide idle batches entirely — a visible mesh with instanceCount 0 still
    // submits a degenerate draw (Dawn warns "index count of 0 is unusual").
    b.mesh.visible = n > 0;
    if (n === 0 && b.geo.instanceCount === 0) continue;   // idle — skip uploads
    b.geo.instanceCount = n;
    b.pos.needsUpdate = true;
    b.scale.needsUpdate = true;
    b.col.needsUpdate = true;
  }
}

/**
 * DEV: the sprite instances actually being drawn, as text.
 *
 * Same reason the flame batch has one: these are placed by a custom positionNode, so every
 * scene-walking probe sees only the unit quad the geometry started as and reports "1m sprite at
 * the origin" whatever is really on screen. The attributes are the only honest answer.
 */
export function spriteBatchDebug(): string {
  const out: string[] = [];
  for (const [key, b] of batches) {
    if (!b.geo.instanceCount) continue;
    for (let i = 0; i < b.geo.instanceCount; i++) {
      const px = b.pos.getX(i), py = b.pos.getY(i), pz = b.pos.getZ(i);
      const sx = b.scale.getX(i), sy = b.scale.getY(i);
      if (Math.hypot(px, py, pz) > 1.5) continue;
      out.push(`${key} #${i} pos[${px.toFixed(2)},${py.toFixed(2)},${pz.toFixed(2)}] `
        + `size[${sx.toFixed(2)},${sy.toFixed(2)}] ← NEAR ORIGIN`);
    }
  }
  const persistent = entries.filter((e) => e.persistent).length;
  return `sprite batches: ${batches.size}, entries=${entries.length} `
    + `(persistent ${persistent})` + (out.length ? `\n  ${out.join('\n  ')}` : ' · none near origin');
}

/** Drop every LEVEL-scoped entry (teardown/load — those placeholders die with
 *  the level root; the batch meshes + pipelines stay resident for the next
 *  floor). Entries marked `persistent` are kept: their owners are app-scoped
 *  pools built once at boot, so dropping them here would silently stop them
 *  rendering from the second floor onward. */
export function resetSpriteBatch(): void {
  const kept = entries.filter((e) => e.persistent);
  entries.length = 0;
  for (const e of kept) entries.push(e);
  for (const b of batches.values()) b.geo.instanceCount = 0;
}

// Warm the batch pipelines at boot: one visible dummy instance per common
// texture, rendered through the real PSX pipeline by the warm pass. The batch
// meshes live in the scene permanently, so the compiled pipelines stay pinned.
// BOTH fog families are warmed. fog is baked into the pipeline, so warming only
// the fog:true flames would leave the fog:false combat-glow pipeline to compile
// on the first affliction of the run — a hitch mid-fight, which is precisely
// what this warm exists to prevent.
registerWarmup({
  label: 'sprite-batch', live: true,
  spawn: () => {
    if (!batchScene) return;
    for (const name of ['fire-wisp', 'moonbeam']) {
      for (const fog of [true, false]) {
        const b = batchFor(name, fog);
        b.pos.setXYZ(0, 0, 0.5, 0);
        b.scale.setXY(0, 0.05, 0.05);
        b.col.setXYZ(0, 1, 1, 1);
        b.geo.instanceCount = 1;
        b.mesh.visible = true;
        b.pos.needsUpdate = true; b.scale.needsUpdate = true; b.col.needsUpdate = true;
      }
    }
  },
  clear: () => { for (const b of batches.values()) b.geo.instanceCount = 0; },
});
