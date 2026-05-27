import * as THREE from 'three';
import { getTexture } from '../style/procedural-textures';
import { grantGold } from '../state/run-state';
import { emit } from '../broadcast/event-bus';

// Gold coins — physical floor pickups, survivor-game style. On death,
// the mob launches N coins on parabolic arcs; they land on the floor,
// settle into a rotate + bob loop, and shine. When the player walks
// within PICKUP_RADIUS they switch to homing and stream into the
// player's chest. Each coin = 1 gold (granted on absorb).
//
// Why coins-as-objects-on-the-floor (rather than instant credit on
// kill): the world is more legible — players SEE the reward, they have
// to walk through the corpse to collect, and it sets up future ground
// loot (gems, scraps) sharing the same pattern.
//
// Shared geometry + materials across coins so spawning a fountain of
// drops doesn't pay per-coin allocation costs.

interface Coin {
  mesh: THREE.Mesh;
  halo: THREE.Sprite;
  vel: THREE.Vector3;
  age: number;
  settled: boolean;
  homing: boolean;
  /** Random phase offset so bob/rotate of nearby coins desyncs. */
  phase: number;
}

const coins: Coin[] = [];
const tmp = new THREE.Vector3();

const GRAVITY = -9.5;
const FLOOR_Y = 0.10;             // settled height above floor
const PICKUP_RADIUS_SQ = 1.8 * 1.8;
const ABSORB_RADIUS_SQ = 0.55 * 0.55;
const HOMING_BIAS_Y = -0.4;       // chest height bias when homing
const HOMING_ACCEL = 16;
const HOMING_MAX_SPEED = 15;
const SETTLED_TIMEOUT = 22;       // seconds before idle coins auto-collect

// Shared resources — built once, reused forever.
let COIN_GEOM: THREE.CylinderGeometry | null = null;
let COIN_MAT: THREE.MeshStandardMaterial | null = null;
let HALO_MAT: THREE.SpriteMaterial | null = null;

function ensureResources(): void {
  if (!COIN_GEOM) {
    COIN_GEOM = new THREE.CylinderGeometry(0.085, 0.085, 0.022, 14);
    // Tilt the cylinder so the coin face is vertical-ish at rest — we
    // want to see the FLAT of the coin from above, so the cylinder's
    // y-axis stays vertical (default). On spawn we tilt slightly for
    // a non-perfectly-flat look.
  }
  if (!COIN_MAT) {
    COIN_MAT = new THREE.MeshStandardMaterial({
      color: 0xc88a2c,
      emissive: 0xc89030,
      emissiveIntensity: 0.85,
      roughness: 0.35,
      metalness: 0.85,
      flatShading: true,
    });
  }
  if (!HALO_MAT) {
    HALO_MAT = new THREE.SpriteMaterial({
      map: getTexture('fire-wisp'),
      color: 0xffd86c,
      transparent: true,
      opacity: 0.60,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
  }
}

export function spawnGoldCoins(
  scene: THREE.Object3D,
  origin: THREE.Vector3,
  count: number,
): void {
  ensureResources();
  for (let i = 0; i < count; i++) {
    const mesh = new THREE.Mesh(COIN_GEOM!, COIN_MAT!);
    // Tilt + rotate so coins don't all face the same way mid-flight.
    mesh.rotation.x = (Math.random() - 0.5) * 0.8;
    mesh.rotation.z = (Math.random() - 0.5) * 0.8;
    mesh.position.copy(origin);

    // Halo uses a SHARED SpriteMaterial so coin-cluster halos read as a
    // single warm glow rather than fighting each other.
    const halo = new THREE.Sprite(HALO_MAT!);
    halo.scale.set(0.45, 0.45, 1);
    halo.position.copy(origin);

    scene.add(mesh);
    scene.add(halo);

    // Initial arc — spread coins around a circle so a 5-coin drop
    // doesn't stack on one pixel. Slight angle jitter prevents
    // perfectly-symmetric fan-outs.
    const angle = (count > 1 ? (i / count) * Math.PI * 2 : Math.random() * Math.PI * 2)
      + (Math.random() - 0.5) * 0.4;
    const horizontalSpeed = 1.4 + Math.random() * 0.8;
    coins.push({
      mesh,
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
    });
  }
}

/** Per-frame tick. Integrates fall physics, settles coins on the floor,
 *  rotates settled coins, switches to homing when player is close, and
 *  retires coins on absorb. Called from the main loop. */
export function tickGoldCoins(dt: number, playerPos: THREE.Vector3): void {
  for (let i = coins.length - 1; i >= 0; i--) {
    const c = coins[i];
    c.age += dt;

    if (c.homing) {
      // Accelerate toward player chest. Capped speed prevents wraparound.
      tmp.set(
        playerPos.x - c.mesh.position.x,
        playerPos.y + HOMING_BIAS_Y - c.mesh.position.y,
        playerPos.z - c.mesh.position.z,
      );
      const distSq = tmp.lengthSq();
      if (distSq < ABSORB_RADIUS_SQ) {
        grantGold(1);
        emit({ type: 'gold:absorbed' });
        c.mesh.parent?.remove(c.mesh);
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
        const k = HOMING_MAX_SPEED / Math.sqrt(sp2);
        c.vel.multiplyScalar(k);
      }
      c.mesh.position.addScaledVector(c.vel, dt);
      // Sprite rotation isn't user-facing for billboards, but spin the
      // mesh so the absorb reads as fast inflow.
      c.mesh.rotation.y += dt * 18;
      c.halo.position.copy(c.mesh.position);
      continue;
    }

    if (!c.settled) {
      // Falling — gravity, light air drag on horizontal speed.
      c.vel.y += GRAVITY * dt;
      c.vel.x *= Math.pow(0.7, dt);
      c.vel.z *= Math.pow(0.7, dt);
      c.mesh.position.addScaledVector(c.vel, dt);
      // Spin during flight.
      c.mesh.rotation.y += dt * 8;
      c.mesh.rotation.z += dt * 4;
      if (c.mesh.position.y <= FLOOR_Y) {
        c.mesh.position.y = FLOOR_Y;
        c.vel.set(0, 0, 0);
        c.settled = true;
        // Snap to flat resting pose so it reads as a disc on the floor.
        c.mesh.rotation.x = 0;
        c.mesh.rotation.z = 0;
      }
    } else {
      // Settled — rotate on Y, gentle bob.
      c.mesh.rotation.y += dt * 3.2;
      c.mesh.position.y = FLOOR_Y + Math.sin(c.age * 2.5 + c.phase) * 0.018;
      // Auto-collect after a long idle so the ground doesn't accumulate
      // coins forever if the player walks away.
      if (c.age > SETTLED_TIMEOUT) {
        c.homing = true;
      }
    }

    c.halo.position.set(c.mesh.position.x, c.mesh.position.y + 0.06, c.mesh.position.z);

    // Proximity check — once close enough, vacuum into the player.
    if (c.settled) {
      const dx = playerPos.x - c.mesh.position.x;
      const dz = playerPos.z - c.mesh.position.z;
      if (dx * dx + dz * dz < PICKUP_RADIUS_SQ) {
        c.homing = true;
      }
    }
  }
}

/** Retire every active coin. Called on level swap. */
export function clearGoldCoins(): void {
  for (const c of coins) {
    c.mesh.parent?.remove(c.mesh);
    c.halo.parent?.remove(c.halo);
  }
  coins.length = 0;
}
