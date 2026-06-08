// Draw-call report — the mobile-friendly, SHAREABLE answer to "what's eating
// the draw calls?" (spector.js does this too, but its UI is desktop-only and
// can't be sent anywhere). This walks the live scene graph, attributes the
// visible meshes to their geometry + material, and finds the biggest batching
// wins: groups of meshes that share one geometry+material and could collapse
// into a single InstancedMesh. Output is a readable text report shared via the
// OS share sheet, so you can fire it to the PC from your phone.
//
// Each unique (mesh) is ~one draw call in three.js (shadow casters draw again
// in the shadow pass, and the PSX pipeline adds bloom+blit passes — so the
// renderer's total is higher than the scene mesh count; both are reported).

import type * as THREE from 'three';
import { shareOrDownload, flash } from './share-file';
import { getCurrentDepth } from '../level/loader';

let scene: THREE.Scene | null = null;
let renderer: THREE.WebGLRenderer | null = null;

export function initDrawReport(s: THREE.Scene, r: THREE.WebGLRenderer): void {
  scene = s;
  renderer = r;
}

interface Group { count: number; tris: number; label: string }

function bump(map: Map<string, Group>, key: string, label: string, tris: number): void {
  const g = map.get(key);
  if (g) { g.count++; g.tris += tris; }
  else map.set(key, { count: 1, tris, label });
}

function triCount(g: THREE.BufferGeometry): number {
  const idx = g.index;
  if (idx) return Math.floor(idx.count / 3);
  const pos = g.attributes?.position;
  return pos ? Math.floor(pos.count / 3) : 0;
}

// SEMANTIC keys — group by what a mesh LOOKS like (shape + material params),
// not by object identity. The game mints a fresh geometry/material per entity
// instance, so keying on uuid would shatter "64 identical dark spheres" into 64
// rows and hide the real instancing win. Two meshes with the same semantic key
// are interchangeable draws that could collapse into one InstancedMesh.
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

export async function captureDrawReport(): Promise<void> {
  if (!scene) return;
  flash('draw report: analyzing scene…');

  const byGeom = new Map<string, Group>();
  const byMat = new Map<string, Group>();
  const byPair = new Map<string, Group>();   // geometry+material = instancing candidate
  let meshes = 0;
  let instanced = 0;
  let sceneTris = 0;

  const walk = (o: THREE.Object3D): void => {
    if (!o.visible) return;   // respect room-culling / hidden subtrees
    const m = o as THREE.Mesh;
    if (m.isMesh && m.geometry) {
      meshes++;
      const isInst = (m as unknown as { isInstancedMesh?: boolean }).isInstancedMesh === true;
      const instCount = isInst ? (m as THREE.InstancedMesh).count : 1;
      if (isInst) instanced++;
      const g = m.geometry;
      const tris = triCount(g);
      sceneTris += tris * instCount;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      const gk = geomKey(m, g);
      const mk = mats.map(matKey).join('+');
      bump(byGeom, gk, gk, tris);
      bump(byMat, mk, mk, tris);
      if (!isInst) bump(byPair, gk + '|' + mk, `${gk}  +  ${mk}`, tris);
    }
    for (const c of o.children) walk(c);
  };
  walk(scene);

  const info = renderer?.info;
  const draws = info ? info.render.calls : 0;
  const rtris = info ? info.render.triangles : 0;
  const programs = info?.programs?.length ?? 0;

  // Instancing candidates: same geometry+material, used by >1 non-instanced
  // mesh. Each could become one InstancedMesh, saving (count-1) draws.
  const candidates = [...byPair.values()].filter((g) => g.count > 1).sort((a, b) => b.count - a.count);
  const potentialSaving = candidates.reduce((s, g) => s + (g.count - 1), 0);

  const top = (m: Map<string, Group>, n: number) =>
    [...m.values()].sort((a, b) => b.count - a.count).slice(0, n);

  const L: string[] = [];
  L.push(`DELVE DRAW-CALL REPORT`);
  L.push(`depth ${getCurrentDepth()} · ${new Date().toISOString()}`);
  L.push('');
  L.push(`renderer: ${draws} draws · ${(rtris / 1000).toFixed(0)}k tris · ${programs} shader programs`);
  L.push(`  (draws span shadow + scene + bloom + blit passes; the blit is 1)`);
  L.push(`scene: ${meshes} visible meshes (${sceneTris / 1000 | 0}k tris) · ${instanced} already instanced`);
  L.push('');
  L.push(`TOP INSTANCING WINS  (same geometry+material → 1 InstancedMesh)`);
  if (candidates.length) {
    for (const g of candidates.slice(0, 14)) {
      L.push(`  ${String(g.count).padStart(4)}×  ${g.label}   → save ${g.count - 1} draws`);
    }
    L.push('');
    L.push(`  potential: ${meshes} meshes → ~${meshes - potentialSaving} (save ~${potentialSaving} draws)`);
  } else {
    L.push(`  none — no repeated geometry+material pairs (already lean, or all unique)`);
  }
  L.push('');
  L.push(`BY GEOMETRY (meshes sharing one geometry)`);
  for (const g of top(byGeom, 10)) L.push(`  ${String(g.count).padStart(4)}×  ${g.label}`);
  L.push('');
  L.push(`BY MATERIAL (meshes sharing one material)`);
  for (const g of top(byMat, 10)) L.push(`  ${String(g.count).padStart(4)}×  ${g.label}`);
  const text = L.join('\n');

  const name = `delve-draws-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.txt`;
  const shared = await shareOrDownload(name, text);
  flash(shared ? 'draw report shared' : 'draw report downloaded');
}
