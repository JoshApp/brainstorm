import * as THREE from 'three';
import { getSettings } from '../settings/settings';
import { CONFIG } from '../config';
import { worldCapsule, worldSphere, type Hurtbox as EnemyHurtbox, type HurtZone } from './hurtbox';

// Combat hit debug overlay (Settings → Debug → HIT CONES).
//
// Draws the ACTUAL melee hit geometry each swing AND every enemy's hurtbox
// ZONES, as real 3D solids that sit in the world (depth-tested), so you can see
// exactly what a swing covers and which zone a target presents:
//   - red capsules  = the enemy swing hitbox, one capsule per swept sample,
//                     posed along your TRUE look direction (pitch included).
//   - cyan capsules = the wider/longer destructible (vase) hitbox.
//   - hurtbox zones = each enemy's body capsule / head sphere / weak point /
//                     armor, coloured by role and GHOSTED when disabled. These
//                     are the literal volumes from src/combat/hurtbox.ts that the
//                     resolver tests against — see docs/COMBAT-HIT-SYSTEM.md.
// The swing capsules snapshot at the strike and linger ~0.6s fading out (a
// 100ms strike would be invisible otherwise). Read-only; gated on the setting.

const LINGER_S = 0.6;
const MAX_SAMPLES = 8;         // matches swingEnds[] in attack.ts

// Zone colour by role.
const ZONE_COLOR: Record<HurtZone['role'], number> = {
  body: 0x40ff80,   // green — the baseline volume
  head: 0xffe040,   // yellow — locational bonus
  weak: 0xff3050,   // red-hot — a vulnerable zone
  armor: 0x8da0b4,  // steel — soaks until broken
};

/** The shaped swing capsule, produced by attack.ts and consumed here. */
export interface SwingShape {
  reach: number;
  radius: number;
  sweepArc: number;    // total lateral sweep (radians); 0 = straight thrust
  sweepBias: number;   // lateral centre offset (radians)
  rise: number;        // world-Y offset of the capsule's far end (overhead = negative)
}

/** What the overlay needs from each live enemy. */
interface DebugTarget { alive: boolean; hurtbox: EnemyHurtbox }

/** A pooled set of capsule meshes for one swing colour. */
interface CapsulePool {
  meshes: THREE.Mesh[];
  mat: THREE.MeshBasicMaterial;
  geom: THREE.CapsuleGeometry | null;
  radius: number;
  length: number;
}

let scene: THREE.Object3D | null = null;
let enemyPool: CapsulePool | null = null;
let destrPool: CapsulePool | null = null;
let linger = 0;

// Per-zone meshes, keyed by the live HurtZone object. Geometry is built once
// (zone dims are static) and reused; world transform + colour update per frame.
const zoneMeshes = new Map<HurtZone, THREE.Mesh>();
const seenZones = new Set<HurtZone>();

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
}

// Scratch.
const _aim = new THREE.Vector3();
const _rot = new THREE.Vector3();
const _end = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _quat = new THREE.Quaternion();
const _za = new THREE.Vector3();
const _zb = new THREE.Vector3();

/** Rotate a vector around world-up by `a` radians (keeps pitch). */
function rotY(v: THREE.Vector3, a: number, out: THREE.Vector3): void {
  const c = Math.cos(a), s = Math.sin(a);
  out.set(v.x * c + v.z * s, v.y, -v.x * s + v.z * c);
}

/** Pose a pool's capsules as the swept hit volume — mirrors swingHitTest(). */
function poseCapsules(pool: CapsulePool, ox: number, oy: number, oz: number, aim: THREE.Vector3, shape: SwingShape): void {
  const length = shape.reach;
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
    _end.set(ox + _rot.x * shape.reach, oy + _rot.y * shape.reach + shape.rise, oz + _rot.z * shape.reach);
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

/** Build the mesh for a zone (geometry sized to its LOCAL dims, once). */
function makeZoneMesh(zone: HurtZone): THREE.Mesh {
  let geom: THREE.BufferGeometry;
  if (zone.shape.kind === 'capsule') {
    const len = zone.shape.a.distanceTo(zone.shape.b);
    geom = new THREE.CapsuleGeometry(zone.shape.radius, len, 6, 12);
  } else {
    geom = new THREE.SphereGeometry(zone.shape.radius, 16, 12);
  }
  const mat = new THREE.MeshBasicMaterial({
    color: ZONE_COLOR[zone.role], transparent: true, opacity: 0.2,
    depthWrite: false, depthTest: true, fog: false,
  });
  const m = new THREE.Mesh(geom, mat);
  m.frustumCulled = false;
  m.renderOrder = 9001;
  scene?.add(m);
  return m;
}

/** Place + colour a zone mesh in world space this frame. */
function poseZone(zone: HurtZone, hb: EnemyHurtbox, m: THREE.Mesh): void {
  if (zone.shape.kind === 'capsule') {
    worldCapsule(zone, hb.root, _za, _zb);
    _mid.addVectors(_za, _zb).multiplyScalar(0.5);
    _dir.subVectors(_zb, _za).normalize();
    _quat.setFromUnitVectors(_up, _dir);
    m.position.copy(_mid);
    m.quaternion.copy(_quat);
  } else {
    worldSphere(zone, hb.root, _za);
    m.position.copy(_za);
    m.quaternion.identity();
  }
  const mat = m.material as THREE.MeshBasicMaterial;
  // Ghost disabled zones (armor that's still up, a weak point not yet open).
  mat.opacity = zone.enabled ? 0.22 : 0.05;
  m.visible = true;
}

/** Per-frame: fade the swing capsules + draw the live enemy hurtbox zones. */
export function tickCombatDebug(dt: number, enemies: readonly DebugTarget[]): void {
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

  // Hurtbox zones — drawn while the setting is on so you can line a swing up
  // against the real volumes, not just on the frame you connect.
  seenZones.clear();
  if (on) {
    for (const e of enemies) {
      if (!e.alive || !e.hurtbox) continue;
      for (const zone of e.hurtbox.zones) {
        let m = zoneMeshes.get(zone);
        if (!m) { m = makeZoneMesh(zone); zoneMeshes.set(zone, m); }
        poseZone(zone, e.hurtbox, m);
        seenZones.add(zone);
      }
    }
  }
  // Prune meshes whose zone wasn't drawn this frame (enemy died / culled /
  // setting off) — dispose so a cleared room doesn't leak debug geometry.
  for (const [zone, m] of zoneMeshes) {
    if (seenZones.has(zone)) continue;
    scene?.remove(m);
    m.geometry.dispose();
    (m.material as THREE.Material).dispose();
    zoneMeshes.delete(zone);
  }
}
