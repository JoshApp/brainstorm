import * as THREE from 'three';
import { setFovOffset, applyFov } from './camera-fov';
import { getBulletTimeIntensity } from '../combat/reactive-defense';
import { setSlowmoAmount, playSlowmoExit } from '../audio/sfx';

// Bullet-time PRESENTATION — the image + camera half of the perfect-dodge
// slow-mo (the audio muffle is driven from here too, via setSlowmoAmount; the
// world-slow itself lives in reactive-defense). Reads getBulletTimeIntensity()
// (0 idle → 1 at the held floor) each frame and layers:
//
//   · a COLD vignette — a cool, desaturated wash creeping in from the edges as
//     the dip deepens, so the world reads as going still + cold (the warmth of
//     the torches receding), not merely slow,
//   · a TRIGGER POP — a brief brighter flash + a small FOV zoom-in on the
//     instant the dip opens, to sell the snap-in,
//   · the AUDIO muffle amount, and the release "whoosh" on the dip's tail.
//
// Pure DOM overlay (no shader/post pass — mobile-cheap) + a transient FOV
// offset on the camera. Reset on floor load.

let coldEl: HTMLDivElement | null = null;   // the steady cold vignette (opacity ∝ intensity)
let popEl: HTMLDivElement | null = null;    // the entry flash (decays on its own)

let fovKick = 0;       // current transient FOV offset (negative = zoom-in)
let popLeft = 0;       // entry-flash countdown (s)
let prevIntensity = 0;

const POP_DUR = 0.22;       // entry flash length (s)
const FOV_ZOOM = 6;         // degrees of zoom-in punch at entry
const FOV_DECAY = 6;        // per-second ease of the FOV kick back to 0
const COLD_MAX_OPACITY = 0.6;

function ensureEls(): void {
  if (coldEl || typeof document === 'undefined') return;
  coldEl = document.createElement('div');
  coldEl.id = 'slowmo-cold';
  Object.assign(coldEl.style, {
    position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '7',
    opacity: '0', willChange: 'opacity',
    // Cool blue-grey draining in from the edges — the torchlight warmth pulling
    // back. Transparent core so the centre of the action stays readable.
    background: 'radial-gradient(ellipse at center, rgba(70,90,120,0) 28%, rgba(55,70,100,0.5) 72%, rgba(30,40,65,0.85) 100%)',
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(coldEl);

  popEl = document.createElement('div');
  popEl.id = 'slowmo-pop';
  Object.assign(popEl.style, {
    position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '7',
    opacity: '0', willChange: 'opacity',
    background: 'radial-gradient(ellipse at center, rgba(200,225,255,0.22) 0%, rgba(150,190,255,0.10) 45%, transparent 70%)',
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(popEl);
}

/** Drive the slow-mo image/camera/audio cues. Call every frame (real time, so
 *  the cues themselves don't slow). `camera` gets a transient FOV kick. */
export function tickSlowmoPresentation(camera: THREE.PerspectiveCamera, realDt: number): void {
  ensureEls();

  const intensity = getBulletTimeIntensity();

  // Rising edge → the snap-in pop (flash + FOV zoom). The entry whoomph is
  // already fired by enterBulletTime; the release whoosh fires on the tail.
  if (prevIntensity < 0.02 && intensity >= 0.02) {
    popLeft = POP_DUR;
    fovKick = -FOV_ZOOM;
  }
  if (prevIntensity >= 0.05 && intensity < 0.05) {
    playSlowmoExit();
  }
  prevIntensity = intensity;

  // Audio muffle tracks the dip.
  setSlowmoAmount(intensity);

  // Cold vignette opacity tracks the dip.
  if (coldEl) coldEl.style.opacity = String(intensity * COLD_MAX_OPACITY);

  // Entry flash decays independently.
  if (popLeft > 0) {
    popLeft = Math.max(0, popLeft - realDt);
    if (popEl) popEl.style.opacity = String((popLeft / POP_DUR));
  } else if (popEl && popEl.style.opacity !== '0') {
    popEl.style.opacity = '0';
  }

  // FOV kick eases back to 0. It is now a NAMED OFFSET rather than a direct
  // write (effects/camera-fov.ts) — this used to cache a base FOV and assign
  // camera.fov itself, which meant it could only avoid fighting other writers
  // by declining to touch the camera at rest. Momentum is the second writer
  // that made that untenable.
  if (Math.abs(fovKick) > 0.01) {
    fovKick += (0 - fovKick) * Math.min(1, realDt * FOV_DECAY);
  } else if (fovKick !== 0) {
    fovKick = 0;
  }
  setFovOffset('slowmo', fovKick);
}

/** Floor load — clear overlays + restore the FOV. */
export function resetSlowmoPresentation(camera?: THREE.PerspectiveCamera): void {
  prevIntensity = 0;
  popLeft = 0;
  fovKick = 0;
  if (coldEl) coldEl.style.opacity = '0';
  if (popEl) popEl.style.opacity = '0';
  setSlowmoAmount(0);
  setFovOffset('slowmo', 0);
  if (camera) applyFov(camera);
}
