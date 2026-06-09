import * as THREE from 'three';
import { getSettings } from '../settings/settings';
import { CONFIG } from '../config';

// Combat hit debug overlay (Settings → Debug → HIT CONES).
//
// Draws the ACTUAL melee hit geometry each swing AND every enemy's hurtbox, as
// real 3D solids that sit in the world (depth-tested — a wall in front occludes
// them), so you can see exactly what a swing covers and whether a target
// overlapped it:
//   - red capsules  = the enemy swing hitbox. The hit test sweeps a capsule
//                     (radius = SWORD_HITBOX_RADIUS) across the swing's arc; we
//                     draw one capsule per swept sample, posed along your TRUE
//                     look direction (pitch included). The fan of capsules IS
//                     the swept volume.
//   - cyan capsules = the wider/longer destructible (vase) hitbox.
//   - yellow spheres = each enemy's hurtbox (centre = position + aimHeight,
//                     radius = hitRadius). A hit lands when the sphere's centre
//                     comes within (hitRadius + capsule radius) of a capsule
//                     segment — i.e. when a sphere touches a capsule here.
// The swing capsules snapshot at the strike and linger ~0.6s fading out (a
// 100ms strike would be invisible otherwise). Read-only; gated on the setting.

const LINGER_S = 0.6;
const HURTBOX_POOL = 48;
const MAX_SAMPLES = 8;         // matches swingEnds[] in attack.ts
const HURTBOX_MIN_R = 0.12;    // most enemies have hitRadius 0 (a point); show a
                               // small marker so the aim point is still visible.

/** The shaped swing capsule, produced by attack.ts and consumed here. */
export interface SwingShape {
  reach: number;
  radius: number;
  sweepArc: number;    // total lateral sweep (radians); 0 = straight thrust
  sweepBias: number;   // lateral centre offset (radians)
}

interface Hurtbox { position: THREE.Vector3; aimHeight: number; hitRadius?: number; alive: boolean }

/** A pooled set of capsule meshes for one swing colour. The capsule geometry is
 *  rebuilt only when the swing's radius/reach changes (cheap — strikes only). */
interface CapsulePool {
  meshes: THREE.Mesh[];
  mat: THREE.MeshBasicMaterial;
  geom: THREE.CapsuleGeometry | null;
  radius: number;   // dims the current geom was built for
  length: number;
}

let scene: THREE.Object3D | null = null;
let enemyPool: CapsulePool | null = null;
let destrPool: CapsulePool | null = null;
let hurtboxes: THREE.Mesh[] = [];
let hurtMat: THREE.MeshBasicMaterial | null = null;
let hurtGeom: THREE.SphereGeometry | null = null;
let linger = 0;

function makeCapsulePool(color: number): CapsulePool {
  const mat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.18, side: THREE.DoubleSide,
    depthWrite: false, depthTest: true, fog: false,
  });
  const meshes: THREE.Mesh[] = [];
  for (let i = 0; i < MAX_SAMPLES; i++) {
    const m = new THREE.Mesh(undefined as unknown as THREE.BufferGeometry, mat);
    m.frustumCulled = false;
    m.renderOrder = 9000;
    m.visible = false;
    meshes.push(m);
  }
  return { meshes, mat, geom: null, radius: -1, length: -1 };
}

export function initCombatDebug(sc: THREE.Object3D): void {
  if (enemyPool) return;
  scene = sc;
  enemyPool = makeCapsulePool(0xff3040);   // enemy hitbox — red
  destrPool = makeCapsulePool(0x40d0ff);   // destructible hitbox — cyan
  for (const m of destrPool.meshes) scene.add(m);
  for (const m of enemyPool.meshes) scene.add(m);
  // Enemy hurtbox spheres — a small pool, shown only for alive enemies.
  hurtMat = new THREE.MeshBasicMaterial({
    color: 0xffe040, transparent: true, opacity: 0.22, depthWrite: false,
    depthTest: true, fog: false,
  });
  hurtGeom = new THREE.SphereGeometry(1, 16, 12);
  for (let i = 0; i < HURTBOX_POOL; i++) {
    const m = new THREE.Mesh(hurtGeom, hurtMat);
    m.frustumCulled = false;
    m.renderOrder = 9001;
    m.visible = false;
    hurtboxes.push(m);
    scene.add(m);
  }
}

// Scratch.
const _aim = new THREE.Vector3();
const _rot = new THREE.Vector3();
const _end = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _quat = new THREE.Quaternion();

/** Rotate a vector around world-up by `a` radians (keeps pitch). */
function rotY(v: THREE.Vector3, a: number, out: THREE.Vector3): void {
  const c = Math.cos(a), s = Math.sin(a);
  out.set(v.x * c + v.z * s, v.y, -v.x * s + v.z * c);
}

/** Pose a pool's capsules as the swept hit volume: one capsule per swept sample,
 *  each from origin → origin + (aim rotated across the arc) × reach, with the
 *  swing's true radius. This mirrors swingHitTest() in attack.ts exactly. */
function poseCapsules(pool: CapsulePool, ox: number, oy: number, oz: number, aim: THREE.Vector3, shape: SwingShape): void {
  // Rebuild geometry only when dims drift (CapsuleGeometry bakes radius/length;
  // scaling would squash the round caps, so we recreate instead of scale).
  const length = shape.reach;            // distance between the two cap centres
  if (!pool.geom || Math.abs(pool.radius - shape.radius) > 1e-3 || Math.abs(pool.length - length) > 1e-3) {
    pool.geom?.dispose();
    pool.geom = new THREE.CapsuleGeometry(shape.radius, length, 6, 12);
    pool.radius = shape.radius;
    pool.length = length;
    for (const m of pool.meshes) m.geometry = pool.geom;
  }

  const samples = Math.max(1, Math.min(MAX_SAMPLES, CONFIG.SWORD_HITBOX_SWEEP_SAMPLES));
  const start = shape.sweepBias - shape.sweepArc / 2;
  const stepA = samples > 1 ? shape.sweepArc / (samples - 1) : 0;
  for (let s = 0; s < MAX_SAMPLES; s++) {
    const m = pool.meshes[s];
    if (s >= samples) { m.visible = false; continue; }
    rotY(aim, samples > 1 ? start + stepA * s : shape.sweepBias, _rot);
    _end.set(ox + _rot.x * shape.reach, oy + _rot.y * shape.reach, oz + _rot.z * shape.reach);
    // Capsule default axis is +Y, centred at its midpoint — place at the segment
    // midpoint, rotate +Y onto the segment direction.
    _mid.set((ox + _end.x) / 2, (oy + _end.y) / 2, (oz + _end.z) / 2);
    _dir.set(_end.x - ox, _end.y - oy, _end.z - oz).normalize();
    _quat.setFromUnitVectors(_up, _dir);
    m.position.copy(_mid);
    m.quaternion.copy(_quat);
    m.visible = true;
  }
}

/** Snapshot the swing capsules at strike + relight the linger. No-op unless on. */
export function showHitCones(camera: THREE.Camera, aimDir: THREE.Vector3, enemy: SwingShape, destr: SwingShape): void {
  if (!enemyPool || !destrPool || !getSettings().debugHitCones) return;
  _aim.copy(aimDir);
  const ox = camera.position.x, oy = camera.position.y, oz = camera.position.z;
  poseCapsules(enemyPool, ox, oy, oz, _aim, enemy);
  poseCapsules(destrPool, ox, oy, oz, _aim, destr);
  linger = LINGER_S;
}

function setPoolVisible(pool: CapsulePool, on: boolean): void {
  for (const m of pool.meshes) if (m.visible !== on) m.visible = on;
}

/** Per-frame: fade the swing capsules + draw the live enemy hurtbox spheres. */
export function tickCombatDebug(dt: number, enemies: readonly Hurtbox[]): void {
  if (!enemyPool || !destrPool) return;
  const on = getSettings().debugHitCones;

  // Swing capsules (lingering, fading).
  if (!on || linger <= 0) {
    setPoolVisible(enemyPool, false);
    setPoolVisible(destrPool, false);
    linger = 0;
  } else {
    linger = Math.max(0, linger - dt);
    const k = linger / LINGER_S;
    enemyPool.mat.opacity = 0.22 * k;
    destrPool.mat.opacity = 0.14 * k;
  }

  // Enemy hurtbox spheres — always shown (while the setting is on) so you can
  // line a swing up against them, not just see them on the frame you hit.
  let i = 0;
  if (on) {
    for (const e of enemies) {
      if (i >= HURTBOX_POOL) break;
      if (!e.alive) continue;
      const r = Math.max(e.hitRadius ?? 0, HURTBOX_MIN_R);
      const m = hurtboxes[i++];
      m.position.set(e.position.x, e.position.y + e.aimHeight, e.position.z);
      m.scale.setScalar(r);
      m.visible = true;
    }
  }
  for (; i < HURTBOX_POOL; i++) if (hurtboxes[i].visible) hurtboxes[i].visible = false;
}
