// Named easing functions for the keyframe DSL. Pure (t and result in [0,1],
// except the "back" eases which deliberately overshoot past 1 for a snappy
// anticipation/settle). An LLM authors a curve by NAME ('easeOutBack') instead
// of inventing bezier handles — readable, diffable, and the curve set is the
// authorable vocabulary.

export type EaseName =
  | 'linear'
  | 'easeInQuad' | 'easeOutQuad' | 'easeInOutQuad'
  | 'easeInCubic' | 'easeOutCubic' | 'easeInOutCubic'
  | 'easeInOutSine'
  | 'easeOutBack'      // overshoots then settles — good for a strike snap
  | 'easeInBack'       // dips back then launches — good for a windup
  | 'step';            // hold, then jump at the end (discrete)

export type EaseFn = (t: number) => number;

const BACK = 1.70158;

export const EASES: Record<EaseName, EaseFn> = {
  linear: (t) => t,
  easeInQuad: (t) => t * t,
  easeOutQuad: (t) => 1 - (1 - t) * (1 - t),
  easeInOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  easeInCubic: (t) => t * t * t,
  easeOutCubic: (t) => 1 - Math.pow(1 - t, 3),
  easeInOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  easeInOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  easeOutBack: (t) => 1 + (BACK + 1) * Math.pow(t - 1, 3) + BACK * Math.pow(t - 1, 2),
  easeInBack: (t) => (BACK + 1) * t * t * t - BACK * t * t,
  step: (t) => (t >= 1 ? 1 : 0),
};

/** Apply a named ease to a normalized 0..1 input. Unknown/undefined → linear. */
export function ease(name: EaseName | undefined, t: number): number {
  const f = name ? EASES[name] : undefined;
  return (f ?? EASES.linear)(t);
}
