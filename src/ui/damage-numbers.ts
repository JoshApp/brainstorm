import * as THREE from 'three';
import { CONFIG } from '../config';
import { worldToScreen } from './hud';

// Floating damage numbers. DOM overlay above the canvas. Each number is a
// short-lived absolutely-positioned div that rises a few pixels and fades out
// over its lifetime. Auto-removed from the DOM at end of life.
//
// CRIT animation: scale-burst from large → settle, yellow color, "!" suffix.
// Sells the rare big hit visually without being annoying.

/** A short-lived WORD that floats off a world point — used for combat status
 *  punctuation like "STAGGERED". Same rise+fade as a damage number, styled as a
 *  small spaced caps label so it reads as an event, not a number. */
export function spawnStatusText(
  camera: THREE.Camera,
  worldPos: THREE.Vector3,
  text: string,
  color: string = 'rgba(255, 236, 170, 0.98)',
) {
  const p = worldToScreen(worldPos, camera);
  if (p.z < -1 || p.behind) return;
  const el = document.createElement('div');
  el.textContent = text;
  const lifetime = CONFIG.DAMAGE_NUMBER_LIFETIME * 1.3;
  const rise = CONFIG.DAMAGE_NUMBER_RISE * 1.3;
  Object.assign(el.style, {
    position: 'fixed',
    left: `${p.x}px`,
    top: `${p.y}px`,
    transform: 'translate(-50%, -50%) scale(1.25)',
    color,
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: '17px',
    fontWeight: '800',
    letterSpacing: '0.16em',
    textTransform: 'uppercase',
    textShadow: '0 0 6px rgba(0,0,0,0.95), 0 0 16px rgba(255,180,40,0.5)',
    pointerEvents: 'none',
    zIndex: '16',
    transition: `transform ${lifetime}s ease-out, opacity ${lifetime}s ease-out`,
    willChange: 'transform, opacity',
    opacity: '1',
  });
  document.body.appendChild(el);
  requestAnimationFrame(() => {
    el.style.transform = `translate(-50%, calc(-50% - ${rise}px)) scale(1.0)`;
    el.style.opacity = '0';
  });
  setTimeout(() => el.remove(), lifetime * 1000 + 100);
}

export function spawnDamageNumber(
  camera: THREE.Camera,
  worldPos: THREE.Vector3,
  amount: number,
  crit: boolean = false,
  /** A GRAZE — a cleaved secondary target that took reduced (falloff) damage.
   *  Rendered small + dim + cool-toned so the player reads "this one only got
   *  clipped" against the solid number on the primary target. Crit wins over
   *  graze (a grazed crit is still a crit visually). */
  graze: boolean = false,
  /** An EXECUTE — a finisher on a staggered/low-HP foe. The loudest number:
   *  big, blood-red with a white core. Wins over crit/graze styling. */
  execute: boolean = false,
) {
  graze = graze && !crit && !execute;
  const p = worldToScreen(worldPos, camera);
  if (p.z < -1 || p.behind) return; // outside the camera frustum
  const x = p.x;
  const y = p.y;

  const el = document.createElement('div');
  el.textContent = crit ? `${amount}!` : String(amount);
  // Executes + crits live a touch longer so the player sees the burst clearly.
  const big = crit || execute;
  const lifetime = big ? CONFIG.DAMAGE_NUMBER_LIFETIME * 1.4 : CONFIG.DAMAGE_NUMBER_LIFETIME;
  const rise = big ? CONFIG.DAMAGE_NUMBER_RISE * 1.4 : CONFIG.DAMAGE_NUMBER_RISE;
  Object.assign(el.style, {
    position: 'fixed',
    left: `${x}px`,
    top: `${y}px`,
    // Executes + crits start LARGER and we let CSS transition scale it down.
    transform: execute
      ? 'translate(-50%, -50%) scale(1.9)'
      : crit
      ? 'translate(-50%, -50%) scale(1.6)'
      : 'translate(-50%, -50%) scale(1.0)',
    color: execute ? 'rgba(255, 250, 245, 0.99)'
      : crit ? 'rgba(255, 235, 130, 0.98)'
      : graze ? 'rgba(190, 205, 215, 0.85)'
      : 'rgba(255, 220, 200, 0.95)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: execute ? '40px' : crit ? '34px' : graze ? '15px' : '20px',
    fontWeight: execute ? '900' : crit ? '800' : graze ? '500' : '600',
    letterSpacing: big ? '0.06em' : '0.04em',
    textShadow: execute
      ? '0 0 10px rgba(220, 20, 20, 0.98), 0 0 26px rgba(150, 0, 0, 0.85), 0 0 3px rgba(0,0,0,0.98)'
      : crit
      ? '0 0 8px rgba(255, 200, 60, 0.95), 0 0 22px rgba(255, 140, 30, 0.7), 0 0 2px rgba(0,0,0,0.95)'
      : graze
      ? '0 0 4px rgba(0,0,0,0.9)'
      : '0 0 6px rgba(0,0,0,0.95), 0 0 14px rgba(255,80,40,0.45)',
    pointerEvents: 'none',
    zIndex: '15',
    transition: `transform ${lifetime}s ease-out, opacity ${lifetime}s ease-out`,
    willChange: 'transform, opacity',
    opacity: '1',
  });

  document.body.appendChild(el);

  // Kick off the animation on next frame. Crit transform settles to a
  // slightly tilted, smaller scale so the burst → linger reads.
  requestAnimationFrame(() => {
    if (big) {
      el.style.transform = `translate(-50%, calc(-50% - ${rise}px)) scale(1.0) rotate(-2deg)`;
    } else {
      el.style.transform = `translate(-50%, calc(-50% - ${rise}px)) scale(1.0)`;
    }
    el.style.opacity = '0';
  });

  setTimeout(() => el.remove(), lifetime * 1000 + 100);
}
