import * as THREE from 'three';
import { getInstancingDiag, type BatchDiag } from '../mobs/creature-instancing';

// Scene audit — a read-only tally of every drawable in the scene graph, grouped
// by category, for finding LEAKS: when `geo`/draws climb and never recover, this
// names WHAT is piling up (corpses? drops? blood? instanced batches?) instead of
// guessing. Captured into a perf recording's meta at save time, so a post-fight
// recording shows the accumulated scene. Pure read — never mutates anything.

export interface SceneAuditEntry {
  meshes: number;       // how many Object3Ds of this category
  instances: number;    // total drawn instances (InstancedMesh count; 1 for a plain mesh/sprite)
}
export interface SceneAudit {
  total: { objects: number; meshes: number; instances: number; uniqueGeometries: number };
  /** Per-category tally, sorted desc by mesh count when serialised. */
  byKind: Record<string, SceneAuditEntry>;
  /** How many `dbgKind:'enemy'` InstancedMeshes are actually IN the scene graph
   *  (creature-instancing batches). Compare to instancing.mapSize: a gap =
   *  orphaned batch meshes left in the scene after being dropped from the map. */
  enemyBatchMeshesInScene: number;
  /** The live `batches` map state (key/used/capacity/count/free/inScene). */
  instancing: { mapSize: number; live: number; batches: BatchDiag[] };
}

/** Category for a drawable — prefer the explicit debug tags the codebase already
 *  stamps (creature-instancing sets dbgKind/dbgSource), then name, then type. */
function categorize(o: THREE.Object3D): string {
  const ud = o.userData || {};
  if (typeof ud.dbgKind === 'string') return ud.dbgKind;
  if (typeof ud.dbgSource === 'string') return String(ud.dbgSource).split(' ')[0];
  const m = o as THREE.Mesh & { isInstancedMesh?: boolean; isSprite?: boolean };
  if (m.isInstancedMesh) return `instanced:${o.name || 'creature'}`;
  if (m.isSprite) return `sprite:${(o as unknown as { material?: { name?: string } }).material?.name || o.name || '?'}`;
  // Strip trailing digits so "ghoul-corpse-3" and "-7" collapse to one bucket.
  const base = (o.name || (m.material as THREE.Material | undefined)?.type || 'mesh').replace(/[ -]?\d+$/, '');
  return base || 'mesh';
}

export function auditScene(root: THREE.Object3D): SceneAudit {
  const byKind: Record<string, SceneAuditEntry> = {};
  const geometries = new Set<string>();
  let objects = 0, meshes = 0, instances = 0, enemyBatchMeshesInScene = 0;

  root.traverse((o) => {
    objects++;
    const m = o as THREE.Mesh & { isMesh?: boolean; isInstancedMesh?: boolean; isSprite?: boolean; count?: number };
    if (!m.isMesh && !m.isInstancedMesh && !m.isSprite) return;
    if (m.isInstancedMesh && o.userData?.dbgKind === 'enemy') enemyBatchMeshesInScene++;   // count BEFORE the visible cull
    if (m.visible === false) return;   // hidden meshes aren't drawn — don't count them as load
    const key = categorize(o);
    const e = byKind[key] || (byKind[key] = { meshes: 0, instances: 0 });
    e.meshes++;
    meshes++;
    const inst = m.isInstancedMesh ? (m.count ?? 0) : 1;
    e.instances += inst;
    instances += inst;
    if (m.geometry) geometries.add((m.geometry as THREE.BufferGeometry).uuid);
  });

  // Sort byKind desc by mesh count for a readable, leak-spotting dump.
  const sorted: Record<string, SceneAuditEntry> = {};
  for (const [k, v] of Object.entries(byKind).sort((a, b) => b[1].meshes - a[1].meshes)) sorted[k] = v;

  return {
    total: { objects, meshes, instances, uniqueGeometries: geometries.size },
    byKind: sorted,
    enemyBatchMeshesInScene,
    instancing: getInstancingDiag(),
  };
}
