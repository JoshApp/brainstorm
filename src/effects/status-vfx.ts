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
  active: boolean;
}

// Fixed pool — built once (lazily, on first emit) then reused forever.
// Each mote owns its own SpriteMaterial so it can fade independently
// (additive opacity is per-material). Previously every emit did
// `new Sprite(base.clone())` + a dispose on retire — steady clone→dispose
// churn whenever multiple things were afflicted (the boss arena: wraith +
// 3 trash), which showed up as GC hitches. Pooling removes all per-emit
// allocation. Same pattern as effects/drifting-motes.
const MAX_MOTES = 64;
const motes: Mote[] = [];

// Throttle emission to a steady cadence regardless of frame rate / how
// many things are afflicted.
const EMIT_INTERVAL = 0.12;
let emitAccum = 0;

function ensurePool(scene: THREE.Object3D) {
  if (motes.length > 0) return;
  for (let i = 0; i < MAX_MOTES; i++) {
    const material = new THREE.SpriteMaterial({
      map: getTexture('fire-wisp'),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.visible = false;
    scene.add(sprite);
    motes.push({
      sprite,
      vel: new THREE.Vector3(),
      age: 0, life: 0, gravity: 0, baseSize: 0,
      active: false,
    });
  }
}

function spawnMote(scene: THREE.Object3D, x: number, y: number, z: number, color: number, style: 'rise' | 'drip') {
  ensurePool(scene);
  // First free slot. Full pool → drop the emit (same cap as before).
  let m: Mote | undefined;
  for (const cand of motes) { if (!cand.active) { m = cand; break; } }
  if (!m) return;

  const mat = m.sprite.material as THREE.SpriteMaterial;
  mat.color.setHex(color);
  mat.opacity = 0.85;
  const size = 0.10 + Math.random() * 0.06;
  m.sprite.scale.set(size, size, 1);
  // Small jitter around the source so motes don't stack on one point.
  m.sprite.position.set(
    x + (Math.random() - 0.5) * 0.35,
    y + (Math.random() - 0.5) * 0.3,
    z + (Math.random() - 0.5) * 0.35,
  );
  m.sprite.visible = true;
  const rise = style === 'rise';
  m.vel.set(
    (Math.random() - 0.5) * 0.5,
    rise ? 0.7 + Math.random() * 0.5 : 0.5 + Math.random() * 0.3,
    (Math.random() - 0.5) * 0.5,
  );
  m.age = 0;
  m.life = rise ? 0.7 : 0.85;
  m.gravity = rise ? 0.4 : -4.0;   // rise: gentle lift decel; drip: fall
  m.baseSize = size;
  m.active = true;
}

/** Animate + retire live motes. Retire just hides + frees the slot — no
 *  scene.remove / material.dispose (the pool owns them for the app life). */
function tickMotes(dt: number) {
  for (const m of motes) {
    if (!m.active) continue;
    m.age += dt;
    if (m.age >= m.life) {
      m.active = false;
      m.sprite.visible = false;
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
  tickMotes(dt);
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

/** Free all live motes (level teardown). The pool itself persists — slots
 *  just go inactive + hidden, ready for reuse on the next floor. */
export function clearStatusVfx() {
  for (const m of motes) {
    m.active = false;
    m.sprite.visible = false;
  }
  emitAccum = 0;
}
