import * as THREE from 'three';
import { getTexture } from '../style/procedural-textures';
import { get } from '../ecs/world';
import { BUFFS } from '../content/buffs';
import type { Enemy } from '../mobs/enemy';

// Status-effect VFX — colored motes emitted from any entity carrying a
// buff that declares `vfx`. This is the "easy way for a status to have
// a visual": author the buff's `vfx: { color, style }` and the afflicted
// thing automatically smokes embers (burn), drips venom (poison), or
// weeps blood (bleed). Decoupled from the buff RUNTIME — this reads the
// buff data + entity positions in the presentation layer and spawns
// from a small additive-sprite pool.
//
// style:
//   'rise' — motes float up + out, like embers/smoke (burn).
//   'drip' — motes pop up then fall under gravity, like droplets
//            (poison / bleed).

interface Mote {
  sprite: THREE.Sprite;
  vel: THREE.Vector3;
  age: number;
  life: number;
  gravity: number;
  baseSize: number;
}

const motes: Mote[] = [];
const MAX_MOTES = 64;
let MAT_BASE: THREE.SpriteMaterial | null = null;
const tmpColor = new THREE.Color();

// Throttle emission to a steady cadence regardless of frame rate / how
// many things are afflicted.
const EMIT_INTERVAL = 0.12;
let emitAccum = 0;

function ensureMat(): THREE.SpriteMaterial {
  if (!MAT_BASE) {
    MAT_BASE = new THREE.SpriteMaterial({
      map: getTexture('fire-wisp'),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
  }
  return MAT_BASE;
}

function spawnMote(scene: THREE.Object3D, x: number, y: number, z: number, color: number, style: 'rise' | 'drip') {
  if (motes.length >= MAX_MOTES) return;
  const sprite = new THREE.Sprite(ensureMat().clone());
  (sprite.material as THREE.SpriteMaterial).color.setHex(color);
  const size = 0.10 + Math.random() * 0.06;
  sprite.scale.set(size, size, 1);
  // Small jitter around the source so motes don't stack on one point.
  sprite.position.set(
    x + (Math.random() - 0.5) * 0.35,
    y + (Math.random() - 0.5) * 0.3,
    z + (Math.random() - 0.5) * 0.35,
  );
  scene.add(sprite);
  const rise = style === 'rise';
  motes.push({
    sprite,
    vel: new THREE.Vector3(
      (Math.random() - 0.5) * 0.5,
      rise ? 0.7 + Math.random() * 0.5 : 0.5 + Math.random() * 0.3,
      (Math.random() - 0.5) * 0.5,
    ),
    age: 0,
    life: rise ? 0.7 : 0.85,
    gravity: rise ? 0.4 : -4.0,   // rise: gentle lift decel; drip: fall
    baseSize: size,
  });
}

/** Animate + retire live motes. Called every frame by tickStatusVfx. */
function tickMotes(scene: THREE.Object3D, dt: number) {
  for (let i = motes.length - 1; i >= 0; i--) {
    const m = motes[i];
    m.age += dt;
    if (m.age >= m.life) {
      scene.remove(m.sprite);
      (m.sprite.material as THREE.SpriteMaterial).dispose();
      motes.splice(i, 1);
      continue;
    }
    m.vel.y += m.gravity * dt;
    m.sprite.position.x += m.vel.x * dt;
    m.sprite.position.y += m.vel.y * dt;
    m.sprite.position.z += m.vel.z * dt;
    const t = m.age / m.life;
    (m.sprite.material as THREE.SpriteMaterial).opacity = (1 - t) * 0.85;
    const s = m.baseSize * (1 - t * 0.5);
    m.sprite.scale.set(s, s, 1);
  }
}

/** Emit one mote per vfx-bearing buff on this entity. */
function emitForEntity(scene: THREE.Object3D, entityId: string, x: number, y: number, z: number) {
  const ent = get(entityId);
  if (!ent || ent.buffs.length === 0) return;
  for (const b of ent.buffs) {
    const spec = BUFFS[b.specId];
    if (!spec?.vfx) continue;
    const color = spec.vfx.color ?? spec.color ?? 0xffffff;
    spawnMote(scene, x, y, z, color, spec.vfx.style ?? 'rise');
  }
}

/**
 * Per-frame driver. Animates live motes every frame, and on a steady
 * cadence emits fresh ones from every afflicted enemy + the player.
 * Reads buff data + positions from the presentation side; the buff
 * runtime stays pure.
 */
export function tickStatusVfx(
  scene: THREE.Object3D,
  enemies: readonly Enemy[],
  playerPos: THREE.Vector3,
  dt: number,
) {
  tickMotes(scene, dt);
  emitAccum += dt;
  if (emitAccum < EMIT_INTERVAL) return;
  emitAccum -= EMIT_INTERVAL;
  for (const e of enemies) {
    if (!e.alive) continue;
    emitForEntity(scene, e.entityId, e.position.x, e.position.y + 0.6, e.position.z);
  }
  // Player motes spawn just below the camera so they read in first person.
  emitForEntity(scene, 'player', playerPos.x, playerPos.y - 0.3, playerPos.z);
}

/** Clear all live motes (level teardown). Removes via each sprite's
 *  own parent so no scene ref is needed. */
export function clearStatusVfx() {
  for (const m of motes) {
    m.sprite.parent?.remove(m.sprite);
    (m.sprite.material as THREE.SpriteMaterial).dispose();
  }
  motes.length = 0;
  emitAccum = 0;
}
