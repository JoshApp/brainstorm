// Blast falloff — the curve that decides whether an explosion is a decision or
// a coin flip. Pure function, no scene / audio context needed.
//
//   npm test -- radial-blast

import assert from 'node:assert/strict';
import { blastDamageScale } from '../src/combat/blast-falloff';
import { ENEMIES } from '../src/content/enemies';
import { CONFIG } from '../src/config';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}
const near = (a: number, b: number, msg = '') =>
  assert.ok(Math.abs(a - b) < 1e-9, `${msg} ${a} ≈ ${b}`);

test('full damage at the centre, rim fraction at the rim, nothing outside', () => {
  near(blastDamageScale(0, 2.6, 0.4), 1, 'centre');
  near(blastDamageScale(2.6, 2.6, 0.4), 0.4, 'rim');
  assert.equal(blastDamageScale(2.61, 2.6, 0.4), 0, 'past the rim is a clean miss');
  assert.equal(blastDamageScale(99, 2.6, 0.4), 0, 'far outside');
});

test('falloff is monotonic — stepping outward never costs you MORE', () => {
  let prev = Infinity;
  for (let d = 0; d <= 2.6; d += 0.1) {
    const s = blastDamageScale(d, 2.6, 0.4);
    assert.ok(s <= prev + 1e-9, `scale rose at d=${d}`);
    prev = s;
  }
});

test('rimDamageFrac 1 disables falloff (flat radius)', () => {
  for (const d of [0, 1, 2.5, 2.6]) near(blastDamageScale(d, 2.6, 1), 1, `d=${d}`);
});

test('a zero-radius blast never divides by zero', () => {
  assert.ok(Number.isFinite(blastDamageScale(0, 0, 0.4)));
  assert.equal(blastDamageScale(1, 0, 0.4), 0, 'nothing is inside a zero radius');
});

test('the bloat is survivable at the rim and lethal at the centre', () => {
  // The design claim this enemy rests on: a late scramble is punished but not
  // fatal, diving the middle is fatal. If someone retunes the numbers, this is
  // the sentence that should fail — not a playtest three weeks later.
  const spec = ENEMIES['bomb-ooze'];
  assert.ok(spec, 'bomb-ooze exists');
  const blast = spec.abilities?.[0]?.steps[0]?.action;
  assert.ok(blast && blast.kind === 'blast', 'its ability opens on a blast');
  if (!blast || blast.kind !== 'blast') return;

  const rim = blast.damage * blastDamageScale(blast.radius, blast.radius, blast.rimDamageFrac);
  const centre = blast.damage * blastDamageScale(0, blast.radius, blast.rimDamageFrac);
  assert.ok(rim < centre * 0.6, `a graze must be much cheaper than a direct hit (${rim} vs ${centre})`);
  assert.ok(rim >= 1, 'a graze must still cost something — otherwise the radius lies');

  // NEVER a one-shot from full. DESIGN-METHOD §"a cost denominated in another
  // system's units is a FRACTION, not a number" — this damage only means
  // anything relative to the health pool, and the first tuning pass shipped a 4
  // against a 5 HP player, which deleted a healthy player in one beat. A
  // fully-telegraphed attack may be the hardest hit in the game; it may not be
  // an instant loss. If PLAYER_HP_MAX ever drops, this fails instead of the player.
  assert.ok(centre < CONFIG.PLAYER_HP_MAX,
    `centre damage ${centre} must not one-shot a full ${CONFIG.PLAYER_HP_MAX} HP player`);

  // It hurts its neighbours at least as hard as it hurts you. That asymmetry is
  // the entire tactic (kite it into a pack); losing it makes the enemy pointless.
  assert.ok((blast.mobDamage ?? blast.damage) >= blast.damage,
    'the blast must be at least as dangerous to mobs as to the player');
  assert.equal(blast.selfDestruct, true, 'the bomb dies delivering the payload');
});

test('the bloat arms INSIDE its own blast radius — the ring is never a lie', () => {
  // Arming range must sit within the radius, or a player standing exactly at
  // the trigger distance would be outside the circle it just painted.
  const spec = ENEMIES['bomb-ooze'];
  const ability = spec?.abilities?.[0];
  const blast = ability?.steps[0]?.action;
  if (!ability || !blast || blast.kind !== 'blast') { assert.fail('bomb-ooze blast missing'); return; }
  assert.ok(ability.maxRange <= blast.radius,
    `arming range ${ability.maxRange} must be within the blast radius ${blast.radius}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
