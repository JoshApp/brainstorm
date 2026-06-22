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
import {
  CARDS, cardModifiers, cardSynergyModifiers, cardConditionalBundles,
  cardTriggerPassives, cardOnHitVictim, dealCards, type CardSpec,
} from '../src/content/cards';
import { CARD_ART } from '../src/art/cards';
import { BUFFS } from '../src/content/buffs';

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
    for (const s of c.effect.synergy ?? []) {
      checkMods(c, s.modifiers);
      assert.ok(['domain', 'major', 'minor', 'card'].includes(s.per), `${c.id}: bad synergy per '${s.per}'`);
      if (s.per === 'domain') assert.ok(s.domain, `${c.id}: domain synergy missing domain`);
    }
    for (const t of c.effect.triggers ?? []) {
      assert.ok(['hit', 'kill', 'crit'].includes(t.on), `${c.id}: bad trigger event '${t.on}'`);
      assert.ok(t.chance >= 0 && t.chance <= 1, `${c.id}: trigger chance out of range`);
      // Every proc references a REAL buff — else the proc fires into the void.
      assert.ok(BUFFS[t.buffId], `${c.id}: trigger references unknown buff '${t.buffId}'`);
    }
  }
});

// ── RESONANCE (synergy) ───────────────────────────────────────────────────────
test('synergy scales by count of held kin (per card)', () => {
  // The Tally: +1 weapon-damage per fate held (counting itself), cap 12.
  const sum = (held: string[]) =>
    cardSynergyModifiers(held).filter((m) => m.kind === 'weapon-damage').reduce((a, m) => a + m.amount, 0);
  assert.equal(sum(['the-tally']), 1, 'alone, counts itself → +1');
  assert.equal(sum(['the-tally', 'the-companion', 'the-maw']), 3, 'three fates held → +3');
});

test('domain synergy counts only that domain', () => {
  // The Star: +0.04 crit-chance per DAWN card held (cap 6). The Dawn is dawn.
  const crit = (held: string[]) =>
    cardSynergyModifiers(held).filter((m) => m.kind === 'crit-chance').reduce((a, m) => a + m.amount, 0);
  assert.ok(Math.abs(crit(['the-star']) - 0.04) < 1e-9, 'star alone (dawn) → 0.04');
  assert.ok(Math.abs(crit(['the-star', 'the-dawn']) - 0.08) < 1e-9, 'star + dawn → 0.08');
  assert.ok(Math.abs(crit(['the-star', 'the-maw']) - 0.04) < 1e-9, 'a greed card does not count for dawn');
});

test('synergy respects the max cap', () => {
  // The Tally caps at +12 even holding the entire (distinct) deck. Held cards
  // are distinct in real play (grantCard dedupes), so the hand is every card id.
  const held = Object.keys(CARDS);   // includes the-tally exactly once
  assert.ok(held.length > 12, 'deck is bigger than the cap, so the cap is exercised');
  const dmg = cardSynergyModifiers(held).filter((m) => m.kind === 'weapon-damage').reduce((a, m) => a + m.amount, 0);
  assert.equal(dmg, 12, 'capped at exactly 12');
});

// ── BRINK (conditional) ───────────────────────────────────────────────────────
test('conditional bundles surface held cards’ HP-gated mods', () => {
  const bundles = cardConditionalBundles(['the-martyr']);
  assert.equal(bundles.length, 1, 'martyr has one conditional bundle');
  assert.equal(bundles[0].condition.kind, 'below-hp-pct');
  assert.ok(bundles[0].modifiers.some((m) => m.kind === 'damage-multiplier'));
  assert.deepEqual(cardConditionalBundles(['the-hound']), [], 'a plain card has none');
});

// ── PROC (triggers) ───────────────────────────────────────────────────────────
test('on-kill/on-crit procs become self passives; on-hit does NOT', () => {
  const feast = cardTriggerPassives(['the-feast']);   // on kill → berserk, self
  assert.equal(feast.length, 1);
  assert.equal(feast[0].trigger.on, 'killed', 'kill maps to engine event "killed"');
  assert.equal(feast[0].trigger.effects[0].buffId, 'berserk');
  assert.equal(feast[0].trigger.effects[0].target, 'self');
  // The Pyre is on-hit (victim) — it must NOT come through the passive path.
  assert.deepEqual(cardTriggerPassives(['the-pyre']), [], 'on-hit hex is not a self passive');
});

test('on-hit hexes surface through the victim on-hit channel', () => {
  const pyre = cardOnHitVictim(['the-pyre']);
  assert.equal(pyre.length, 1);
  assert.equal(pyre[0].buffId, 'bleed');
  assert.ok(pyre[0].chance > 0 && pyre[0].chance <= 1);
  assert.deepEqual(cardOnHitVictim(['the-feast']), [], 'on-kill fury is not an on-hit hex');
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

// ── dealCards (the fate hand) ─────────────────────────────────────────────────
test('dealCards deals distinct cards of the requested arcana', () => {
  const hand = dealCards(3, { arcana: 'minor' });
  assert.equal(hand.length, 3, 'dealt three');
  assert.equal(new Set(hand).size, 3, 'all distinct within a deal');
  for (const id of hand) assert.equal(CARDS[id].arcana, 'minor', `${id} should be a minor`);
});

test('dealCards never exceeds the pool size', () => {
  const minors = Object.values(CARDS).filter((c) => c.arcana === 'minor').length;
  const hand = dealCards(999, { arcana: 'minor' });
  assert.equal(hand.length, minors, 'capped at the number of minors that exist');
});

test('dealCards is deterministic given an rng', () => {
  const rng = () => 0.42;  // constant rng → stable order
  assert.deepEqual(dealCards(3, { arcana: 'minor', rng }), dealCards(3, { arcana: 'minor', rng }));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
