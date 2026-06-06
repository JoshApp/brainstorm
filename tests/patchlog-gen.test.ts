// scripts/gen-patchlog.ts — trailer parser + commit-to-entry mapping.
//
// The contract: a commit appears in the patch log iff it carries a
// `Patch-summary` trailer. Tag + area are optional. Nothing else
// matters (no keyword inference, no subject cleanup, no housekeeping
// heuristics — those went away when Claude took over authoring the
// patch text directly).

import assert from 'node:assert/strict';
import {
  parseTrailers,
  entryForCommit,
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
Patch-summary: The widget hums quieter now.
Patch-area: ui, render`;
  assert.deepEqual(parseTrailers(body), {
    'patch-tag': 'tune',
    'patch-summary': 'The widget hums quieter now.',
    'patch-area': 'ui, render',
  });
});

test('parseTrailers: session URL alongside trailers is not itself a trailer', () => {
  const body = `Body.

Patch-tag: fix
https://claude.ai/code/session_abc`;
  assert.deepEqual(parseTrailers(body), { 'patch-tag': 'fix' });
});

test('parseTrailers: blank line between trailers and URL is transparent', () => {
  // The Claude Code commit convention writes the session URL on its
  // own line, often blank-separated from the Patch-* block above.
  // Both belong to the same footer region.
  const body = `Body.

Patch-tag: tech
Patch-summary: Trailer parser stomached the blank-separated URL.

https://claude.ai/code/session_xyz`;
  assert.deepEqual(parseTrailers(body), {
    'patch-tag': 'tech',
    'patch-summary': 'Trailer parser stomached the blank-separated URL.',
  });
});

test('parseTrailers: looks at the LAST footer block only', () => {
  // A mid-body line that LOOKS like a trailer should be ignored — only
  // the trailer block at the very end counts.
  const body = `Body line 1.
Patch-tag: tune (this looks like a trailer but isn't — it's mid-body)
Body line 3.

Patch-tag: fix`;
  assert.deepEqual(parseTrailers(body), { 'patch-tag': 'fix' });
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

test('entryForCommit: no Patch-summary → skipped', () => {
  // No matter how informative the subject is, without an authored
  // Patch-summary we have nothing player-facing to show.
  assert.equal(
    entryForCommit(commit({ subject: 'Fix the swing handler' })),
    null,
  );
  assert.equal(
    entryForCommit(commit({
      subject: 'Anything',
      trailers: { 'patch-tag': 'tune', 'patch-area': 'combat' },
    })),
    null,
  );
});

test('entryForCommit: Patch-summary is the displayed text verbatim', () => {
  const e = entryForCommit(commit({
    subject: 'Rework swing handler in attack.ts',
    trailers: {
      'patch-tag': 'tune',
      'patch-summary': 'Swings hit harder. The mob is not pleased.',
    },
  }));
  assert.equal(e?.text, 'Swings hit harder. The mob is not pleased.');
  assert.equal(e?.tag, 'tune');
});

test('entryForCommit: missing Patch-tag defaults to tune', () => {
  const e = entryForCommit(commit({
    subject: 'Anything',
    trailers: { 'patch-summary': 'Something changed. The dungeon noticed.' },
  }));
  assert.equal(e?.tag, 'tune');
});

test('entryForCommit: invalid Patch-tag falls back to default', () => {
  const e = entryForCommit(commit({
    subject: 'Anything',
    trailers: {
      'patch-tag': 'apocrypha',
      'patch-summary': 'Something changed. The dungeon noticed.',
    },
  }));
  assert.equal(e?.tag, 'tune');
});

test('entryForCommit: each valid Patch-tag passes through', () => {
  for (const tag of ['add', 'fix', 'tune', 'content', 'tech'] as const) {
    const e = entryForCommit(commit({
      subject: 'Anything',
      trailers: {
        'patch-tag': tag,
        'patch-summary': 'Something changed. The dungeon noticed.',
      },
    }));
    assert.equal(e?.tag, tag, `tag ${tag} should pass through`);
  }
});

test('entryForCommit: Patch-area splits + lowercases + dedupes', () => {
  const e = entryForCommit(commit({
    subject: 'Tune combat',
    trailers: {
      'patch-summary': 'The blade is hungrier than yesterday.',
      'patch-area': 'Combat, UI, combat ',
    },
  }));
  assert.deepEqual(e?.area, ['combat', 'ui']);
});

test('entryForCommit: missing Patch-area → entry has no area field', () => {
  const e = entryForCommit(commit({
    subject: 'Anything',
    trailers: { 'patch-summary': 'A thing happened. The dungeon kept score.' },
  }));
  assert.equal(e?.area, undefined);
});

test('entryForCommit: Patch-summary under 4 chars → skipped', () => {
  // A summary shorter than 4 chars is almost certainly noise. The
  // generator never displays it; this catches a typo'd trailer
  // ("Patch-summary: x") before it lands in the log.
  const e = entryForCommit(commit({
    subject: 'Anything',
    trailers: { 'patch-summary': 'no' },
  }));
  assert.equal(e, null);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
