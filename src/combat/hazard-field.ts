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
//
// Visually it reads as a wavy puddle of mucus, not a flat ring: a lumpy
// translucent body, a thicker brighter core blob, and a wet gloss — the
// whole thing jiggles gently like jelly and fades out over its last second.

interface FadeMat { mat: THREE.MeshBasicMaterial; base: number; }

interface HazardField {
  x: number; z: number; radius: number; radiusSq: number;
  age: number; lifetime: number;
  slow: number; dps: number; dotInterval: number; dotAccum: number;
  damageType: DamageType; source: EntityId;
  group: THREE.Group;
  mats: FadeMat[];
  phase: number;
}

const fields: HazardField[] = [];

export interface HazardFieldOpts {
  x: number; z: number; radius: number; lifetime: number;
  slow?: number; dps?: number; dotInterval?: number;
  damageType: DamageType; source: EntityId;
  /** Puddle tint. Defaults to acid green. */
  color?: number;
}

/** A circle whose rim is pushed in/out by smooth angular noise, so it reads
 *  as an irregular organic blob rather than a clean disc. */
function makeBlobGeometry(radius: number, segments: number, lumpiness: number, phase: number): THREE.BufferGeometry {
  const geo = new THREE.CircleGeometry(radius, segments);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const r = Math.hypot(x, y);
    if (r < 1e-4) continue;   // centre vertex stays put
    const a = Math.atan2(y, x);
    const lump = 1 + lumpiness * (0.6 * Math.sin(3 * a + phase) + 0.4 * Math.sin(5 * a - phase * 1.3));
    pos.setXY(i, x * lump, y * lump);
  }
  pos.needsUpdate = true;
  return geo;
}

function blobLayer(radius: number, segs: number, lump: number, color: number, opacity: number, blending: THREE.Blending, y: number): { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial } {
  const mat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity,
    blending, depthWrite: false, fog: false, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(makeBlobGeometry(radius, segs, lump, Math.random() * Math.PI * 2), mat);
  mesh.position.z = -y;   // group is rotated -90° about X, so local -Z = world up
  return { mesh, mat };
}

/** Spawn a hazard field at (x, z). Called from the `field` action handler. */
export function spawnHazardField(scene: THREE.Object3D, o: HazardFieldOpts): void {
  const color = o.color ?? 0x6abf2a;
  // A lighter, more saturated tint for the thick core + gloss.
  const bright = new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.35).getHex();

  const group = new THREE.Group();
  group.position.set(o.x, 0.02, o.z);
  group.rotation.x = -Math.PI / 2;

  // Layered blobs: spreading body → thick core → wet gloss highlight.
  const body  = blobLayer(o.radius,        48, 0.13, color,  0.26, THREE.NormalBlending,   0.000);
  const core  = blobLayer(o.radius * 0.62, 40, 0.20, color,  0.40, THREE.NormalBlending,   0.006);
  const gloss = blobLayer(o.radius * 0.34, 28, 0.26, bright, 0.30, THREE.AdditiveBlending, 0.012);
  group.add(body.mesh, core.mesh, gloss.mesh);
  scene.add(group);

  fields.push({
    x: o.x, z: o.z, radius: o.radius, radiusSq: o.radius * o.radius,
    age: 0, lifetime: o.lifetime,
    slow: o.slow ?? 1, dps: o.dps ?? 0, dotInterval: o.dotInterval ?? 1, dotAccum: 0,
    damageType: o.damageType, source: o.source,
    group,
    mats: [
      { mat: body.mat,  base: 0.26 },
      { mat: core.mat,  base: 0.40 },
      { mat: gloss.mat, base: 0.30 },
    ],
    phase: Math.random() * Math.PI * 2,
  });
}

/** Per-frame: animate (jiggle + fade), apply slow + DoT to a player standing
 *  inside, and retire expired fields. Called from the main loop (unpaused). */
export function tickHazardFields(dt: number, playerPos: THREE.Vector3): void {
  for (let i = fields.length - 1; i >= 0; i--) {
    const f = fields[i];
    f.age += dt;

    // Wet-jelly jiggle — non-uniform breathing in the floor plane (the
    // group is rotated, so local x/y are the two ground axes).
    const jx = 1 + 0.05 * Math.sin(f.age * 2.1 + f.phase);
    const jy = 1 + 0.05 * Math.sin(f.age * 2.1 + f.phase + 1.6);
    f.group.scale.set(jx, jy, 1);

    // Fade out over the last second of life; gentle opacity shimmer.
    const remaining = f.lifetime - f.age;
    const fade = remaining < 1 ? Math.max(0, remaining) : 1;
    const shimmer = 0.9 + 0.1 * Math.sin(f.age * 3.4 + f.phase);
    for (const m of f.mats) m.mat.opacity = m.base * fade * shimmer;

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
