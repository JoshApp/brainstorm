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
