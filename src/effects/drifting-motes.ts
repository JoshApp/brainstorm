import * as THREE from 'three';
import { CONFIG } from '../config';
import { getTexture } from '../style/procedural-textures';
import type { WalkableRect } from '../level/types';

// Drifting motes — subtle volumetric ambient. A small pool of
// additive billboarded specks slowly floats through every room,
// reading as "dust in the air" / "embers / spirits drifting".
// They don't try to be a particle storm; the eye should notice
// them peripherally, not be overwhelmed.
//
// ONE DRAW for the whole pool. Each mote used to be its own
// THREE.Sprite (N motes = N draw calls + N objects the renderer
// sorts), which the draw-report flagged as the dominant sprite
// count on a floor. They're now a SINGLE camera-billboarded quad
// batch: one BufferGeometry of N quads whose 4 corners are rewritten
// each frame to face the camera (the same screen-aligned facing a
// Sprite does), one additive material, one mesh. 52 draws → 1.
//
// Motes have a lifetime + scale-based fade-in/out (the quad shrinks
// to nothing at birth/death — no per-mote opacity, so the whole
// batch stays one material). On despawn they respawn at a random
// walkable position weighted by room area so big halls have more
// motes than small alcoves.
//
// Lifecycle matches the xpWisps / goldCoins module pattern:
//   initDriftingMotes(scene, rects, tint) at level load
//   tickDriftingMotes(dt, camera) each frame
//   clearDriftingMotes() at level teardown

// Atmosphere tuning lives in src/config.ts (CONFIG.EFFECTS_MOTES).
const MOTE_COUNT       = CONFIG.EFFECTS_MOTES.COUNT;
const SPAWN_Y_MIN      = CONFIG.EFFECTS_MOTES.SPAWN_Y_MIN;
const SPAWN_Y_MAX      = CONFIG.EFFECTS_MOTES.SPAWN_Y_MAX;
const LIFE_MIN         = CONFIG.EFFECTS_MOTES.LIFE_MIN;
const LIFE_MAX         = CONFIG.EFFECTS_MOTES.LIFE_MAX;
const DRIFT_SPEED_LAT  = CONFIG.EFFECTS_MOTES.DRIFT_SPEED_LAT;
const DRIFT_SPEED_UP   = CONFIG.EFFECTS_MOTES.DRIFT_SPEED_UP;
const BASE_SIZE        = CONFIG.EFFECTS_MOTES.BASE_SIZE;
const FADE_FRACTION    = CONFIG.EFFECTS_MOTES.FADE_FRACTION;

interface Mote {
  px: number; py: number; pz: number;
  vx: number; vy: number; vz: number;
  life: number;
  age: number;
  size: number;     // current half-extent, after the fade ramp
  rect: WalkableRect;
}

let motes: Mote[] = [];
let rects: WalkableRect[] = [];
let material: THREE.MeshBasicMaterial | null = null;
let geometry: THREE.BufferGeometry | null = null;
let mesh: THREE.Mesh | null = null;
let positions: Float32Array | null = null;

// Reused per-frame billboard basis (camera right / up in world space).
const right = new THREE.Vector3();
const up = new THREE.Vector3();

export function initDriftingMotes(
  scene: THREE.Object3D,
  walkableRects: WalkableRect[],
  tint: number = 0xc8d4ff,
): void {
  clearDriftingMotes();
  if (walkableRects.length === 0) return;
  rects = walkableRects;

  material = new THREE.MeshBasicMaterial({
    map: getTexture('fire-wisp'),
    color: tint,
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    // Fog catches the motes naturally — far ones fade out which
    // is exactly the volumetric feel we want.
    fog: true,
    side: THREE.DoubleSide,
  });

  // One quad per mote: 4 verts, 2 tris. UVs + indices are static; only
  // the corner POSITIONS are rewritten each frame (billboarded).
  positions = new Float32Array(MOTE_COUNT * 4 * 3);
  const uvs = new Float32Array(MOTE_COUNT * 4 * 2);
  const index = new Uint16Array(MOTE_COUNT * 6);
  for (let i = 0; i < MOTE_COUNT; i++) {
    const v = i * 4;
    uvs.set([0, 0, 1, 0, 1, 1, 0, 1], i * 8);
    index.set([v, v + 1, v + 2, v, v + 2, v + 3], i * 6);
  }
  geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  // Motes blanket the whole level; per-batch frustum culling would either
  // pop the entire pool or never cull. Leave it on always — it's one draw.
  mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;   // additive ambient — after opaque, before the held viewmodel
  mesh.userData.dbgKind = 'fx';
  scene.add(mesh);

  for (let i = 0; i < MOTE_COUNT; i++) {
    const m: Mote = {
      px: 0, py: 0, pz: 0,
      vx: 0, vy: 0, vz: 0,
      life: 0, age: 0, size: 0,
      rect: rects[0],
    };
    respawn(m, /*ageJitter*/ true);
    motes.push(m);
  }
}

export function tickDriftingMotes(dt: number, camera: THREE.Camera): void {
  if (!geometry || !positions) return;

  // Screen-aligned billboard basis: the camera's world right + up. Writing
  // each quad's corners along these gives the same facing a Sprite has.
  const e = camera.matrixWorld.elements;
  right.set(e[0], e[1], e[2]).normalize();
  up.set(e[4], e[5], e[6]).normalize();

  for (let i = 0; i < motes.length; i++) {
    const m = motes[i];
    m.px += m.vx * dt;
    m.py += m.vy * dt;
    m.pz += m.vz * dt;
    m.age += dt;
    if (m.age >= m.life) respawn(m, false);

    // Scale-based fade in / fade out — ramps up over the first 18% of life
    // and down over the last 18%, so a mote is born and dies as a vanishing
    // speck. Keeps the whole pool on one (opacity-static) material.
    const t = m.age / m.life;
    let sizeMul = 1.0;
    if (t < FADE_FRACTION) sizeMul = t / FADE_FRACTION;
    else if (t > 1 - FADE_FRACTION) sizeMul = (1 - t) / FADE_FRACTION;
    const h = (BASE_SIZE * sizeMul) * 0.5;   // half-extent

    // Four corners around the mote centre, along the camera basis.
    const rx = right.x * h, ry = right.y * h, rz = right.z * h;
    const ux = up.x * h,    uy = up.y * h,    uz = up.z * h;
    const o = i * 12;
    positions[o]     = m.px - rx - ux; positions[o + 1]  = m.py - ry - uy; positions[o + 2]  = m.pz - rz - uz;
    positions[o + 3] = m.px + rx - ux; positions[o + 4]  = m.py + ry - uy; positions[o + 5]  = m.pz + rz - uz;
    positions[o + 6] = m.px + rx + ux; positions[o + 7]  = m.py + ry + uy; positions[o + 8]  = m.pz + rz + uz;
    positions[o + 9] = m.px - rx + ux; positions[o + 10] = m.py - ry + uy; positions[o + 11] = m.pz - rz + uz;
  }
  geometry.attributes.position.needsUpdate = true;
}

/** Hide/show the whole mote batch — used by the GPU-attribution probe to
 *  measure what the motes cost. No-op if motes aren't initialised. */
export function setMotesHidden(hidden: boolean): void {
  if (mesh) mesh.visible = !hidden;
}

export function clearDriftingMotes(): void {
  mesh?.parent?.remove(mesh);
  geometry?.dispose();
  material?.dispose();
  motes = [];
  rects = [];
  mesh = null;
  geometry = null;
  material = null;
  positions = null;
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
