import * as THREE from 'three';
import { damagePlayer } from '../player/health';
import { setPlayerInAura } from '../player/inside-aura';
import type { DamageType } from './damage';
import type { EntityId } from '../ecs/types';

// Persistent ground hazard fields — the runtime behind the composable
// `field` ability action (e.g. the slime king's acid puddle a leap leaves
// on landing). A field is a stationary aura left on the floor: while the
// player stands in it they're SLOWED and take a periodic DoT tick. It
// OUTLIVES the cast that spawned it (and the caster), ticking independently
// here until its lifetime expires — which is exactly why attribution rides
// on the field (its DoT credits the unit that spawned it, not "some acid").
//
// Same slow + tick model as an enemy's body aura (inside-aura.ts), just
// placed at a point and time-limited. The ~dotInterval before the first
// tick gives a natural "I'm in it, get out" grace.

interface HazardField {
  x: number; z: number; radius: number; radiusSq: number;
  age: number; lifetime: number;
  slow: number; dps: number; dotInterval: number; dotAccum: number;
  damageType: DamageType; source: EntityId;
  group: THREE.Group;
  fillMat: THREE.MeshBasicMaterial;
  rimMat: THREE.MeshBasicMaterial;
}

const fields: HazardField[] = [];
const BASE_FILL_OPACITY = 0.30;
const BASE_RIM_OPACITY = 0.5;

export interface HazardFieldOpts {
  x: number; z: number; radius: number; lifetime: number;
  slow?: number; dps?: number; dotInterval?: number;
  damageType: DamageType; source: EntityId;
  /** Puddle tint. Defaults to acid green. */
  color?: number;
}

/** Spawn a hazard field at (x, z). Called from the `field` action handler. */
export function spawnHazardField(scene: THREE.Object3D, o: HazardFieldOpts): void {
  const color = o.color ?? 0x6abf2a;
  const group = new THREE.Group();
  group.position.set(o.x, 0.02, o.z);   // just above the floor (avoid z-fight)
  group.rotation.x = -Math.PI / 2;

  // Filled disc — the hazard body. Translucent + faintly additive so it
  // glows in the dark without washing to white.
  const fillMat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: BASE_FILL_OPACITY,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    side: THREE.DoubleSide,
  });
  group.add(new THREE.Mesh(new THREE.CircleGeometry(o.radius, 36), fillMat));

  // Darker rim so the edge reads as a defined puddle, not a soft glow.
  const rimMat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: BASE_RIM_OPACITY,
    depthWrite: false, fog: false, side: THREE.DoubleSide,
  });
  group.add(new THREE.Mesh(new THREE.RingGeometry(o.radius * 0.86, o.radius, 36), rimMat));

  scene.add(group);

  fields.push({
    x: o.x, z: o.z, radius: o.radius, radiusSq: o.radius * o.radius,
    age: 0, lifetime: o.lifetime,
    slow: o.slow ?? 1, dps: o.dps ?? 0, dotInterval: o.dotInterval ?? 1, dotAccum: 0,
    damageType: o.damageType, source: o.source,
    group, fillMat, rimMat,
  });
}

/** Per-frame: animate, apply slow + DoT to a player standing inside, and
 *  retire expired fields. Called from the main loop (unpaused). */
export function tickHazardFields(dt: number, playerPos: THREE.Vector3): void {
  for (let i = fields.length - 1; i >= 0; i--) {
    const f = fields[i];
    f.age += dt;

    // Fade out over the last second of life; gentle pulse while alive.
    const remaining = f.lifetime - f.age;
    const fade = remaining < 1 ? Math.max(0, remaining) : 1;
    const pulse = 0.85 + 0.15 * Math.sin(f.age * 3.2);
    f.fillMat.opacity = BASE_FILL_OPACITY * fade * pulse;
    f.rimMat.opacity = BASE_RIM_OPACITY * fade;

    // Player inside → slow (last-refresh-wins, shared with body auras) +
    // periodic DoT credited to the spawning unit.
    const dx = playerPos.x - f.x;
    const dz = playerPos.z - f.z;
    if (dx * dx + dz * dz <= f.radiusSq) {
      if (f.slow !== 1) setPlayerInAura(f.slow);
      if (f.dps > 0) {
        f.dotAccum += dt;
        if (f.dotAccum >= f.dotInterval) {
          f.dotAccum -= f.dotInterval;
          damagePlayer(f.dps, f.source, f.damageType);
        }
      }
    } else {
      f.dotAccum = 0;   // leaving resets the grace
    }

    if (f.age >= f.lifetime) {
      disposeField(f);
      fields.splice(i, 1);
    }
  }
}

/** Drop every active field. Called on level load / teardown. */
export function clearHazardFields(): void {
  for (const f of fields) disposeField(f);
  fields.length = 0;
}

function disposeField(f: HazardField): void {
  f.group.parent?.remove(f.group);
  f.group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
  });
}
