import * as THREE from 'three';
import { getTexture } from '../style/procedural-textures';
import type { DomainId } from '../content/domains';
import { bindToDomain } from './domain-bind';
import { disposeGpu } from '../scene/gpu-dispose';

// THE FATE, TAKEN INTO YOU — the diegetic close of a reading.
//
// You pick a card in the reading screen; the screen dissolves back to the game
// world and the chosen card appears THERE — a billboarded quad hovering in front
// of your face — then IGNITES and is drawn into you, dissolving to embers. Not a
// menu animation: the fate becomes a physical thing in the dark for a beat, and
// then it's inside you.
//
// Camera-parented (like the sword viewmodel + breath puffs) so the card stays
// "in front of you" through any look movement, and inherently faces the player —
// a billboard by construction. Self-driven off wall-clock time in onBeforeRender
// so there's no frame-loop wiring and it cleans itself up when the beat ends.
//
// Three beats over ~1.35s:
//   1. RISE  (~360ms) — the card fades up out of the dark in front of the eyes,
//                       bobbing, self-lit so it reads against the black.
//   2. IGNITE (~420ms) — an accent-tinted flame blooms around it, edges brighten,
//                        embers peel up off the surface.
//   3. ABSORB (~560ms) — the card rushes in toward you and downward (into the
//                        chest), scaling + fading as the flame gutters — drawn in.

const BASE = import.meta.env.BASE_URL;

const CARD_W = 0.30, CARD_H = 0.50;     // apparent size in the hand's reach
const REST_Z = -0.60;                   // camera-local: just in front of the eyes
const REST_Y = -0.03;

const RISE_MS = 360;
const IGNITE_MS = 420;
const ABSORB_MS = 560;
const TOTAL_MS = RISE_MS + IGNITE_MS + ABSORB_MS;
const EMBER_COUNT = 9;

let cameraRef: THREE.PerspectiveCamera | null = null;

/** Wire the effect to the player camera (call once at boot, like initBreath). */
export function initCardClaim(camera: THREE.PerspectiveCamera): void {
  cameraRef = camera;
}

const texLoader = new THREE.TextureLoader();
function cardTex(url: string): THREE.Texture {
  const t = texLoader.load(url, undefined, undefined, (e) => console.error('[card-claim] texture FAILED', url, e));
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Ember { spr: THREE.Sprite; ox: number; oy: number; vx: number; vy: number; }

/** Play the world-space "fate drawn into you" beat for `cardId`, tinted `accentHex`
 *  (the card's domain colour). If `domain` is given, the shared domain-binding
 *  beat plays UNDER the burning card (the sigil + rune-ring), so a fate claim and
 *  a trinket pickup read as the same act of binding. No-op headless / pre-boot. */
export function playCardClaim(cardId: string, accentHex: string, domain?: DomainId): void {
  const camera = cameraRef;
  if (!camera || typeof document === 'undefined') return;
  const accent = new THREE.Color(accentHex);
  // The domain binds under the card (the reading already floods, so no flood here).
  if (domain) { try { bindToDomain(domain, { withFlood: false }); } catch { /* presentation */ } }

  // A rig on the camera; everything sits in its local frame so a look-around
  // carries the whole beat with the view.
  const rig = new THREE.Group();
  rig.position.set(0, REST_Y, REST_Z);
  rig.frustumCulled = false;
  camera.add(rig);

  // The card — a self-lit quad facing the player. depthTest off + a high
  // renderOrder so it draws cleanly over the world for its short life.
  const faceMat = new THREE.MeshBasicMaterial({
    map: cardTex(`${BASE}cards/${cardId}.webp`),
    transparent: true, side: THREE.DoubleSide, toneMapped: false,
    depthTest: false, depthWrite: false, opacity: 0,
  });
  const card = new THREE.Mesh(new THREE.PlaneGeometry(CARD_W, CARD_H), faceMat);
  card.renderOrder = 10000;
  card.frustumCulled = false;
  rig.add(card);

  // Flame wash behind + around the card — additive, accent-tinted, blooms during
  // the ignite beat and guts out through the absorb.
  const flameMat = new THREE.SpriteMaterial({
    map: getTexture('fire-wisp'), color: accent,
    transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
    depthTest: false, depthWrite: false, fog: false,
  });
  const flame = new THREE.Sprite(flameMat);
  flame.scale.set(CARD_W * 2.4, CARD_H * 1.7, 1);
  flame.position.z = -0.03;
  flame.renderOrder = 9999;
  flame.frustumCulled = false;
  rig.add(flame);

  // Embers — small additive motes that peel up off the burning card.
  const embers: Ember[] = [];
  for (let i = 0; i < EMBER_COUNT; i++) {
    const m = flameMat.clone();
    m.opacity = 0;
    const spr = new THREE.Sprite(m);
    const s = 0.02 + (i % 3) * 0.012;
    spr.scale.set(s, s, s);
    const ox = ((i * 47) % 100) / 100 * CARD_W - CARD_W / 2;
    const oy = ((i * 29) % 100) / 100 * CARD_H - CARD_H / 2;
    spr.position.set(ox, oy, 0.01);
    spr.renderOrder = 10001;
    spr.frustumCulled = false;
    rig.add(spr);
    embers.push({ spr, ox, oy, vx: (((i * 13) % 7) - 3) * 0.06, vy: 0.28 + (i % 4) * 0.05 });
  }

  const start = performance.now();
  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    camera.remove(rig);
    // Deferred — everything here was on screen a frame ago. The face map is
    // this card's own canvas texture (not a pooled one), so it goes too.
    disposeGpu(
      faceMat.map, faceMat, flameMat,
      ...embers.map((e) => e.spr.material as THREE.Material),
      card.geometry as THREE.BufferGeometry,
    );
  };

  // Driven every render off wall-clock time — no external tick, no per-floor
  // teardown to remember. Runs on the card (always drawn: frustumCulled off).
  card.onBeforeRender = () => {
    const el = performance.now() - start;
    if (el >= TOTAL_MS) { cleanup(); return; }

    if (el < RISE_MS) {
      // RISE — fade up, a slow bob, drifting a touch closer.
      const t = el / RISE_MS;
      const ease = 1 - (1 - t) * (1 - t);
      faceMat.opacity = ease;
      rig.position.z = REST_Z - 0.05 * (1 - ease);
      rig.position.y = REST_Y + Math.sin(t * Math.PI) * 0.012;
      card.scale.setScalar(0.9 + 0.1 * ease);
    } else if (el < RISE_MS + IGNITE_MS) {
      // IGNITE — flame blooms, edges brighten, embers lift.
      const t = (el - RISE_MS) / IGNITE_MS;
      faceMat.opacity = 1;
      faceMat.color.setScalar(1 + 0.9 * Math.sin(t * Math.PI));   // hot flare on the face
      flameMat.opacity = Math.sin(t * Math.PI) * 0.85;
      card.position.x = Math.sin(el * 0.05) * 0.004;              // a live flicker-jitter
      for (const e of embers) {
        (e.spr.material as THREE.SpriteMaterial).opacity = Math.sin(t * Math.PI) * 0.9;
        e.spr.position.set(e.ox + e.vx * t, e.oy + e.vy * t, 0.01);
      }
    } else {
      // ABSORB — the card rushes in + down into the chest, scaling + fading out
      // as the flame guts. "Drawn into you."
      const t = (el - RISE_MS - IGNITE_MS) / ABSORB_MS;
      const rush = t * t;                                         // accelerate inward
      faceMat.color.setScalar(1);
      faceMat.opacity = 1 - rush;
      rig.position.z = REST_Z + 0.42 * rush;                     // toward the eyes
      rig.position.y = REST_Y - 0.18 * rush;                     // and down, into the chest
      card.scale.setScalar((0.9 + 0.1) * (1 - 0.55 * rush));
      flameMat.opacity = 0.85 * (1 - t);
      for (const e of embers) {
        const et = 1 + t;
        (e.spr.material as THREE.SpriteMaterial).opacity = 0.9 * (1 - t);
        e.spr.position.set(e.ox + e.vx * et, e.oy + e.vy * et, 0.01);
      }
    }
  };
}
