import * as THREE from 'three';
import { getAllInteractables } from './system';
import { outlineStats } from './outline';

// ── INTERACTABLE CENSUS ─────────────────────────────────────────────────────
//
// "Interactables are the biggest population in the scene" was measured on a
// phone recording — 59 loose meshes, more than the level shell's 48. That
// number is a total, and a total tells you nothing about what to do: 59 could
// be one staircase or thirty pickups, and the fix is completely different.
//
// So this splits it by KIND, and reports for each kind the thing that decides
// whether merging is worth it: how many objects there are, how many meshes
// each one costs, and how many of those meshes an outline pass duplicates when
// the player walks near.
//
// It reads the LIVE scene through getAllInteractables(), so it is a measurement
// and not a model of one. DEV-only (window.__interactables()).

export interface KindRow {
  kind: string;
  /** How many of this kind are alive right now. */
  count: number;
  /** Meshes across all of them (the draw-call mass, before culling). */
  meshes: number;
  /** Sprites — billboards can't merge, so they're the floor on any win here. */
  sprites: number;
  /** Meshes that are currently outline hulls (one extra additive draw each). */
  hulls: number;
  /** Meshes a merge could still fold away: opaque, unnamed-parent siblings. */
  mergeable: number;
  tris: number;
}

export interface InteractableCensus {
  total: number;
  meshes: number;
  sprites: number;
  hulls: number;
  mergeable: number;
  kinds: KindRow[];
  outline: ReturnType<typeof outlineStats>;
}

/** The kind label for a row. Prefers the provenance detail the registration
 *  seam stamps (`interactable [OPEN]`), falls back to the prompt verb, then to
 *  the model group's name — in that order because the first is authored and the
 *  last is incidental. */
function kindOf(group: THREE.Object3D | undefined, promptLabel: string): string {
  const src = group?.userData?.dbgSource;
  if (typeof src === 'string') {
    const m = /\[([^\]]+)\]/.exec(src);
    if (m) return m[1];
  }
  return promptLabel || group?.name || 'unnamed';
}

/** Could this mesh still be merged away? Deliberately the SAME predicate shape
 *  merge-static uses — opaque, not a sprite, not already a merge product — so
 *  the census can't claim a win the merger wouldn't actually take. It is a
 *  ceiling, not a promise: merge-static also refuses named parts. */
function isMergeable(m: THREE.Mesh): boolean {
  if (!m.isMesh || !m.geometry) return false;
  if (m.userData.outline) return false;
  const mat = m.material as THREE.Material | THREE.Material[];
  if (Array.isArray(mat)) return false;
  if (mat?.transparent) return false;
  if ((m as THREE.InstancedMesh).isInstancedMesh) return false;
  return true;
}

export function interactableCensus(): InteractableCensus {
  const rows = new Map<string, KindRow>();
  let total = 0, meshes = 0, sprites = 0, hulls = 0, mergeable = 0;

  for (const it of getAllInteractables()) {
    const g = it.built?.group;
    const kind = kindOf(g, it.promptLabel);
    let row = rows.get(kind);
    if (!row) { row = { kind, count: 0, meshes: 0, sprites: 0, hulls: 0, mergeable: 0, tris: 0 }; rows.set(kind, row); }
    row.count++; total++;
    if (!g) continue;
    g.traverse((o) => {
      if ((o as THREE.Sprite).isSprite) { row!.sprites++; sprites++; return; }
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      row!.meshes++; meshes++;
      if (m.userData.outline) { row!.hulls++; hulls++; return; }
      const pos = m.geometry?.attributes?.position;
      if (pos) row!.tris += (m.geometry.index ? m.geometry.index.count : pos.count) / 3;
      if (isMergeable(m)) { row!.mergeable++; mergeable++; }
    });
  }

  const kinds = [...rows.values()].sort((a, b) => b.meshes - a.meshes);
  return { total, meshes, sprites, hulls, mergeable, kinds, outline: outlineStats() };
}

/** Human-readable table — what gets pasted into a work item. */
export function interactableCensusText(): string {
  const c = interactableCensus();
  const pad = (s: string | number, n: number) => String(s).padStart(n);
  const lines = [
    `INTERACTABLES · ${c.total} objects · ${c.meshes} meshes (${c.hulls} outline hulls) · ${c.sprites} sprites`,
    `  kind                cnt   meshes   /each    hulls   merge?     tris`,
  ];
  for (const k of c.kinds) {
    lines.push(`  ${k.kind.slice(0, 18).padEnd(18)} ${pad(k.count, 4)}  ${pad(k.meshes, 6)}  ${pad((k.meshes / k.count).toFixed(1), 6)}  ${pad(k.hulls, 6)}  ${pad(k.mergeable, 6)}  ${pad(k.tris, 7)}`);
  }
  const o = c.outline;
  lines.push(`  outline: ${o.targets} targets · ${o.hulls} hulls live · ${o.builds} built, ${o.rebuilds} of them REBUILDS · ${o.cacheHits} from cache`);
  return lines.join('\n');
}
