// The pure gamepad reader (controls/gamepad-read.ts): deadzone, axis
// conventions, look curve, trigger threshold, button edges.
//
//   npm test -- gamepad-read

import assert from 'node:assert/strict';
import { readPad, radialDeadzone, type PadSnapshot } from '../src/controls/gamepad-read';
import { DEFAULT_PAD_BINDINGS, PAD } from '../src/controls/gamepad-bindings';

let passed = 0, failed = 0;
function test(name: string, fn: () => void): void {
  try { fn(); passed++; console.log(`✓ ${name}`); }
  catch (e) { failed++; console.log(`✗ ${name}\n  ${(e as Error).message}`); }
}

const T = { deadzone: 0.2, triggerThreshold: 0.35, lookCurve: 2 };
function pad(axes: number[] = [0, 0, 0, 0], down: number[] = [], values: Record<number, number> = {}): PadSnapshot {
  return {
    axes,
    buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: down.includes(i), value: values[i] ?? (down.includes(i) ? 1 : 0) })),
  };
}

test('a stick inside the deadzone reads centred', () => {
  const f = readPad(pad([0.1, 0.1, 0.15, 0]), [], DEFAULT_PAD_BINDINGS, T);
  assert.deepEqual([f.moveX, f.moveY, f.lookX, f.lookY], [0, 0, 0, 0]);
  assert.equal(f.active, false);
});

test('the deadzone edge maps to 0, full tilt to 1, with no jump', () => {
  const [x] = radialDeadzone(0.2001, 0, 0.2);
  assert.ok(x > 0 && x < 0.001);
  assert.equal(radialDeadzone(1, 0, 0.2)[0], 1);
});

test('stick up is forward, which is negative moveY (InputState convention)', () => {
  const f = readPad(pad([0, -1]), [], DEFAULT_PAD_BINDINGS, T);
  assert.equal(f.moveY, -1);
  assert.equal(f.active, true);
});

test('look follows the response curve: half tilt is a quarter rate', () => {
  const f = readPad(pad([0, 0, 0.6, 0]), [], DEFAULT_PAD_BINDINGS, T);
  const lin = (0.6 - 0.2) / 0.8;   // after deadzone rescale
  assert.ok(Math.abs(f.lookX - lin * lin) < 1e-9);
});

test('an analogue trigger counts as pressed past the threshold only', () => {
  assert.equal(readPad(pad([0, 0, 0, 0], [], { [PAD.RT]: 0.2 }), [], DEFAULT_PAD_BINDINGS, T).held.has('attack'), false);
  assert.equal(readPad(pad([0, 0, 0, 0], [], { [PAD.RT]: 0.6 }), [], DEFAULT_PAD_BINDINGS, T).held.has('attack'), true);
});

test('pressed and released are edges; held is the level', () => {
  const f1 = readPad(pad([0, 0, 0, 0], [PAD.A]), [], DEFAULT_PAD_BINDINGS, T);
  assert.ok(f1.pressed.has('interact') && f1.held.has('interact'));
  const f2 = readPad(pad([0, 0, 0, 0], [PAD.A]), f1.buttons, DEFAULT_PAD_BINDINGS, T);
  assert.ok(!f2.pressed.has('interact') && f2.held.has('interact'));
  const f3 = readPad(pad(), f2.buttons, DEFAULT_PAD_BINDINGS, T);
  assert.ok(f3.released.has('interact') && !f3.held.has('interact'));
});

test('every default binding is a distinct button', () => {
  const idx = Object.values(DEFAULT_PAD_BINDINGS);
  assert.equal(new Set(idx).size, idx.length);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
