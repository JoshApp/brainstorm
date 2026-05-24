import * as THREE from 'three';
import { CONFIG } from '../config';

// Floating damage numbers. DOM overlay above the canvas. Each number is a
// short-lived absolutely-positioned div that rises a few pixels and fades out
// over its lifetime. Auto-removed from the DOM at end of life.
//
// World position → screen position via camera.project(). If the hit is behind
// the camera, the number is skipped (clip-space z out of range).

const ndc = new THREE.Vector3();

export function spawnDamageNumber(camera: THREE.Camera, worldPos: THREE.Vector3, amount: number) {
  ndc.copy(worldPos).project(camera);
  if (ndc.z < -1 || ndc.z > 1) return; // outside the camera frustum

  const x = (ndc.x * 0.5 + 0.5) * window.innerWidth;
  const y = (-ndc.y * 0.5 + 0.5) * window.innerHeight;

  const el = document.createElement('div');
  el.textContent = String(amount);
  Object.assign(el.style, {
    position: 'fixed',
    left: `${x}px`,
    top: `${y}px`,
    transform: 'translate(-50%, -50%)',
    color: 'rgba(255, 220, 200, 0.95)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: '20px',
    fontWeight: '600',
    letterSpacing: '0.04em',
    textShadow: '0 0 6px rgba(0,0,0,0.95), 0 0 14px rgba(255,80,40,0.45)',
    pointerEvents: 'none',
    zIndex: '15',
    transition: `transform ${CONFIG.DAMAGE_NUMBER_LIFETIME}s ease-out, opacity ${CONFIG.DAMAGE_NUMBER_LIFETIME}s ease-out`,
    willChange: 'transform, opacity',
    opacity: '1',
  });

  document.body.appendChild(el);

  // Kick off the animation on next frame so the transition fires.
  requestAnimationFrame(() => {
    el.style.transform = `translate(-50%, calc(-50% - ${CONFIG.DAMAGE_NUMBER_RISE}px))`;
    el.style.opacity = '0';
  });

  setTimeout(() => el.remove(), CONFIG.DAMAGE_NUMBER_LIFETIME * 1000 + 100);
}
