// SCARS — the ceiling, asserted rather than hoped for.
//
// docs/WEAPON-EVOLUTION.md §0 writes the constraint before the content:
//   - no scar may raise a weapon's DPS by more than +35%
//   - nor may all three lanes together
//   - one scar per class, ever
//   - a FORM scar must change how the weapon SWINGS, not what it hits for
//   - a DEBT scar must be worth its cost
//   - no scar may be inert
//
// This file is that paragraph as code. It measures through the REAL functions —
// resolveWeaponStats, applyScars, composeStrikeDamage — because an audit that
// re-inlines the arithmetic reports a model of the game rather than the game,
// and that is how an eleven-damage dagger lived for months under a MAX column
// (DESIGN-METHOD §2).
//
// If a scar you authored fails here, the scar is wrong.
//
//   npm test

import assert from 'node:assert/strict';
import {
  SCARS, applyScars, scarDpsFactor, scarSetDpsFactor, scarModifiers,
  SCAR_DPS_CEILING, SCAR_TOTAL_DPS_CEILING, DEBT_DPS_FLOOR, type ScarClass,
} from '../src/content/scars';
import { resolveWeaponStats } from '../src/content/weapon-classes';
import { ITEMS } from '../src/content/items';
import {
  getScars, canTakeScar, applyScar, clearScars, offerableScars,
  serializeScars, hydrateScars, MAX_SCARS_PER_WEAPON,
} from '../src/state/weapon-scars';

let passed = 0, failed = 0;
function test(name: string, fn: () => void) {
  clearScars();
  try { fn(); passed++; }
  catch (err) { failed++; console.error(`✗ ${name}\n  ${(err as Error).message}`); }
  clearScars();
}

/** Every weapon in the catalog, resolved — a scar has to be safe on ALL of
 *  them, not on the one it was authored against. */
const WEAPONS = Object.values(ITEMS)
  .filter((i) => i.kind === 'weapon' && i.weapon)
  .map((i) => ({ id: i.id, name: i.name, stats: resolveWeaponStats(i.weapon!) }));

const ALL = Object.values(SCARS);
const byClass = (k: ScarClass) => ALL.filter((s) => s.klass === k);

// ── THE CEILING ──────────────────────────────────────────────────────────────

test('NO SCAR EXCEEDS THE DPS CEILING ON ANY WEAPON IN THE CATALOG', () => {
  for (const scar of ALL) {
    for (const w of WEAPONS) {
      const f = scarDpsFactor(scar, w.stats);
      assert.ok(f <= 1 + SCAR_DPS_CEILING + 1e-9,
        `${scar.id} on ${w.id}: ×${f.toFixed(3)} — over the +${SCAR_DPS_CEILING * 100}% ceiling`);
    }
  }
});

test('NOR DO ALL THREE LANES TOGETHER', () => {
  // The worst legal loadout: the strongest scar in each lane, all at once.
  for (const w of WEAPONS) {
    const worst = (['edge', 'form', 'debt'] as ScarClass[])
      .map((k) => byClass(k).slice().sort((a, b) => scarDpsFactor(b, w.stats) - scarDpsFactor(a, w.stats))[0])
      .filter(Boolean);
    if (!worst.length) continue;
    const f = scarSetDpsFactor(worst, w.stats);
    assert.ok(f <= 1 + SCAR_TOTAL_DPS_CEILING + 1e-9,
      `${worst.map((s) => s.id).join('+')} on ${w.id}: ×${f.toFixed(3)} — a fully scarred weapon is over budget`);
  }
});

test('NO SCAR IS INERT — every one moves something on some weapon', () => {
  // DESIGN-METHOD §5: an item that never moves either tail is dead content and
  // should be cut or rewritten. This is the cheap version of that check — six
  // relics carrying `action-speed-mult` that nothing read is the failure it
  // exists to catch.
  for (const scar of ALL) {
    const moved = WEAPONS.some((w) => {
      const shaped = applyScars(w.stats, [scar.id]);
      const changedSwing = shaped.reach !== w.stats.reach
        || shaped.coneHalfAngle !== w.stats.coneHalfAngle
        || shaped.attackSpeed !== w.stats.attackSpeed
        || shaped.staggerPower !== w.stats.staggerPower
        || shaped.commitment !== w.stats.commitment
        || shaped.critChance !== w.stats.critChance
        || shaped.onHit !== w.stats.onHit;
      return changedSwing || scarModifiers([scar.id]).length > 0;
    });
    assert.ok(moved, `${scar.id} changes nothing on any weapon — it is a tooltip, not a scar`);
  }
});

// ── THE LANES MEAN WHAT THEY SAY ─────────────────────────────────────────────

test('a FORM scar changes how the weapon SWINGS', () => {
  for (const scar of byClass('form')) {
    assert.ok(scar.form, `${scar.id} is in the FORM lane with no form block`);
    const w = WEAPONS[0];
    const shaped = applyScars(w.stats, [scar.id]);
    const moved = shaped.reach !== w.stats.reach
      || shaped.coneHalfAngle !== w.stats.coneHalfAngle
      || shaped.attackSpeed !== w.stats.attackSpeed
      || shaped.staggerPower !== w.stats.staggerPower
      || shaped.commitment !== w.stats.commitment;
    assert.ok(moved, `${scar.id} is FORM but moves no timing, reach or shape — mislabelled EDGE`);
  }
});

test('a FORM scar is not a damage scar wearing a hat', () => {
  // If everything a FORM scar does can be said on the damage line, it belongs in
  // EDGE. Half the single-scar budget is the line.
  for (const scar of byClass('form')) {
    for (const w of WEAPONS) {
      const f = scarDpsFactor(scar, w.stats);
      assert.ok(f <= 1 + SCAR_DPS_CEILING / 2 + 1e-9,
        `${scar.id} on ${w.id}: ×${f.toFixed(3)} — a FORM scar carrying an EDGE scar's payoff`);
    }
  }
});

test('a DEBT scar TAKES something', () => {
  for (const scar of byClass('debt')) {
    const takes = (scar.modifiers ?? []).some((m) => {
      if (m.kind === 'max-hp' || m.kind === 'physical-armor' || m.kind === 'magic-armor') return m.amount < 0;
      if (m.kind === 'move-speed-mult' || m.kind === 'action-speed-mult') return m.amount < 1;
      if (m.kind === 'incoming-damage-mult') return m.amount > 1;
      return false;
    }) || Object.values(scar.form ?? {}).some((v) => typeof v === 'number' && v < 1);
    assert.ok(takes, `${scar.id} is DEBT but costs nothing — that is just an EDGE scar with a grim name`);
  }
});

test('a DEBT scar is worth its cost', () => {
  // The lane exists because a cost you cannot switch off earns a big number.
  // A debt that pays less than the floor is a punishment, not a bargain.
  for (const scar of byClass('debt')) {
    const best = Math.max(...WEAPONS.map((w) => scarDpsFactor(scar, w.stats)));
    assert.ok(best >= 1 + DEBT_DPS_FLOOR,
      `${scar.id} peaks at ×${best.toFixed(3)} — nobody would pay permanent health for that`);
  }
});

test('an EDGE scar does not multiply', () => {
  // §1: player-controlled condition + multiplicative payoff = broken. Every
  // condition an EDGE scar can key off is chosen by the player, so its payoff
  // stays a slice of base — no damage-multiplier records in this lane.
  for (const scar of byClass('edge')) {
    for (const m of scar.modifiers ?? []) {
      assert.notEqual(m.kind, 'damage-multiplier',
        `${scar.id} multiplies on a condition the player controls — this is the ×14.6 dagger again`);
    }
  }
});

// ── THE ONE-PER-CLASS RULE ───────────────────────────────────────────────────

test('a weapon takes one scar per lane and no more', () => {
  const edge = byClass('edge')[0], form = byClass('form')[0], debt = byClass('debt')[0];
  assert.ok(applyScar('rusted-sword', edge.id), 'the first scar was refused');
  assert.ok(applyScar('rusted-sword', form.id));
  assert.ok(applyScar('rusted-sword', debt.id));
  assert.equal(getScars('rusted-sword').length, MAX_SCARS_PER_WEAPON);
  assert.equal(offerableScars('rusted-sword').length, 0, 'a fully scarred weapon is still being offered scars');
});

test('the same lane cannot be spent twice', () => {
  const edges = byClass('edge');
  applyScar('rusted-sword', edges[0].id);
  for (const e of edges) {
    assert.equal(canTakeScar('rusted-sword', e.id), false,
      `${e.id} was offered to a weapon that has already spent its EDGE`);
  }
});

test('scars belong to the WEAPON, not the delver', () => {
  applyScar('rusted-sword', byClass('edge')[0].id);
  assert.equal(getScars('scimitar').length, 0, 'a scar leaked onto another blade');
});

test('an unknown weapon is not scarrable', () => {
  assert.equal(canTakeScar(undefined, byClass('edge')[0].id), false);
  assert.equal(canTakeScar('rusted-sword', 'no-such-scar'), false);
});

// ── PERSISTENCE ──────────────────────────────────────────────────────────────

test('a scarred blade survives the save', () => {
  applyScar('rusted-sword', byClass('edge')[0].id);
  applyScar('rusted-sword', byClass('form')[0].id);
  const snap = JSON.parse(JSON.stringify(serializeScars()));
  clearScars();
  assert.equal(getScars('rusted-sword').length, 0);
  hydrateScars(snap);
  assert.equal(getScars('rusted-sword').length, 2, 'the forge work was lost across a reload');
});

test('a save from an older catalog drops what no longer exists', () => {
  hydrateScars({ 'rusted-sword': ['notched', 'a-scar-we-deleted'] });
  assert.deepEqual([...getScars('rusted-sword')], ['notched']);
});

// ── PURITY ───────────────────────────────────────────────────────────────────

test('applying scars never mutates the weapon it was handed', () => {
  // getCurrentWeapon() runs this on the shared resolve every frame — if it
  // wrote through, a scar would compound itself sixty times a second.
  const w = WEAPONS[0];
  const before = { ...w.stats };
  applyScars(w.stats, ALL.map((s) => s.id));
  applyScars(w.stats, ALL.map((s) => s.id));
  assert.deepEqual({ ...w.stats }, before, 'applyScars wrote through to its input');
});

test('an unscarred weapon is handed back untouched', () => {
  const w = WEAPONS[0];
  assert.equal(applyScars(w.stats, []), w.stats, 'a blank weapon paid for a copy');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
