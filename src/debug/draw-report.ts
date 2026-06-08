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
import { getViewmodelRoots } from '../style/render-target';

let scene: THREE.Scene | null = null;
let renderer: THREE.WebGLRenderer | null = null;
let getLevel: (() => LiveLevel | null) | null = null;

export function initDrawReport(s: THREE.Scene, r: THREE.WebGLRenderer, gl: () => LiveLevel | null): void {
  scene = s;
  renderer = r;
  getLevel = gl;
}

type Cat = 'enemy' | 'destructible' | 'viewmodel' | 'fixture' | 'shell' | 'prop' | 'decor';

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

function looseCat(m: THREE.Mesh): Cat {
  const k = m.userData?.dbgKind as string | undefined;
  if (k === 'wall' || k === 'floor' || k === 'ceiling' || k === 'fixtures') return 'shell';
  if (k === 'prop') return 'prop';
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
  const tag = (root: THREE.Object3D | undefined, cat: Cat) => {
    if (!root) return;
    root.traverse((c) => { if ((c as THREE.Mesh).isMesh) owner.set(c, cat); });
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
  const bySource: Record<Cat, number> = { enemy: 0, destructible: 0, viewmodel: 0, fixture: 0, shell: 0, prop: 0, decor: 0 };

  let meshes = 0, instanced = 0, sceneTris = 0;
  let mergedDraws = 0, mergeableNow = 0, dynamicDraws = 0;
  let shadowCasters = 0, transparentMeshes = 0;

  const walk = (o: THREE.Object3D): void => {
    if (!o.visible) return;   // respect room-culling / hidden subtrees
    const m = o as THREE.Mesh;
    if (m.isMesh && m.geometry) {
      meshes++;
      const cat: Cat = owner.get(m) ?? looseCat(m);
      bySource[cat]++;
      const inst = (m as unknown as { isInstancedMesh?: boolean }).isInstancedMesh === true;
      if (inst) instanced++;
      if (m.castShadow) shadowCasters++;
      const g = m.geometry;
      const tris = triCount(g);
      sceneTris += tris;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      if (mats.some(isTransparent)) transparentMeshes++;

      const merged = isMerged(m, cat);
      // Animated → can't simple-merge: enemies, shards, the held viewmodel, and
      // torch flames (which flicker/scale per frame).
      const dynamic = cat === 'enemy' || cat === 'destructible' || cat === 'viewmodel' || m.name === 'flame';
      if (merged) mergedDraws++;
      else if (dynamic) dynamicDraws++;
      else mergeableNow++;

      const gk = geomKey(m, g);
      const mk = mats.map(matKey).join('+');
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
  const draws = info ? info.render.calls : 0;
  const rtris = info ? info.render.triangles : 0;
  const programs = info?.programs?.length ?? 0;

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
  L.push(`renderer: ${draws} draws · ${(rtris / 1000).toFixed(0)}k tris · ${programs} shader programs`);
  L.push(`  (renderer total spans scene + shadow + bloom + blit passes)`);
  L.push(`scene: ${meshes} visible meshes · ${(sceneTris / 1000) | 0}k tris · ${instanced} instanced`);
  L.push(`  shadow casters: ${shadowCasters} (redrawn in the shadow pass when in the light's frustum)`);
  L.push(`  transparent/additive: ${transparentMeshes} (overdraw — GPU fill cost)`);
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
