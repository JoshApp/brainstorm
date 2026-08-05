import * as THREE from 'three';
import { acquireClone, releaseClone } from '../scene/effect-clone-pool';
import { registerWarmup } from '../content/warmup-registry';

// FEAR TELL — a bone skull hanging over the head of a creature whose nerve has
// broken. Its job is to be READ ACROSS A ROOM, in a hurry, on a phone: that one
// is running, its back is open, go and take it.
//
// Sibling of stun-stars.ts (same pooled-material lifecycle, same overlay
// ordering) but a deliberately different REGISTER. Stun is a spark — additive,
// spectral, weightless. Fear is an OBJECT: normal blending, dead bone-grey, a
// dark socket that reads against a torch. Two overhead cues that can never be
// mistaken for each other at a glance, which is the whole point of having them.
//
// Per docs/VISUAL-LANGUAGE.md the skull is allowed to glow faintly because it is
// SIGNAL, not decoration — an uncommon light that means something is happening
// there. It marks a kill window the player earned.

let skullTex: THREE.CanvasTexture | null = null;

/** The skull glyph, drawn once and shared by every feared creature. */
function getSkullTexture(): THREE.CanvasTexture {
  if (skullTex) return skullTex;
  const S = 96;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  const k = S / 96;   // authored at 96px; scale if that ever changes

  // Dark halo FIRST — the skull has to stay legible against a torch flare
  // behind it, and a soot-coloured falloff does that without adding light.
  const halo = ctx.createRadialGradient(48 * k, 46 * k, 4 * k, 48 * k, 46 * k, 46 * k);
  halo.addColorStop(0, 'rgba(18, 10, 10, 0.62)');
  halo.addColorStop(0.62, 'rgba(14, 8, 8, 0.34)');
  halo.addColorStop(1, 'rgba(10, 6, 6, 0)');
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, S, S);

  const BONE = 'rgba(206, 199, 182, 0.97)';
  const BONE_DIM = 'rgba(150, 143, 128, 0.95)';
  const SOCKET = 'rgba(9, 6, 7, 0.98)';

  // Cranium.
  ctx.fillStyle = BONE;
  ctx.beginPath();
  ctx.ellipse(48 * k, 40 * k, 26 * k, 25 * k, 0, 0, Math.PI * 2);
  ctx.fill();
  // Cheekbones + jaw — a tapering box under the cranium, rounded at the chin.
  ctx.beginPath();
  ctx.moveTo(29 * k, 54 * k);
  ctx.lineTo(67 * k, 54 * k);
  ctx.lineTo(62 * k, 74 * k);
  ctx.quadraticCurveTo(48 * k, 82 * k, 34 * k, 74 * k);
  ctx.closePath();
  ctx.fill();
  // The jaw sits in shadow — keeps the cranium reading as the bright mass.
  ctx.fillStyle = BONE_DIM;
  ctx.beginPath();
  ctx.moveTo(34 * k, 66 * k);
  ctx.lineTo(62 * k, 66 * k);
  ctx.lineTo(60 * k, 74 * k);
  ctx.quadraticCurveTo(48 * k, 81 * k, 36 * k, 74 * k);
  ctx.closePath();
  ctx.fill();

  // Sockets — big, black, angled inward. This is the shape the eye actually
  // recognises at 20 pixels tall, so it gets the most contrast on the glyph.
  ctx.fillStyle = SOCKET;
  for (const sx of [36, 60]) {
    ctx.save();
    ctx.translate(sx * k, 40 * k);
    ctx.rotate(sx < 48 ? 0.16 : -0.16);
    ctx.beginPath();
    ctx.ellipse(0, 0, 10 * k, 11.5 * k, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  // Nasal aperture.
  ctx.beginPath();
  ctx.moveTo(48 * k, 47 * k);
  ctx.lineTo(53 * k, 58 * k);
  ctx.lineTo(43 * k, 58 * k);
  ctx.closePath();
  ctx.fill();
  // Teeth — three notches cut out of the jaw. Cheap, and it stops the jaw
  // reading as a plain block.
  for (let i = 0; i < 3; i++) {
    ctx.fillRect((41 + i * 7) * k, 66 * k, 2.2 * k, 9 * k);
  }

  skullTex = new THREE.CanvasTexture(c);
  skullTex.colorSpace = THREE.SRGBColorSpace;
  return skullTex;
}

export interface FearSkull {
  /** Advance the hover + fade. `feared` drives fade in/out. */
  tick(dt: number, feared: boolean): void;
  dispose(): void;
}

/** Size of the skull in metres. Big enough to read at the far side of a room,
 *  small enough not to sit on the creature's silhouette. */
const SKULL_SIZE = 0.40;

// Template SpriteMaterial — built ONCE; per-skull instances are ACQUIRED from
// the effect-clone-pool and RELEASED on teardown, never disposed. On WebGPU,
// disposing the last live clone releases the compiled pipeline and the next
// rout would recompile mid-fight (see scene/effect-clone-pool.ts).
let skullMatTpl: THREE.SpriteMaterial | null = null;
function getSkullMatTemplate(): THREE.SpriteMaterial {
  if (!skullMatTpl) skullMatTpl = new THREE.SpriteMaterial({
    // depthTest OFF + high renderOrder → the cue always reads above the head,
    // never buried in the body of a tall creature or occluded by the pillar the
    // coward is cowering behind. Finding it is the reward; hunting for it isn't.
    map: getSkullTexture(), color: 0xffffff, transparent: true, opacity: 0,
    depthWrite: false, depthTest: false, fog: false,
  });
  return skullMatTpl;
}

/**
 * Hang a fear skull over `parent` (the creature's container) at local height
 * `y`. Hidden until `tick(dt, true)` fades it in.
 */
export function createFearSkull(parent: THREE.Object3D, y: number): FearSkull {
  const mat = acquireClone(getSkullMatTemplate());
  mat.opacity = 0;              // recycled clones carry their last owner's fade
  const sprite = new THREE.Sprite(mat);
  sprite.renderOrder = 9500;
  sprite.position.set(0, y, 0);
  sprite.scale.setScalar(SKULL_SIZE);
  sprite.visible = false;
  parent.add(sprite);

  let opacity = 0;
  let t = 0;
  let everShown = false;

  function tick(dt: number, feared: boolean): void {
    const target = feared ? 1 : 0;
    // Snaps IN (the panic is sudden) and drains out slowly (the nerve returns
    // gradually) — asymmetric rates, because a cue that leaves as fast as it
    // arrives reads as a flicker when a mob bobs in and out of the state.
    opacity += (target - opacity) * Math.min(1, dt * (feared ? 16 : 5));
    if (opacity < 0.01 && !feared) {
      if (sprite.visible) sprite.visible = false;
      return;
    }
    sprite.visible = true;
    t += dt;
    // A POP on first appearance, then a slow uneasy hover. The pop is what makes
    // the moment land — without it the skull just materialises and you miss it.
    const pop = everShown ? 1 : 1 + (1 - opacity) * 0.9;
    everShown = opacity > 0.6 ? true : everShown;
    const breathe = 1 + Math.sin(t * 2.1) * 0.05;
    sprite.scale.setScalar(SKULL_SIZE * pop * breathe);
    sprite.position.y = y + Math.sin(t * 1.7) * 0.05;
    mat.opacity = opacity * 0.94;
  }

  function dispose(): void {
    parent.remove(sprite);
    // Release the clone to the pool — never dispose (the pipeline stays pinned).
    releaseClone(getSkullMatTemplate(), mat);
  }

  return { tick, dispose };
}

// Warm the shared TEMPLATE by rendering one real skull during the live warm:
// skulls acquire pooled clones, and clones only share a pinned pipeline if the
// template's pipeline was compiled once.
registerWarmup({
  label: 'fear-skull', live: true,
  spawn: (scene) => {
    warmSkull = createFearSkull(scene, 1);
    warmSkull.tick(0.5, true);   // fade-in makes it visible for the warm render
  },
  clear: () => { warmSkull?.dispose(); warmSkull = null; },
});
let warmSkull: FearSkull | null = null;
