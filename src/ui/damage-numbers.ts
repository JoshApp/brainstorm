import * as THREE from 'three';
import { CONFIG } from '../config';

// Floating damage numbers. DOM overlay above the canvas. Each number is a
// short-lived absolutely-positioned div that rises a few pixels and fades out
// over its lifetime. Auto-removed from the DOM at end of life.
//
// CRIT animation: scale-burst from large → settle, yellow color, "!" suffix.
// Sells the rare big hit visually without being annoying.

const ndc = new THREE.Vector3();

export function spawnDamageNumber(
  camera: THREE.Camera,
  worldPos: THREE.Vector3,
  amount: number,
  crit: boolean = false,
) {
  ndc.copy(worldPos).project(camera);
  if (ndc.z < -1 || ndc.z > 1) return; // outside the camera frustum

  const x = (ndc.x * 0.5 + 0.5) * window.innerWidth;
  const y = (-ndc.y * 0.5 + 0.5) * window.innerHeight;

  const el = document.createElement('div');
  el.textContent = crit ? `${amount}!` : String(amount);
  // Crits live a touch longer so the player sees the burst clearly.
  const lifetime = crit ? CONFIG.DAMAGE_NUMBER_LIFETIME * 1.4 : CONFIG.DAMAGE_NUMBER_LIFETIME;
  const rise = crit ? CONFIG.DAMAGE_NUMBER_RISE * 1.4 : CONFIG.DAMAGE_NUMBER_RISE;
  Object.assign(el.style, {
    position: 'fixed',
    left: `${x}px`,
    top: `${y}px`,
    // Crits start LARGER and we let CSS transition scale it down.
    transform: crit
      ? 'translate(-50%, -50%) scale(1.6)'
      : 'translate(-50%, -50%) scale(1.0)',
    color: crit ? 'rgba(255, 235, 130, 0.98)' : 'rgba(255, 220, 200, 0.95)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: crit ? '34px' : '20px',
    fontWeight: crit ? '800' : '600',
    letterSpacing: crit ? '0.06em' : '0.04em',
    textShadow: crit
      ? '0 0 8px rgba(255, 200, 60, 0.95), 0 0 22px rgba(255, 140, 30, 0.7), 0 0 2px rgba(0,0,0,0.95)'
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
    if (crit) {
      el.style.transform = `translate(-50%, calc(-50% - ${rise}px)) scale(1.0) rotate(-2deg)`;
    } else {
      el.style.transform = `translate(-50%, calc(-50% - ${rise}px)) scale(1.0)`;
    }
    el.style.opacity = '0';
  });

  setTimeout(() => el.remove(), lifetime * 1000 + 100);
}
