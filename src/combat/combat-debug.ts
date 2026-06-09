import * as THREE from 'three';
import { getSettings } from '../settings/settings';

// Combat hit debug overlay (Settings → Debug → HIT CONES).
//
// Draws the ACTUAL melee hit volume each swing AND every enemy's hurtbox, so you
// can see exactly what a swing covers and whether a target overlapped it:
//   - red fan   = the enemy swing capsule, swept across the swing's arc, posed
//                 along your TRUE look direction (pitch included)
//   - cyan fan  = the wider/longer destructible (vase) capsule
//   - yellow spheres = each enemy's hurtbox (position + aimHeight, hitRadius)
// The swing fans snapshot at the strike and linger ~0.6s fading out (a 100ms
// strike would be invisible otherwise). Read-only; gated on the setting.

const SEGMENTS = 24;           // fan arc resolution
const LINGER_S = 0.6;
const HURTBOX_POOL = 48;

/** The shaped swing capsule, produced by attack.ts and consumed here. */
export interface SwingShape {
  reach: number;
  radius: number;
  sweepArc: number;    // total lateral sweep (radians); 0 = straight thrust
  sweepBias: number;   // lateral centre offset (radians)
}

interface Fan {
  mesh: THREE.Mesh;
  geom: THREE.BufferGeometry;
  pos: Float32Array;
  mat: THREE.MeshBasicMaterial;
}

interface Hurtbox { position: THREE.Vector3; aimHeight: number; hitRadius?: number; alive: boolean }

let scene: THREE.Object3D | null = null;
let enemyFan: Fan | null = null;
let destrFan: Fan | null = null;
let hurtboxes: THREE.Mesh[] = [];
let hurtMat: THREE.MeshBasicMaterial | null = null;
let linger = 0;

function makeFan(color: number): Fan {
  const vertCount = 1 + (SEGMENTS + 1);
  const pos = new Float32Array(vertCount * 3);
  const index: number[] = [];
  for (let i = 0; i < SEGMENTS; i++) index.push(0, 1 + i, 2 + i);
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geom.setIndex(index);
  const mat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.22, side: THREE.DoubleSide,
    depthWrite: false, depthTest: false, fog: false,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 9000;
  mesh.visible = false;
  return { mesh, geom, pos, mat };
}

export function initCombatDebug(sc: THREE.Object3D): void {
  if (enemyFan) return;
  scene = sc;
  enemyFan = makeFan(0xff3040);   // enemy capsule — red
  destrFan = makeFan(0x40d0ff);   // destructible capsule — cyan
  scene.add(destrFan.mesh, enemyFan.mesh);
  // Enemy hurtbox spheres — a small pool, shown only for alive enemies in view.
  hurtMat = new THREE.MeshBasicMaterial({
    color: 0xffe040, transparent: true, opacity: 0.16, depthWrite: false,
    depthTest: false, fog: false, wireframe: true,
  });
  const sph = new THREE.SphereGeometry(1, 12, 8);
  for (let i = 0; i < HURTBOX_POOL; i++) {
    const m = new THREE.Mesh(sph, hurtMat);
    m.frustumCulled = false;
    m.renderOrder = 9001;
    m.visible = false;
    hurtboxes.push(m);
    scene.add(m);
  }
}

// Scratch.
const fwd = new THREE.Vector3();
const rot = new THREE.Vector3();

/** Rotate a vector around world-up by `a` radians (keeps pitch). */
function rotY(v: THREE.Vector3, a: number, out: THREE.Vector3): void {
  const c = Math.cos(a), s = Math.sin(a);
  out.set(v.x * c + v.z * s, v.y, -v.x * s + v.z * c);
}

/** Rewrite a fan to the swept-capsule centreline arc: origin + (aim rotated
 *  across [bias - arc/2, bias + arc/2]) × reach. 3D aim → the fan tilts with
 *  pitch. (The capsule RADIUS isn't drawn; the hurtbox spheres show the target
 *  sizes the radius is matched against.) */
function writeFan(fan: Fan, ox: number, oy: number, oz: number, aim: THREE.Vector3, shape: SwingShape): void {
  const p = fan.pos;
  p[0] = ox; p[1] = oy; p[2] = oz;
  const start = shape.sweepBias - shape.sweepArc / 2;
  for (let i = 0; i <= SEGMENTS; i++) {
    const a = start + shape.sweepArc * (i / SEGMENTS);
    rotY(aim, a, rot);
    const o = (1 + i) * 3;
    p[o] = ox + rot.x * shape.reach;
    p[o + 1] = oy + rot.y * shape.reach;
    p[o + 2] = oz + rot.z * shape.reach;
  }
  fan.geom.attributes.position.needsUpdate = true;
  fan.geom.computeBoundingSphere();
}

/** Snapshot the swing capsules at strike + relight the linger. No-op unless on. */
export function showHitCones(camera: THREE.Camera, aimDir: THREE.Vector3, enemy: SwingShape, destr: SwingShape): void {
  if (!enemyFan || !destrFan || !getSettings().debugHitCones) return;
  fwd.copy(aimDir);
  const ox = camera.position.x, oy = camera.position.y, oz = camera.position.z;
  writeFan(enemyFan, ox, oy, oz, fwd, enemy);
  writeFan(destrFan, ox, oy, oz, fwd, destr);
  linger = LINGER_S;
}

/** Per-frame: fade the swing fans + draw the live enemy hurtbox spheres. */
export function tickCombatDebug(dt: number, enemies: readonly Hurtbox[]): void {
  if (!enemyFan || !destrFan) return;
  const on = getSettings().debugHitCones;

  // Swing fans (lingering, fading).
  if (!on || linger <= 0) {
    if (enemyFan.mesh.visible) { enemyFan.mesh.visible = false; destrFan.mesh.visible = false; }
    linger = 0;
  } else {
    linger = Math.max(0, linger - dt);
    const k = linger / LINGER_S;
    enemyFan.mesh.visible = true; destrFan.mesh.visible = true;
    enemyFan.mat.opacity = 0.28 * k;
    destrFan.mat.opacity = 0.18 * k;
  }

  // Enemy hurtbox spheres — always shown (while the setting is on) so you can
  // line a swing up against them, not just see them on the frame you hit.
  let i = 0;
  if (on) {
    for (const e of enemies) {
      if (i >= HURTBOX_POOL) break;
      if (!e.alive) continue;
      const r = e.hitRadius ?? 0.35;
      const m = hurtboxes[i++];
      m.position.set(e.position.x, e.position.y + e.aimHeight, e.position.z);
      m.scale.setScalar(r);
      m.visible = true;
    }
  }
  for (; i < HURTBOX_POOL; i++) if (hurtboxes[i].visible) hurtboxes[i].visible = false;
}
