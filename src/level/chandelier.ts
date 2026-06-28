import * as THREE from 'three';
import { registerLight } from '../scene/light-pool';
import { applyShadowRole } from '../scene/shadow-role';
import { chainRun } from '../content/chain-links';
import { stdMat } from '../style/material-registry';
import { buildRng } from '../engine/rng';

// ── CHANDELIER — the ceiling light class ─────────────────────────────
//
// An iron ring hung on chains, candle stubs burning on the rim. Tall
// rooms get their light from ABOVE: one central hung source paints a
// wide pool and the walls keep their darkness — which reads grander
// AND cheaper than four wall torches (one env slot instead of four).
// The per-room light budget places these and removes procedural wall
// torches in trade.
//
// Ceiling-height aware: the ring hangs ~30% of the room height down,
// clamped so low rooms never dangle it into faces and great halls
// don't leave it glued to the ceiling.

export function spawnChandelier(
  scene: THREE.Object3D,
  x: number,
  z: number,
  ceilH: number,
  tint: number | undefined,
  lightSerial: number,
): void {
  const drop = Math.min(1.5, Math.max(0.8, ceilH * 0.30));
  const ringY = ceilH - drop;
  const RING_R = 0.52;

  const iron = stdMat({
    color: 0x16140f, roughness: 0.6, metalness: 0.75, flatShading: true,
  });
  const group = new THREE.Group();

  // The ring.
  const ring = new THREE.Mesh(new THREE.TorusGeometry(RING_R, 0.034, 8, 20), iron);
  ring.rotation.x = Math.PI / 2;
  ring.position.set(x, ringY, z);
  group.add(ring);

  // Candle stubs + flames around the rim.
  const wax = stdMat({ color: 0xb8a98c, roughness: 0.95 });
  const flameColor = tint ?? 0xffaa55;
  const flame = stdMat({
    color: 0x000000, emissive: flameColor, emissiveIntensity: 2.2, roughness: 1.0, fog: false,
  });
  const stubs = 4;
  for (let i = 0; i < stubs; i++) {
    const a = (i / stubs) * Math.PI * 2 + buildRng() * 0.4;
    const sx = x + Math.cos(a) * RING_R * 0.92;
    const sz = z + Math.sin(a) * RING_R * 0.92;
    const h = 0.07 + buildRng() * 0.07;
    const stub = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, h, 6), wax);
    stub.position.set(sx, ringY + 0.02 + h / 2, sz);
    group.add(stub);
    const fl = new THREE.Mesh(new THREE.SphereGeometry(0.028, 6, 5), flame);
    fl.position.set(sx, ringY + 0.05 + h, sz);
    fl.name = 'flame';
    group.add(fl);
  }

  // Three chains to the ceiling, splayed; one centre drop.
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5;
    const fromPt = new THREE.Vector3(x + Math.cos(a) * RING_R, ringY + 0.02, z + Math.sin(a) * RING_R);
    const toPt = new THREE.Vector3(x + Math.cos(a) * 0.12, ceilH, z + Math.sin(a) * 0.12);
    group.add(chainRun(fromPt, toPt, iron, { sag: 0.02, spacing: 0.09 }));
  }

  // Overhead in the hall — out of the shadow system entirely (its candles light
  // the room; it needn't throw or catch a shadow, and it was a top caster in the
  // boss hall that drove the framerate down). See scene/shadow-role.ts.
  applyShadowRole(group, 'none');
  scene.add(group);

  // One central hung light — a wide warm pool from above. Flickers
  // like the candles it is.
  const seed = buildRng() * Math.PI * 2;
  const base = 55;
  registerLight({
    id: `chandelier-${lightSerial}`,
    category: 'environment',
    position: new THREE.Vector3(x, ringY - 0.15, z),
    color: flameColor,
    intensity: base,
    getIntensity: () => {
      const t = performance.now() / 1000;
      return base * (1 + 0.08 * (0.6 * Math.sin(t * 4.7 + seed) + 0.4 * Math.sin(t * 7.9 + seed * 2)));
    },
    distance: 9,
    decay: 2.0,
  });
}
