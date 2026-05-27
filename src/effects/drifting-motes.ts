import * as THREE from 'three';
import { getTexture } from '../style/procedural-textures';
import type { WalkableRect } from '../level/types';

// Drifting motes — subtle volumetric ambient. A small pool of
// additive billboarded specks slowly floats through every room,
// reading as "dust in the air" / "embers / spirits drifting".
// They don't try to be a particle storm; the eye should notice
// them peripherally, not be overwhelmed.
//
// Motes have a lifetime + scale-based fade-in/out (no per-sprite
// opacity mutation so all motes share one material — cheap). On
// despawn they respawn at a random walkable position weighted by
// room area so big halls have more motes than small alcoves.
//
// Lifecycle matches the xpWisps / goldCoins module pattern:
//   initDriftingMotes(scene, rects, tint) at level load
//   tickDriftingMotes(dt) each frame
//   clearDriftingMotes() at level teardown

const MOTE_COUNT       = 38;        // sparse — feedback was "not too crowded"
const SPAWN_Y_MIN      = 0.25;
const SPAWN_Y_MAX      = 2.60;
const LIFE_MIN         = 6.0;       // seconds
const LIFE_MAX         = 11.0;
const DRIFT_SPEED_LAT  = 0.06;      // m/s — sideways drift max
const DRIFT_SPEED_UP   = 0.10;      // m/s — upward drift max
const BASE_SIZE        = 0.085;
const FADE_FRACTION    = 0.18;      // first/last 18% of life ramps size

interface Mote {
  sprite: THREE.Sprite;
  px: number; py: number; pz: number;
  vx: number; vy: number; vz: number;
  life: number;
  age: number;
  rect: WalkableRect;
}

let motes: Mote[] = [];
let rects: WalkableRect[] = [];
let material: THREE.SpriteMaterial | null = null;

export function initDriftingMotes(
  scene: THREE.Object3D,
  walkableRects: WalkableRect[],
  tint: number = 0xc8d4ff,
): void {
  clearDriftingMotes();
  if (walkableRects.length === 0) return;
  rects = walkableRects;

  material = new THREE.SpriteMaterial({
    map: getTexture('fire-wisp'),
    color: tint,
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    // Fog catches the motes naturally — far ones fade out which
    // is exactly the volumetric feel we want.
    fog: true,
  });

  for (let i = 0; i < MOTE_COUNT; i++) {
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(BASE_SIZE, BASE_SIZE, 1);
    scene.add(sprite);
    const m: Mote = {
      sprite,
      px: 0, py: 0, pz: 0,
      vx: 0, vy: 0, vz: 0,
      life: 0, age: 0,
      rect: rects[0],
    };
    respawn(m, /*ageJitter*/ true);
    motes.push(m);
  }
}

export function tickDriftingMotes(dt: number): void {
  for (const m of motes) {
    m.px += m.vx * dt;
    m.py += m.vy * dt;
    m.pz += m.vz * dt;
    m.age += dt;
    if (m.age >= m.life) {
      respawn(m, false);
      continue;
    }
    // Scale-based fade in / fade out so we don't need per-sprite
    // opacity (shared material). Ramps up over the first 18% of
    // life and down over the last 18%.
    const t = m.age / m.life;
    let sizeMul = 1.0;
    if (t < FADE_FRACTION) sizeMul = t / FADE_FRACTION;
    else if (t > 1 - FADE_FRACTION) sizeMul = (1 - t) / FADE_FRACTION;
    const s = BASE_SIZE * sizeMul;
    m.sprite.scale.set(s, s, 1);
    m.sprite.position.set(m.px, m.py, m.pz);
  }
}

export function clearDriftingMotes(): void {
  for (const m of motes) {
    m.sprite.parent?.remove(m.sprite);
  }
  motes = [];
  rects = [];
  material?.dispose();
  material = null;
}

function respawn(m: Mote, ageJitter: boolean): void {
  m.rect = pickRect(rects);
  m.px = m.rect.x - m.rect.w / 2 + Math.random() * m.rect.w;
  m.pz = m.rect.z - m.rect.d / 2 + Math.random() * m.rect.d;
  m.py = SPAWN_Y_MIN + Math.random() * (SPAWN_Y_MAX - SPAWN_Y_MIN);
  // Random gentle drift — mostly upward with small lateral
  // wander, like fine dust in a still room.
  m.vx = (Math.random() - 0.5) * DRIFT_SPEED_LAT;
  m.vy = (Math.random() * 0.5 + 0.5) * DRIFT_SPEED_UP;
  m.vz = (Math.random() - 0.5) * DRIFT_SPEED_LAT;
  m.life = LIFE_MIN + Math.random() * (LIFE_MAX - LIFE_MIN);
  // First-tick jitter: when the level loads, all motes shouldn't
  // start fresh at age 0 (they'd all pop in together). Seed each
  // with a random age inside its lifespan so the pool is already
  // mid-cycle.
  m.age = ageJitter ? Math.random() * m.life : 0;
}

/** Area-weighted pick of a rect. Bigger rooms host more motes. */
function pickRect(pool: WalkableRect[]): WalkableRect {
  const total = pool.reduce((s, r) => s + r.w * r.d, 0);
  let pick = Math.random() * total;
  for (const r of pool) {
    pick -= r.w * r.d;
    if (pick <= 0) return r;
  }
  return pool[pool.length - 1];
}
