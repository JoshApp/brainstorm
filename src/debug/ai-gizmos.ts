import * as THREE from 'three';
import { DEV } from './dev';
import type { Enemy } from '../mobs/enemy';

// DEV in-world AI facing gizmos — three colored lines per mob so facing jitter is
// visible SPATIALLY, not just numerically:
//   RED   = body facing (where it points)
//   GREEN = actual velocity (where it's going)     → red≠green = crab-walk
//   BLUE  = desired-face target (what faceTarget aims at this frame)
//           → blue jittering = the TARGET is the problem;
//             red oscillating around a steady blue = the TURN LOGIC is.
//
// One pooled LineSegments (vertex-coloured), rebuilt each frame. Enable with
// ?aigizmos=1 or ?scenario=ai-lab. Whole module DCE's out of prod builds.

const MAX_MOBS = 48;
const SEGS = 3;                       // facing / velocity / target
const VERTS = MAX_MOBS * SEGS * 2;

let lines: THREE.LineSegments | null = null;
let posAttr: THREE.BufferAttribute | null = null;
const prevPos = new WeakMap<Enemy, { x: number; z: number }>();

export function aiGizmosEnabled(): boolean {
  if (!DEV || typeof location === 'undefined') return false;
  const q = new URLSearchParams(location.search);
  return q.get('aigizmos') === '1' || q.get('scenario') === 'ai-lab';
}

export function initAiGizmos(scene: THREE.Object3D): void {
  if (!DEV || lines) return;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(VERTS * 3);
  const col = new Float32Array(VERTS * 3);
  // Fixed per-vertex colours (both ends of each segment share a colour).
  const RED = [1, 0.25, 0.25], GREEN = [0.3, 1, 0.35], BLUE = [0.4, 0.6, 1];
  for (let m = 0; m < MAX_MOBS; m++) {
    const base = m * SEGS * 2;
    for (const [s, c] of [[0, RED], [1, GREEN], [2, BLUE]] as const) {
      for (let v = 0; v < 2; v++) {
        const i = (base + s * 2 + v) * 3;
        col[i] = c[0]; col[i + 1] = c[1]; col[i + 2] = c[2];
      }
    }
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.95 });
  lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  lines.renderOrder = 9999;   // draw over the world
  lines.visible = false;
  scene.add(lines);
  posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
}

/** Rebuild the gizmo lines from the live mobs. Call each frame. */
export function tickAiGizmos(enemies: readonly Enemy[] | undefined | null): void {
  if (!DEV || !lines || !posAttr) return;
  const on = aiGizmosEnabled();
  lines.visible = on;
  if (!on || !enemies) return;
  const arr = posAttr.array as Float32Array;
  let m = 0;
  for (const e of enemies) {
    if (m >= MAX_MOBS) break;
    if (!e.alive) continue;
    const d = e.aiDebug();
    const px = e.position.x, pz = e.position.z, py = e.position.y + e.aimHeight;
    // RED — body facing (−Z rotated by yaw; +π convention → dir = (−sin,−cos)).
    const fx = -Math.sin(d.yaw), fz = -Math.cos(d.yaw);
    // GREEN — velocity from last frame's displacement (scaled so a walk reads ~1m).
    const pv = prevPos.get(e);
    let vx = 0, vz = 0;
    if (pv) { vx = px - pv.x; vz = pz - pv.z; }
    prevPos.set(e, { x: px, z: pz });
    const vlen = Math.hypot(vx, vz);
    const vs = vlen > 1e-4 ? Math.min(1.6, vlen * 30) / vlen : 0;
    // BLUE — the point faceTarget is aiming at.
    let tx = d.faceX - px, tz = d.faceZ - pz;
    const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;

    const base = m * SEGS * 2 * 3;
    const seg = (s: number, ex: number, ez: number, len: number) => {
      const i = base + s * 2 * 3;
      arr[i] = px; arr[i + 1] = py; arr[i + 2] = pz;
      arr[i + 3] = px + ex * len; arr[i + 4] = py; arr[i + 5] = pz + ez * len;
    };
    seg(0, fx, fz, 1.3);          // facing
    seg(1, vx * vs, vz * vs, 1);  // velocity (already length-scaled)
    seg(2, tx, tz, 1.1);          // target
    m++;
  }
  // Zero out unused segments.
  for (let k = m; k < MAX_MOBS; k++) {
    const base = k * SEGS * 2 * 3;
    for (let j = 0; j < SEGS * 2 * 3; j++) arr[base + j] = 0;
  }
  posAttr.needsUpdate = true;
}
