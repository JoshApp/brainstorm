import * as THREE from 'three';
import type { LevelSpec, RoomSpec, TorchSpec } from './types';
import type { BuiltModel } from '../ecs/build-model';
import { getTexture } from '../style/procedural-textures';

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
  // Fallback: nearest torch within reach. A candle can sit in a sub-room or
  // corridor that carries no torches of its own (multi-room vaults, composed
  // floors) — the room-average above returns null and the prop kept its default
  // warm flame. Next to a blood-red or sickly-green chamber that read as "some
  // candles tinted, some left white" in the same space. Borrowing the closest
  // torch's tint makes every moodTintable prop agree with the local mood.
  let best: number | null = null;
  let bestD2 = MOOD_TINT_FALLBACK_RADIUS * MOOD_TINT_FALLBACK_RADIUS;
  for (const t of spec.torches) {
    const d2 = (t.x - x) * (t.x - x) + (t.z - z) * (t.z - z);
    if (d2 <= bestD2) { bestD2 = d2; best = t.colorTint ?? 0xffaa55; }
  }
  return best;
}

// How far a moodTintable prop will reach for a torch to borrow a tint from when
// its own room has none. ~one large room across — close enough that the prop
// and torch read as the same space, far enough to cross a sub-room boundary.
const MOOD_TINT_FALLBACK_RADIUS = 9;

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
  //
  // Crucially, also swap the map to the NEUTRAL 'moonbeam' texture. The
  // default flame sprite uses 'fire-wisp', whose gradient bakes in a
  // yellow-white→orange→red ramp. Additive `color` multiply can DARKEN that
  // ramp but can't add the blue/green a cool tint needs — so a violet- or
  // blood-tinted candle kept a warm core and read "white" next to the
  // cleanly-recoloured wall torches (whose look is driven by the emissive
  // flame sphere, not the sprite). moonbeam is a neutral white radial, so the
  // tint colour alone decides the hue. (Same swap the stair shaft already
  // does for exactly this reason — see stairs.ts.)
  built.group.traverse((obj) => {
    const sprite = obj as THREE.Sprite;
    if (!sprite.isSprite) return;
    const m = sprite.material as THREE.SpriteMaterial;
    if (m.blending !== THREE.AdditiveBlending) return;
    m.color.setHex(tint);
    m.map = getTexture('moonbeam');
    m.needsUpdate = true;
  });
}
