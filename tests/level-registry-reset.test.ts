// THE RUN-START RESET MUST NOT EAT AUTHORED LEVELS.
//
// resetGeneratedLevels() exists to stop run N+1 replaying run N's cached
// procgen floors. It used to decide what was "generated" by snapshotting the
// registry keys at initLevelLoader time and deleting everything else — which
// silently means "anything registered late is disposable".
//
// Every PER-RUN authored level is registered late by construction. The starter
// chamber rolls three weapons and picks its stair target per run, so main.ts
// writes LEVELS['starter'] on each descend, and startRun() calls this reset
// BEFORE loading it. The chamber was deleted, the loader fell through to the
// procgen fallback, and the first room of every run was a generated depth-0
// floor instead of the weapon-select chamber (reported 2026-08-13:
// "puts me right into depth 0 which isn't the weapon select chamber").
//
// So the property under test is NOT "the snapshot is correct" — it's that
// registration ORDER doesn't decide survival. Only specs the loader itself
// cached from generate() may be dropped.
//
//   npm test -- level-registry-reset

import assert from 'node:assert/strict';
import { markGenerated, dropGeneratedLevels, resetGeneratedTracking } from '../src/level/generated-registry';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

/** A registry stands in for LEVELS — the reset is pure bookkeeping over it, so
 *  the values never need to be real specs. */
function registry(...ids: string[]): Record<string, object> {
  resetGeneratedTracking();
  return Object.fromEntries(ids.map((id) => [id, { id }]));
}

test('AN AUTHORED LEVEL REGISTERED LATE SURVIVES THE RESET', () => {
  const levels = registry('tutorial');
  // main.ts does exactly this on every descend, long after boot.
  levels['starter'] = { id: 'starter' };

  dropGeneratedLevels(levels);

  assert.ok(levels['starter'], 'the starter chamber was deleted at run start — '
    + 'the player lands on a generated floor instead of the weapon-select chamber');
  assert.ok(levels['tutorial'], 'a boot-time authored level was deleted');
});

test('GENERATED FLOORS ARE STILL DROPPED (the reason the reset exists)', () => {
  const levels = registry('tutorial');
  levels['depth-1'] = { id: 'depth-1' };
  markGenerated('depth-1');
  levels['starter'] = { id: 'starter' };

  dropGeneratedLevels(levels);

  assert.equal(levels['depth-1'], undefined,
    "run 2 would replay run 1's depth-1 despite a fresh seed");
  assert.deepEqual(Object.keys(levels).sort(), ['starter', 'tutorial']);
});

test('THE RESET IS IDEMPOTENT, AND FORGETS WHAT IT DROPPED', () => {
  const levels = registry('tutorial');
  levels['depth-1'] = { id: 'depth-1' };
  markGenerated('depth-1');
  dropGeneratedLevels(levels);
  // A fresh run re-registers the same id as AUTHORED; the stale marking from
  // the previous run must not carry over and delete it.
  levels['depth-1'] = { id: 'depth-1' };
  dropGeneratedLevels(levels);
  assert.deepEqual(Object.keys(levels).sort(), ['depth-1', 'tutorial']);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
