// Visible cold-breath exhale — the atmospheric sibling of the exhaustion
// breath audio + camera heave (exhaustion-feedback.ts). When you're winded a
// soft pale puff drifts up from the lower view and dissipates, once per breath
// cycle, heavier (more opaque) the more gassed you are. Sells "this place is
// cold and you're spent" without a HUD number.
//
// Camera-parented sprites (a tiny pool), so the puff sits in the player's view
// and follows the head. Emission is driven by exhaustion-feedback's existing
// breath cycle (emitBreath), so cadence already matches the breath SOUND.
// Tunable via CONFIG.EXHAUSTION.BREATH_PUFF_*. Browser-only (canvas texture).

import * as THREE from 'three';
import { CONFIG } from '../config';

const COUNT = 5;                 // pool size — only a couple are live at once
const START_Y = -0.14;           // camera-local: just below eye line ("mouth")
const START_Z = -0.42;           // a touch in front of the face

interface Puff {
  sprite: THREE.Sprite;
  mat: THREE.SpriteMaterial;
  life: number;
  ttl: number;
  peak: number;
  drift: number;   // lateral m/s
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
    puffs.push({ sprite, mat, life: 0, ttl: 0, peak: 0, drift: 0 });
  }
}

/** Emit one exhale, scaled by exertion (0..1). Called once per breath cycle. */
export function emitBreath(exertion: number): void {
  if (!cam || exertion <= 0) return;
  const p = puffs.find((x) => !x.sprite.visible);
  if (!p) return;
  const E = CONFIG.EXHAUSTION;
  p.ttl = E.BREATH_PUFF_LIFE;
  p.life = 0;
  p.peak = E.BREATH_PUFF_OPACITY * Math.min(1, exertion);
  p.drift = (Math.random() - 0.5) * 0.1;
  p.sprite.visible = true;
  p.sprite.position.set((Math.random() - 0.5) * 0.06, START_Y, START_Z);
  p.sprite.scale.setScalar(E.BREATH_PUFF_SIZE0);
  p.mat.opacity = 0;
}

/** Advance live puffs: rise + drift forward, expand, fade in then out. */
export function tickBreath(dt: number): void {
  if (!puffs.length) return;
  const E = CONFIG.EXHAUSTION;
  for (const p of puffs) {
    if (!p.sprite.visible) continue;
    p.life += dt;
    const t = p.ttl > 0 ? p.life / p.ttl : 1;
    if (t >= 1) { p.sprite.visible = false; p.mat.opacity = 0; continue; }
    p.sprite.scale.setScalar(THREE.MathUtils.lerp(E.BREATH_PUFF_SIZE0, E.BREATH_PUFF_SIZE1, t));
    p.sprite.position.y = START_Y + E.BREATH_PUFF_RISE * t;
    p.sprite.position.z = START_Z - E.BREATH_PUFF_FWD * t;
    p.sprite.position.x += p.drift * dt;
    p.mat.opacity = p.peak * Math.sin(t * Math.PI);   // fade in → out
  }
}

/** Hide all puffs (floor change). */
export function clearBreath(): void {
  for (const p of puffs) { p.sprite.visible = false; p.mat.opacity = 0; }
}
