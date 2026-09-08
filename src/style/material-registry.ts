import * as THREE from 'three';
import { brighten, darken } from './color-utils';
import { isPooledGeometry } from '../scene/geometry-pool';

// ── BOUNDED MATERIAL REGISTRY ────────────────────────────────────────────────
//
// On WebGPU a render PIPELINE is keyed by (material × geometry layout × render state),
// and Three's WebGPU backend effectively mints a pipeline PER MATERIAL INSTANCE (see
// docs/PIPELINE-BUDGET.md + three.js #32735). So `new THREE.MeshStandardMaterial(p)` called
// once per FLOOR built a fresh pipeline EVERY descent — the unbounded-pipeline explosion that
// made the game compile (and hitch) forever as you went deeper.
//
// stdMat() collapses that: identical params return the SAME shared instance, so the set of
// distinct floor materials is CLOSED and small (a handful of kinds × the few per-act torch
// tints). The level teardown disposes geometry but NEVER materials (builder.ts), so sharing
// instances across floors is safe. registeredFloorMaterials() exposes the live set so the
// warm can compile all of them once, up front — after which nothing new compiles in-game.
//
// USE FOR: static surface materials (decor, clutter, framing) NOT mutated per instance —
// per-instance colour goes through InstancedMesh.instanceColor, not the material object.
// DON'T use for materials that get per-instance shader state (hit-flash, gore, independent
// flame flicker); those own their instance by design (ModelSpec.materials / createMaterialFromDef).

const stdCache = new Map<string, THREE.MeshStandardMaterial>();
const basicCache = new Map<string, THREE.MeshBasicMaterial>();

// Canonical key over the params: sorted keys, THREE.Color → hex, textures → uuid. Two calls
// with structurally-equal params hash to the same key → share one instance → one pipeline.
function canonKey(p: object): string {
  const o = p as Record<string, unknown>;
  return Object.keys(o).sort().map((k) => {
    let v: unknown = o[k];
    if (v && typeof v === 'object') {
      const c = v as { getHex?: () => number; isTexture?: boolean; uuid?: string };
      v = typeof c.getHex === 'function' ? c.getHex() : c.isTexture ? c.uuid : JSON.stringify(v);
    }
    return `${k}=${String(v)}`;
  }).join('|');
}

function shared<T extends THREE.Material>(cache: Map<string, T>, make: () => T, params: object): T {
  const key = canonKey(params);
  let m = cache.get(key);
  if (!m) {
    m = make();
    m.userData.sharedPalette = true;   // teardown/dispose passes must skip it
    // Name for the compile report (label = renderPipeline_${name}_${id}); cosmetic, not in the
    // shader/cache key. A shared material that slips through to an in-play compile shows as
    // 'shared:…' in __compileReport(), flagging a warm-coverage miss vs a genuinely new material.
    if (!m.name) m.name = m instanceof THREE.MeshBasicMaterial ? 'shared:basic' : 'shared:std';
    cache.set(key, m);
  }
  return m;
}

/** Shared, structurally-deduplicated MeshStandardMaterial — call instead of
 *  `new THREE.MeshStandardMaterial` for any STATIC surface (decor, static interactables) so the
 *  game's recurring-material set stays closed and warmable. See docs/PIPELINE-BUDGET.md. */
export function stdMat(params: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
  // `flatShading` never reaches the material (it is a second shader program);
  // the material is marked and the MESH bakes face normals into its geometry —
  // see scene/flat-bake.ts. The key keeps the flag so flat and smooth callers
  // get distinct instances, which is what lets the mesh side tell them apart.
  const { flatShading, ...rest } = params;
  const m = shared(stdCache, () => new THREE.MeshStandardMaterial(rest), params);
  if (flatShading) m.userData.flatBaked = true;
  return m;
}

/** Shared, structurally-deduplicated MeshBasicMaterial — the unlit twin of stdMat, for static
 *  interactable glows/rings/voids that aren't per-instance animated. (Animated ones own their
 *  instance — see the PIPELINE-BUDGET 'animated interactables' list.) */
export function basicMat(params: THREE.MeshBasicMaterialParameters): THREE.MeshBasicMaterial {
  return shared(basicCache, () => new THREE.MeshBasicMaterial(params), params);
}

// ── CANONICAL SURFACE KINDS ──────────────────────────────────────────────────
//
// A pipeline's identity is its FLAGS — transparent, blending, depthWrite, side,
// target format, topology, attribute layout (+ fog and flatShading, which the
// node builder bakes into the WGSL). `color`, `opacity` and `map` are UNIFORMS:
// they are NOT in the key. Two materials that differ only in colour are already
// one pipeline.
//
// That is why the 2026-08-10 audit found 42 material configurations but only a
// handful of genuinely distinct looks — and why collapsing materials by colour
// would have bought nothing. stairs.ts alone had five additive glow materials
// (fire ×2, floor ring, light shaft ×2) that were already sharing one pipeline
// and just LOOKED like sprawl.
//
// The real cost is flag combinations that drifted apart for no reason: the same
// glow authored `side: DoubleSide` here and `BackSide` there, `fog: false` in one
// place and defaulted-true in the next. Each accidental difference is a pipeline
// to compile at load.
//
// So these helpers fix the FLAGS and leave the look free. They return a fresh
// instance rather than a pooled one, because these surfaces are typically tweened
// per object (the stair glow fades between passive and active) — pooling them
// would make one object's tween drive another's. Sharing the pipeline is the win;
// sharing the instance is not required for it.

export interface GlowOptions {
  map?: THREE.Texture;
  color?: THREE.ColorRepresentation;
  opacity?: number;
  /** DoubleSide by default — a glow quad read from behind should still glow.
   *  Pass FrontSide for a CLOSED additive solid (a projectile core, a tendril
   *  tube): double-sided additive draws its back faces too and doubles the
   *  brightness. Those two are the only sides a glow has. */
  side?: THREE.Side;
  /** THE TWO FOG FAMILIES (see sprite-batch.ts): a thing IN THE AIR — a world
   *  flame, a doorway haze, an eye's glow — hazes out with the corridor and
   *  wants fog on. A combat glow wants it off: additive fog ADDS the fog colour
   *  with distance, so a receding mote brightens. Default off. */
  fog?: boolean;
  /** Per-vertex colour (blade trails). Changes the vertex layout, so it is
   *  its own pipeline either way; stated here so the intent is visible. */
  vertexColors?: boolean;
  /** Drawn over everything (no depth test) — an overlay, not a thing in the
   *  world. Domain-bind sigils. */
  overlay?: boolean;
}

// A map's PRESENCE is in the shader (the sample is compiled in or not), so an
// untextured glow and a textured one were two programs of every kind. Every
// kind now samples a map; the untextured ones sample this 1×1 white.
let whiteTex: THREE.DataTexture | null = null;
function whiteMap(): THREE.Texture {
  if (!whiteTex) {
    whiteTex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    whiteTex.colorSpace = THREE.SRGBColorSpace;
    whiteTex.needsUpdate = true;
  }
  return whiteTex;
}
function named<T extends THREE.Material>(m: T, kind: string): T { m.name = `kind:${kind}`; return m; }

/** ADDITIVE GLOW — light that isn't a light. Fire wisps, light shafts, floor
 *  pools, telegraph rings: anything that ADDS brightness and must never occlude
 *  what's behind it. Fixed: transparent, additive, no depth write. */
export function glowSurface(o: GlowOptions = {}): THREE.MeshBasicMaterial {
  return named(new THREE.MeshBasicMaterial({
    map: o.map ?? whiteMap(),
    color: o.color ?? 0xffffff,
    opacity: o.opacity ?? 1,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: !o.overlay,
    fog: o.fog ?? false,
    side: o.side ?? THREE.DoubleSide,
    vertexColors: o.vertexColors ?? false,
  }), o.fog ? 'glow:fog' : o.overlay ? 'glow:overlay' : 'glow');
}

/** VEIL / SHADE — normal-blended darkness or haze that must never occlude:
 *  the threshold veil, a blob shadow, a hazard's floor stain, a telegraph
 *  disc. Fixed: transparent, normal blend, no depth write, double-sided.
 *  `fog` follows the same two-family rule as glows (a blob shadow is on the
 *  ground and hazes; the veil IS the darkness and must not). */
export function veilSurface(o: GlowOptions = {}): THREE.MeshBasicMaterial {
  return named(new THREE.MeshBasicMaterial({
    map: o.map ?? whiteMap(),
    color: o.color ?? 0xffffff,
    opacity: o.opacity ?? 1,
    transparent: true,
    blending: THREE.NormalBlending,
    depthWrite: false,
    depthTest: !o.overlay,
    fog: o.fog ?? false,
    side: THREE.DoubleSide,
  }), o.fog ? 'veil:fog' : 'veil');
}

/** ART QUAD — a picture in the world: a tarot card's face. Normal blend, writes
 *  depth (the front and back faces are separate quads and must sort against
 *  each other), front-only, no fog, and NOT tone-mapped so the art reads as
 *  authored. `overlay` is the claim animation: drawn over everything, both
 *  sides, no depth write. */
export function artQuadSurface(o: { map?: THREE.Texture; opacity?: number; overlay?: boolean } = {}): THREE.MeshBasicMaterial {
  return named(new THREE.MeshBasicMaterial({
    map: o.map ?? whiteMap(),
    opacity: o.opacity ?? 1,
    transparent: true,
    depthWrite: !o.overlay,
    depthTest: !o.overlay,
    side: o.overlay ? THREE.DoubleSide : THREE.FrontSide,
    fog: false,
    toneMapped: false,
  }), o.overlay ? 'art:overlay' : 'art');
}

// ── SPRITE KINDS — the same discipline for billboards ─────────────────────────
//
// A SpriteMaterial's pipeline is decided by blending, depthTest and fog (and
// whether it has a map; every DELVE sprite does). Three kinds cover every
// sprite the game draws; the audit found the same three authored eleven ways.

export interface SpriteOptions {
  map?: THREE.Texture;
  color?: THREE.ColorRepresentation;
  opacity?: number;
  /** World-flame family (fog on) vs combat-glow family (fog off, default). */
  fog?: boolean;
}

/** GLOW SPRITE — an additive billboard IN the world, depth-tested: eye halos,
 *  coin sparks, XP wisps, parry sparks, corpse wisps (fog on: they are flames). */
export function glowSprite(o: SpriteOptions = {}): THREE.SpriteMaterial {
  return named(new THREE.SpriteMaterial({
    map: o.map ?? whiteMap(),
    color: o.color ?? 0xffffff,
    opacity: o.opacity ?? 1,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    fog: o.fog ?? false,
  }), o.fog ? 'sprite:glow:fog' : 'sprite:glow');
}

/** OVERLAY SPRITE — drawn over everything (no depth test): the viewmodel's
 *  flame layers and flask glow, stun stars, the fear skull, breath puffs.
 *  Additive by default; `additive: false` for the smoke-like ones. Never
 *  fogged — an overlay has no distance. */
export function overlaySprite(o: SpriteOptions & { additive?: boolean } = {}): THREE.SpriteMaterial {
  return named(new THREE.SpriteMaterial({
    map: o.map ?? whiteMap(),
    color: o.color ?? 0xffffff,
    opacity: o.opacity ?? 1,
    transparent: true,
    blending: o.additive === false ? THREE.NormalBlending : THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    fog: false,
  }), o.additive === false ? 'sprite:overlay:normal' : 'sprite:overlay');
}

/** SMOKE SPRITE — a normal-blended puff IN the world that hazes with distance:
 *  dust puffs, summon smoke. Fixed: normal blend, depth-tested, fog on. */
export function smokeSprite(o: SpriteOptions = {}): THREE.SpriteMaterial {
  return named(new THREE.SpriteMaterial({
    map: o.map ?? whiteMap(),
    color: o.color ?? 0xffffff,
    opacity: o.opacity ?? 1,
    transparent: true,
    blending: THREE.NormalBlending,
    depthWrite: false,
    depthTest: true,
    fog: o.fog ?? true,
  }), 'sprite:smoke');
}

/** THE CLOSED SET of unlit surface kinds, as builders — what the boot warm
 *  compiles so no glow, veil or sprite ever compiles on first sight in play.
 *  A kind that is added above and not listed here is the one that will hitch. */
export function unlitSurfaceKinds(): Array<{ label: string; make: () => THREE.Material; sprite: boolean }> {
  return [
    { label: 'glow', make: () => glowSurface(), sprite: false },
    { label: 'glow:fog', make: () => glowSurface({ fog: true }), sprite: false },
    { label: 'glow:solid', make: () => glowSurface({ side: THREE.FrontSide }), sprite: false },
    { label: 'glow:overlay', make: () => glowSurface({ overlay: true }), sprite: false },
    { label: 'outline', make: () => outlineSurface(), sprite: false },
    { label: 'outline:additive', make: () => outlineSurface({ additive: true }), sprite: false },
    { label: 'veil', make: () => veilSurface(), sprite: false },
    { label: 'veil:fog', make: () => veilSurface({ fog: true }), sprite: false },
    { label: 'art', make: () => artQuadSurface(), sprite: false },
    { label: 'art:overlay', make: () => artQuadSurface({ overlay: true }), sprite: false },
    { label: 'sprite:glow', make: () => glowSprite(), sprite: true },
    { label: 'sprite:glow:fog', make: () => glowSprite({ fog: true }), sprite: true },
    { label: 'sprite:overlay', make: () => overlaySprite(), sprite: true },
    { label: 'sprite:overlay:normal', make: () => overlaySprite({ additive: false }), sprite: true },
    { label: 'sprite:smoke', make: () => smokeSprite(), sprite: true },
  ];
}

/** INVERSE-HULL OUTLINE — a back-faced shell scaled slightly larger than the
 *  mesh it wraps, so only its silhouette shows. Fixed: BackSide, no depth write,
 *  no fog, transparent. `additive` picks the blend, and that is the ONE flag
 *  worth varying here: an additive outline glows, a normal-blended one reads as
 *  a hard ink line. */
export function outlineSurface(o: GlowOptions & { additive?: boolean } = {}): THREE.MeshBasicMaterial {
  return named(new THREE.MeshBasicMaterial({
    map: whiteMap(),   // same shader as a glow; only the side differs (a state, not a program)
    color: o.color ?? 0xffffff,
    opacity: o.opacity ?? 1,
    transparent: true,
    blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    depthWrite: false,
    fog: false,
    side: THREE.BackSide,
  }), 'outline');
}

/** Every distinct shared material created so far — the closed set the warm compiles. */
export function registeredFloorMaterials(): THREE.Material[] {
  return [...stdCache.values(), ...basicCache.values()];
}

/** True when a material is a SHARED pooled instance — the stdMat/basicMat
 *  palette or build-model's model pool. Disposing one of these kills the
 *  pipeline/render-objects out from under every OTHER mesh sharing it (and
 *  the next spawn re-mints + recompiles). Both pools have carried "teardown
 *  must skip it" flags since they were built — this is the one place that
 *  actually honours them. */
export function isSharedMaterial(m: THREE.Material): boolean {
  return m.userData.sharedPalette === true || m.userData.sharedModelMat === true;
}

/** Dispose a subtree's OWNED materials, skipping shared pooled instances.
 *  A bare `mats.forEach(m => m.dispose())` walk destroys pooled materials
 *  that other live models still reference. */
export function disposeOwnedMaterials(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const mat = (mesh as { material?: THREE.Material | THREE.Material[] }).material;
    if (!mat) return;
    const mats = Array.isArray(mat) ? mat : [mat];
    for (const m of mats) if (!isSharedMaterial(m)) m.dispose();
  });
}

/** THE teardown for a buildModel/buildCreature tree: dispose owned materials
 *  (shared pool instances skipped — see disposeOwnedMaterials) AND owned
 *  geometry (pooled primitives skipped via `userData.pooled`; bespoke
 *  CSG/lathe/merged geometry is genuinely per-build and would otherwise
 *  leak). Every site that previously hand-rolled a traverse-and-dispose
 *  either corrupted a pool or leaked one of the two — use this instead. */
export function disposeBuiltTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const mat = (mesh as { material?: THREE.Material | THREE.Material[] }).material;
    if (mat) {
      const mats = Array.isArray(mat) ? mat : [mat];
      for (const m of mats) if (!isSharedMaterial(m)) m.dispose();
    }
    // A THREE.Sprite's geometry is a MODULE-LEVEL SINGLETON — every Sprite ever
    // constructed, in every scene, in every renderer, shares the same object.
    // Disposing it here deletes the GPU buffers out from under every OTHER
    // sprite in the process, and the next frame drives an error per sprite draw
    // ("no buffer is bound to enabled attribute"), which the context-recovery
    // watchdog reads as a dead device and veils with "something below has
    // shifted". That is the whole story of the ember-pickup crash: taking an
    // ember built its inventory thumbnail (ui/item-thumbnail.ts), tore the rig
    // down through here, and killed every flame in the dungeon.
    //
    // Sprite MATERIALS are per-instance and are disposed above; only the
    // geometry is shared, and it is not ours to free.
    if ((o as unknown as { isSprite?: boolean }).isSprite) return;
    const geo = (mesh as { geometry?: THREE.BufferGeometry }).geometry;
    if (geo && !isPooledGeometry(geo)) geo.dispose();
  });
}

/** Count of distinct floor pipelines the registry holds (DEV diagnostics / invariant check). */
export function floorMaterialCount(): number { return stdCache.size + basicCache.size; }

// ── UNIFIED POOL REGISTRY ─────────────────────────────────────────────────────
// stdMat/basicMat are the STATIC-surface pool; build-model's createMaterial is the
// MODEL pool (creatures/items). They stay as separate typed entry points (their
// warm paths differ — static warms on a dummy box, models need creature-shaped
// dummies with skin/reveal attributes), but they register here so there's ONE
// source of truth for "every pooled material." A pool joins via registerMaterialPool
// (build-model calls it at module load) — no import cycle, and any future pool
// auto-joins. registeredMaterials() / totalMaterialCount() are what diagnostics +
// the compile-coverage net read; the compile guard flags anything that isn't pooled
// (compiles in-play), which is how the "all creation goes through a pool" discipline
// is ENFORCED rather than hand-audited.
const externalPools: Array<() => readonly THREE.Material[]> = [];

/** Register an additional pooled-material source (its live set). Called once, at
 *  module load, by each pool outside this file (e.g. build-model's model pool). */
export function registerMaterialPool(getMaterials: () => readonly THREE.Material[]): void {
  externalPools.push(getMaterials);
}

/** Every pooled material across ALL pools (static + model + any registered) — the
 *  closed, warmable set + the invariant surface (this must PLATEAU as you descend). */
export function registeredMaterials(): THREE.Material[] {
  const out: THREE.Material[] = [...stdCache.values(), ...basicCache.values()];
  for (const pool of externalPools) out.push(...pool());
  return out;
}

/** Total distinct pooled materials across all pools (DEV invariant check). */
export function totalMaterialCount(): number { return registeredMaterials().length; }

// ── DECLARATIVE FLOOR-DECOR PALETTE (the precompile list — PIPELINE-BUDGET Pillar 1b) ─────
//
// The CLOSED set of per-floor decoration materials, as builder functions. Tinted entries take
// the floor's per-act torch tint (a bounded set). This MIRRORS the inline params in
// decorate.ts / builder.ts / chandelier.ts — since those call stdMat() with the same params,
// constructing the palette here pre-populates the cache, and the floor builders cache-HIT it
// (no second instance, no second pipeline). Keeping it a separate mirror (rather than editing
// those files to import it) means the floor visuals are UNTOUCHED — priming can only change
// compile TIMING, never appearance — and the compile-watch flags any param drift as an in-play
// hitch. (When validated, this can collapse to a single source.)
const floorPalette = {
  sigil:      (t: number) => stdMat({ color: 0x000000, emissive: brighten(t, 0.55), emissiveIntensity: 1.4, roughness: 1.0, fog: false }),
  crack:      (t: number) => stdMat({ color: 0x000000, emissive: darken(t, 0.4), emissiveIntensity: 0.9, roughness: 1.0, fog: false }),
  nicheEmber: (t: number) => stdMat({ color: 0x000000, emissive: brighten(t, 0.3), emissiveIntensity: 0.9, roughness: 1.0, fog: false }),
  chandFlame: (t: number) => stdMat({ color: 0x000000, emissive: t, emissiveIntensity: 2.2, roughness: 1.0, fog: false }),
  rubble:        () => stdMat({ color: 0x252018, roughness: 1.0, metalness: 0.0, flatShading: true }),
  nicheStone:    () => stdMat({ color: 0x35302a, roughness: 0.8, metalness: 0.05, flatShading: true }),
  nicheVoid:     () => stdMat({ color: 0x040405, roughness: 1.0 }),
  nicheBone:     () => stdMat({ color: 0x9a8d74, roughness: 0.95, flatShading: true }),
  portcullisBars:() => stdMat({ color: 0x15171b, roughness: 0.55, metalness: 0.55 }),
  breachCavity:  () => stdMat({ color: 0x020203, roughness: 1.0 }),
  breachRubble:  () => stdMat({ color: 0x231f19, roughness: 1.0, flatShading: true }),
  chandIron:     () => stdMat({ color: 0x16140f, roughness: 0.6, metalness: 0.75, flatShading: true }),
  chandWax:      () => stdMat({ color: 0xb8a98c, roughness: 0.95 }),
};
const TINTED = [floorPalette.sigil, floorPalette.crack, floorPalette.nicheEmber, floorPalette.chandFlame];
const PLAIN = [
  floorPalette.rubble, floorPalette.nicheStone, floorPalette.nicheVoid, floorPalette.nicheBone,
  floorPalette.portcullisBars, floorPalette.breachCavity, floorPalette.breachRubble,
  floorPalette.chandIron, floorPalette.chandWax,
];

/** Construct the entire closed floor-decor palette into the registry — every plain material
 *  plus every tinted material × the bounded per-act tint set — so the boot warm compiles it
 *  all up front instead of lazily on first room-reveal. Idempotent (stdMat caches). */
export function primeFloorPalette(tints: number[]): void {
  for (const make of PLAIN) make();
  for (const make of TINTED) for (const t of tints) make(t);
}
