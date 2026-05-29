import * as THREE from 'three';
import { registerLight, unregisterLight } from './light-pool';

// A faint diegetic coal at a passage threshold — a guttering ember that marks
// "a way through" in the dark WITHOUT a UI rim on the architecture. Per the
// "lighting as signal" doctrine this is in-world light (blessed), and it's
// meaningful: it sits at an onward passage.
//
// The visible additive SPRITE is the real wayfinding cue — it reads across a
// dark room even when the light pool hands its slot to a nearer torch (the
// sprite always renders; fog is off so it punches through the dark like a
// distant fire). The dim warm LIGHT it registers is a bonus floor-glow when a
// pool slot is free.

const EMBER_COLOR = 0xff7a30;        // warm coal orange
const LIGHT_INTENSITY = 1.0;         // dim; short range
const LIGHT_DISTANCE = 3.5;
const SPRITE_SCALE = 0.34;           // metres
const SPRITE_OPACITY = 0.6;
const EMBER_Y = 0.12;                // sits low — a coal on the floor

interface Ember {
  id: string;
  sprite: THREE.Sprite;
  mat: THREE.SpriteMaterial;
  intensity: number;   // current flickered intensity (pool reads via getIntensity)
  p1: number; p2: number;
  t: number;
}

let serial = 0;
const embers: Ember[] = [];
let glowTex: THREE.Texture | null = null;

function emberTexture(): THREE.Texture {
  if (glowTex) return glowTex;
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(255, 210, 140, 1)');
  grad.addColorStop(0.4, 'rgba(255, 130, 50, 0.55)');
  grad.addColorStop(1, 'rgba(255, 90, 30, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

/** Place a threshold ember at world (x, z). Added under `scene` (the level
 *  root) so teardown carries the sprite; the light is registered with the
 *  pool and cleared on level rebuild. */
export function spawnThresholdEmber(scene: THREE.Object3D, x: number, z: number): void {
  const id = `ember-${serial++}`;
  const mat = new THREE.SpriteMaterial({
    map: emberTexture(),
    color: EMBER_COLOR,
    transparent: true,
    opacity: SPRITE_OPACITY,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,            // a beacon — reads through the dark, like a distant fire
  });
  const sprite = new THREE.Sprite(mat);
  sprite.position.set(x, EMBER_Y, z);
  sprite.scale.set(SPRITE_SCALE, SPRITE_SCALE, 1);
  scene.add(sprite);

  // Cosmetic flicker phases — flame micro-jitter stays on Math.random (matches
  // the build-model flame-phase exclusion; doesn't affect gameplay).
  const ember: Ember = {
    id, sprite, mat, intensity: LIGHT_INTENSITY,
    p1: Math.random() * 6.283, p2: Math.random() * 6.283, t: 0,
  };
  embers.push(ember);

  registerLight({
    id,
    category: 'environment',
    position: sprite.position,
    color: EMBER_COLOR,
    intensity: LIGHT_INTENSITY,
    distance: LIGHT_DISTANCE,
    decay: 1.6,
    getIntensity: () => ember.intensity,
  });
}

/** Per-frame flicker. realDt so the coal stays alive through slow-mo. */
export function tickThresholdEmbers(dt: number): void {
  for (const e of embers) {
    e.t += dt;
    // Two-sine guttering flicker at incommensurable rates.
    const f = 0.7 + 0.3 * (0.6 * Math.sin(e.t * 5 + e.p1) + 0.4 * Math.sin(e.t * 11 + e.p2));
    e.intensity = LIGHT_INTENSITY * f;
    e.mat.opacity = SPRITE_OPACITY * (0.8 + 0.2 * f);
    const s = SPRITE_SCALE * (0.95 + 0.08 * f);
    e.sprite.scale.set(s, s, 1);
  }
}

/** Remove all embers + their lights. Call on level teardown. */
export function clearThresholdEmbers(): void {
  for (const e of embers) {
    unregisterLight(e.id);
    e.sprite.parent?.remove(e.sprite);
    e.mat.dispose();
  }
  embers.length = 0;
}
