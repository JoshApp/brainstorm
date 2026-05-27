import * as THREE from 'three';
import { getTexture } from '../style/procedural-textures';
import { grantXp } from '../state/run-state';
import { emit } from '../broadcast/event-bus';

// XP wisps — visible glowing orbs that burst UP from a dying mob, hang
// for a beat, then home in on the player and absorb on contact. Each
// orb is a mesh sphere (so it reads as a physical object) + an additive
// halo sprite (so it glows). Each orb = 1 XP granted on absorb.
//
// Three phases:
//   1. burst (≈0.4s): strong upward velocity + outward spread, gentle
//      drag. Visibly flies UP out of the corpse.
//   2. hover (≈0.15s): nearly stationary at peak, slight wobble. Gives
//      the player a beat to register the drop before it homes.
//   3. home (rest of lifetime): accelerate toward player chest height,
//      capped speed, absorbed when within absorb radius.
//
// 30% violet, 70% blue so each kill reads as a shower of mixed motes.

interface Wisp {
  mesh: THREE.Mesh;
  halo: THREE.Sprite;
  vel: THREE.Vector3;
  age: number;
  burstEnd: number;
  hoverEnd: number;
  violet: boolean;
}

const wisps: Wisp[] = [];
const tmp = new THREE.Vector3();

const ABSORB_RADIUS_SQ = 0.55 * 0.55;
const MAX_HOMING_SPEED = 16;
const HOMING_BIAS_Y = -0.4;

// Shared resources — built once.
let ORB_GEOM: THREE.SphereGeometry | null = null;
let ORB_MAT_BLUE: THREE.MeshBasicMaterial | null = null;
let ORB_MAT_VIOLET: THREE.MeshBasicMaterial | null = null;
let HALO_MAT_BLUE: THREE.SpriteMaterial | null = null;
let HALO_MAT_VIOLET: THREE.SpriteMaterial | null = null;

function ensureResources(): void {
  if (!ORB_GEOM) ORB_GEOM = new THREE.SphereGeometry(0.10, 10, 8);
  if (!ORB_MAT_BLUE) {
    // MeshBasic so the orb is unlit — it IS a light source visually,
    // not something the dungeon's torches need to light.
    ORB_MAT_BLUE = new THREE.MeshBasicMaterial({ color: 0x80c8ff, fog: false });
  }
  if (!ORB_MAT_VIOLET) {
    ORB_MAT_VIOLET = new THREE.MeshBasicMaterial({ color: 0xc090ff, fog: false });
  }
  if (!HALO_MAT_BLUE) {
    HALO_MAT_BLUE = new THREE.SpriteMaterial({
      map: getTexture('fire-wisp'),
      color: 0x40a0ff,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
  }
  if (!HALO_MAT_VIOLET) {
    HALO_MAT_VIOLET = new THREE.SpriteMaterial({
      map: getTexture('fire-wisp'),
      color: 0x9560ff,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
  }
}

export function spawnXpWisps(
  scene: THREE.Object3D,
  origin: THREE.Vector3,
  count: number,
): void {
  ensureResources();
  for (let i = 0; i < count; i++) {
    const violet = Math.random() < 0.3;
    const mesh = new THREE.Mesh(ORB_GEOM!, violet ? ORB_MAT_VIOLET! : ORB_MAT_BLUE!);
    mesh.position.copy(origin);
    mesh.position.x += (Math.random() - 0.5) * 0.25;
    mesh.position.y += (Math.random() - 0.5) * 0.15;
    mesh.position.z += (Math.random() - 0.5) * 0.25;

    const halo = new THREE.Sprite(violet ? HALO_MAT_VIOLET! : HALO_MAT_BLUE!);
    halo.scale.set(0.6, 0.6, 1);
    halo.position.copy(mesh.position);

    scene.add(mesh);
    scene.add(halo);

    // Strong UPWARD velocity — orbs visibly fly up out of the corpse
    // before they home. Slight outward spread so a 5-orb burst reads
    // as a fountain, not a single rising column.
    const angle = Math.random() * Math.PI * 2;
    const horiz = 0.6 + Math.random() * 1.0;
    const burst = 0.35 + Math.random() * 0.12;
    wisps.push({
      mesh,
      halo,
      vel: new THREE.Vector3(
        Math.cos(angle) * horiz,
        2.4 + Math.random() * 1.0,
        Math.sin(angle) * horiz,
      ),
      age: 0,
      burstEnd: burst,
      hoverEnd: burst + 0.15 + Math.random() * 0.10,
      violet,
    });
  }
}

/** Per-frame tick. Burst → hover → home. */
export function tickXpWisps(dt: number, playerPos: THREE.Vector3): void {
  for (let i = wisps.length - 1; i >= 0; i--) {
    const w = wisps[i];
    w.age += dt;

    if (w.age < w.burstEnd) {
      // Burst — rise + spread, gentle drag.
      w.mesh.position.addScaledVector(w.vel, dt);
      const drag = Math.pow(0.45, dt * 2);
      w.vel.x *= drag;
      w.vel.z *= drag;
      // Light upward drag too — orbs slow as they reach peak.
      w.vel.y *= Math.pow(0.55, dt * 1.8);
    } else if (w.age < w.hoverEnd) {
      // Hover — nearly stationary with a tiny wobble. Gives the player
      // a beat to register "there's the loot" before it streams in.
      const wob = Math.sin(w.age * 6 + w.burstEnd) * 0.012;
      w.mesh.position.y += wob * dt * 60;
      // Drift residue from burst dies fast.
      w.vel.multiplyScalar(Math.pow(0.2, dt));
      w.mesh.position.addScaledVector(w.vel, dt);
    } else {
      // Home — accelerate to player chest.
      tmp.set(
        playerPos.x - w.mesh.position.x,
        playerPos.y + HOMING_BIAS_Y - w.mesh.position.y,
        playerPos.z - w.mesh.position.z,
      );
      const distSq = tmp.lengthSq();
      if (distSq < ABSORB_RADIUS_SQ) {
        grantXp(1);
        emit({ type: 'xp:absorbed' });
        w.mesh.parent?.remove(w.mesh);
        w.halo.parent?.remove(w.halo);
        wisps.splice(i, 1);
        continue;
      }
      const inv = 1 / Math.sqrt(distSq);
      const homeT = w.age - w.hoverEnd;
      const accel = 9 + homeT * 26;
      w.vel.x += tmp.x * inv * accel * dt;
      w.vel.y += tmp.y * inv * accel * dt;
      w.vel.z += tmp.z * inv * accel * dt;
      const speedSq = w.vel.lengthSq();
      if (speedSq > MAX_HOMING_SPEED * MAX_HOMING_SPEED) {
        const s = MAX_HOMING_SPEED / Math.sqrt(speedSq);
        w.vel.multiplyScalar(s);
      }
      w.mesh.position.addScaledVector(w.vel, dt);
    }

    // Pulse the orb's mesh size slightly so it reads as alive, not a
    // static sphere. Halo tracks the mesh.
    const pulse = 1 + Math.sin(w.age * 7) * 0.10;
    w.mesh.scale.setScalar(pulse);
    w.halo.position.copy(w.mesh.position);
    // Halo grows slightly as it ages — the orb gets brighter as it
    // commits to the player.
    const haloScale = 0.6 + Math.min(0.35, w.age * 0.25);
    w.halo.scale.set(haloScale, haloScale, 1);
  }
}

/** Retire every active wisp. Called on level swap. */
export function clearXpWisps(): void {
  for (const w of wisps) {
    w.mesh.parent?.remove(w.mesh);
    w.halo.parent?.remove(w.halo);
  }
  wisps.length = 0;
}
