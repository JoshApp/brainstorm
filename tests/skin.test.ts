// A SEAM WITH ONE IMPLEMENTATION IS A CLAIM, NOT A FACT.
//
// src/level/skins.ts ships exactly one skin, on purpose — the first pass of an
// architecture should reproduce what shipped, not introduce a look nobody asked
// for. But "a theme is now a data file" is precisely the sort of statement that
// is easy to write and easy to have wrong, and a single-skin catalog cannot
// disprove it.
//
// So the second skin lives HERE. It is a throwaway, it never ships, and its only
// job is to prove that swapping the palette swaps what the dungeon is made of
// without a placement pass knowing. If this file stops compiling or stops
// passing, the seam has quietly closed.
//
// The other half is REFUSAL. `resolveSkin` returning null is the feature that
// separates a resolver from a lookup table: the request describes the situation,
// the candidate describes its needs, and a thing that does not fit is dropped
// rather than squeezed in. Half these tests are about the drop.
//
//   npm test

import assert from 'node:assert/strict';
import { resolveSkin, skinCandidates, skinCoverage, type Skin } from '../src/level/skin';
import { CRYPT_SKIN, SKINS, activeSkin, setActiveSkin } from '../src/level/skins';
import type { ModelSpec } from '../src/ecs/model-types';
import { generatePolyFloor } from '../src/level/poly-floor';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

/** Deterministic "random" so a weighted pick is a decision, not a coin flip. */
const fixed = (v: number) => () => v;

const stub = (id: string): ModelSpec => ({ id, materials: {}, parts: [] });

test('THE SEAM IS REAL — a different palette builds a different dungeon', () => {
  // The whole promise of the architecture in one assertion. Same intent, same
  // caller, same rand; only the palette differs.
  const bone: Skin = {
    id: 'test-bone', name: 'Bone',
    palette: { 'light.wall': [{ model: stub('skull-lantern') }] },
  };
  const fromCrypt = resolveSkin(CRYPT_SKIN, { intent: 'light.wall' }, fixed(0.1));
  const fromBone = resolveSkin(bone, { intent: 'light.wall' }, fixed(0.1));
  assert.equal(fromBone?.id, 'skull-lantern');
  assert.notEqual(fromCrypt?.id, fromBone?.id,
    'two skins answered the same intent with the same model — the palette is not being read');
});

test('AN INTENT A SKIN HAS NO ANSWER FOR RETURNS NULL, NOT A GUESS', () => {
  // A half-written theme must be VISIBLE. Substituting some other intent's model
  // would make a missing palette entry look like a design choice.
  const thin: Skin = { id: 'test-thin', name: 'Thin', palette: {} };
  assert.equal(resolveSkin(thin, { intent: 'light.floor' }, fixed(0.5)), null);
});

test('A CANDIDATE THAT DOES NOT FIT IS REFUSED', () => {
  // The cresset pike is 2.4m of iron. In a 1.8m crawlspace the answer must be
  // the squat brazier, never the pike — and the caller never had to know that.
  const low = resolveSkin(CRYPT_SKIN,
    { intent: 'light.floor', footprint: 1, headroom: 1.8 }, fixed(0.99));
  assert.equal(low?.id, 'iron-brazier');

  // And with headroom, the pike is reachable — otherwise the test above would
  // pass on a palette that simply never offers a pike.
  const tall = resolveSkin(CRYPT_SKIN,
    { intent: 'light.floor', footprint: 1, headroom: 3.2 }, fixed(0.99));
  assert.equal(tall?.id, 'cresset-pike');
});

test('a footprint smaller than anything in the palette gets nothing', () => {
  // Not a crash, not the least-bad fit. An empty spot is the honest answer for a
  // spot too small for the theme.
  const none = resolveSkin(CRYPT_SKIN,
    { intent: 'light.floor', footprint: 0.05, headroom: 3.2 }, fixed(0.5));
  assert.equal(none, null);
});

test('A ROOM\'S CLAIM FILTERS THE PALETTE — the merchant cannot draw a cobweb', () => {
  // prop-taxonomy's contradiction table, enforced at the point of choosing
  // rather than by every pass remembering to check. A brazier somebody dragged
  // in and lit asserts TENDED, so a room committed to ABANDONED must never be
  // offered one — whatever the roll.
  //
  // The exemplars here are deliberately a STANDING light against a DEAD wall
  // fixture, because that is the axis the table actually splits on: portable or
  // placed asserts tending, architectural does not. This test previously used a
  // wall torch as the tended side and broke when the table was corrected, which
  // is the table doing its job.
  const web: Skin = {
    id: 'test-web', name: 'Web',
    palette: {
      'light.floor': [
        { model: stub('iron-brazier'), weight: 1 },   // tended — someone lit this
        { model: stub('wall-stub'), weight: 1 },      // abandoned — a cresset with no fire left
      ],
    },
  };
  for (const roll of [0.0, 0.3, 0.7, 0.99]) {
    const m = resolveSkin(web, { intent: 'light.floor', claims: ['abandoned'] }, fixed(roll));
    assert.equal(m?.id, 'wall-stub',
      `an abandoned room was offered ${m?.id} — the claim filter is not running`);
  }
});

test('a builder candidate is handed the request', () => {
  // Parametric models (a god ray sized to the ceiling, a glow in the room's
  // colour) are the reason `model` may be a function. If the request did not
  // reach it, every shaft in the game would be the default height and every
  // pool the default blue, which is exactly the bug this signature prevents.
  const seen: Array<number | undefined> = [];
  const probe: Skin = {
    id: 'test-probe', name: 'Probe',
    palette: { 'light.pool': [{ model: (req) => { seen.push(req.tint); return stub('glow'); } }] },
  };
  resolveSkin(probe, { intent: 'light.pool', tint: 0xff0000 }, fixed(0.5));
  assert.deepEqual(seen, [0xff0000]);
});

test('WEIGHTS ARE HONOURED, so a theme can have a default and an accent', () => {
  // 75/25 in the crypt's wall pool. A low roll must land in the heavy entry and
  // a high roll in the light one — if weights were ignored both would be the
  // same model and the "occasional silhouette break" would be a coin flip.
  assert.equal(resolveSkin(CRYPT_SKIN, { intent: 'light.wall' }, fixed(0.1))?.id, 'wall-torch');
  assert.equal(resolveSkin(CRYPT_SKIN, { intent: 'light.wall' }, fixed(0.9))?.id, 'wall-cresset');
});

test('THE SHIPPING SKIN COVERS EVERY LIGHT INTENT THE GENERATOR ASKS FOR', () => {
  // A palette hole is a room with a hole in it. poly-floor.ts requests exactly
  // these four; if one is ever dropped from the crypt, rooms go dark silently.
  const covered = new Set(skinCoverage(CRYPT_SKIN));
  for (const i of ['light.wall', 'light.floor', 'light.pool', 'light.shaft'] as const) {
    assert.ok(covered.has(i), `the crypt has no answer for ${i}`);
  }
});

test('the active skin defaults to the crypt and an unknown id falls back to it', () => {
  assert.equal(activeSkin().id, 'crypt');
  setActiveSkin('no-such-theme');
  assert.equal(activeSkin().id, 'crypt',
    'an unknown theme silently became undefined — every request would then return null');
  setActiveSkin('crypt');
});

test('every catalog entry is keyed by its own id', () => {
  // A typo in the key makes a theme unreachable by name while still looking
  // present in the file.
  for (const [key, skin] of Object.entries(SKINS)) assert.equal(key, skin.id);
});

test('skinCandidates returns the whole fitting pool, in palette order', () => {
  // The debris pass deals its pool ROUND-ROBIN so a room gets rubble AND ash AND
  // shards rather than four of whatever the dice liked. That needs the pool, not
  // a pick — and it must go through the SAME filter, or the two entry points
  // drift and only one of them respects a room's claims.
  const pool = skinCandidates(CRYPT_SKIN, { intent: 'debris.small' });
  assert.deepEqual(pool.map((m) => m.id),
    ['rubble-chunk', 'ash-mound', 'stone-shards', 'iron-bars']);
});

test('...and applies the same refusals a single pick would', () => {
  // If this ever returns four models, the pool path has stopped filtering and
  // every claim rule in the game is one code path away from being bypassed.
  const filtered = skinCandidates(CRYPT_SKIN, { intent: 'debris.corner', claims: ['tended'] });
  assert.ok(!filtered.some((m) => m.id.startsWith('corner-mound')),
    'a tended room was offered a rubble mound through the pool path');
});

test('EXCLUDE IS THE CALLER\'S BUDGET, not the palette\'s business', () => {
  // "At most one large mound in a room" is a fact about this room, not about the
  // mound — it is no less suitable for having a twin elsewhere. Every roll must
  // avoid it once the caller says so.
  for (const roll of [0.0, 0.5, 0.95, 0.999]) {
    const m = resolveSkin(CRYPT_SKIN,
      { intent: 'debris.corner', exclude: ['corner-mound-large'] }, fixed(roll));
    assert.notEqual(m?.id, 'corner-mound-large');
  }
  // And without the exclusion it IS reachable, or the test above proves nothing.
  const pool = skinCandidates(CRYPT_SKIN, { intent: 'debris.corner' });
  assert.ok(pool.some((m) => m.id === 'corner-mound-large'));
});

test('A THEME CHANGE IS NOT A LEVEL CHANGE', () => {
  // The invariant the dressing RNG exists for, asserted end-to-end on the real
  // generator rather than argued for in a comment.
  //
  // The skin's rolls originally came out of the floor's own stream, so choosing
  // a cresset over a torch advanced it and every later decision moved with it —
  // measured across 240 floors as three sconces, one standing light and one glow
  // that drifted for reasons having nothing to do with fixtures. Invisible, and
  // it makes a palette edit read as a procgen regression.
  //
  // So: same seed, two completely different palettes. Every enemy stands where
  // it stood, every non-light prop is where it was, and only the light models
  // differ. If this test ever fails, the streams have been joined back together.
  const other: Skin = {
    id: 'test-parallel', name: 'Parallel',
    palette: {
      'light.wall': [{ model: stub('bone-lantern') }],
      // Same footprint as the crypt's brazier ON PURPOSE — a light that takes a
      // different amount of floor legitimately changes what fits beside it, and
      // that would be a real difference rather than the leak under test.
      'light.floor': [{ model: stub('skull-pyre'), needsFootprint: 0.45 }],
      'light.pool': [{ model: stub('pale-glow') }],
      'light.shaft': [{ model: stub('bone-shaft'), needsHeadroom: 3.6 }],
    },
  };
  const LIGHT = /^(floor-glow|god-ray|pale-glow|bone-shaft)/;
  const isLight = (id: string) => LIGHT.test(id)
    || ['iron-brazier', 'cresset-pike', 'skull-pyre'].includes(id);

  const layoutOf = (spec: ReturnType<typeof generatePolyFloor>) => ({
    spawns: (spec.spawns ?? []).map((s) => `${s.id}@${s.x.toFixed(3)},${s.z.toFixed(3)}`),
    torchPositions: (spec.torches ?? []).map((t) => `${t.x.toFixed(3)},${t.z.toFixed(3)}`),
    props: (spec.props ?? [])
      .map((p) => ({ id: (p as { model?: { id?: string } }).model?.id ?? (p as { kind: string }).kind, p }))
      .filter((e) => !isLight(e.id))
      .map((e) => `${e.id}@${e.p.x.toFixed(3)},${e.p.z.toFixed(3)}`),
  });

  for (const seed of [1, 7, 23]) {
    setActiveSkin('crypt');
    const a = layoutOf(generatePolyFloor(4, seed));
    setActiveSkin(other);
    const b = layoutOf(generatePolyFloor(4, seed));
    assert.deepEqual(b.spawns, a.spawns, `seed ${seed}: a palette moved an enemy`);
    assert.deepEqual(b.torchPositions, a.torchPositions, `seed ${seed}: a palette moved a bracket`);
    assert.deepEqual(b.props, a.props, `seed ${seed}: a palette moved a prop`);
  }
  setActiveSkin('crypt');
});

test('...and the theme change WAS actually applied', () => {
  // The control on the test above. Asserting "nothing moved" passes trivially if
  // the skin was never consulted, so this proves the second palette really is
  // what the floor got built from.
  const bone: Skin = {
    id: 'test-visible', name: 'Visible',
    palette: {
      'light.wall': [{ model: stub('bone-lantern') }],
      'light.floor': [{ model: stub('skull-pyre'), needsFootprint: 0.45 }],
      'light.pool': [{ model: stub('pale-glow') }],
      'light.shaft': [{ model: stub('bone-shaft'), needsHeadroom: 3.6 }],
    },
  };
  setActiveSkin(bone);
  const spec = generatePolyFloor(4, 7);
  const ids = new Set((spec.props ?? []).map((p) => (p as { model?: { id?: string } }).model?.id));
  setActiveSkin('crypt');
  const crypt = new Set((generatePolyFloor(4, 7).props ?? [])
    .map((p) => (p as { model?: { id?: string } }).model?.id));
  assert.ok([...ids].some((i) => i?.startsWith('pale-glow') || i === 'skull-pyre' || i === 'bone-shaft'),
    'no model from the test palette reached the floor — the skin is not being consulted');
  assert.ok([...crypt].some((i) => i?.startsWith('floor-glow') || i === 'iron-brazier'),
    'the crypt palette produced none of its own models either — the audit is measuring nothing');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
