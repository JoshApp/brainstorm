// The substrate PAYOFF hook (combat/death-payoffs.ts) — the contract the
// blood-drinker (and every future status machine) relies on: payoffs fire at
// death with the dying entity (buffs still live) + its position, can gate on a
// status, survive a throwing handler, and clear on reset.
//
//   npm test

import assert from 'node:assert/strict';
import { registerDeathPayoff, fireDeathPayoffs, resetDeathPayoffs } from '../src/combat/death-payoffs';
import type { Entity } from '../src/ecs/types';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

const bleeding = { buffs: [{ specId: 'bleed', remaining: 3, tickAccumulator: 0, stacks: 2 }] } as unknown as Entity;
const clean = { buffs: [] } as unknown as Entity;
const pos = { x: 1, y: 0, z: 2 } as unknown as import('three').Vector3;

test('a registered payoff fires with the dying entity + its position', () => {
  resetDeathPayoffs();
  let seen: { dying: Entity; x: number } | null = null;
  registerDeathPayoff((dying, p) => { seen = { dying, x: p.x }; });
  fireDeathPayoffs(bleeding, pos);
  assert.ok(seen, 'payoff did not fire');
  assert.equal(seen!.dying, bleeding, 'wrong dying entity');
  assert.equal(seen!.x, 1, 'position not threaded through');
});

test('a payoff can gate on the dying entity carrying a status (bleed)', () => {
  resetDeathPayoffs();
  let fired = 0;
  registerDeathPayoff((dying) => { if (dying.buffs.some((b) => b.specId === 'bleed')) fired++; });
  fireDeathPayoffs(clean, pos);     // no bleed → inert (this is why a non-bleed kill pays nothing)
  assert.equal(fired, 0, 'fired on a non-bleeding death');
  fireDeathPayoffs(bleeding, pos);  // bleed → fires
  assert.equal(fired, 1, 'did not fire on a bleeding death');
});

test('a throwing payoff is swallowed and does not block the others', () => {
  resetDeathPayoffs();
  let after = 0;
  registerDeathPayoff(() => { throw new Error('a bad relic must not break the death path'); });
  registerDeathPayoff(() => { after++; });
  fireDeathPayoffs(bleeding, pos);  // must not throw
  assert.equal(after, 1, 'a throwing payoff blocked a later one');
});

test('reset clears every payoff', () => {
  resetDeathPayoffs();
  let fired = 0;
  registerDeathPayoff(() => { fired++; });
  resetDeathPayoffs();
  fireDeathPayoffs(bleeding, pos);
  assert.equal(fired, 0, 'a payoff survived reset');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
