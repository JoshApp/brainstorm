// Telegraph pose clips — the crude, moody animation layer keyed to an
// ability's phase + flavour. Data-driven so each telegraph style reads
// as a distinct silhouette (a charge coils then lunges; a swing leans
// back then slams; a cast rises then thrusts) without per-enemy code.
//
// Each pose is a few additive offsets on named rig nodes, interpreted by
// applyTelegraph in enemy.ts:
//   - windup  : lerp 0 → .windup over the phase progress t
//   - strike  : hold .strike
//   - recover : lerp .strike → 0 over t
//
// Nodes (all optional per model — a node that doesn't exist no-ops, so
// the same clip works on a fully-rigged humanoid and a limbless blob):
//   rigTilt  — the body lean (rig slot rotation.x)
//   bob      — the body rise (model-root position.y)
//   armSwing — both shoulder pivots' rotation.x (jointed-arm models only)
//
// Positive rigTilt / armSwing pitches FORWARD (toward the player);
// negative leans/coils back. bob is metres of vertical rise.

export type TelegraphStyle = 'swing' | 'cast' | 'charge';

interface Phased { windup: number; strike: number; }
export interface TelegraphPose {
  rigTilt: Phased;
  bob: Phased;
  armSwing: Phased;
}

export const TELEGRAPH_POSES: Record<TelegraphStyle, TelegraphPose> = {
  // Baseline melee — wind back high, slam down through the target.
  swing: {
    rigTilt:  { windup:  0.50, strike: -0.25 },
    bob:      { windup:  0.10, strike:  0.0  },
    armSwing: { windup:  0.70, strike: -1.05 },   // arms raise, then overhand
  },
  // Caster — a smaller, steadier lean; arms spread out then push the
  // bolt/hex forward. No big body slam (it's not a physical blow).
  cast: {
    rigTilt:  { windup:  0.18, strike:  0.0  },
    bob:      { windup:  0.06, strike:  0.0  },
    armSwing: { windup:  0.45, strike: -0.35 },
  },
  // Charger — COIL back hard (negative), then a deep forward lunge.
  // The big rig pitch + arm thrust sells the "springs across the gap."
  charge: {
    rigTilt:  { windup: -0.45, strike: -0.55 },
    bob:      { windup:  0.04, strike:  0.0  },
    armSwing: { windup:  0.90, strike: -1.30 },   // wind arms back, hurl forward
  },
};

/** Linear value for a node at the given phase + progress. */
export function poseValue(p: Phased, phase: 'windup' | 'strike' | 'recover', t: number): number {
  if (phase === 'windup') return p.windup * t;
  if (phase === 'strike') return p.strike;
  return p.strike * (1 - t);   // recover: ease back to neutral
}
