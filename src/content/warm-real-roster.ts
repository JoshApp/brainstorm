import * as THREE from 'three';
import { ENEMIES } from './enemies';
import { ITEMS } from './items';
import { WARM_MODELS } from './warmup-models';
import { buildModel } from '../ecs/build-model';
import { buildCreature } from './build-creature';
import { buildSkinnedCreature } from '../mobs/creature-skinned';
import { warmSceneCompile } from '../style/render-webgpu';
import { isWebGPU } from '../scene/renderer-mode';
import { DEV } from '../debug/dev';

// ── REAL-ROSTER WARM — warm through the REAL build path, not a dummy ──────────────────────────────
//
// A WebGPU pipeline = material × EXACT vertex layout × render state. The cheap dummy warm
// (spawn-warmups.ts) compiles each material on a stand-in mesh (WARM_BOX / SKIN_GEO) — but every way
// the dummy's layout differs from the real geometry is a guaranteed first-spawn hitch (the long tail:
// Uint16-vs-Float32 skinIndex, missing aReveal attributes, chunk layouts). Dummies ALWAYS drift.
//
// This warms the opposite way: build ONE REAL instance of every enemy / prop / item through the SAME
// builders the game uses live, into a throwaway scene, and compile THOSE at the PSX target format.
// Because the warm and the live spawn run identical code, the warmed pipeline CANNOT drift from the
// live one — the entire dummy-vs-real mismatch class disappears by construction.
//
// Driven by the content REGISTRIES (ENEMIES / WARM_MODELS / ITEMS), so the coverage tracks content:
// add an enemy/prop/item to its registry — which you do to use it at all — and it warms itself here.
// No dummy to keep in sync, no per-build-path attribute to remember.
//
// Heavy (real CSG creatures), but ONE-TIME behind the boot loading bar; the compiled pipelines then
// live in the renderer + the browser's persistent cache, so repeat sessions skip the compile. We free
// the GEOMETRY afterward (compileAsync compiled the pipelines; we don't keep the meshes) but keep the
// MATERIALS alive so their pipeline-cache entries aren't evicted.

let done = false;

export async function warmRealRoster(
  renderer: THREE.WebGLRenderer,
  camera: THREE.Camera,
  onProgress?: (frac: number) => void,
): Promise<void> {
  if (done || !isWebGPU()) return;
  done = true;

  const scene = new THREE.Scene();
  const geometries: THREE.BufferGeometry[] = [];
  const add = (group: THREE.Object3D): void => {
    group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.geometry) geometries.push(m.geometry);
    });
    scene.add(group);
  };

  const t0 = DEV ? performance.now() : 0;
  let built = 0, failed = 0;

  // ENEMIES — real rigid-skinned creatures: the body pipeline + every per-material group, the exact
  // SkinnedMesh layout (Float32 skinIndex + per-vertex aReveal) the live spawn uses. PLUS the combat-
  // only geometry the body never reveals: dismember CHUNKS. A chunk is a non-skinned mesh the runtime
  // builds when a limb is severed (creature-skinned severBoneChunk) — a DIFFERENT vertex layout than
  // the body, so it's its own pipeline and was compiling on the first dismember mid-fight. We crumble
  // a second instance of every creature here so those chunk pipelines (opaque AND the transparent
  // spectral/ooze variants — we crumble every enemy) warm too. Same real code as the live sever.
  const DEFAULT_CUTS = ['head', 'shoulderL', 'shoulderR', 'armL', 'armR', 'hipL', 'hipR', 'legL', 'legR', 'tail'];
  for (const spec of Object.values(ENEMIES)) {
    try {
      const creature = buildCreature(spec.creature);
      buildSkinnedCreature(creature);     // adds the SkinnedMesh into creature.group
      add(creature.group);
      built++;
    } catch { failed++; }
    try {
      // Second instance, crumbled — warms the dismember-chunk pipelines (the crumble is destructive,
      // so it can't share the instance we just added as the live body).
      const c2 = buildCreature(spec.creature);
      const sk2 = buildSkinnedCreature(c2);
      const cuts = (spec as { severable?: readonly string[] }).severable ?? DEFAULT_CUTS;
      for (const chunk of sk2.crumbleToChunks(cuts)) add(chunk);
    } catch { /* a creature with no severable layout still warmed its body above */ }
  }
  // PROPS + ITEM DROPS — real models through buildModel (the placement / drop path).
  for (const spec of WARM_MODELS) {
    try { add(buildModel(spec).group); built++; } catch { failed++; }
  }
  for (const item of Object.values(ITEMS)) {
    try { add(buildModel(item.dropModel).group); built++; } catch { failed++; }
  }

  onProgress?.(0.5);
  // compileAsync over the whole roster at the bound PSX target — warmSceneCompile forces every object
  // visible + frustum-unculled, so all of it warms regardless of where the warm camera points.
  try { await warmSceneCompile(renderer, scene, camera); } catch { /* best-effort */ }
  onProgress?.(1);

  // Free the geometry (big buffers); keep the materials so the compiled pipelines stay cached.
  for (const g of geometries) g.dispose();
  scene.clear();

  if (DEV) {
    // eslint-disable-next-line no-console
    console.log(`[warmRealRoster] ${built} real subjects warmed${failed ? `, ${failed} failed` : ''} in ${Math.round(performance.now() - t0)}ms (one-time; cached after)`);
  }
}
