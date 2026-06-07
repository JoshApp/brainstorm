// Visible cold-breath exhale — the atmospheric sibling of the exhaustion
// breath audio + camera heave (exhaustion-feedback.ts). When you're winded a
// soft pale puff drifts up from the lower view and dissipates, once per breath
// cycle, heavier (more opaque) the more gassed you are. Sells "this place is
// cold and you're spent" without a HUD number.
//
// Camera-parented sprites (a tiny pool), so the puff sits in the player's view
// and follows the head. Emission is driven by exhaustion-feedback's existing
// breath cycle (emitBreath), so cadence already matches the breath SOUND.
//
// Each puff carries its OWN randomized size / spawn point / drift / lifespan
// and lags the breath beat by a small random delay, so no two exhales look
// alike and they don't pop in lockstep with the audio — natural, not a
// metronome. A breath occasionally throws a second smaller trailing wisp.
// Tunable via CONFIG.EXHAUSTION.BREATH_PUFF_*. Browser-only (canvas texture).

import * as THREE from 'three';
import { CONFIG } from '../config';

const COUNT = 8;                 // pool size — a few live at once (puff + wisps)
const START_Y = -0.14;           // camera-local: just below eye line ("mouth")
const START_Z = -0.42;           // a touch in front of the face

interface Puff {
  sprite: THREE.Sprite;
  mat: THREE.SpriteMaterial;
  active: boolean;   // claimed (counting down delay or alive)
  delay: number;     // seconds left before it appears
  life: number;
  ttl: number;
  peak: number;
  size0: number;
  size1: number;
  rise: number;
  fwd: number;
  driftX: number;    // lateral m/s
  driftY: number;    // extra vertical wander m/s
  ox: number;        // spawn offset x
  oy: number;        // spawn offset y
}

let cam: THREE.Camera | null = null;
let puffs: Puff[] = [];
let texture: THREE.CanvasTexture | null = null;

// Soft round fog dab — white centre fading to nothing. Normal-blended (fog,
// not glow), so it reads as breath, not a spark.
function makePuffTexture(): THREE.CanvasTexture {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Create the breath puff pool, parented to the camera. Idempotent. */
export function initBreath(camera: THREE.Camera): void {
  if (puffs.length) return;
  cam = camera;
  texture = makePuffTexture();
  for (let i = 0; i < COUNT; i++) {
    const mat = new THREE.SpriteMaterial({
      map: texture,
      color: 0xdfe6ea,          // pale cold grey-white
      transparent: true,
      opacity: 0,
      depthTest: false,         // always reads in front of the view
      depthWrite: false,
      fog: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.visible = false;
    sprite.renderOrder = 12;    // over the weapon viewmodel
    camera.add(sprite);
    puffs.push({
      sprite, mat, active: false, delay: 0, life: 0, ttl: 0, peak: 0,
      size0: 0, size1: 0, rise: 0, fwd: 0, driftX: 0, driftY: 0, ox: 0, oy: 0,
    });
  }
}

// ±frac random multiplier around 1.
function jitter(frac: number): number {
  return 1 + (Math.random() * 2 - 1) * frac;
}

// Spawn one puff with randomized character. `scale` shrinks a trailing wisp.
function spawn(exertion: number, scale: number): void {
  const p = puffs.find((x) => !x.active);
  if (!p) return;
  const E = CONFIG.EXHAUSTION;
  p.active = true;
  p.delay = Math.random() * E.BREATH_PUFF_DELAY;
  p.life = 0;
  p.ttl = E.BREATH_PUFF_LIFE * jitter(E.BREATH_PUFF_LIFE_VAR);
  p.peak = E.BREATH_PUFF_OPACITY * Math.min(1, exertion) * scale;
  p.size0 = E.BREATH_PUFF_SIZE0 * scale * jitter(E.BREATH_PUFF_SIZE_VAR);
  p.size1 = E.BREATH_PUFF_SIZE1 * scale * jitter(E.BREATH_PUFF_SIZE_VAR);
  p.rise = E.BREATH_PUFF_RISE * jitter(E.BREATH_PUFF_RISE_VAR);
  p.fwd = E.BREATH_PUFF_FWD * jitter(E.BREATH_PUFF_FWD_VAR);
  p.driftX = (Math.random() * 2 - 1) * E.BREATH_PUFF_DRIFT;
  p.driftY = (Math.random() * 2 - 1) * E.BREATH_PUFF_DRIFT * 0.4;
  p.ox = (Math.random() * 2 - 1) * E.BREATH_PUFF_POS_JITTER;
  p.oy = (Math.random() * 2 - 1) * E.BREATH_PUFF_POS_JITTER * 0.6;
  // Sprite stays hidden until its delay elapses (see tickBreath).
  p.sprite.visible = false;
  p.mat.opacity = 0;
}

/** Emit one exhale, scaled by exertion (0..1). Called once per breath cycle. */
export function emitBreath(exertion: number): void {
  if (!cam || exertion <= 0) return;
  spawn(exertion, 1);
  // Sometimes a smaller trailing wisp tags along, so breaths feel uneven.
  if (Math.random() < CONFIG.EXHAUSTION.BREATH_PUFF_WISP_CHANCE) {
    spawn(exertion, 0.55);
  }
}

/** Advance live puffs: wait out delay, then rise + drift + expand + fade. */
export function tickBreath(dt: number): void {
  if (!puffs.length) return;
  for (const p of puffs) {
    if (!p.active) continue;
    if (p.delay > 0) {
      p.delay -= dt;
      if (p.delay > 0) continue;
      // Delay just elapsed — appear at the (jittered) mouth position.
      p.sprite.visible = true;
      p.sprite.position.set(p.ox, START_Y + p.oy, START_Z);
    }
    p.life += dt;
    const t = p.ttl > 0 ? p.life / p.ttl : 1;
    if (t >= 1) { p.active = false; p.sprite.visible = false; p.mat.opacity = 0; continue; }
    p.sprite.scale.setScalar(THREE.MathUtils.lerp(p.size0, p.size1, t));
    p.sprite.position.y = START_Y + p.oy + (p.rise + p.driftY) * t;
    p.sprite.position.z = START_Z - p.fwd * t;
    p.sprite.position.x = p.ox + p.driftX * t;
    p.mat.opacity = p.peak * Math.sin(t * Math.PI);   // fade in → out
  }
}

/** Hide all puffs (floor change). */
export function clearBreath(): void {
  for (const p of puffs) { p.active = false; p.sprite.visible = false; p.mat.opacity = 0; }
}
