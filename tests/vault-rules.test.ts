// WHAT MAY A VAULT CLEAR? Height for solids, opt-in for holes.
//
// Two rules were changed here at once and each of them existed because of a
// report from the phone, so both are pinned against the REAL WalkableRegion
// rather than a re-implementation of its arithmetic:
//
//   1. HEIGHT ALONE decides a solid. It used to be `dashable && low`, and
//      exactly one thing in the entire game ever set `dashable`. Every vase,
//      plinth and low offering was a wall to the vault for no authored reason —
//      just an untagged flag. Josh: "I want to be able to jump through a cluster
//      of vases ... it can calculate that the objects would be jumpable on
//      their own."
//
//   2. A GAP IS OPT-IN. A rift has no height to be under (it is a full-height
//      blocker on purpose, so no walk wanders into the abyss), so it carries
//      `leapable` instead — and only a caller passing `allowGaps` may cross it.
//      That flag is what separates "I chose to roll across this" from "I brushed
//      a chasm lip while exploring and got launched over it."
//
//   npm test -- vault-rules

import assert from 'node:assert/strict';
import { WalkableRegion, type Obstacle } from '../src/level/walkable';
import { CONFIG } from '../src/config';
import type { WalkableRect } from '../src/level/types';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

const ROOM: WalkableRect = { x: 0, z: 0, w: 20, d: 20 };
const R = 0.3;

/** A vase, exactly as level/builder.ts registers one — untagged, 0.6m tall. */
const vase = (x: number, z: number): Obstacle => ({ kind: 'circle', x, z, r: 0.18, yTop: 0.6 });
/** A pillar / doorframe jamb — full height, and no rule may ever clear it. */
const pillar = (x: number, z: number): Obstacle => ({ kind: 'circle', x, z, r: 0.4, yTop: Infinity });

test('FIXTURE: the numbers the cases below depend on', () => {
  assert.ok(0.6 <= CONFIG.VAULT.MAX_CLEAR_HEIGHT_M,
    'a vase is no longer under the vault ceiling — the cluster cases test nothing');
  assert.ok(CONFIG.VAULT.MAX_GAP_M >= 1.3 && CONFIG.VAULT.MAX_GAP_M < 2.4,
    'MAX_GAP_M must take the narrow rift and refuse the widest (room-voids.ts: 1.3/1.8/2.4)');
});

test('AN UNTAGGED VASE IS VAULTABLE — height decides, not a flag', () => {
  const region = new WalkableRegion([ROOM], [vase(0, 0)]);
  assert.equal(region.contains(0, 0, R), false, 'it must still BLOCK a walk');
  assert.equal(region.canDashOver(0, -1.2, 0, 1.2, R), true,
    'the vault refused a knee-high pot — that is the untagged-flag bug');
});

test('A CLUSTER OF THEM IS ONE VAULT, not a wall', () => {
  // Three vases across the line of travel, the spacing spawnVaseCluster makes.
  const region = new WalkableRegion([ROOM], [vase(0, -0.35), vase(0.1, 0), vase(-0.05, 0.35)]);
  assert.equal(region.canDashOver(0, -1.5, 0, 1.5, R), true,
    'a pile of pots stopped the vault — the whole point of the cluster case');
});

test('A PILLAR IS STILL A PILLAR', () => {
  const region = new WalkableRegion([ROOM], [pillar(0, 0)]);
  assert.equal(region.canDashOver(0, -1.5, 0, 1.5, R), false,
    'height stopped being the rule — you can vault through architecture again');
});

test('ONE PILLAR IN THE CLUSTER REFUSES THE WHOLE CARRY', () => {
  const region = new WalkableRegion([ROOM], [vase(0, -0.4), pillar(0, 0), vase(0, 0.4)]);
  assert.equal(region.canDashOver(0, -1.5, 0, 1.5, R), false);
});

test('THE LANDING MUST STILL BE CLEAR', () => {
  // Vault the near vase and come down on the far one — refused, or the rescue
  // has to dig you out of a pot every time.
  const region = new WalkableRegion([ROOM], [vase(0, 0), vase(0, 1.2)]);
  assert.equal(region.canDashOver(0, -1.2, 0, 1.2, R), false,
    'the vault landed inside the second vase');
});

// ── GAPS ────────────────────────────────────────────────────────────────

/** A rift across the room, `across` metres wide, as the builder registers it. */
const rift = (across: number, leapable: boolean): Obstacle => ({
  kind: 'aabb', minX: -5, maxX: 5, minZ: -across / 2, maxZ: across / 2,
  yTop: Infinity, leapable,
});

test('A NARROW RIFT IS CROSSABLE — but only when the caller asks', () => {
  const region = new WalkableRegion([ROOM], [rift(1.3, true)]);
  assert.equal(region.canDashOver(0, -1.4, 0, 1.4, R, { allowGaps: true }), true,
    'the dodge could not cross a one-wide rift');
  assert.equal(region.canDashOver(0, -1.4, 0, 1.4, R), false,
    'the WALK-vault crossed a hole in the floor — nobody chose that jump');
});

test('A WIDE RIFT IS ARCHITECTURE — no flag, no crossing, for anyone', () => {
  // The builder never marks the 2.4m rift leapable; even asking doesn't help.
  const region = new WalkableRegion([ROOM], [rift(2.4, false)]);
  assert.equal(region.canDashOver(0, -1.9, 0, 1.9, R, { allowGaps: true }), false);
  assert.equal(region.canDashOver(0, -1.9, 0, 1.9, R), false);
});

test('A GAP IS NEVER WALKABLE, whatever it lets a roll do', () => {
  const region = new WalkableRegion([ROOM], [rift(1.3, true)]);
  assert.equal(region.contains(0, 0, R), false,
    'the player can stand in the abyss — leapable leaked into ordinary collision');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
