import * as THREE from 'three';
import { getSettings } from '../settings/settings';

// Combat hit-cone debug overlay (Settings → "Show hit cones").
//
// Draws the ACTUAL melee hit test as translucent horizontal fans, one per swing:
//   - red  fan = the ENEMY cone (reach + half-angle the swing scans enemies in)
//   - cyan fan = the wider DESTRUCTIBLE cone (vases/crates get a forgiving arc)
// The hit test is horizontal (angle in XZ, reach in 3D — see attack.ts), so the
// fan is a flat sector on a plane through the swing origin. It snapshots the cone
// at the swing and LINGERS ~0.6s fading out, so a 100ms strike is actually
// visible. Pure read-only viz; no gameplay effect, gated on the setting.

const SEGMENTS = 24;            // arc resolution
const LINGER_S = 0.6;          // how long a swing's fan stays before it's gone
const ORIGIN_DROP = 0.45;      // draw the fan a touch below the eye so it reads against bodies

interface Fan {
  mesh: THREE.Mesh;
  geom: THREE.BufferGeometry;
  pos: Float32Array;
  mat: THREE.MeshBasicMaterial;
}

let scene: THREE.Object3D | null = null;
let enemyFan: Fan | null = null;
let destrFan: Fan | null = null;
let linger = 0;

function makeFan(color: number): Fan {
  // Triangle fan: a centre vertex + SEGMENTS+1 arc vertices → SEGMENTS triangles.
  const vertCount = 1 + (SEGMENTS + 1);
  const pos = new Float32Array(vertCount * 3);
  const index: number[] = [];
  for (let i = 0; i < SEGMENTS; i++) index.push(0, 1 + i, 2 + i);
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geom.setIndex(index);
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.22,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: false,      // show through walls/enemies — it's a debug guide
    fog: false,
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
  enemyFan = makeFan(0xff3040);   // enemy cone — red
  destrFan = makeFan(0x40d0ff);   // destructible cone — cyan
  scene.add(destrFan.mesh, enemyFan.mesh);   // destr under enemy
}

// Reusable scratch.
const fwd = new THREE.Vector3();
const baseAng = (v: THREE.Vector3) => Math.atan2(v.x, v.z);

/** Rewrite a fan's vertices for an origin + horizontal forward + reach + half-
 *  angle (radians). All in world space; y dropped a little below the eye. */
function writeFan(fan: Fan, ox: number, oy: number, oz: number, fwdAng: number, reach: number, half: number): void {
  const p = fan.pos;
  const y = oy - ORIGIN_DROP;
  p[0] = ox; p[1] = y; p[2] = oz;
  for (let i = 0; i <= SEGMENTS; i++) {
    const a = fwdAng - half + (2 * half) * (i / SEGMENTS);
    const o = (1 + i) * 3;
    p[o] = ox + Math.sin(a) * reach;
    p[o + 1] = y;
    p[o + 2] = oz + Math.cos(a) * reach;
  }
  fan.geom.attributes.position.needsUpdate = true;
  fan.geom.computeBoundingSphere();
}

/** Called from the combat strike resolution while a swing's hit window is open,
 *  with the LIVE (charge-scaled) cone numbers. Snapshots both fans + relights
 *  the linger. half-angles are in radians. */
export function showHitCones(
  camera: THREE.Camera,
  reach: number, enemyHalf: number,
  destrReach: number, destrHalf: number,
): void {
  if (!enemyFan || !destrFan || !getSettings().debugHitCones) return;
  camera.getWorldDirection(fwd);
  const ang = baseAng(fwd);
  const ox = camera.position.x, oy = camera.position.y, oz = camera.position.z;
  writeFan(enemyFan, ox, oy, oz, ang, reach, enemyHalf);
  writeFan(destrFan, ox, oy, oz, ang, destrReach, destrHalf);
  linger = LINGER_S;
}

/** Per-frame: fade the lingering fans out + honour the setting toggling off. */
export function tickCombatDebug(dt: number): void {
  if (!enemyFan || !destrFan) return;
  const on = getSettings().debugHitCones;
  if (!on || linger <= 0) {
    if (enemyFan.mesh.visible) { enemyFan.mesh.visible = false; destrFan.mesh.visible = false; }
    linger = 0;
    return;
  }
  linger = Math.max(0, linger - dt);
  const k = linger / LINGER_S;     // 1 → 0
  enemyFan.mesh.visible = true;
  destrFan.mesh.visible = true;
  enemyFan.mat.opacity = 0.28 * k;
  destrFan.mat.opacity = 0.18 * k;
}
