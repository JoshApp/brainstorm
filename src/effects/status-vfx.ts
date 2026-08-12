import * as THREE from 'three';
import { getTexture } from '../style/procedural-textures';
import { get } from '../ecs/world';
import { BUFFS } from '../content/buffs';
import type { Enemy } from '../mobs/enemy';
import { registerWarmup } from '../content/warmup-registry';
import { createBatchedSprite, isSpriteBatchingEnabled } from '../scene/sprite-batch';

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

// ── Glow — one handle over "a batched instance" and "a real Sprite" ─────────
//
// The pool is 64 motes + 16 auras, and it used to be 80 THREE.Sprites each
// owning its own SpriteMaterial. That made it ~76% of the 105 SpriteMaterial
// instances the scene audit counted, and — because they are all in the scene at
// boot — 80 separately-bound render objects live during exactly the moments the
// phone is CPU-bound (docs/PIPELINE-BUDGET.md measures ~16.6µs per bound object
// per frame). The instanced sprite batch collapses them to one draw.
//
// The batch is unavailable in the bench/viewer (setSpriteBatchScene is never
// called there), so both paths stay live behind this five-operation handle. The
// per-mote material that the old comment defended is no longer needed: opacity
// and colour ride per-INSTANCE attributes in the batch.
interface Glow {
  setPos(x: number, y: number, z: number): void;
  addPos(x: number, y: number, z: number): void;
  setSize(s: number): void;
  setColor(hex: number): void;
  setOpacity(v: number): void;
  setVisible(v: boolean): void;
}

function makeGlow(scene: THREE.Object3D, texture: string, color: number): Glow {
  if (isSpriteBatchingEnabled()) {
    const h = createBatchedSprite({
      texture, size: [1, 1], color, opacity: 0,
      fog: false,        // additive + fog BRIGHTENS with distance — see sprite-batch's FOG note
      persistent: true,  // the pool outlives the floor; resetSpriteBatch must not drop it
    });
    h.obj.visible = false;
    scene.add(h.obj);
    return {
      setPos: (x, y, z) => h.obj.position.set(x, y, z),
      addPos: (x, y, z) => { h.obj.position.x += x; h.obj.position.y += y; h.obj.position.z += z; },
      setSize: (s) => h.baseSize.set(s, s),
      setColor: (hex) => h.color.setHex(hex),
      setOpacity: (v) => { h.opacity = v; },
      setVisible: (v) => { h.obj.visible = v; },
    };
  }
  const material = new THREE.SpriteMaterial({
    map: getTexture(texture),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
    opacity: 0,
  });
  material.color.setHex(color);
  const sprite = new THREE.Sprite(material);
  sprite.visible = false;
  scene.add(sprite);
  return {
    setPos: (x, y, z) => sprite.position.set(x, y, z),
    addPos: (x, y, z) => { sprite.position.x += x; sprite.position.y += y; sprite.position.z += z; },
    setSize: (s) => sprite.scale.set(s, s, 1),
    setColor: (hex) => material.color.setHex(hex),
    setOpacity: (v) => { material.opacity = v; },
    setVisible: (v) => { sprite.visible = v; },
  };
}

interface Mote {
  glow: Glow;
  vel: THREE.Vector3;
  age: number;
  life: number;
  gravity: number;
  baseSize: number;
  active: boolean;
}

// Fixed pool — built once (lazily, on first emit) then reused forever.
// Previously every emit did `new Sprite(base.clone())` + a dispose on retire —
// steady clone→dispose churn whenever multiple things were afflicted (the boss
// arena: wraith + 3 trash), which showed up as GC hitches. Pooling removes all
// per-emit allocation. Same pattern as effects/drifting-motes. Each slot is now
// a Glow (see above) rather than a Sprite + private material.
const MAX_MOTES = 64;
const motes: Mote[] = [];

// Throttle emission to a steady cadence regardless of frame rate / how
// many things are afflicted.
const EMIT_INTERVAL = 0.09;
let emitAccum = 0;

// ── Affliction AURA — the "the whole thing is afflicted" read ─────────────
// Motes alone are easy to miss on a moving mob; an aura WREATHES the body in
// the affliction's colour so a poisoned thing is visibly sickly-green, a
// burning thing glows ember, a bleeding thing is haloed red. A soft additive
// sprite (no material-path touch — safe over the fragile hit-flash), pooled and
// re-bound to whichever enemies are afflicted this frame. This is the cheap
// "elemental hull" without cloning the model or writing its shaders.
interface Aura {
  glow: Glow;
  entityId: string | null;   // which enemy it's bound to this frame (null = free)
}
const AURA_MAX = 16;
const auras: Aura[] = [];
const auraByEntity = new Map<string, Aura>();

function ensureAuraPool(scene: THREE.Object3D) {
  if (auras.length > 0) return;
  for (let i = 0; i < AURA_MAX; i++) {
    // 'moonbeam' — neutral white glow, tints cleanly to any hue.
    auras.push({ glow: makeGlow(scene, 'moonbeam', 0xffffff), entityId: null });
  }
}

function freeAura(a: Aura) {
  a.glow.setVisible(false);
  a.glow.setOpacity(0);
  if (a.entityId) auraByEntity.delete(a.entityId);
  a.entityId = null;
}

/** The dominant affliction colour on an entity (first vfx-bearing buff), or
 *  null if it carries none. */
function afflictionColor(entityId: string): number | null {
  const ent = get(entityId);
  if (!ent) return null;
  for (const b of ent.buffs) {
    const spec = BUFFS[b.specId];
    if (spec?.vfx) return spec.vfx.color ?? spec.color ?? 0xffffff;
  }
  return null;
}

/** Build the pool at boot instead of on the first mid-combat emit. The lazy
 *  path allocated 64 sprites + materials during a fight (a measured GC spike)
 *  and compiled the sprite shader program on the next render — a hitch frame.
 *  Call once after the scene exists; ensurePool stays as the safety net. */
export function initStatusVfxPool(scene: THREE.Object3D): void {
  ensurePool(scene);
}

function ensurePool(scene: THREE.Object3D) {
  if (motes.length > 0) return;
  for (let i = 0; i < MAX_MOTES; i++) {
    motes.push({
      glow: makeGlow(scene, 'fire-wisp', 0xffffff),
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

  m.glow.setColor(color);
  m.glow.setOpacity(0.85);
  const size = 0.10 + Math.random() * 0.06;
  m.glow.setSize(size);
  // Small jitter around the source so motes don't stack on one point.
  m.glow.setPos(
    x + (Math.random() - 0.5) * 0.35,
    y + (Math.random() - 0.5) * 0.3,
    z + (Math.random() - 0.5) * 0.35,
  );
  m.glow.setVisible(true);
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
      m.glow.setVisible(false);
      continue;
    }
    m.vel.y += m.gravity * dt;
    m.glow.addPos(m.vel.x * dt, m.vel.y * dt, m.vel.z * dt);
    const t = m.age / m.life;
    m.glow.setOpacity((1 - t) * 0.85);
    m.glow.setSize(m.baseSize * (1 - t * 0.5));
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
    const style = spec.vfx.style ?? 'rise';
    // Two motes per affliction per beat — dense enough to read as "on fire" /
    // "dripping venom" on a moving mob, not a lone occasional speck.
    spawnMote(scene, x, y, z, color, style);
    spawnMote(scene, x, y, z, color, style);
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
  tickAuras(scene, enemies, dt);

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

const _auraSeen = new Set<string>();

/** Each frame: wreathe every afflicted enemy in an aura of its affliction
 *  colour; free auras whose enemy is no longer afflicted / alive / present. */
function tickAuras(scene: THREE.Object3D, enemies: readonly Enemy[], dt: number) {
  ensureAuraPool(scene);
  _auraSeen.clear();
  const t = auraClock += dt;

  for (const e of enemies) {
    if (!e.alive) continue;
    const color = afflictionColor(e.entityId);
    if (color === null) continue;
    _auraSeen.add(e.entityId);

    let a = auraByEntity.get(e.entityId);
    if (!a) {
      // Bind a free aura sprite to this enemy.
      const free = auras.find((x) => x.entityId === null);
      if (!free) continue;   // pool exhausted — a crowd; motes still carry it
      free.entityId = e.entityId;
      free.glow.setVisible(true);
      auraByEntity.set(e.entityId, free);
      a = free;
    }
    a.glow.setColor(color);
    // Size to the body; gentle breathing so it reads as alive, not a decal.
    const h = Math.max(1.0, e.aimHeight * 1.9);
    const pulse = 0.85 + 0.15 * Math.sin(t * 4 + e.position.x);
    a.glow.setSize(h * pulse);
    a.glow.setPos(e.position.x, e.position.y + e.aimHeight, e.position.z);
    a.glow.setOpacity(0.34 * pulse);   // soft — a wash, never a solid blob
  }

  // Retire auras bound to enemies no longer afflicted / present.
  for (const a of auras) {
    if (a.entityId && !_auraSeen.has(a.entityId)) freeAura(a);
  }
}
let auraClock = 0;

/** Free all live motes (level teardown). The pool itself persists — slots
 *  just go inactive + hidden, ready for reuse on the next floor. */
export function clearStatusVfx() {
  for (const m of motes) {
    m.active = false;
    m.glow.setVisible(false);
  }
  for (const a of auras) freeAura(a);
  auraByEntity.clear();
  emitAccum = 0;
}

// Warm the pool's ACTUAL sprite instances (pooled per-mote materials): the
// pool is built hidden at boot, so its sprite pipeline otherwise compiled on
// the first mid-combat emit. One mote rendered during the live warm pins it.
registerWarmup({
  label: 'status-vfx', live: true,
  spawn: (scene) => {
    ensurePool(scene);
    spawnMote(scene, 0, 0.5, 0, 0xffffff, 'rise');
  },
  clear: () => clearStatusVfx(),
});
