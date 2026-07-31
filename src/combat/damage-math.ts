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
 * The pre-armor strike damage a swing/shot deals: `base`, crit-multiplied when
 * `crit`, then times every situational multiplier (charge, finisher, cleave,
 * zone, execute, step, …). The crit ROLL stays at the call site — it needs RNG
 * and per-zone bonuses — but this composes the number, so the melee and ranged
 * paths share ONE tested formula instead of re-inlining the multiplier product
 * (melee had a 9-factor inline chain; ranged its own). Multiplication order is
 * irrelevant to the result, so this is exactly behavior-preserving.
 */
export function composeStrikeDamage(
  base: number,
  crit: boolean,
  critMultiplier: number,
  multipliers: readonly number[] = [],
): number {
  let dmg = crit ? base * critMultiplier : base;
  for (const m of multipliers) dmg *= m;
  return dmg;
}
