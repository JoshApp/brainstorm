import * as THREE from 'three';
import { disposeGpu } from '../scene/gpu-dispose';
import { getSettings } from '../settings/settings';
import { CONFIG } from '../config';
import { worldCapsule, worldSphere, type Hurtbox as EnemyHurtbox, type HurtZone } from './hurtbox';

// Combat hit debug overlay (Settings → Debug → HIT CONES).
//
// Draws the ACTUAL melee hit geometry + every enemy's hurtbox ZONES as real
// depth-tested 3D solids, so you can study exactly what a swing covers and where
// it landed:
//   - red capsules  = the enemy swing hitbox, one per swept sample, posed along
//                     your TRUE look direction (pitch + per-move `rise`). After a
//                     swing it lingers bright, then HOLDS as a faint ghost of the
//                     last attack until the next one — a shadow you can read.
//   - cyan capsules = the wider/longer destructible (vase) hitbox.
//   - hurtbox zones = each enemy's body capsule / head sphere / weak point /
//                     armor, coloured by role, ghosted when disabled. The zone a
//                     swing actually STRUCK flashes white-hot and pulses for a
//                     beat, so you see which part you hit and where it intersects.
// Read-only; gated on the setting.

const LINGER_S = 0.7;          // bright fade after a swing
const GHOST_OPACITY = 0.05;    // faint hold of the last swing until the next
const SWING_PEAK = 0.24;       // bright peak opacity of the swing capsules
const HIT_FLASH_S = 0.9;       // how long a struck zone stays highlighted
const MAX_SAMPLES = 8;         // matches swingEnds[] in attack.ts

// Zone colour by role.
const ZONE_COLOR: Record<HurtZone['role'], number> = {
  body: 0x40ff80,   // green — the baseline volume
  head: 0xffe040,   // yellow — locational bonus
  weak: 0xff3050,   // red-hot — a vulnerable zone
  armor: 0x8da0b4,  // steel — soaks until broken
};
const HIT_COLOR = new THREE.Color(0xffffff);   // struck zone flashes white-hot

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
  // Last-posed swept geometry (world space) — captured so the frozen hit-echo
  // can snapshot the swing exactly as it landed.
  origin: THREE.Vector3;
  ends: THREE.Vector3[];
  activeSamples: number;
}

let scene: THREE.Object3D | null = null;
let enemyPool: CapsulePool | null = null;
let destrPool: CapsulePool | null = null;
let linger = 0;
let hasSwung = false;          // a swing has been posed at least once (else nothing to ghost)

// Per-zone meshes, keyed by the live HurtZone object. Geometry is built once
// (zone dims are static) and reused; world transform + colour update per frame.
const zoneMeshes = new Map<HurtZone, THREE.Mesh>();
const seenZones = new Set<HurtZone>();
// Struck-zone flash timers, keyed by the zone hit this swing.
const hitFlash = new Map<HurtZone, number>();
const _baseColor = new THREE.Color();

function makeCapsulePool(color: number): CapsulePool {
  const mat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: SWING_PEAK, side: THREE.DoubleSide,
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
  return {
    meshes, mat, geom: null, radius: -1, length: -1,
    origin: new THREE.Vector3(),
    ends: Array.from({ length: MAX_SAMPLES }, () => new THREE.Vector3()),
    activeSamples: 0,
  };
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
const _zc = new THREE.Vector3();
const _contact = new THREE.Vector3();
const _tmp = new THREE.Vector3();

/** Rotate a vector around world-up by `a` radians (keeps pitch). */
function rotY(v: THREE.Vector3, a: number, out: THREE.Vector3): void {
  const c = Math.cos(a), s = Math.sin(a);
  out.set(v.x * c + v.z * s, v.y, -v.x * s + v.z * c);
}

/** Pose a pool's capsules as the swept hit volume — mirrors swingHitEnemies(). */
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
  pool.origin.set(ox, oy, oz);
  pool.activeSamples = samples;
  for (let s = 0; s < MAX_SAMPLES; s++) {
    const m = pool.meshes[s];
    if (s >= samples) { m.visible = false; continue; }
    rotY(aim, samples > 1 ? start + stepA * s : shape.sweepBias, _rot);
    _end.set(ox + _rot.x * shape.reach, oy + _rot.y * shape.reach + shape.rise, oz + _rot.z * shape.reach);
    pool.ends[s].copy(_end);
    _mid.set((ox + _end.x) / 2, (oy + _end.y) / 2, (oz + _end.z) / 2);
    _dir.set(_end.x - ox, _end.y - oy, _end.z - oz).normalize();
    _quat.setFromUnitVectors(_up, _dir);
    m.position.copy(_mid);
    m.quaternion.copy(_quat);
    m.visible = true;
  }
}

/** Are two swing shapes identical? When so the overlay draws ONE capsule. */
function shapesEqual(a: SwingShape, b: SwingShape): boolean {
  return Math.abs(a.reach - b.reach) < 1e-4 && Math.abs(a.radius - b.radius) < 1e-4 &&
    Math.abs(a.sweepArc - b.sweepArc) < 1e-4 && Math.abs(a.sweepBias - b.sweepBias) < 1e-4 &&
    Math.abs(a.rise - b.rise) < 1e-4;
}

/** Snapshot the swing capsules at strike + relight the linger. No-op unless on.
 *  When the enemy + destructible shapes are identical (the unified case) only the
 *  enemy capsule is drawn, so there aren't two stacked on top of each other. */
export function showHitCones(camera: THREE.Camera, aimDir: THREE.Vector3, enemy: SwingShape, destr: SwingShape): void {
  if (!enemyPool || !destrPool || !getSettings().debugHitCones) return;
  _aim.copy(aimDir);
  const ox = camera.position.x, oy = camera.position.y, oz = camera.position.z;
  poseCapsules(enemyPool, ox, oy, oz, _aim, enemy);
  if (shapesEqual(enemy, destr)) {
    for (const m of destrPool.meshes) m.visible = false;
    destrPool.activeSamples = 0;
  } else {
    poseCapsules(destrPool, ox, oy, oz, _aim, destr);
  }
  linger = LINGER_S;
  hasSwung = true;
}

/** A registered hit: the live enemy hurtbox + the zone the swing caught. */
export interface SwingHit { hurtbox: EnemyHurtbox; zone: HurtZone }

// Frozen "last hit" echo — a world-space snapshot taken the instant a hit
// registers: the swing volume, the struck zone, and the contact point. It
// PERSISTS until the next hit and survives the enemy dying or walking off, so
// you can study where and how the blow landed.
const echoParts: THREE.Mesh[] = [];

function clearEcho(): void {
  for (const m of echoParts) {
    scene?.remove(m);
    disposeGpu(m.geometry, m.material as THREE.Material);
  }
  echoParts.length = 0;
}

function echoMesh(geom: THREE.BufferGeometry, color: number, opacity: number, order: number): THREE.Mesh {
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, depthTest: true, fog: false });
  const m = new THREE.Mesh(geom, mat);
  m.frustumCulled = false;
  m.renderOrder = order;
  scene?.add(m);
  echoParts.push(m);
  return m;
}

function echoCapsule(a: THREE.Vector3, b: THREE.Vector3, radius: number, color: number, opacity: number, order: number): void {
  const m = echoMesh(new THREE.CapsuleGeometry(radius, a.distanceTo(b), 6, 12), color, opacity, order);
  _mid.addVectors(a, b).multiplyScalar(0.5);
  _dir.subVectors(b, a).normalize();
  m.position.copy(_mid);
  m.quaternion.setFromUnitVectors(_up, _dir);
}

function echoSphere(c: THREE.Vector3, radius: number, color: number, opacity: number, order: number): void {
  echoMesh(new THREE.SphereGeometry(radius, 16, 12), color, opacity, order).position.copy(c);
}

/** Closest point on segment a→b to point p, into `out`. */
function closestPointOnSeg(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, out: THREE.Vector3): void {
  out.subVectors(b, a);
  const len2 = out.lengthSq() || 1e-6;
  let t = (p.x - a.x) * out.x + (p.y - a.y) * out.y + (p.z - a.z) * out.z;
  t = Math.max(0, Math.min(1, t / len2));
  out.copy(a).addScaledVector(_tmp.subVectors(b, a), t);
}

/** Flag the zone(s) a swing connected with: flash the LIVE enemy, and freeze a
 *  persistent world-space ECHO of this hit (swing + zone + contact). */
export function markSwingHits(hits: readonly SwingHit[]): void {
  if (!getSettings().debugHitCones || hits.length === 0 || !enemyPool) return;
  for (const h of hits) hitFlash.set(h.zone, HIT_FLASH_S);

  // Snapshot THIS hit as the new frozen echo (replaces the previous one).
  clearEcho();
  const pool = enemyPool;
  // Swing volume at the moment it landed — dim red, drawn behind the zones.
  for (let s = 0; s < pool.activeSamples; s++) {
    echoCapsule(pool.origin, pool.ends[s], pool.radius, 0xff5060, 0.10, 8999);
  }
  // Each struck zone, snapshotted to world (baked — independent of the enemy),
  // plus a magenta marker at where the blade was closest: the contact point.
  for (const h of hits) {
    if (h.zone.shape.kind === 'capsule') {
      const r = worldCapsule(h.zone, h.hurtbox.root, _za, _zb);
      echoCapsule(_za, _zb, r, ZONE_COLOR[h.zone.role], 0.34, 9002);
      _zc.addVectors(_za, _zb).multiplyScalar(0.5);
    } else {
      const r = worldSphere(h.zone, h.hurtbox.root, _zc);
      echoSphere(_zc, r, ZONE_COLOR[h.zone.role], 0.34, 9002);
    }
    let bestD = Infinity;
    _contact.copy(_zc);
    for (let s = 0; s < pool.activeSamples; s++) {
      closestPointOnSeg(_zc, pool.origin, pool.ends[s], _tmp);
      const d = _tmp.distanceToSquared(_zc);
      if (d < bestD) { bestD = d; _contact.copy(_tmp); }
    }
    echoSphere(_contact, 0.08, 0xff40ff, 0.95, 9003);
  }
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
  const flash = hitFlash.get(zone) ?? 0;
  if (flash > 0) {
    // Struck this swing — flash white-hot and pulse outward so you see WHICH
    // part connected. Lerp role colour → white by how fresh the hit is.
    const k = flash / HIT_FLASH_S;
    _baseColor.setHex(ZONE_COLOR[zone.role]);
    mat.color.copy(_baseColor).lerp(HIT_COLOR, k);
    mat.opacity = 0.30 + 0.45 * k;
    m.scale.setScalar(1 + 0.18 * k);
  } else {
    mat.color.setHex(ZONE_COLOR[zone.role]);
    // Ghost disabled zones (armor still up, a weak point not yet open).
    mat.opacity = zone.enabled ? 0.22 : 0.05;
    m.scale.setScalar(1);
  }
  m.visible = true;
}

/** Per-frame: hold the swing-capsule trace + draw the live hurtbox zones. */
export function tickCombatDebug(dt: number, enemies: readonly DebugTarget[]): void {
  if (!enemyPool || !destrPool) return;
  const on = getSettings().debugHitCones;

  // Swing capsules: bright fade right after a swing, then HOLD as a faint ghost
  // of the last attack until the next one — a readable shadow.
  if (!on) {
    for (const m of enemyPool.meshes) if (m.visible) m.visible = false;
    for (const m of destrPool.meshes) if (m.visible) m.visible = false;
    if (echoParts.length > 0) clearEcho();
    linger = 0;
  } else if (!hasSwung) {
    for (const m of enemyPool.meshes) if (m.visible) m.visible = false;
    for (const m of destrPool.meshes) if (m.visible) m.visible = false;
    linger = 0;
  } else {
    if (linger > 0) linger = Math.max(0, linger - dt);
    const k = linger / LINGER_S;             // 1 → 0 over the bright fade
    enemyPool.mat.opacity = GHOST_OPACITY + (SWING_PEAK - GHOST_OPACITY) * k;
    destrPool.mat.opacity = GHOST_OPACITY * 1.2 + (SWING_PEAK * 0.7 - GHOST_OPACITY * 1.2) * k;
  }

  // Decay the struck-zone flashes (independent of which zones draw this frame).
  if (hitFlash.size > 0) {
    for (const [zone, t] of hitFlash) {
      const nt = t - dt;
      if (nt <= 0) hitFlash.delete(zone); else hitFlash.set(zone, nt);
    }
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
    disposeGpu(m.geometry, m.material as THREE.Material);
    zoneMeshes.delete(zone);
  }
}
