import * as THREE from 'three';

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

const cache = new Map<string, THREE.MeshStandardMaterial>();

// Canonical key over the params: sorted keys, THREE.Color → hex, textures → uuid. Two calls
// with structurally-equal params hash to the same key → share one instance → one pipeline.
function canonKey(p: THREE.MeshStandardMaterialParameters): string {
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

/** Shared, structurally-deduplicated MeshStandardMaterial — call this instead of
 *  `new THREE.MeshStandardMaterial` for any STATIC surface in per-floor build code, so the
 *  game's floor-material set stays closed and warmable. See docs/PIPELINE-BUDGET.md. */
export function stdMat(params: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
  const key = canonKey(params);
  let m = cache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial(params);
    m.userData.sharedPalette = true;   // teardown/dispose passes must skip it
    cache.set(key, m);
  }
  return m;
}

/** Every distinct floor material created so far — the closed set the warm compiles. */
export function registeredFloorMaterials(): THREE.MeshStandardMaterial[] {
  return [...cache.values()];
}

/** Count of distinct floor pipelines the registry holds (DEV diagnostics / invariant check). */
export function floorMaterialCount(): number { return cache.size; }
