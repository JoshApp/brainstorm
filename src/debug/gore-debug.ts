import * as THREE from 'three';
import type { WallHit } from '../scene/splat-map';

// ── GORE DEBUG — see what the splash system decided ──────────────────
//
// Toggle in Settings → DEBUG (like the hit cones). For ~3s after each
// landed blow it draws:
//   ORANGE arrow   — the splash throw (impact point + direction,
//                    length = energy)
//   YELLOW rays    — the wall-probe cone (throw ±40°)
//   MAGENTA frame  — the wall the probe found (vertical outline on
//                    the wall plane at the arc's position)
//   GREEN rings    — every floor stamp (position + radius)
//
// Everything is plain line segments, created on the event and removed
// on expiry — debug-only cost, nothing when the toggle is off.

const TTL_S = 3.0;

let scene: THREE.Object3D | null = null;
let enabled = false;

interface Entry { obj: THREE.Object3D; dieAt: number }
const entries: Entry[] = [];

// Triangle meshes, not GL lines — lines vanish somewhere in the PS1
// low-res pipeline; the combat-debug cones (which render fine) use
// exactly this recipe: MeshBasicMaterial, fog off, high renderOrder.
const MAT_THROW = new THREE.MeshBasicMaterial({ color: 0xff8830, fog: false, depthTest: false, transparent: true, opacity: 0.95 });
const MAT_PROBE = new THREE.MeshBasicMaterial({ color: 0xffe060, fog: false, depthTest: false, transparent: true, opacity: 0.5 });
const MAT_WALL = new THREE.MeshBasicMaterial({ color: 0xff44dd, fog: false, depthTest: false, transparent: true, opacity: 0.9 });
const MAT_STAMP = new THREE.MeshBasicMaterial({ color: 0x55ff88, fog: false, depthTest: false, transparent: true, opacity: 0.7 });
const SEG_GEO = new THREE.BoxGeometry(1, 1, 1);

export function initGoreDebug(sc: THREE.Object3D): void {
  scene = sc;
}

export function setGoreDebugEnabled(on: boolean): void {
  enabled = on;
  if (!on) {
    for (const e of entries) e.obj.parent?.remove(e.obj);
    entries.length = 0;
  }
}

export function isGoreDebugEnabled(): boolean {
  return enabled;
}

function add(obj: THREE.Object3D): void {
  if (!scene) return;
  obj.renderOrder = 999;
  scene.add(obj);
  entries.push({ obj, dieAt: performance.now() / 1000 + TTL_S });
}

/** A thin box stretched from a to b — a chunky, PS1-proof line. */
function seg(a: THREE.Vector3, b: THREE.Vector3, mat: THREE.MeshBasicMaterial, thick = 0.03): THREE.Mesh {
  const m = new THREE.Mesh(SEG_GEO, mat);
  const len = a.distanceTo(b);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.scale.set(thick, thick, Math.max(0.01, len));
  m.lookAt(b);
  return m;
}

function polyline(points: THREE.Vector3[], mat: THREE.MeshBasicMaterial, thick = 0.03): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < points.length - 1; i++) g.add(seg(points[i], points[i + 1], mat, thick));
  return g;
}

/** The throw: impact point + direction, length scales with energy. */
export function markGoreThrow(x: number, z: number, y: number, dx: number, dz: number, energy: number): void {
  if (!enabled) return;
  const len = 0.5 + energy * 0.8;
  const tip = new THREE.Vector3(x + dx * len, y, z + dz * len);
  const head = 0.16;
  add(polyline([
    new THREE.Vector3(x, y, z), tip,
    new THREE.Vector3(tip.x - dx * head - dz * head, y, tip.z - dz * head + dx * head),
    tip,
    new THREE.Vector3(tip.x - dx * head + dz * head, y, tip.z - dz * head - dx * head),
  ], MAT_THROW, 0.045));
}

/** One wall-probe ray of the cone; `found` paints it solid. */
export function markGoreProbe(x: number, z: number, y: number, dx: number, dz: number, reach: number, found: boolean): void {
  if (!enabled) return;
  add(seg(
    new THREE.Vector3(x, y - 0.06, z),
    new THREE.Vector3(x + dx * reach, y - 0.06, z + dz * reach),
    found ? MAT_THROW : MAT_PROBE, 0.02,
  ));
}

/** The wall the probe found: a frame on the wall plane at the arc. */
export function markGoreWall(hit: WallHit, y: number, size: number): void {
  if (!enabled) return;
  const h = size * 1.1;
  const w = size * 1.0;
  const pts: THREE.Vector3[] = [];
  const corner = (a: number, b: number) =>
    hit.axis === 'x'
      ? new THREE.Vector3(hit.plane, y + b, hit.along + a)
      : new THREE.Vector3(hit.along + a, y + b, hit.plane);
  pts.push(corner(-w, -h), corner(w, -h), corner(w, h), corner(-w, h), corner(-w, -h));
  add(polyline(pts, MAT_WALL, 0.035));
}

/** A floor stamp: ring at its position + radius. */
export function markGoreStamp(x: number, z: number, r: number): void {
  if (!enabled) return;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    pts.push(new THREE.Vector3(x + Math.cos(a) * r, 0.04, z + Math.sin(a) * r));
  }
  add(polyline(pts, MAT_STAMP, 0.025));
}

export function tickGoreDebug(): void {
  if (entries.length === 0) return;
  const now = performance.now() / 1000;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].dieAt <= now) {
      const e = entries[i];
      e.obj.parent?.remove(e.obj);   // shared geometry/materials — nothing to dispose
      entries.splice(i, 1);
    }
  }
}
