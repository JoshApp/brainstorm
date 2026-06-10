import * as THREE from 'three';

// Lambert-class shading preview — the A/B for the "PBR tax" question.
//
// The ATTR sweep prices the GGX/PBR shading model via scene.overrideMaterial,
// which is fair for COST but unfair for LOOKS (it drops colors, maps,
// emissives). This swaps every MeshStandardMaterial in the scene for a
// faithful MeshLambertMaterial twin — same color, maps, emissive, vertex
// colors, and the same injected shader chain (surface detail / AO chunks
// patch `#include <color_fragment>`, which Lambert's fragment shader also
// has) — so the difference you SEE is the shading model itself: GGX
// specular response + roughness/metalness vs plain diffuse.
//
// Profiler-suite tool (window.__lambert), not a player setting. If the look
// holds up, the real migration would be a material-build switch in
// style/materials.ts + build-model.ts, not this swapper.

interface SwappedEntry {
  mesh: THREE.Mesh;
  original: THREE.Material | THREE.Material[];
}

let active = false;
const swapped: SwappedEntry[] = [];
// Shared originals → shared twins, so material sharing (and program count)
// survives the swap.
const twinCache = new Map<THREE.Material, THREE.Material>();

function lambertTwin(src: THREE.Material): THREE.Material {
  const std = src as THREE.MeshStandardMaterial;
  if (!std.isMeshStandardMaterial) return src;   // sprites/shader/basic stay
  let twin = twinCache.get(src);
  if (twin) return twin;
  const lam = new THREE.MeshLambertMaterial({
    color: std.color.clone(),
    map: std.map,
    emissive: std.emissive.clone(),
    emissiveIntensity: std.emissiveIntensity,
    emissiveMap: std.emissiveMap,
    vertexColors: std.vertexColors,
    transparent: std.transparent,
    opacity: std.opacity,
    alphaTest: std.alphaTest,
    side: std.side,
    blending: std.blending,
    depthWrite: std.depthWrite,
    depthTest: std.depthTest,
    fog: std.fog,
    flatShading: std.flatShading,
  });
  lam.name = std.name ? `${std.name}·lambert` : 'lambert-twin';
  // Carry the injected shader chain (surface detail, AO, mood tint). The
  // chunks these patch (`color_fragment`, `normal_fragment_maps`) exist in
  // Lambert's shader too; customProgramCacheKey keeps variants distinct.
  if (std.onBeforeCompile) lam.onBeforeCompile = std.onBeforeCompile;
  if (std.customProgramCacheKey !== THREE.Material.prototype.customProgramCacheKey) {
    lam.customProgramCacheKey = std.customProgramCacheKey.bind(std);
  }
  twinCache.set(src, lam);
  return lam;
}

/** Swap the whole scene's standard materials to Lambert twins (on) or
 *  restore the originals (off). Idempotent per direction. */
export function setLambertPreview(scene: THREE.Scene, on: boolean): void {
  if (on === active) return;
  active = on;
  if (on) {
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.material) return;
      const orig = mesh.material;
      const next = Array.isArray(orig) ? orig.map(lambertTwin) : lambertTwin(orig);
      if (next === orig) return;
      swapped.push({ mesh, original: orig });
      mesh.material = next;
    });
  } else {
    for (const e of swapped) e.mesh.material = e.original;
    swapped.length = 0;
    // Twins stay cached (and their programs compiled) for instant re-toggle.
  }
}

export function isLambertPreview(): boolean { return active; }
