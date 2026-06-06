// Pure half-heart HP math — no DOM/THREE imports, so it's unit-testable in
// node. Each heart is worth HEART_HP (2) HP; damage wipes a heart's fill from
// the right, so 1 HP into a 2-HP heart reads as a HALF heart.

/** HP per heart. 2 → a full heart is 2 HP and 1 HP is a half heart. */
export const HEART_HP = 2;

// Quarter-of-a-heart granularity = 0.5 HP steps. Integer HP yields clean full/
// half hearts; fractional HP (DoT, % damage) snaps to the nearest half.
const STEPS = 4;

/** Hearts needed to show `max` HP (never zero). */
export function heartCount(max: number): number {
  return Math.max(1, Math.ceil(max / HEART_HP));
}

/** How full each heart is (0..1, quantized to STEPS) for a given hp + heart
 *  count. Heart i covers HP [i*HEART_HP, (i+1)*HEART_HP). */
export function heartFillFractions(hp: number, numHearts: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < numHearts; i++) {
    const f = Math.max(0, Math.min(1, (hp - i * HEART_HP) / HEART_HP));
    out.push(Math.round(f * STEPS) / STEPS);
  }
  return out;
}
