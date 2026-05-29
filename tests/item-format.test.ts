// Pure item-formatting tests (src/ui/item-format.ts) — strings only, no DOM.

import assert from 'node:assert/strict';
import {
  signed, formatWeapon, formatModifier, formatBuffEffect, abbrev, hexCss,
} from '../src/ui/item-format';

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

test('signed prefixes + for non-negative, bare - for negative', () => {
  assert.equal(signed(3), '+3');
  assert.equal(signed(0), '+0');
  assert.equal(signed(-2), '-2');
});

test('formatWeapon renders damage / reach / arc', () => {
  const s = formatWeapon({ damage: 4, reach: 1.8, coneHalfAngle: Math.PI / 4 } as never);
  assert.match(s, /Base Damage 4/);
  assert.match(s, /Reach 1\.8m/);
  assert.match(s, /Arc 45°/);
});

test('formatModifier covers each stat kind', () => {
  assert.equal(formatModifier({ kind: 'weapon-damage', amount: 2 }), '+2 Damage');
  assert.equal(formatModifier({ kind: 'max-hp', amount: 1 }), '+1 Max HP');
  assert.equal(formatModifier({ kind: 'physical-armor', amount: -1 }), '-1 Physical Armor');
  assert.equal(formatModifier({ kind: 'damage-multiplier', amount: 1.5 }), '×1.50 Damage');
});

test('formatBuffEffect falls back gracefully for an unknown buff', () => {
  assert.equal(formatBuffEffect('does-not-exist', 8), 'does-not-exist for 8s');
});

test('abbrev strips leading article and clamps long names', () => {
  assert.equal(abbrev({ name: 'The Rusted Sword' } as never), 'Rusted Sword');
  const long = abbrev({ name: 'An Impossibly Long Relic Name Of Doom' } as never);
  assert.ok(long.length <= 22 && long.endsWith('…'));
});

test('hexCss converts a packed hex to rgb()', () => {
  assert.equal(hexCss(0xff7722), 'rgb(255, 119, 34)');
  assert.equal(hexCss(0x000000), 'rgb(0, 0, 0)');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
