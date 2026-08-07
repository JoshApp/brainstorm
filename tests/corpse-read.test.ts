// A FALLEN DELVER HAS TO READ AGAINST THE FLOOR IT IS LYING ON.
//
// Josh, on a phone: *"I saw a dead delver, the skeleton version — that one
// looked awesome. I don't really like the others because they are brown on
// brown; the skeleton reads nice with the lighting bouncing off."*
//
// He was describing a number. The dungeon floor is a warm near-black
// (CONFIG.FLOOR_COLOR) lit by a warm lamp, and three quarters of a FLESHY
// corpse was warm brown rag barely brighter than it — measured at 12× the
// floor's luminance against the skeleton's 92×, so the same prop read seven
// times stronger in one decay than the other.
//
// This is here because it is not a thing a screenshot settles: the bench lights
// models with a bright neutral key, which flatters every palette, and the game
// lights them with one dim warm point at two metres. The albedo is what decides
// whether a body is findable, and the albedo is a number.
//
// Both halves are asserted, because value alone does not survive down here — a
// warm grey and warm stone stay the same family however you scale them, and
// what separates a corpse from the floor at torch range is that it is COLD.
//
//   npm test

import assert from 'node:assert/strict';
import { CONFIG } from '../src/config';
import { makeCorpseModel } from '../src/content/corpse-model';
import type { CorpseDecay, CorpsePose } from '../src/content/corpses';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
/** Relative luminance, sRGB → linear, Rec.709 weights. */
const lum = (h: number) =>
  0.2126 * lin(((h >> 16) & 255) / 255)
  + 0.7152 * lin(((h >> 8) & 255) / 255)
  + 0.0722 * lin((h & 255) / 255);
/** Red minus blue: positive is the warm family the stone and the lamp are in. */
const warmth = (h: number) => ((((h >> 16) & 255) - (h & 255)) / 255);

/**
 * The body's albedo, weighted by limb GIRTH — which is what a silhouette is
 * made of, and the reason a pale strap does not rescue a brown cloak.
 *
 * Built from the REAL model, so a material renamed or a part re-clothed moves
 * this number instead of quietly leaving the test measuring a stale copy.
 * Decals are excluded: the blood pool is a metre across and lies flat under the
 * body, so counting its extent would swamp every limb on the model.
 */
function bodyAlbedo(pose: CorpsePose, decay: CorpseDecay): { lum: number; warmth: number } {
  const spec = makeCorpseModel(pose, decay, false);
  const mats = spec.materials as Record<string, { color: number }>;
  const girth = new Map<string, number>();
  for (const p of spec.parts as Array<Record<string, unknown>>) {
    if (p.kind === 'decal' || p.kind === 'sprite') continue;
    const r = (p.radius as number)
      ?? Math.max(...((p.size as number[]) ?? [0.05]));
    const mat = (p.mat as string) ?? '';
    girth.set(mat, (girth.get(mat) ?? 0) + r);
  }
  let total = 0;
  for (const g of girth.values()) total += g;
  let L = 0, W = 0;
  for (const [m, g] of girth) {
    const c = mats[m]?.color ?? 0;
    L += lum(c) * (g / total);
    W += warmth(c) * (g / total);
  }
  return { lum: L, warmth: W };
}

const POSES: CorpsePose[] = ['slumped', 'curled', 'crawled'];
const FLOOR = lum(CONFIG.FLOOR_COLOR);
const FLOOR_WARMTH = warmth(CONFIG.FLOOR_COLOR);

test('A FLESHY DELVER IS NOT BROWN ON BROWN', () => {
  for (const pose of POSES) {
    const a = bodyAlbedo(pose, 'fleshy');
    // COLDER THAN THE STONE. This is the half that value cannot substitute for:
    // the floor is warm and so is every light down here, so a body in the warm
    // family is the floor no matter how you scale it.
    assert.ok(a.warmth < FLOOR_WARMTH - 0.02,
      `${pose}: the body reads warmth ${a.warmth.toFixed(2)} against warm stone at `
      + `${FLOOR_WARMTH.toFixed(2)} — that is brown on brown`);
    // And bright enough to be a shape the lamp finds. It was 12× before.
    assert.ok(a.lum > FLOOR * 15,
      `${pose}: ${(a.lum / FLOOR).toFixed(1)}× the floor's luminance — the lamp will not find it`);
  }
});

test('...and the SKULL is still the brightest thing on a body', () => {
  // The control. "Make the corpse read" has an obvious wrong answer — turn
  // everything up — and it costs the thing Josh actually liked, which is that
  // bone is what the light catches. A skeletal delver has to stay clearly the
  // stronger read, or the two decays stop being two decays.
  for (const pose of POSES) {
    const fleshy = bodyAlbedo(pose, 'fleshy');
    const skeletal = bodyAlbedo(pose, 'skeletal');
    assert.ok(skeletal.lum > fleshy.lum * 2.5,
      `${pose}: skeletal ${(skeletal.lum / FLOOR).toFixed(0)}× vs fleshy `
      + `${(fleshy.lum / FLOOR).toFixed(0)}× — the bone stopped being the story`);
  }
});

test('nothing on a corpse is brighter than bone', () => {
  // A grimdark body with one specular highlight on it reads as loot. Bone is
  // the ceiling; everything else sits under it.
  const spec = makeCorpseModel('curled', 'skeletal', true);
  const mats = spec.materials as Record<string, { color: number }>;
  const bone = lum(mats.bone.color);
  for (const [name, m] of Object.entries(mats)) {
    if (name === 'bone') continue;
    assert.ok(lum(m.color) <= bone,
      `${name} (${lum(m.color).toFixed(2)}) is brighter than bone (${bone.toFixed(2)})`);
  }
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
