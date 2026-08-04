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
  return shared(stdCache, () => new THREE.MeshStandardMaterial(params), params);
}

/** Shared, structurally-deduplicated MeshBasicMaterial — the unlit twin of stdMat, for static
 *  interactable glows/rings/voids that aren't per-instance animated. (Animated ones own their
 *  instance — see the PIPELINE-BUDGET 'animated interactables' list.) */
export function basicMat(params: THREE.MeshBasicMaterialParameters): THREE.MeshBasicMaterial {
  return shared(basicCache, () => new THREE.MeshBasicMaterial(params), params);
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
