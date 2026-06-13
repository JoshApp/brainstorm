// Elevation field invariants (src/level/elevation.ts).
//
// Guards the depth-7+ "corridor ends in mid-air" bug: a sloped corridor's
// seam with the room it connects must sit at exactly that room's floor
// elevation. The old field GUESSED endpoints by nearest-room probing,
// which picks the wrong room in dense layouts; the composer now stamps
// explicit rampLoElev/rampHiElev and the field must honour them.

import assert from 'node:assert/strict';
import { buildElevationField } from '../src/level/elevation';
import type { RoomSpec } from '../src/level/types';

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; } catch (err) {
    failed++;
    console.error(`✗ ${name}`);
    console.error(`  ${(err as Error).message}`);
  }
}
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

function room(id: string, x: number, z: number, w: number, d: number, elevation: number): RoomSpec {
  return { id, rect: { x, z, w, d }, height: 3, elevation };
}

// ── Explicit endpoints: seams match the connected rooms ─────────────────
test('sloped corridor seams sit at the connected rooms\' elevations', () => {
  // Room A at z=-5 (elev 0), Room B at z=+5 (elev -1.4), corridor between.
  const rooms = [room('a', 0, -5, 6, 6, 0), room('b', 0, 5, 6, 6, -1.4)];
  const corridor: RoomSpec = {
    id: 'c0', rect: { x: 0, z: 0, w: 2, d: 4 }, height: 2.6,
    rampLoElev: 0,      // low-Z end touches room A
    rampHiElev: -1.4,   // high-Z end touches room B
  };
  const field = buildElevationField(rooms, [corridor]);
  // At the corridor's low-Z apron the ground is room A's floor; at the
  // high-Z apron it is room B's floor.
  assert.ok(near(field.groundY(0, -1.9), 0), `low seam ${field.groundY(0, -1.9)} != 0`);
  assert.ok(near(field.groundY(0, 1.9), -1.4), `high seam ${field.groundY(0, 1.9)} != -1.4`);
  // Mid-corridor is partway down the linear grade (between the two).
  const mid = field.groundY(0, 0);
  assert.ok(mid < 0 && mid > -1.4, `mid ${mid} not between the endpoints`);
});

// ── Explicit endpoints are used VERBATIM, not re-derived ────────────────
// Set the stamped endpoints to values NO room in the floor holds. If the
// field were probing rooms it could never produce them; honouring the
// stamp is the only way the seams come out right. This is the guarantee
// that fixes the depth-7+ mid-air ramp regardless of which room a probe
// would have picked.
test('stamped endpoints are honoured verbatim (no probing)', () => {
  const rooms = [room('a', 0, -5, 6, 6, 0), room('b', 0, 5, 6, 6, 0)];
  const corridor: RoomSpec = {
    id: 'c0', rect: { x: 0, z: 0, w: 2, d: 4 }, height: 2.6,
    rampLoElev: -0.7, rampHiElev: -2.3,   // values no room has
  };
  const field = buildElevationField(rooms, [corridor]);
  assert.ok(near(field.groundY(0, -1.9), -0.7), `low seam ${field.groundY(0, -1.9)} != -0.7`);
  assert.ok(near(field.groundY(0, 1.9), -2.3), `high seam ${field.groundY(0, 1.9)} != -2.3`);
});

// ── Flat floor short-circuit still holds ────────────────────────────────
test('all-zero elevations report flat', () => {
  const rooms = [room('a', 0, -5, 6, 6, 0), room('b', 0, 5, 6, 6, 0)];
  const corridor: RoomSpec = { id: 'c0', rect: { x: 0, z: 0, w: 2, d: 4 }, height: 2.6, rampLoElev: 0, rampHiElev: 0 };
  const field = buildElevationField(rooms, [corridor]);
  assert.ok(field.flat, 'should be flat when nothing is elevated');
  assert.ok(near(field.groundY(0, 0), 0));
});

// ── X-running corridor (alongX) is handled too ──────────────────────────
test('corridor running along X ramps on X', () => {
  const rooms = [room('a', -5, 0, 6, 6, 0), room('b', 5, 0, 6, 6, -1.0)];
  const corridor: RoomSpec = {
    id: 'c0', rect: { x: 0, z: 0, w: 4, d: 2 }, height: 2.6,
    rampLoElev: 0, rampHiElev: -1.0,
  };
  const field = buildElevationField(rooms, [corridor]);
  assert.ok(near(field.groundY(-1.9, 0), 0), `low-X seam ${field.groundY(-1.9, 0)} != 0`);
  assert.ok(near(field.groundY(1.9, 0), -1.0), `high-X seam ${field.groundY(1.9, 0)} != -1.0`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
