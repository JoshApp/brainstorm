// scripts/gen-patchlog.ts — trailer parser + commit-to-entry mapping.
//
// The generator runs unattended on every build, so a regression that
// silently drops entries or mis-parses trailers would land on the
// next deploy with no warning. These tests pin the contract.

import assert from 'node:assert/strict';
import {
  parseTrailers,
  entryForCommit,
  inferTag,
  cleanSubject,
  isHousekeeping,
  type ParsedCommit,
} from '../scripts/gen-patchlog';

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

// ── parseTrailers ───────────────────────────────────────────────────

test('parseTrailers: empty body → no trailers', () => {
  assert.deepEqual(parseTrailers(''), {});
});

test('parseTrailers: standard trailer block at the end', () => {
  const body = `Refactor the widget.

Long explanation.

Patch-tag: tune
Patch-summary: Widget is faster.
Patch-area: ui, render`;
  assert.deepEqual(parseTrailers(body), {
    'patch-tag': 'tune',
    'patch-summary': 'Widget is faster.',
    'patch-area': 'ui, render',
  });
});

test('parseTrailers: session URL alongside trailers is not itself a trailer', () => {
  const body = `Body.

Patch-tag: fix
https://claude.ai/code/session_abc`;
  // The URL is tolerated (sits in the trailer block) but doesn't
  // become a trailer with key "https".
  assert.deepEqual(parseTrailers(body), { 'patch-tag': 'fix' });
});

test('parseTrailers: looks at the LAST block only', () => {
  // A mid-body "Patch-tag: tune" should be ignored; only the trailer
  // block at the very end counts. The mid-body line has prose after
  // it (the next two lines), so the block-finder walks past it.
  const body = `Body line 1.
Patch-tag: tune (this looks like a trailer but isn't — it's mid-body)
Body line 3.

Patch-tag: fix`;
  assert.deepEqual(parseTrailers(body), { 'patch-tag': 'fix' });
});

test('parseTrailers: no trailers, prose only', () => {
  const body = `Plain commit body without any structured trailers.

Just prose.`;
  assert.deepEqual(parseTrailers(body), {});
});

test('parseTrailers: case-insensitive keys', () => {
  const body = `Body.

PATCH-TAG: tune
patch-area: combat`;
  assert.deepEqual(parseTrailers(body), {
    'patch-tag': 'tune',
    'patch-area': 'combat',
  });
});

// ── entryForCommit ──────────────────────────────────────────────────

function commit(opts: { subject: string; trailers?: Record<string, string> }): ParsedCommit {
  return {
    date: '2026-06-06',
    subject: opts.subject,
    body: '',
    trailers: opts.trailers ?? {},
  };
}

test('entryForCommit: explicit Patch-tag wins over inference', () => {
  const e = entryForCommit(commit({
    subject: 'Add a new ooze enemy',
    trailers: { 'patch-tag': 'tech' },
  }));
  // "ooze" would infer 'content'; the explicit trailer overrides.
  assert.equal(e?.tag, 'tech');
});

test('entryForCommit: invalid Patch-tag falls back to inference', () => {
  const e = entryForCommit(commit({
    subject: 'Fix the swing handler',
    trailers: { 'patch-tag': 'nonsense' },
  }));
  assert.equal(e?.tag, 'fix');
});

test('entryForCommit: Patch-summary overrides the subject', () => {
  const e = entryForCommit(commit({
    subject: 'Rework swing handler in attack.ts',
    trailers: { 'patch-summary': 'Swings feel snappier.' },
  }));
  assert.equal(e?.text, 'Swings feel snappier.');
});

test('entryForCommit: Patch-area splits + lowercases + dedupes', () => {
  const e = entryForCommit(commit({
    subject: 'Tune combat',
    trailers: { 'patch-area': 'Combat, UI, combat ' },
  }));
  assert.deepEqual(e?.area, ['combat', 'ui']);
});

test('entryForCommit: Patch-skip true drops the entry', () => {
  const e = entryForCommit(commit({
    subject: 'Anything',
    trailers: { 'patch-skip': 'true' },
  }));
  assert.equal(e, null);
});

test('entryForCommit: Patch-audience dev drops the entry from the player log', () => {
  const e = entryForCommit(commit({
    subject: 'Internal dev tooling improvement',
    trailers: { 'patch-audience': 'dev' },
  }));
  assert.equal(e, null);
});

test('entryForCommit: no trailers → infer + clean subject', () => {
  const e = entryForCommit(commit({
    subject: 'Fix the swing handler',
  }));
  assert.equal(e?.tag, 'fix');
  assert.equal(e?.text, 'Fix the swing handler');
});

test('entryForCommit: no trailers + housekeeping subject → null', () => {
  const e = entryForCommit(commit({
    subject: 'chore: bump deps',
  }));
  assert.equal(e, null);
});

test('entryForCommit: trailers BYPASS the housekeeping skip', () => {
  // If a commit explicitly declares trailers, we trust the author —
  // a subject the legacy housekeeping regex would skip can still
  // become an entry if Patch-tag/summary are set.
  const e = entryForCommit(commit({
    subject: 'chore: bump three.js',
    trailers: { 'patch-tag': 'tech', 'patch-summary': 'Three.js upgrade.' },
  }));
  assert.equal(e?.tag, 'tech');
  assert.equal(e?.text, 'Three.js upgrade.');
});

// ── inferTag / cleanSubject / isHousekeeping (regression coverage) ──

test('inferTag: fix wins over content keywords', () => {
  assert.equal(inferTag('Fix the ooze targeting bug'), 'fix');
});

test('inferTag: content keywords pick content', () => {
  assert.equal(inferTag('Add new brazier variants'), 'content');
});

test('inferTag: tech keywords pick tech', () => {
  assert.equal(inferTag('Refactor the projectile pool'), 'tech');
});

test('cleanSubject: strips trailing technical colon clauses', () => {
  assert.equal(
    cleanSubject('Tune projectiles: PROJECTILE_POOL_SIZE 64→128'),
    'Tune projectiles',
  );
});

test('cleanSubject: keeps natural colon clauses', () => {
  // No ALL_CAPS / no path → keep the full subject.
  const s = 'Combat: heavy combos for the rest of the weapons';
  assert.equal(cleanSubject(s), s);
});

test('isHousekeeping: skips ci/chore/build prefixes', () => {
  assert.equal(isHousekeeping('chore: prune unused'), true);
  assert.equal(isHousekeeping('ci: bump action'), true);
  assert.equal(isHousekeeping('Tune projectiles'), false);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
