import * as THREE from 'three';
import { getTexture } from '../style/procedural-textures';
import { grantGold } from '../state/run-state';
import { emit } from '../broadcast/event-bus';

// Gold coins — chunky floor pickups, survivor-game style. Each mob drops
// at most THREE coins; the kill's total gold is bundled into them so the
// floor doesn't get littered with tiny pickups after a big fight.
//
// Coins stand UPRIGHT on edge and spin around the vertical axis — at any
// moment you see either the round face or a thin slice, the way a real
// spinning coin reads in arcade pickup HUDs. Bob gently while at rest.
//
// Player walks within PICKUP_RADIUS → coin switches to homing and
// streams into the chest. Absorb grants coin.value gold (NOT 1).

interface Coin {
  /** Positioned root. Spins around its own Y axis for the visible flicker. */
  group: THREE.Group;
  halo: THREE.Sprite;
  vel: THREE.Vector3;
  age: number;
  settled: boolean;
  homing: boolean;
  phase: number;
  /** Gold granted on absorb. Bundles multiple gold per coin. */
  value: number;
}

const coins: Coin[] = [];
const tmp = new THREE.Vector3();

const GRAVITY = -9.5;
const FLOOR_Y = 0.12;             // group center sits this high — disc radius ≈ 0.085 below
const PICKUP_RADIUS_SQ = 1.8 * 1.8;
const ABSORB_RADIUS_SQ = 0.55 * 0.55;
const HOMING_BIAS_Y = -0.4;
const HOMING_ACCEL = 16;
const HOMING_MAX_SPEED = 15;
const SETTLED_TIMEOUT = 22;
/** Max gold per coin. Killing a wraith for 25g → 3 coins of ~8-9g each. */
const MAX_GOLD_PER_COIN = 12;
/** Max coins per drop. */
const MAX_COINS_PER_DROP = 3;

// Shared resources.
let COIN_GEOM: THREE.CylinderGeometry | null = null;
let COIN_MAT: THREE.MeshStandardMaterial | null = null;
let HALO_MAT: THREE.SpriteMaterial | null = null;

function ensureResources(): void {
  if (!COIN_GEOM) COIN_GEOM = new THREE.CylinderGeometry(0.085, 0.085, 0.022, 14);
  if (!COIN_MAT) {
    // Slightly muted gold — bright enough to read on a dark floor but
    // not so saturated it punches a hole in the dungeon's tone.
    COIN_MAT = new THREE.MeshStandardMaterial({
      color: 0xa87530,
      emissive: 0x6a4a18,
      emissiveIntensity: 0.65,
      roughness: 0.40,
      metalness: 0.85,
      flatShading: true,
    });
  }
  if (!HALO_MAT) {
    HALO_MAT = new THREE.SpriteMaterial({
      map: getTexture('fire-wisp'),
      color: 0xd8a850,
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
  }
}

/** Spawn coins for a kill's gold reward. Total amount is BUNDLED into
 *  1–3 coins; each coin grants its own value on absorb. */
export function spawnGoldCoins(
  scene: THREE.Object3D,
  origin: THREE.Vector3,
  totalGold: number,
): void {
  if (totalGold <= 0) return;
  ensureResources();

  // How many coins do we split this into? Want chunky bundles — coins
  // worth ~5g each, capped to MAX_COINS_PER_DROP so a fortune doesn't
  // litter the floor.
  const coinCount = Math.min(
    MAX_COINS_PER_DROP,
    Math.max(1, Math.ceil(totalGold / MAX_GOLD_PER_COIN)),
  );
  const baseValue = Math.floor(totalGold / coinCount);
  const remainder = totalGold - baseValue * coinCount;

  for (let i = 0; i < coinCount; i++) {
    const value = baseValue + (i < remainder ? 1 : 0);
    // The disc sits inside a positioned GROUP. We spin the GROUP around
    // its own Y axis; the disc itself is pre-rotated so its axis is
    // horizontal (axis along Z after the X tilt). Effect: face → edge →
    // face flicker as the group rotates around the world's vertical.
    const group = new THREE.Group();
    group.position.copy(origin);
    const disc = new THREE.Mesh(COIN_GEOM!, COIN_MAT!);
    disc.rotation.x = Math.PI / 2;
    group.add(disc);

    const halo = new THREE.Sprite(HALO_MAT!);
    halo.scale.set(0.40, 0.40, 1);
    halo.position.copy(origin);

    scene.add(group);
    scene.add(halo);

    // Initial arc — spread coins around a circle so 3 coins don't stack
    // on one pixel.
    const angle = (coinCount > 1 ? (i / coinCount) * Math.PI * 2 : Math.random() * Math.PI * 2)
      + (Math.random() - 0.5) * 0.5;
    const horizontalSpeed = 1.3 + Math.random() * 0.7;
    coins.push({
      group,
      halo,
      vel: new THREE.Vector3(
        Math.cos(angle) * horizontalSpeed,
        2.6 + Math.random() * 1.4,
        Math.sin(angle) * horizontalSpeed,
      ),
      age: 0,
      settled: false,
      homing: false,
      phase: Math.random() * Math.PI * 2,
      value,
    });
  }
}

/** Per-frame tick. */
export function tickGoldCoins(dt: number, playerPos: THREE.Vector3): void {
  for (let i = coins.length - 1; i >= 0; i--) {
    const c = coins[i];
    c.age += dt;

    if (c.homing) {
      tmp.set(
        playerPos.x - c.group.position.x,
        playerPos.y + HOMING_BIAS_Y - c.group.position.y,
        playerPos.z - c.group.position.z,
      );
      const distSq = tmp.lengthSq();
      if (distSq < ABSORB_RADIUS_SQ) {
        grantGold(c.value);
        emit({ type: 'gold:absorbed' });
        c.group.parent?.remove(c.group);
        c.halo.parent?.remove(c.halo);
        coins.splice(i, 1);
        continue;
      }
      const inv = 1 / Math.sqrt(distSq);
      c.vel.x += tmp.x * inv * HOMING_ACCEL * dt;
      c.vel.y += tmp.y * inv * HOMING_ACCEL * dt;
      c.vel.z += tmp.z * inv * HOMING_ACCEL * dt;
      const sp2 = c.vel.lengthSq();
      if (sp2 > HOMING_MAX_SPEED * HOMING_MAX_SPEED) {
        c.vel.multiplyScalar(HOMING_MAX_SPEED / Math.sqrt(sp2));
      }
      c.group.position.addScaledVector(c.vel, dt);
      // Spin fast as the coin streams in — extra sell on the absorb.
      c.group.rotation.y += dt * 16;
      c.halo.position.copy(c.group.position);
      continue;
    }

    if (!c.settled) {
      c.vel.y += GRAVITY * dt;
      c.vel.x *= Math.pow(0.7, dt);
      c.vel.z *= Math.pow(0.7, dt);
      c.group.position.addScaledVector(c.vel, dt);
      // Tumble during the arc.
      c.group.rotation.y += dt * 8;
      c.group.rotation.z += dt * 5;
      if (c.group.position.y <= FLOOR_Y) {
        c.group.position.y = FLOOR_Y;
        c.vel.set(0, 0, 0);
        c.settled = true;
        // Settle upright. The disc is already pre-rotated to vertical
        // inside the group; we just zero the group's tumble rotations
        // EXCEPT keep a random starting Y angle so adjacent coins don't
        // all flicker in lockstep.
        c.group.rotation.set(0, c.phase, 0);
      }
    } else {
      // Settled — spin around the GROUP's Y axis (the world vertical),
      // so the disc inside cycles face → edge → face. Plus a tiny bob.
      c.group.rotation.y += dt * 2.6;
      c.group.position.y = FLOOR_Y + Math.sin(c.age * 2.5 + c.phase) * 0.020;
      if (c.age > SETTLED_TIMEOUT) c.homing = true;
    }

    c.halo.position.set(c.group.position.x, c.group.position.y + 0.05, c.group.position.z);

    if (c.settled) {
      const dx = playerPos.x - c.group.position.x;
      const dz = playerPos.z - c.group.position.z;
      if (dx * dx + dz * dz < PICKUP_RADIUS_SQ) c.homing = true;
    }
  }
}

/** Retire every active coin. Called on level swap. */
export function clearGoldCoins(): void {
  for (const c of coins) {
    c.group.parent?.remove(c.group);
    c.halo.parent?.remove(c.halo);
  }
  coins.length = 0;
}
