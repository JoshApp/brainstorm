// Draw-call report — a mobile-friendly, SHAREABLE optimization plan for "what's
// eating the draw calls?" It walks the live scene, attributes every visible mesh
// to its OWNER (enemy / fixture / destructible / prop / decor / shell) using the
// level's own collections, splits the draws into "already merged",
// "mergeable now" (static decor we could fold into the existing per-room merge
// pass) and "dynamic" (enemies/shards — need instancing + pooling), and ranks
// the concrete instancing wins in each tier. Plus shadow-caster and
// transparency (overdraw) counts. Output is a text report shared via the OS
// share sheet so it gets off the phone.
//
// Why this beats spector here: spector is GL-level (it sees "draw with program 7
// / texture 3"), with no idea an object is an altar vs an enemy. This has the
// game semantics, so it tells you WHAT to instance/merge, which is the plan.

import type * as THREE from 'three';
import type { LiveLevel } from '../level/builder';
import { shareOrDownload, flash } from './share-file';
import { getCurrentDepth } from '../level/loader';
import { getViewmodelRoots } from '../style/render-frame';
import { pipelineCount, type DelveRenderer } from '../scene/create-renderer';
import { perFrameDraws } from './frame-timing';
import { originOf, untaggedDrawables } from '../scene/provenance';

let scene: THREE.Scene | null = null;
let renderer: DelveRenderer | null = null;
let getLevel: (() => LiveLevel | null) | null = null;

export function initDrawReport(s: THREE.Scene, r: DelveRenderer, gl: () => LiveLevel | null): void {
  scene = s;
  renderer = r;
  getLevel = gl;
}

/** Structured totals (no formatting, no share) — the numbers `captureDrawReport`
 *  prints, returned as data so a headless probe can A/B them. The key pair is
 *  `drawables` (actual visible meshes/sprites/points = the SCENE pass) vs
 *  `draws` (renderer.info.render.calls = scene + shadow + bloom/blit). When a
 *  per-object delta in `draws` exceeds the delta in `drawables`, the gap is the
 *  shadow + post passes, not geometry — the distinction every absolute reading
 *  needs. Exposed as window.__drawData() (DEV). */
export interface DrawReportData {
  draws: number; rtris: number;
  drawables: number; meshes: number; sprites: number; points: number;
  shadowCasters: number; transparent: number; sceneTris: number;
  programs: number; geometries: number; textures: number;
  lightsActive: number; lightsShadow: number;
  /** Visible drawables by owner (enemy/fixture/shell/prop/decor/sprite/fx/…) —
   *  "where do the draws go", so an optimization targets the biggest bucket. */
  bySource: Record<Cat, number>;
  /** Mergeability split: already merged/instanced · loose STATIC that could
   *  fold into the per-room merge (the achievable win) · dynamic (can't merge). */
  mergedDraws: number; mergeableNow: number; dynamicDraws: number;
  /** Loose-static (decor/prop) drawables tallied by GENERATING SYSTEM (the
   *  nearest ancestor's userData.dbgSource — surface-clutter / geometry-warp /
   *  doorframe / authored / …). Answers "what ARE the unmerged props". */
  looseBySource: Record<string, number>;
  /** Drawables NO system claims — the ratchet for the provenance work. While
   *  this is non-zero the population accounting is incomplete by exactly this
   *  much, and every merge/bake decision above it is partly guesswork. */
  untagged: number;
  /** The biggest anonymous populations, so they can be found in the code. */
  untaggedKinds: Record<string, number>;
}

export function drawReportData(): DrawReportData | null {
  if (!scene) return null;

  // Owner map (same tagging as captureDrawReport): attribute each drawable to
  // its enemy / fixture / destructible / viewmodel group; everything else falls
  // to looseCat (shell/prop/decor by dbgKind).
  const owner = new Map<THREE.Object3D, Cat>();
  const isDrawable = (c: THREE.Object3D): boolean => {
    const a = c as unknown as { isMesh?: boolean; isSprite?: boolean; isPoints?: boolean };
    return a.isMesh === true || a.isSprite === true || a.isPoints === true;
  };
  const tag = (root: THREE.Object3D | undefined, cat: Cat) => {
    if (root) root.traverse((c) => { if (isDrawable(c)) owner.set(c, cat); });
  };
  const level = getLevel?.();
  if (level) {
    for (const e of level.enemies) tag(e.group, 'enemy');
    for (const t of level.torches) tag(t.group, 'fixture');
    for (const d of level.destructibles) tag(d.group, 'destructible');
  }
  for (const vm of getViewmodelRoots()) tag(vm, 'viewmodel');

  const bySource: Record<Cat, number> = {
    enemy: 0, destructible: 0, viewmodel: 0, fixture: 0, shell: 0, prop: 0, decor: 0,
    sprite: 0, particle: 0, fx: 0,
  };
  let meshes = 0, sprites = 0, points = 0, shadowCasters = 0, transparent = 0, sceneTris = 0;
  let lightsActive = 0, lightsShadow = 0;
  let mergedDraws = 0, mergeableNow = 0, dynamicDraws = 0;
  const looseBySource: Record<string, number> = {};
  // Walk up to the nearest ancestor carrying a dbgSource tag (props set it on
  // the group; the renderable meshes are untagged children) — coarsened to the
  // generating-system prefix before the first separator.
  const provenance = (o: THREE.Object3D): string => {
    let n: THREE.Object3D | null = o;
    while (n) {
      const src = (n.userData?.dbgSource as string | undefined);
      if (src) return src.split(/[ ·:@]/)[0] || src;
      const dk = n.userData?.dbgKind as string | undefined;
      if (dk && dk !== 'prop') return dk;
      n = n.parent;
    }
    // No tag anywhere up the chain — fall back to a geometry/material hint so
    // the "untagged" bucket is still identifiable.
    const m = o as THREE.Mesh;
    const v = m.geometry?.attributes?.position?.count ?? 0;
    const name = m.name || (m.material as THREE.MeshStandardMaterial)?.color?.getHexString?.() || m.type;
    return `untagged:${name}·${v}v`;
  };
  const walk = (o: THREE.Object3D): void => {
    if (!o.visible) return;   // respect room-culling / hidden subtrees (matches the report)
    const lit = o as unknown as { isLight?: boolean; intensity?: number; castShadow?: boolean };
    if (lit.isLight && (lit.intensity ?? 0) > 0.001) {
      lightsActive++;
      if (lit.castShadow) lightsShadow++;
    }
    const a = o as unknown as { isMesh?: boolean; isSprite?: boolean; isPoints?: boolean };
    const isSprite = a.isSprite === true;
    const isPoints = a.isPoints === true;
    const m = o as THREE.Mesh;
    if ((m.isMesh && m.geometry) || isSprite || (isPoints && m.geometry)) {
      if (isSprite) sprites++; else if (isPoints) points++; else meshes++;
      if (m.castShadow) shadowCasters++;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      const isTrans = isSprite || mats.some((mm) => mm && isTransparent(mm));
      if (isTrans) transparent++;
      if ((m.isMesh || isPoints) && m.geometry) sceneTris += triCount(m.geometry);
      let cat: Cat = owner.get(o) ?? (isSprite ? 'sprite' : isPoints ? 'particle' : looseCat(m));
      if (cat === 'decor' && isTrans) cat = 'fx';   // loose transparent = effect, not mergeable decor
      bySource[cat]++;
      const merged = !isSprite && !isPoints && isMerged(m, cat);
      const dynamic = cat === 'enemy' || cat === 'destructible' || cat === 'viewmodel'
        || cat === 'sprite' || cat === 'particle' || cat === 'fx' || m.name === 'flame';
      if (merged) mergedDraws++; else if (dynamic) dynamicDraws++; else {
        mergeableNow++;
        const src = provenance(o);
        looseBySource[src] = (looseBySource[src] ?? 0) + 1;
      }
    }
    for (const c of o.children) walk(c);
  };
  walk(scene);
  const info = renderer?.info;
  // Everything no system claims. Computed over the whole scene, not the culled
  // walk above: an object hidden this frame is still an object we cannot
  // account for.
  const untag = untaggedDrawables(scene);
  return {
    draws: perFrameDraws(info),
    rtris: info ? info.render.triangles : 0,
    drawables: meshes + sprites + points, meshes, sprites, points,
    shadowCasters, transparent, sceneTris,
    programs: renderer ? pipelineCount(renderer) : 0,
    geometries: info ? info.memory.geometries : 0,
    textures: info ? info.memory.textures : 0,
    lightsActive, lightsShadow, bySource,
    mergedDraws, mergeableNow, dynamicDraws, looseBySource,
    untagged: untag.count, untaggedKinds: untag.kinds,
  };
}

type Cat = 'enemy' | 'destructible' | 'viewmodel' | 'fixture' | 'shell' | 'prop' | 'decor'
  // Drawables the old walk missed or mislabeled:
  //   sprite   — THREE.Sprite (motes, wisps, coin/blood/puff halos, projectile
  //              trails). Each is a draw AND additive overdraw; the mesh-only
  //              walk counted ZERO of them.
  //   particle — THREE.Points clouds.
  //   fx       — pooled/transient effect MESHES (coin disc, shatter shard, blood
  //              drop, blade-trail, telegraph ring, projectile). Dynamic — they
  //              are NOT mergeable static decor, which is how the old walk scored
  //              them. Tagged at the source via userData.dbgKind === 'fx'.
  | 'sprite' | 'particle' | 'fx';

interface Group { count: number; tris: number; label: string; cats: Set<Cat> }

function bump(map: Map<string, Group>, key: string, label: string, tris: number, cat: Cat): void {
  const g = map.get(key);
  if (g) { g.count++; g.tris += tris; g.cats.add(cat); }
  else map.set(key, { count: 1, tris, label, cats: new Set([cat]) });
}

function triCount(g: THREE.BufferGeometry): number {
  const idx = g.index;
  if (idx) return Math.floor(idx.count / 3);
  const pos = g.attributes?.position;
  return pos ? Math.floor(pos.count / 3) : 0;
}

function geomKey(mesh: THREE.Mesh, g: THREE.BufferGeometry): string {
  const v = g.attributes?.position?.count ?? 0;
  return mesh.name || g.name || `${g.type}·${v}v`;
}

function matKey(m: THREE.Material): string {
  const sm = m as unknown as {
    color?: { getHexString(): string }; roughness?: number; metalness?: number;
    emissive?: { getHexString(): string };
  };
  const c = sm.color ? '#' + sm.color.getHexString() : '';
  const e = sm.emissive && sm.emissive.getHexString() !== '000000' ? '+e' + sm.emissive.getHexString() : '';
  const r = sm.roughness !== undefined ? `r${sm.roughness.toFixed(1)}` : '';
  const mm = sm.metalness !== undefined ? `m${sm.metalness.toFixed(1)}` : '';
  return m.name || `${m.type}·${c}${e}${r}${mm}`;
}

function looseCat(m: THREE.Object3D): Cat {
  // ASK THE ANCESTORS, not just this mesh. This read the mesh's OWN userData and
  // nothing else, so anything generated as a tagged GROUP of untagged meshes —
  // which is most of the world — reported as 'decor'. That is how a floor with a
  // shell, props and fixtures came back as `shell: 0, prop: 0, fixture: 0` with
  // 953 drawables filed under 'decor': the tags existed, one level up, and the
  // categoriser never looked. Tagging is a group-level fact (scene/provenance.ts),
  // so the reader has to be too.
  const k = originOf(m)?.system;
  if (k === 'wall' || k === 'floor' || k === 'ceiling' || k === 'trim' || k === 'fixtures') return 'shell';
  if (k === 'batched') return 'shell';       // already collapsed — not outstanding work
  if (k === 'prop' || k === 'clutter') return 'prop';
  if (k === 'fx') return 'fx';
  // Creature-instancing batches hang off the level root (not any one enemy's
  // group), so the owner map can't tag them — they self-identify instead.
  if (k === 'enemy') return 'enemy';
  return 'decor';
}

function isMerged(m: THREE.Mesh, cat: Cat): boolean {
  return cat === 'shell'
    || /merged/i.test(m.name)
    || (m as unknown as { isInstancedMesh?: boolean }).isInstancedMesh === true;
}

function isTransparent(m: THREE.Material): boolean {
  return m.transparent === true || (m as unknown as { blending?: number }).blending === 2 /* AdditiveBlending */;
}

export async function captureDrawReport(): Promise<void> {
  if (!scene) return;
  flash('draw report: analyzing scene…');

  // Ownership map: tag every mesh under an enemy / torch / destructible group so
  // the walk can attribute it. Everything else is loose level geometry.
  const owner = new Map<THREE.Object3D, Cat>();
  const isDrawable = (c: THREE.Object3D): boolean => {
    const a = c as unknown as { isMesh?: boolean; isSprite?: boolean; isPoints?: boolean };
    return a.isMesh === true || a.isSprite === true || a.isPoints === true;
  };
  const tag = (root: THREE.Object3D | undefined, cat: Cat) => {
    if (!root) return;
    root.traverse((c) => { if (isDrawable(c)) owner.set(c, cat); });
  };
  const level = getLevel?.();
  if (level) {
    for (const e of level.enemies) tag(e.group, 'enemy');
    for (const t of level.torches) tag(t.group, 'fixture');
    for (const d of level.destructibles) tag(d.group, 'destructible');
  }
  for (const vm of getViewmodelRoots()) tag(vm, 'viewmodel');   // hand / weapon / lamp — animated

  const byGeom = new Map<string, Group>();
  const byMat = new Map<string, Group>();
  const byPairStatic = new Map<string, Group>();    // mergeable now
  const byPairDynamic = new Map<string, Group>();    // need instancing + pooling
  const bySource: Record<Cat, number> = {
    enemy: 0, destructible: 0, viewmodel: 0, fixture: 0, shell: 0, prop: 0, decor: 0,
    sprite: 0, particle: 0, fx: 0,
  };

  let meshes = 0, sprites = 0, points = 0, instanced = 0, sceneTris = 0;
  let mergedDraws = 0, mergeableNow = 0, dynamicDraws = 0;
  let shadowCasters = 0, transparentMeshes = 0, spriteOverdraw = 0;
  // Lights drive a PER-FRAGMENT cost: every active PointLight is another
  // iteration of the lighting loop on every lit pixel, which the 0.4× render
  // scale does NOT reduce away (it's already the dominant fragment cost). A
  // shadow-caster additionally re-renders the scene into its cube map.
  let lightSlots = 0, lightsActive = 0, lightsShadow = 0;

  const walk = (o: THREE.Object3D): void => {
    if (!o.visible) return;   // respect room-culling / hidden subtrees
    const lit = o as unknown as { isLight?: boolean; isPointLight?: boolean; intensity?: number; castShadow?: boolean };
    if (lit.isLight) {
      if (lit.isPointLight) lightSlots++;
      if ((lit.intensity ?? 0) > 0.001) {
        lightsActive++;
        if (lit.castShadow) lightsShadow++;
      }
    }
    const a = o as unknown as { isMesh?: boolean; isSprite?: boolean; isPoints?: boolean; isInstancedMesh?: boolean };
    const isSprite = a.isSprite === true;
    const isPoints = a.isPoints === true;
    const m = o as THREE.Mesh;
    // A drawable is a Mesh, a Sprite, or a Points cloud — each is ONE GL draw.
    // The old walk only saw Mesh, so every sprite (motes/wisps/halos/trails)
    // and every Points cloud was missing from the accounting entirely.
    if ((m.isMesh && m.geometry) || isSprite || (isPoints && m.geometry)) {
      const inst = a.isInstancedMesh === true;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      // Sprites are always camera-facing transparent quads → guaranteed overdraw.
      const transparent = isSprite || mats.some((mm) => mm && isTransparent(mm));

      let cat: Cat = owner.get(o)
        ?? (isSprite ? 'sprite' : isPoints ? 'particle' : looseCat(m));
      // A LOOSE transparent/additive mesh (not owned, not tagged shell/prop) is
      // an effect — blade-trail, telegraph ring, lash tendril, projectile,
      // shatter shard, god-ray plane — NOT static decor we could merge. The old
      // walk scored every one of these as a mergeable static-decor win.
      if (cat === 'decor' && transparent) cat = 'fx';
      bySource[cat]++;
      if (inst) instanced++;
      if ((o as THREE.Mesh).castShadow) shadowCasters++;
      if (transparent) transparentMeshes++;
      if (isSprite) spriteOverdraw++;

      const tris = (m.isMesh || isPoints) && m.geometry ? triCount(m.geometry) : 0;
      sceneTris += tris;
      if (isSprite) sprites++; else if (isPoints) points++; else meshes++;

      const merged = !isSprite && !isPoints && isMerged(m, cat);
      // Animated / pooled → can't simple-merge: enemies, shards, the held
      // viewmodel, torch flames, and now EVERY sprite / particle / fx mesh.
      const dynamic = cat === 'enemy' || cat === 'destructible' || cat === 'viewmodel'
        || cat === 'sprite' || cat === 'particle' || cat === 'fx' || m.name === 'flame';
      if (merged) mergedDraws++;
      else if (dynamic) dynamicDraws++;
      else mergeableNow++;

      const gk = isSprite ? 'Sprite·quad'
        : isPoints ? `Points·${(m.geometry.attributes?.position?.count ?? 0)}p`
        : geomKey(m, m.geometry);
      const mk = mats.map((mm) => (mm ? matKey(mm) : '∅')).join('+');
      bump(byGeom, gk, gk, tris, cat);
      bump(byMat, mk, mk, tris, cat);
      if (!inst && !merged) {
        bump(dynamic ? byPairDynamic : byPairStatic, gk + '|' + mk, `${gk}  +  ${mk}`, tris, cat);
      }
    }
    for (const c of o.children) walk(c);
  };
  walk(scene);

  const info = renderer?.info;
  const draws = perFrameDraws(info);
  const rtris = info ? info.render.triangles : 0;
  const programs = renderer ? pipelineCount(renderer) : 0;
  // GPU-resource counts — capture two reports (fresh vs after the slowdown sets
  // in); if these climb while the JS heap stays flat, that's the leak (created-
  // not-disposed geometry/texture, or a growing shader-program cache).
  const geoCount = info ? info.memory.geometries : 0;
  const texCount = info ? info.memory.textures : 0;

  const wins = (map: Map<string, Group>) =>
    [...map.values()].filter((g) => g.count > 1).sort((a, b) => b.count - a.count);
  const staticWins = wins(byPairStatic);
  const dynWins = wins(byPairDynamic);
  const saving = (gs: Group[]) => gs.reduce((s, g) => s + (g.count - 1), 0);

  const top = (m: Map<string, Group>, n: number) =>
    [...m.values()].sort((a, b) => b.count - a.count).slice(0, n);

  const L: string[] = [];
  L.push(`DELVE DRAW-CALL REPORT`);
  L.push(`depth ${getCurrentDepth()} · ${new Date().toISOString()}`);
  L.push('');
  const drawables = meshes + sprites + points;
  // The renderer total spans the SCENE pass (every visible drawable), the SHADOW
  // pass (each caster redrawn into the lamp's cube map), and the post passes
  // (bloom downsample/blur/upsample + blit). Reconcile so the shadow + post
  // share is explicit instead of hidden in the gap.
  const accounted = drawables + shadowCasters;
  L.push(`renderer: ${draws} draws · ${(rtris / 1000).toFixed(0)}k tris · ${programs} programs · ${geoCount} geo · ${texCount} tex`);
  L.push(`  (programs/geo/tex climbing across a session while heap is flat = a GPU-resource leak — the degradation that a tab-out resets)`);
  L.push(`  scene drawables ${drawables} + shadow casters ${shadowCasters} ≈ ${accounted}; remaining ${Math.max(0, draws - accounted)} = bloom/blit post`);
  L.push(`scene: ${meshes} meshes · ${sprites} sprites · ${points} points · ${(sceneTris / 1000) | 0}k tris · ${instanced} instanced`);
  L.push(`  shadow casters: ${shadowCasters} (redrawn in the shadow pass — CPU draws + cube-map fill)`);
  L.push(`  transparent/additive: ${transparentMeshes} (overdraw — GPU fill), of which ${spriteOverdraw} are sprites (full camera-facing quads)`);
  L.push(`  lights: ${lightsActive} active of ${lightSlots} slots · ${lightsShadow} casting shadow`);
  L.push(`    (each active light = one more lighting-loop pass per LIT FRAGMENT — the 0.4x scale doesn't reduce this; a shadow-caster also re-draws the scene into a cube map)`);
  L.push('');
  L.push(`WHERE THE DRAWS GO (visible meshes by owner)`);
  for (const [cat, n] of (Object.entries(bySource) as [Cat, number][]).sort((a, b) => b[1] - a[1])) {
    if (n) L.push(`  ${String(n).padStart(4)}  ${cat}`);
  }
  L.push('');
  L.push(`MERGEABILITY  (the achievable win)`);
  L.push(`  already merged/instanced : ${mergedDraws}`);
  L.push(`  mergeable now (static decor → mergeStatic) : ${mergeableNow}  →  ~${mergeableNow - saving(staticWins)} after merge (save ~${saving(staticWins)})`);
  L.push(`  dynamic (enemies/shards → instancing + pooling) : ${dynamicDraws}  →  ~${dynamicDraws - saving(dynWins)} if instanced (save ~${saving(dynWins)})`);
  L.push('');
  L.push(`STATIC MERGE WINS  (same geometry+material, mergeable now)`);
  if (staticWins.length) for (const g of staticWins.slice(0, 12)) L.push(`  ${String(g.count).padStart(4)}×  ${g.label}   → save ${g.count - 1}`);
  else L.push('  none');
  L.push('');
  L.push(`DYNAMIC INSTANCING WINS  (identical, but moving/breaking → InstancedMesh + pool)`);
  if (dynWins.length) for (const g of dynWins.slice(0, 12)) L.push(`  ${String(g.count).padStart(4)}×  ${g.label}  [${[...g.cats].join(',')}]   → save ${g.count - 1}`);
  else L.push('  none');
  L.push('');
  L.push(`BY GEOMETRY`);
  for (const g of top(byGeom, 10)) L.push(`  ${String(g.count).padStart(4)}×  ${g.label}  [${[...g.cats].join(',')}]`);
  L.push('');
  L.push(`BY MATERIAL`);
  for (const g of top(byMat, 10)) L.push(`  ${String(g.count).padStart(4)}×  ${g.label}  [${[...g.cats].join(',')}]`);
  const text = L.join('\n');

  const name = `delve-draws-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.txt`;
  const shared = await shareOrDownload(name, text);
  flash(shared ? 'draw report shared' : 'draw report downloaded');
}
