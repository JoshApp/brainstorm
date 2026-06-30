import * as THREE from 'three';
import { ENEMIES } from './enemies';
import { ITEMS } from './items';
import { WARM_MODELS } from './warmup-models';
import { buildModel } from '../ecs/build-model';
import { buildCreature } from './build-creature';
import { buildSkinnedCreature } from '../mobs/creature-skinned';
import { warmSceneCompile } from '../style/render-webgpu';
import { getWarmupHooks } from './warmup-registry';
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
  liveScene: THREE.Scene,
  camera: THREE.Camera,
  onProgress?: (frac: number) => void,
): Promise<void> {
  if (done || !isWebGPU()) return;
  done = true;

  const subjects: THREE.Object3D[] = [];
  const geometries: THREE.BufferGeometry[] = [];
  const collect = (o: THREE.Object3D): void => {
    o.traverse((c) => {
      const m = c as THREE.Mesh;
      if (m.isMesh && m.geometry) geometries.push(m.geometry);
    });
    subjects.push(o);
  };

  const t0 = DEV ? performance.now() : 0;
  let chunks = 0;

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
      collect(creature.group);
    } catch { /* body failed — chunks below still try */ }
    try {
      // Second instance, crumbled — warms the dismember-chunk pipelines (the crumble is destructive,
      // so it can't share the instance we just added as the live body).
      const c2 = buildCreature(spec.creature);
      const sk2 = buildSkinnedCreature(c2);
      const cuts = (spec as { severable?: readonly string[] }).severable ?? DEFAULT_CUTS;
      for (const chunk of sk2.crumbleToChunks(cuts)) { collect(chunk); chunks++; }
    } catch { /* a creature with no severable layout still warmed its body above */ }
  }
  // PROPS + ITEM DROPS — real models through buildModel (the placement / drop path).
  for (const spec of WARM_MODELS) {
    try { collect(buildModel(spec).group); } catch { /* skip */ }
  }
  for (const item of Object.values(ITEMS)) {
    try { collect(buildModel(item.dropModel).group); } catch { /* skip */ }
  }

  // Warm INSIDE THE LIVE SCENE — not a synthetic one. A pipeline's shader is the LIT lighting model the
  // game uses (indirectDiffuse + ambientOcclusion from the scene's ambient/light pool); a bare warm
  // scene with no lights compiles the UNLIT variant, a different pipeline, so every lit material
  // recompiled on first spawn (the shared:std / dis tail). The live scene already carries the exact
  // lights + fog + ambient, so compiling subjects parented under it produces the pipeline the game
  // actually draws. We attach a holder under the live scene, fill it a batch at a time, compile, and
  // empty it — batched so one malformed object can't abort the whole warm, and removed at the end so the
  // live floor is untouched. The live floor's own pipelines are already cached, so each compile only
  // does the batch's new work.
  const holder = new THREE.Group();
  holder.name = '__warmRealRoster';
  liveScene.add(holder);
  const BATCH = 12;
  let okBatches = 0, failBatches = 0;
  for (let i = 0; i < subjects.length; i += BATCH) {
    for (const s of subjects.slice(i, i + BATCH)) holder.add(s);
    try { await warmSceneCompile(renderer, liveScene, camera); okBatches++; }
    catch { failBatches++; }
    holder.clear();
    onProgress?.(Math.min(1, (i + BATCH) / subjects.length));
  }

  // EFFECTS + DECOR — the self-registered warmup hooks (VFX, decor palettes, sprite variants), warmed
  // the SAME way: spawn each into the holder under the live scene so it compiles with the real lights +
  // fog, one hook at a time so a single bad spawn can't abort the rest.
  let hookOk = 0, hookFail = 0;
  for (const hook of getWarmupHooks()) {
    try {
      hook.spawn(holder);
      await warmSceneCompile(renderer, liveScene, camera);
      hookOk++;
    } catch { hookFail++; }
    try { hook.clear(); } catch { /* the effect's pool clear */ }
    holder.clear();
  }
  liveScene.remove(holder);

  // Free the geometry (big buffers); keep the materials so the compiled pipelines stay cached.
  for (const g of geometries) g.dispose();

  if (DEV) {
    // eslint-disable-next-line no-console
    console.log(`[warmRealRoster] ${subjects.length} subjects (${chunks} chunks) in ${okBatches}/${okBatches + failBatches} batches + ${hookOk}/${hookOk + hookFail} hooks, ${Math.round(performance.now() - t0)}ms (one-time; cached after)`);
  }
}
