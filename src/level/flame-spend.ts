import * as THREE from 'three';
import { DEV } from '../debug/dev';

// ── SPENDING A FIRE ─────────────────────────────────────────────────────────
//
// A claimed fate fire collapses to cold embers: small, dim, ashen. That is the
// whole "already taken" signal — playtesting found a spent fire that merely got
// SMALLER still read as a little fire you could rest at, so the colour matters
// as much as the scale.
//
// This lives in its own file because it is the seam that broke. It used to be
// two private functions inside fate-fire.ts, which imports the card reading UI,
// the vignette, damage numbers and player state — so nothing could test it, and
// nothing did. Meanwhile the thing it operates on quietly changed shape
// underneath it:
//
//   A bonfire built with `batchSprites` HAS NO SPRITES. Every flame is a plain
//   Object3D placeholder whose look lives in an instanced buffer, driven by a
//   handle on `userData.batchedSprite` (and `userData.batchedFlame` for the
//   flame-mesh batch). A collector that looks for `isSprite` finds nothing, a
//   spender that reaches for `.material` finds nothing, and the fire keeps
//   burning at full height and full brightness after you have taken its card.
//   No error. No warning. The beat just stops happening.
//
// level/builder.ts has been building its bonfires with batchSprites for a while
// and registering them as fate fires, so that is not hypothetical — it is what
// the game was doing. mood-tint.ts and torchlight.ts had already been taught
// about batched placeholders; this collector had not.

/** The look a claimed fire cools TO — dark ash, not a dimmer orange. */
const SPENT_ASH = new THREE.Color(0x241009);
/** What a self-lit flame's emissive cools to: a faint ember, not a bright tongue. */
const EMBER = new THREE.Color(0x551505);

/**
 * A batched sprite/flame handle hanging off a placeholder's `userData`.
 * `scene/sprite-batch.ts` and `scene/flame-mesh-batch.ts` replace a Sprite/Mesh
 * with a bare Object3D and drive the look through these fields, so anything
 * that used to reach for `.material` has to come through here instead.
 */
interface BatchHandle { color: THREE.Color; opacity?: number }

export function batchHandleOf(o: THREE.Object3D): BatchHandle | undefined {
  return (o.userData.batchedSprite ?? o.userData.batchedFlame) as BatchHandle | undefined;
}

/** Everything in a bonfire that reads as FIRE: flame meshes (named 'flame'),
 *  real Sprites, and batched placeholders standing in for either. */
export function collectFlames(group: THREE.Object3D): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  group.traverse((o) => {
    if ((o as THREE.Sprite).isSprite || o.name === 'flame' || batchHandleOf(o)) out.push(o);
  });
  return out;
}

/**
 * Collapse the flames to low, cooled embers — smaller, dimmer, ashen.
 *
 * Scale works the same for both kinds: the batch reads WORLD scale off the
 * placeholder's matrix, so shrinking the placeholder shrinks the instance.
 * Colour does not — a placeholder has no material — so a batched flame is
 * cooled through its handle, to the same target, so batched and unbatched fires
 * spend to the same look.
 *
 * Materials are CLONED before mutating: bonfire flame materials may be shared
 * template-clones, so editing in place would dim every other fire too.
 */
export function spendFlames(flames: readonly THREE.Object3D[]): void {
  for (const f of flames) {
    f.scale.multiplyScalar(0.28);   // a low ember heap, not a small flame
    const handle = batchHandleOf(f);
    if (handle) {
      if (typeof handle.opacity === 'number') handle.opacity *= 0.3;
      handle.color.lerp(SPENT_ASH, 0.82);
      continue;
    }
    const obj = f as THREE.Mesh | THREE.Sprite;
    if (!obj.material) continue;
    obj.material = Array.isArray(obj.material) ? obj.material.map(spend) : spend(obj.material);
  }
}

function spend(m: THREE.Material): THREE.Material {
  const c = m.clone();
  const cc = c as THREE.Material & {
    opacity?: number; color?: THREE.Color; emissive?: THREE.Color; emissiveIntensity?: number;
  };
  if (typeof cc.opacity === 'number') { cc.opacity *= 0.3; cc.transparent = true; }
  cc.color?.lerp(SPENT_ASH, 0.82);
  cc.emissive?.lerp(EMBER, 0.7);
  if (typeof cc.emissiveIntensity === 'number') cc.emissiveIntensity *= 0.35;
  return c;
}

/** DEV: collapse a built bonfire's flames to the CLAIMED look (for snap compare). */
export function debugSpendFlames(group: THREE.Object3D): void {
  if (!DEV) return;
  spendFlames(collectFlames(group));
}
