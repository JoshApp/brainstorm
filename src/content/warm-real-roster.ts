import * as THREE from 'three';
import { ENEMIES } from './enemies';
import { ITEMS } from './items';
import { WARM_MODELS } from './warmup-models';
import { buildModel } from '../ecs/build-model';
import { buildCreature } from './build-creature';
import { buildSkinnedCreature } from '../mobs/creature-skinned';
import { warmRenderWebGPU } from '../style/render-webgpu';
import { registeredFloorMaterials } from '../style/material-registry';
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

  // FLOOR DECOR + static interactables — the shared stdMat/basicMat palette. The floor decor you walk
  // into mid-floor otherwise compiles its LIT shader on first reveal (the shared:std tail) because the
  // descent warms it with compileAsync, not a render. Render a box per shared material here so the decor
  // pipeline warms through the real path too. Shared instances, so one rep covers every decor that uses
  // it. The box (pos/normal/uv) matches the non-instanced decor layout. Box geometry is shared across
  // reps + disposed once at the end (not via `collect`, which would double-dispose it).
  const decorBox = new THREE.BoxGeometry(0.2, 0.2, 0.2);
  for (const mat of registeredFloorMaterials()) {
    try {
      // needsUpdate is the keystone for SHARED materials: a node material builds its WGSL ONCE per
      // instance and caches it; light changes don't invalidate it. These shared stdMat decor instances
      // were first built UNLIT at boot (before the floor's lights existed), and nothing re-dirties them,
      // so they stay unlit through the warm and only rebuild lit at play — the hitch. Bumping the version
      // forces a rebuild, so their FIRST LIT build happens now (lights are pumped active) behind the cover.
      (mat as THREE.Material).needsUpdate = true;
      subjects.push(new THREE.Mesh(decorBox, mat));
    } catch { /* skip */ }
  }

  // RENDER-warm — the keystone. compileAsync and a real render emit DIFFERENT shaders for LIT materials:
  // warming in the live scene with all its lights STILL recompiled on first spawn, which proves the gap
  // is the PATH, not the conditions. So we warm by RENDERING through the actual PSX render path
  // (warmRenderWebGPU → pipeline.renderAsync), making the warmed pipeline byte-identical to what the game
  // draws. A holder is parented under the LIVE scene (so the real lights/fog/ambient apply); every
  // subject mesh is forced frustumCulled=false + visible so the render draws — and therefore compiles —
  // it regardless of where it sits relative to the warm camera. Batched so one frame needn't draw the
  // whole roster; removed at the end so the live floor is untouched. renderAsync awaits each draw's
  // pipeline, so the compiles finish behind the descent cover.
  const holder = new THREE.Group();
  holder.name = '__warmRealRoster';
  liveScene.add(holder);
  const forceDraw = (root: THREE.Object3D): void => root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) { m.frustumCulled = false; m.visible = true; }
  });
  const BATCH = 24;
  let okBatches = 0, failBatches = 0;
  for (let i = 0; i < subjects.length; i += BATCH) {
    for (const s of subjects.slice(i, i + BATCH)) holder.add(s);
    forceDraw(holder);
    try { await warmRenderWebGPU(renderer, liveScene, camera, 2); okBatches++; }
    catch { failBatches++; }
    holder.clear();
    onProgress?.(Math.min(1, (i + BATCH) / subjects.length));
  }

  // EFFECTS + DECOR — the self-registered warmup hooks (VFX, decor palettes, sprite variants), warmed the
  // SAME way: spawn each into the holder under the live scene and RENDER, so it compiles with the real
  // lights + fog through the real path, one hook at a time so a single bad spawn can't abort the rest.
  let hookOk = 0, hookFail = 0;
  for (const hook of getWarmupHooks()) {
    try {
      hook.spawn(holder);
      forceDraw(holder);
      await warmRenderWebGPU(renderer, liveScene, camera, 2);
      hookOk++;
    } catch { hookFail++; }
    try { hook.clear(); } catch { /* the effect's pool clear */ }
    holder.clear();
  }
  liveScene.remove(holder);

  // Free the geometry (big buffers); keep the materials so the compiled pipelines stay cached.
  for (const g of geometries) g.dispose();
  decorBox.dispose();

  if (DEV) {
    // eslint-disable-next-line no-console
    console.log(`[warmRealRoster] ${subjects.length} subjects (${chunks} chunks) in ${okBatches}/${okBatches + failBatches} batches + ${hookOk}/${hookOk + hookFail} hooks, ${Math.round(performance.now() - t0)}ms (one-time; cached after)`);
  }
}
