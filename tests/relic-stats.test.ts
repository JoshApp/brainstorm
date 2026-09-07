import assert from 'node:assert/strict';
import { aggregateModifiers, computePlayerStats, stackedRelicModifiers } from '../src/combat/modifiers';
import { addRelic, clearReliquary, onReliquaryChanged } from '../src/player/reliquary';
import { spawn, get, destroy } from '../src/ecs/world';
import type { ItemSpec } from '../src/content/items';

const relic = {
  id: 'stack-cache-test',
  modifiers: [
    { kind: 'weapon-damage', amount: 2 },
    { kind: 'damage-multiplier', amount: 1.15 },
    { kind: 'crit-chance', amount: 0.1, stack: 'hyperbolic' },
  ],
  conditionalModifiers: [{ condition: { kind: 'below-hp-pct', value: 0.5 },
    modifiers: [{ kind: 'weapon-damage', amount: 3 }] }],
} as ItemSpec;
spawn({ id: 'player', kind: 'player', hp: { base: 10, current: 10 }, buffs: [], passives: [] });
clearReliquary();
const baseline = computePlayerStats();
const observed: number[] = [];
const unsubscribe = onReliquaryChanged(() => observed.push(computePlayerStats().weaponDamageBonus));
addRelic(relic);
addRelic(relic);
assert.deepEqual(observed, [baseline.weaponDamageBonus + 2, baseline.weaponDamageBonus + 4],
  'pickup listeners must see newly stacked values immediately');
const expected = stackedRelicModifiers(relic.modifiers, 2);
assert.deepEqual(aggregateModifiers('player').slice(0, expected.length), expected, 'stack order and curves unchanged');
const high = computePlayerStats();
assert.equal(high.damageMultiplier, baseline.damageMultiplier * 1.15 * 1.15);
assert.ok(Math.abs(high.critChanceBonus - baseline.critChanceBonus - (1 - 0.9 ** 2)) < 1e-12);

get('player')!.hp!.current = 4;
assert.equal(computePlayerStats().weaponDamageBonus, baseline.weaponDamageBonus + 10,
  'losing HP activates conditional modifiers without a pickup');
get('player')!.hp!.current = 5;
assert.equal(computePlayerStats().weaponDamageBonus, baseline.weaponDamageBonus + 4,
  'healing to the exact threshold removes the below-HP bonus');

clearReliquary();
assert.equal(observed.at(-1), baseline.weaponDamageBonus, 'clear listeners see no stale relics');
// Clear + re-add before the next stat read, with the SAME count and id, must
// still rebuild. This rules out length-only or ID-only cache keys.
unsubscribe();
addRelic(relic);
computePlayerStats();
clearReliquary();
addRelic({ ...relic, modifiers: [{ kind: 'weapon-damage', amount: 7 }] });
assert.equal(computePlayerStats().weaponDamageBonus, baseline.weaponDamageBonus + 7);
assert.deepEqual(aggregateModifiers('unrelated-enemy'), [], 'player cache must not affect enemies');
clearReliquary();
destroy('player');
console.log('relic stat cache: stacking, live HP, pickup callbacks, clear/reload and entity isolation passed');
