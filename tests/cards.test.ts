// The Cards — guards the tarot grammar: the content deck and the art deck agree,
// every card's effect uses only the real StatModifier vocabulary (so a card is
// genuinely just another source for the one modifier pipeline), and the
// cardModifiers() resolver folds held cards correctly.
//
//   npm test
//
// Imports content/cards (pure data + a pure resolver; StatModifier is a
// type-only import, so nothing heavy is pulled) and art/cards (plain specs).

import assert from 'node:assert/strict';
import { CARDS, cardModifiers, type CardSpec } from '../src/content/cards';
import { CARD_ART } from '../src/art/cards';

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}`); console.error(`  ${(err as Error).message}`); }
}

// The real StatModifier kinds (mirrors src/combat/modifiers.ts). A card may
// only emit these — that's what proves cards share the item vocabulary.
const VALID_KINDS = new Set([
  'max-hp', 'weapon-damage', 'damage-multiplier', 'finisher-damage-mult',
  'physical-armor', 'magic-armor', 'incoming-damage-mult', 'move-speed-mult',
  'action-speed-mult', 'crit-chance', 'crit-mult', 'lifesteal-pct',
]);
const ARCANA = new Set(['minor', 'major']);

const cards = Object.values(CARDS);

// ── content deck ⇄ art deck agree ────────────────────────────────────────────
test('every art card has a game card and vice versa', () => {
  const artIds = new Set(CARD_ART.map((c) => c.id));
  const gameIds = new Set(cards.map((c) => c.id));
  for (const id of artIds) assert.ok(gameIds.has(id), `art card '${id}' has no game card in content/cards.ts`);
  for (const id of gameIds) assert.ok(artIds.has(id), `game card '${id}' has no art spec in art/cards.ts`);
});

test('name + arcana + domain agree across the two decks', () => {
  for (const art of CARD_ART) {
    const game = CARDS[art.id];
    if (!game) continue;
    assert.equal(game.name, art.name, `${art.id}: name mismatch`);
    assert.equal(game.arcana, art.arcana, `${art.id}: arcana mismatch`);
    assert.ok(game.domains.includes(art.domain), `${art.id}: art domain '${art.domain}' not in game domains [${game.domains}]`);
  }
});

// ── grammar validity ──────────────────────────────────────────────────────────
test('every card has a valid arcana and id == key', () => {
  for (const [key, c] of Object.entries(CARDS)) {
    assert.equal(c.id, key, `card key '${key}' != id '${c.id}'`);
    assert.ok(ARCANA.has(c.arcana), `${c.id}: bad arcana '${c.arcana}'`);
    assert.ok(typeof c.fate === 'string' && c.fate.length > 0, `${c.id}: missing fate line`);
    assert.ok(Array.isArray(c.domains), `${c.id}: domains must be an array`);
  }
});

test('every effect uses only the real StatModifier vocabulary', () => {
  const checkMods = (c: CardSpec, mods?: { kind: string }[]) => {
    for (const m of mods ?? []) assert.ok(VALID_KINDS.has(m.kind), `${c.id}: unknown modifier kind '${m.kind}'`);
  };
  for (const c of cards) {
    checkMods(c, c.effect.modifiers);
    for (const cm of c.effect.conditional ?? []) checkMods(c, cm.modifiers);
    for (const t of c.effect.triggers ?? []) {
      assert.ok(['hit', 'kill', 'crit'].includes(t.on), `${c.id}: bad trigger event '${t.on}'`);
      assert.ok(t.chance >= 0 && t.chance <= 1, `${c.id}: trigger chance out of range`);
    }
  }
});

// ── resolver ──────────────────────────────────────────────────────────────────
test('cardModifiers folds held cards and skips unknown ids', () => {
  assert.deepEqual(cardModifiers([]), [], 'empty hand → no modifiers');
  assert.deepEqual(cardModifiers(['does-not-exist']), [], 'unknown id contributes nothing');

  const held = ['the-hearth', 'the-companion']; // armor +2, max-hp +10
  const mods = cardModifiers(held);
  const sum = (kind: string) => mods.filter((m) => m.kind === kind).reduce((a, m) => a + m.amount, 0);
  assert.equal(sum('physical-armor'), 2, 'hearth armor');
  assert.equal(sum('max-hp'), 10, 'companion hp');
  assert.equal(mods.length, 2, 'only the two cards contributed');
});

test('a card duplicated in hand stacks (resolver does not dedupe)', () => {
  const mods = cardModifiers(['the-companion', 'the-companion']);
  const hp = mods.filter((m) => m.kind === 'max-hp').reduce((a, m) => a + m.amount, 0);
  assert.equal(hp, 20, 'two Companions stack to +20 (the Spread, not the resolver, enforces the cap)');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
