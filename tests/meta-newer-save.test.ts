// An OLDER build must never overwrite a meta save written by a NEWER one.
//
// meta-state used to reset to an empty meta on seeing a newer version, and the
// next persist() wrote that empty meta over the player's real one — so a PWA
// serving its cached old bundle after an update, or a rolled-back deploy, wiped
// every record and the stash. This pins the fix: read what we understand, keep
// the disk copy byte-for-byte, and let an explicit clearMeta() still clear.
//
//   npm test -- meta-newer

import assert from 'node:assert/strict';

// A minimal localStorage, installed BEFORE meta-state loads (its cache is
// module-level, so the first read decides everything).
const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
};

const NEWER = JSON.stringify({
  version: 999,
  runsAttempted: 40, runsDied: 39, deepestDepth: 11, totalKills: 512,
  totalPlayMs: 1, enemiesSlain: ['rat'], itemsFound: [], notesRead: [],
  achievementsUnlocked: ['first-blood'], stash: [{ id: 's1', tier: 'rare', source: 'x' }],
  someFieldFromTheFuture: { kept: true },
});
store.set('delve:meta', NEWER);

const meta = await import('../src/state/meta-state');

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
}

test('a newer save is still shown: the stats this build understands are read', () => {
  assert.equal(meta.getMeta().deepestDepth, 11);
  assert.equal(meta.getMeta().totalKills, 512);
});

test('recording progress does not write over the newer save', () => {
  meta.recordRunStart();
  meta.recordKill('ghoul');
  meta.recordDepthReached(12);
  meta.setPlayerName('Nobody');
  meta.getPlayerId();
  assert.equal(store.get('delve:meta'), NEWER);
});

test('an explicit clearMeta still clears', () => {
  meta.clearMeta();
  const after = JSON.parse(store.get('delve:meta') ?? 'null');
  assert.equal(after.runsAttempted, 0);
  assert.equal(after.deepestDepth, 0);
});

console.log(`meta-newer-save: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
