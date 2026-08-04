// Pure damage arithmetic — no module state, no deps (unit-testable in Node).
// damage.ts looks up the source/target stats, then defers the actual number
// crunch to here so the floor + multiplier rules have one tested home.

export interface DamageOutcome {
  /** Final damage after bonus, multiplier, armor — floored at 1. */
  applied: number;
  /** How much armor absorbed (for optional "blocked" feedback). */
  blocked: number;
}

/**
 * base, plus the source's flat bonus, times the source's multiplier, minus the
 * target's armor for the damage type. Rounded and floored at 1 so every
 * connecting hit does SOMETHING — armor can soften but never fully negate.
 */
export function resolveDamage(
  base: number,
  damageBonus: number,
  damageMultiplier: number,
  armor: number,
): DamageOutcome {
  const boosted = (base + damageBonus) * damageMultiplier;
  const applied = Math.max(1, Math.round(boosted - armor));
  return { applied, blocked: Math.max(0, boosted - applied) };
}

/**
 * The pre-armor strike damage a swing/shot deals.
 *
 * BONUSES ADD, PENALTIES MULTIPLY, CRIT MULTIPLIES ONCE.
 *
 * This used to multiply every situational factor together, and that is what
 * made a one-damage dagger hit for eleven. Landing the perfect strike stacks
 * FIVE separate "you did the right thing" factors — a full charge (×1.8), the
 * head zone (×1.2), an overcharged release (×1.35), an execute on a staggered
 * foe (×2.0) and the crit (×2.5) — and multiplied that is ×14.6 against a
 * dungeon whose depth-1 population has one to four hit points. Every one of
 * those factors was individually reasonable; the product was not, and it got
 * worse every time we added a sixth good idea.
 *
 * So the situational bonuses now sum their SURPLUS and apply as one term:
 *
 *     bonus   = 1 + Σ (m − 1)   for every m ≥ 1
 *     penalty = Π m             for every m < 1
 *     damage  = base × crit × bonus × penalty
 *
 * Crit stays a true multiplier — it's the weapon's identity stat, it already
 * varies 2.0–2.5 across the arsenal, and a crit that didn't feel like a crit
 * would be the wrong fix. Penalties stay multiplicative because that's the only
 * way they keep reducing: additively, two reducers (an armour zone at 0.25 and
 * a cleave falloff at 0.6) would sum to a NEGATIVE factor.
 *
 * The result is that each bonus contributes a legible slice you can reason
 * about — a head shot is always "+20% of base", not "+20% of whatever the other
 * four factors already compounded to" — and adding a new bonus later costs a
 * slice instead of doubling the ceiling.
 */
export function composeStrikeDamage(
  base: number,
  crit: boolean,
  critMultiplier: number,
  multipliers: readonly number[] = [],
): number {
  let surplus = 0;
  let penalty = 1;
  for (const m of multipliers) {
    if (m >= 1) surplus += m - 1;
    else penalty *= m;
  }
  const dmg = crit ? base * critMultiplier : base;
  return dmg * (1 + surplus) * penalty;
}
