import * as THREE from 'three';
import type { LevelSpec, RoomSpec, TorchSpec } from './types';
import type { BuiltModel } from '../ecs/build-model';

// Mood-tint colour math, extracted from builder.ts. Pure helpers that derive
// a room's signature light colour (the average of its torches) so fill lights
// and tintable flame props agree with the palette a vault commits to —
// blood-red chambers get red fills, sickly-green ones get green, etc.
// See the "Lighting as signal" section in CLAUDE.md.

/** Linear mix between two hex colors. t=0 returns a, t=1 returns b. */
export function mixColors(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

/** Average torch colorTint across every torch whose position falls
 *  inside `rect`. Returns null when the room has no torches — caller
 *  falls back to the default fill colour. Used so fill PointLights in
 *  a blood-tinted chamber read RED, not generic warm; sickly-green
 *  chambers get sickly-green fills; etc. */
export function averageTorchTintInRect(torches: TorchSpec[], rect: { x: number; z: number; w: number; d: number }): number | null {
  const hw = rect.w / 2;
  const hd = rect.d / 2;
  let n = 0, r = 0, g = 0, b = 0;
  for (const t of torches) {
    if (t.x < rect.x - hw || t.x > rect.x + hw) continue;
    if (t.z < rect.z - hd || t.z > rect.z + hd) continue;
    const tint = t.colorTint ?? 0xffaa55;
    r += (tint >> 16) & 0xff;
    g += (tint >> 8) & 0xff;
    b += tint & 0xff;
    n++;
  }
  if (n === 0) return null;
  return (Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n);
}

/** Look up the mood tint (average torch palette) for a world point.
 *  Walks rooms smallest-first so a sub-room's local torches win over
 *  its parent vault's average; falls back to the parent if the sub
 *  has no torches. Returns null when the position is outside every
 *  room OR no torch sits inside any of its containing rects. */
export function moodTintForPosition(spec: LevelSpec, x: number, z: number): number | null {
  const candidates: RoomSpec[] = [];
  for (const r of spec.rooms) {
    const hw = r.rect.w / 2;
    const hd = r.rect.d / 2;
    if (x >= r.rect.x - hw && x <= r.rect.x + hw &&
        z >= r.rect.z - hd && z <= r.rect.z + hd) {
      candidates.push(r);
    }
  }
  candidates.sort((a, b) => (a.rect.w * a.rect.d) - (b.rect.w * b.rect.d));
  for (const r of candidates) {
    const tint = averageTorchTintInRect(spec.torches, r.rect);
    if (tint !== null) return tint;
  }
  return null;
}

/** Recolour a built model's flame-family materials + additive sprite
 *  particles + (signalled out) attached light to `tint`. Used by the
 *  model-prop handler when the spec sets moodTintable. Wax / wick /
 *  iron / wood materials and non-additive sprites are left alone.
 *  The light's colour override is returned via a separate path
 *  (`lightColorOverride` in the caller) so we don't have to mutate
 *  the spec. */
export function applyMoodTint(built: BuiltModel, tint: number): void {
  // Named flame-family materials — mutate colour + emissive together
  // so the tint reads in both lit and unlit paths.
  for (const name of ['flame', 'core', 'orb', 'shine']) {
    const mat = built.materials.get(name) as THREE.MeshStandardMaterial | undefined;
    if (!mat) continue;
    if (mat.color) mat.color.setHex(tint);
    if (mat.emissive) mat.emissive.setHex(tint);
  }
  // Additive sprite tongues (flame, embers). These are unnamed in the
  // materials map; walk the scene-graph instead and recolour any
  // additive SpriteMaterial.
  built.group.traverse((obj) => {
    const sprite = obj as THREE.Sprite;
    if (!sprite.isSprite) return;
    const m = sprite.material as THREE.SpriteMaterial;
    if (m.blending !== THREE.AdditiveBlending) return;
    m.color.setHex(tint);
  });
}
