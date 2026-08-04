import type { StatModifier } from '../combat/modifiers';
import type { ResolvedWeaponStats } from './weapon-classes';
import { composeStrikeDamage } from '../combat/damage-math';
import type { ContentStatus } from './content-status';

// SCARS — what a weapon REMEMBERS. See docs/WEAPON-EVOLUTION.md.
//
// A scar is a permanent modification to ONE weapon, chosen from an offer and
// applied on the spot. It sticks to the weapon by item id (state/weapon-scars.ts,
// the same shape as the blacksmith's temper), so by Depth 10 the rusted sword you
// started with is YOUR rusted sword and you can name the three decisions that
// made it so.
//
// ── THE THREE CLASSES, AND WHY THE CLASS IS THE BALANCE MECHANISM ────────────
//
//   EDGE  changes what a HIT does      — a status, a condition, a slice of base
//   FORM  changes what the SWING IS    — reach, cone, cadence, weight
//   DEBT  changes what HOLDING IT COSTS — strictly stronger, and it takes
//
// ONE SCAR PER CLASS, EVER. Three is the ceiling on a weapon. That is
// DESIGN-METHOD §1's "what does a second copy do?" answered in the data model
// instead of in a tooltip — there is no stacking to balance because there is no
// stacking.
//
// DEBT is where the big numbers are allowed, and that is not generosity. §1:
// *a player-controlled condition may not carry a multiplicative payoff.* An EDGE
// scar's condition ("on a crit", "on the finisher") is chosen by the player every
// swing, so its payoff must stay a slice of base. A DEBT scar's condition is
// simply that you are carrying the thing — you cannot switch it off, you cannot
// set it up, you pay it in every fight including the ones where it doesn't help.
// That is the only condition that earns a big number.
//
// ── THE CEILING, WRITTEN BEFORE THE CONTENT ──────────────────────────────────
// tests/scars.test.ts asserts all of this against the REAL damage composition
// (§2 — an audit that re-inlines the arithmetic is reporting a model of the game
// rather than the game). If a scar you author fails the test, the scar is wrong.

/** Which lane a scar belongs to. One per lane per weapon. */
export type ScarClass = 'edge' | 'form' | 'debt';

/**
 * The LEGEND. A player should learn "amber-red means it costs you" before they
 * learn any individual scar's name, so the colour lives with the data and every
 * surface that shows a scar reads from here (VISUAL-LANGUAGE.md — the legend
 * carries the meaning, not the prose).
 */
export const SCAR_LANE_COLOR: Record<ScarClass, string> = {
  edge: '#c9b27a',   // pale steel — a keener hit
  form: '#8fb3c9',   // cold blue — the shape of the swing
  debt: '#c96a4a',   // the blood price
};
export const SCAR_LANE_LABEL: Record<ScarClass, string> = { edge: 'EDGE', form: 'FORM', debt: 'DEBT' };

/** No single scar may raise a weapon's DPS by more than this. */
export const SCAR_DPS_CEILING = 0.35;
/** Nor may all three together. A weapon is a character, not a stat stack. */
export const SCAR_TOTAL_DPS_CEILING = 0.35;
/** A DEBT scar has to be worth its cost — below this it is just a punishment. */
export const DEBT_DPS_FLOOR = 0.15;

/**
 * FORM shaping — multiplicative on the RESOLVED weapon stats, applied after
 * class defaults, proficiency and attributes have had their say. Every field is
 * a multiplier so a scar composes with a weapon it was never authored against.
 *
 * A FORM scar MUST move at least one of these. If everything it does can be said
 * on the damage line, it is an EDGE scar that has been mislabelled.
 */
export interface ScarForm {
  reachMul?: number;
  coneMul?: number;
  /** >1 = faster. Scales the whole timeline (windup + strike + recover). */
  attackSpeedMul?: number;
  /** Stagger power — the poise pressure a hit applies. */
  staggerMul?: number;
  /** Attack commitment 0..1 — how much movement agency the swing costs. */
  commitmentMul?: number;
  critChanceMul?: number;
}

export interface ScarSpec {
  id: string;
  name: string;
  klass: ScarClass;
  /** Include-flag: omit = 'release' (content-status.ts). */
  status?: ContentStatus;
  /** One line, IN-WORLD register — this is the blade's own history, not the
   *  voice in the deep. Terse, archaic, no jokes (Tone Bible). */
  fate: string;
  /** EDGE + DEBT: folded into the stat pipeline while this weapon is DRAWN.
   *  Same StatModifier records an affix or a card emits — no bespoke path. */
  modifiers?: StatModifier[];
  /** FORM: how the swing itself changes. */
  form?: ScarForm;
  /** EDGE: a status the scarred weapon inflicts on hit. Rides the buff pipeline. */
  onHit?: { buffId: string; chance: number; duration: number };
}

// ── THE CATALOG ──────────────────────────────────────────────────────────────
// S0 is deliberately three plain scars — one per lane — so the SPINE can be felt
// before the content grows. Each was briefed with a role before it had a name
// (§6: role-first, fiction afterward), and the brief is written above it.

export const SCARS: Record<string, ScarSpec> = {
  // ROLE: make a weapon that already lands often care about landing often —
  // the pressure lane. Chosen for S0 because bleed is the status the codebase
  // has the most payoff plumbing for (bleed-chain, bleed-feed), so it lands in
  // an economy instead of standing alone.
  'notched': {
    id: 'notched', name: 'Notched', klass: 'edge',
    fate: 'Someone fought back, once. The gap in the edge never closed.',
    onHit: { buffId: 'bleed', chance: 0.30, duration: 4 },
  },

  // ROLE: give a slow weapon a reason to stay slow — trade cadence for space,
  // so a hammer becomes a crowd tool rather than a worse sword. The cone widens
  // by more than the speed loses, which is the whole trade being legible.
  'broad-ground': {
    id: 'broad-ground', name: 'Broad-Ground', klass: 'form',
    fate: 'Ground back on a wheel by someone with more patience than skill.',
    form: { coneMul: 1.35, reachMul: 1.10, attackSpeedMul: 0.90, staggerMul: 1.15 },
  },

  // ROLE: the first taste of the lane where power costs something permanent.
  // The debt is max HP — it composes through the existing pipeline with no new
  // plumbing, and the health economy (BUILD-ECONOMY.md: health is scarce and
  // does NOT bloat) is exactly the thing it should be allowed to bite.
  'blood-drunk': {
    id: 'blood-drunk', name: 'Blood-Drunk', klass: 'debt',
    fate: 'It drinks first. What is left over, it lets you keep.',
    // Denominated in the WEAPON'S OWN units, not in flat points. The first
    // draft of this scar was `weapon-damage: +2` and the ceiling test caught it
    // at ×3.05 on a rusted sword — because +2 is a rounding error on a hammer
    // and a tripling on a 1-damage blade. DESIGN-METHOD §4: a cost or reward
    // denominated in another system's units is a FRACTION, not a number.
    //
    // The multiplier is safe here for the reason DEBT exists: composeStrikeDamage
    // turns any multiplier ≥1 into an additive slice of base, so this contributes
    // +25% of base and cannot compound with the rest of a build.
    modifiers: [
      { kind: 'damage-multiplier', amount: 1.25 },
      { kind: 'crit-mult', amount: 0.25 },
      { kind: 'max-hp', amount: -1 },
    ],
  },
};

/** Lookup, or undefined for an unknown id (a save from an older catalog). */
export function getScar(id: string): ScarSpec | undefined {
  return SCARS[id];
}

/**
 * Shape a weapon's resolved stats by the scars it carries — FORM's multipliers
 * and EDGE's on-hit status, the two things that live on the weapon rather than
 * on the player. Pure: the same inputs always give the same output, so the forge
 * preview and the live swing cannot disagree.
 *
 * A weapon that already inflicts something of its own KEEPS it — a torch that
 * burns does not stop burning because you notched it. The scar's status only
 * fills an empty slot; a weapon with its own identity is not overwritten by one.
 */
export function applyScars(base: ResolvedWeaponStats, scarIds: readonly string[]): ResolvedWeaponStats {
  if (!scarIds.length) return base;
  let out = base;
  const write = () => (out = out === base ? { ...base } : out);
  for (const id of scarIds) {
    const spec = SCARS[id];
    if (!spec) continue;
    const f = spec.form;
    if (f) {
      write();
      if (f.reachMul) out.reach *= f.reachMul;
      if (f.coneMul) out.coneHalfAngle *= f.coneMul;
      if (f.attackSpeedMul) out.attackSpeed *= f.attackSpeedMul;
      if (f.staggerMul) out.staggerPower *= f.staggerMul;
      if (f.commitmentMul) out.commitment = Math.min(1, out.commitment * f.commitmentMul);
      if (f.critChanceMul) out.critChance *= f.critChanceMul;
    }
    if (spec.onHit && !out.onHit) {
      write();
      out.onHit = { ...spec.onHit };
    }
  }
  return out;
}

/** The stat modifiers a set of scars contributes while the weapon is drawn. */
export function scarModifiers(scarIds: readonly string[]): StatModifier[] {
  const out: StatModifier[] = [];
  for (const id of scarIds) {
    const m = SCARS[id]?.modifiers;
    if (m) out.push(...m);
  }
  return out;
}

/** The on-hit status a scarred weapon inflicts, if any scar grants one. */
export function scarOnHit(scarIds: readonly string[]): ScarSpec['onHit'] | undefined {
  for (const id of scarIds) {
    const h = SCARS[id]?.onHit;
    if (h) return h;
  }
  return undefined;
}

/**
 * How much a scar multiplies a weapon's damage-per-second — the number the
 * ceiling is written in, and the number the forge preview shows the player.
 *
 * ONE function, two consumers, so the audit and the UI can never drift apart
 * (DESIGN-METHOD §2: every audit tool calls the real function). The damage side
 * runs through `composeStrikeDamage` itself rather than re-inlining the
 * bonuses-add/crit-multiplies-once rule.
 *
 * What it does NOT capture, stated so nobody reads more into it than it means:
 * reach and cone (crowd value, not single-target DPS), and the value of a status
 * over time. A FORM scar that widens the cone will read as ~1.0 here and that is
 * correct — it is not a DPS scar. The status floor is approximated crudely, on
 * purpose: this is a ceiling check, not a simulation.
 */
export function scarDpsFactor(scar: ScarSpec, base: ResolvedWeaponStats): number {
  return scarSetDpsFactor([scar], base);
}

/** The same measure for a whole set — what the three-scar ceiling is checked on. */
export function scarSetDpsFactor(scars: readonly ScarSpec[], base: ResolvedWeaponStats): number {
  const ids = scars.map((s) => s.id);
  const shaped = applyScars(base, ids);
  const mods = scarModifiers(ids);

  let flat = 0, mul: number[] = [];
  let critChanceBonus = 0, critMultBonus = 0;
  for (const m of mods) {
    if (m.kind === 'weapon-damage') flat += m.amount;
    else if (m.kind === 'damage-multiplier') mul.push(m.amount);
    else if (m.kind === 'crit-chance') critChanceBonus += m.amount;
    else if (m.kind === 'crit-mult') critMultBonus += m.amount;
  }

  const expected = (dmg: number, chance: number, cm: number, muls: number[]) => {
    const c = Math.max(0, Math.min(1, chance));
    return (1 - c) * composeStrikeDamage(dmg, false, cm, muls)
         + c * composeStrikeDamage(dmg, true, cm, muls);
  };

  const before = expected(base.damage, base.critChance, base.critMultiplier, []);
  const after = expected(
    shaped.damage + flat,
    shaped.critChance + critChanceBonus,
    shaped.critMultiplier + critMultBonus,
    mul,
  );
  // Cadence: attackSpeed scales the whole timeline, so DPS scales with it.
  const rate = shaped.attackSpeed / (base.attackSpeed || 1);
  if (before <= 0) return 1;

  // A status contributes damage the swing math never sees. Priced flat and
  // conservatively — an over-estimate is the safe direction for a ceiling.
  const STATUS_DPS_SHARE = 0.20;
  const onHit = scarOnHit(ids);
  const status = onHit ? onHit.chance * STATUS_DPS_SHARE : 0;

  return (after / before) * rate + status;
}
