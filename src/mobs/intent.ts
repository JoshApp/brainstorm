import { CONFIG } from '../config';

// Enemy AI V2 — the Intent layer (docs/ENEMY-AI-V2.md).
//
// A chasing mob no longer runs one fixed behaviour (walk to ring, swing when
// able). It picks an INTENT and executes it, re-deciding on a slow decision tick
// so choices carry commitment. This is the pure selector: given a snapshot of
// the fight, score the candidate intents and return the winner + how to execute
// it. No side effects, no globals, no Math.random — the caller passes a seeded
// rng so the choice is deterministic + replayable (the AI runs in the sim).
//
// The load-bearing inversion vs V1: ATTACKS ARE HELD BY DEFAULT. Only an
// aggressive intent (`press`) releases one. That's what creates the lull — a mob
// stops swinging the instant it's able and instead CHOOSES when, so a fight
// breathes (size-you-up → burst) instead of a constant shuffle-and-swing.

export type Intent = 'close' | 'circle' | 'watch' | 'press';

/** How the chasing executor should MOVE for a chosen intent. */
export type MoveMode = 'close' | 'orbit' | 'hold';

/** Per-mob disposition, rolled at spawn (spec defaults + seeded jitter). Drives
 *  how the utility leans — a bold mob rushes, a patient one waits for openings. */
export interface Personality {
  boldness: number;      // 0..1 — rush in + swing vs hang back
  patience: number;      // 0..1 — wait/size-up vs constant pressure
  packLoyalty: number;   // 0..1 — reserved for Stage 3 flank coordination
}

export interface IntentInput {
  distance: number;         // to the player (m)
  reach: number;            // strike range — the ring radius
  commitDistance: number;   // farthest range any ability triggers
  aggression: number;       // 0..1 mood (drifts; see enemy.ts)
  personality: Personality;
  canAttack: boolean;       // an ability is ready AND the player is in its band
  hpFrac: number;           // 0..1 current HP
  rng: () => number;        // seeded [0,1) — deterministic tie-break jitter
}

export interface IntentChoice {
  intent: Intent;
  moveMode: MoveMode;
  speedMul: number;         // scales moveSpeed
  releaseAttack: boolean;   // may this window commit an attack?
}

const CHOICE: Record<Intent, IntentChoice> = {
  close:  { intent: 'close',  moveMode: 'close', speedMul: 1.0,  releaseAttack: false },
  circle: { intent: 'circle', moveMode: 'orbit', speedMul: 0.75, releaseAttack: false },
  watch:  { intent: 'watch',  moveMode: 'hold',  speedMul: 0.0,  releaseAttack: false },
  press:  { intent: 'press',  moveMode: 'close', speedMul: 1.12, releaseAttack: true  },
};

/**
 * Pick the intent for this decision window. Pure: same inputs → same output.
 *
 * Shape of the logic:
 *   - Out of engagement range → CLOSE (nothing else matters; get in the fight).
 *   - In range → score press / circle / watch by mood + personality and take the
 *     best, with a little seeded noise so a pack doesn't move as one organism.
 */
export function selectIntent(input: IntentInput): IntentChoice {
  const { distance, reach, commitDistance, aggression, personality, canAttack, hpFrac, rng } = input;
  const P = CONFIG.ENEMY_AI.INTENT;

  // Well out of range: close the gap. (Past the commit band + a margin.)
  if (distance > commitDistance + reach * 0.6) return CHOICE.close;

  const jitter = () => (rng() - 0.5) * P.JITTER;

  // PRESS — commit to a swing. Only meaningful if it can actually attack. Warmth
  // (mood) + boldness push it; patience pulls it back (waits for a better moment).
  const scorePress = canAttack
    ? 0.30 + aggression * 0.60 + personality.boldness * 0.30 - personality.patience * 0.30 + jitter()
    : -1;

  // CLOSE — still a bit far within the band: drift toward strike range. Scales
  // with how far past reach we are, so a mob at arm's length won't keep shoving in.
  const bandFrac = Math.min(1, Math.max(0, (distance - reach) / Math.max(0.001, commitDistance - reach)));
  const scoreClose = bandFrac * (0.40 + personality.boldness * 0.30) + jitter();

  // CIRCLE — orbit the ring, sizing you up. The default "intelligent opponent"
  // read: aggressive presence, but it grants breathing room.
  const scoreCircle = 0.32 + personality.patience * 0.22 + (1 - aggression) * 0.20 + jitter();

  // WATCH — the lull: hold still and stare. Cautious/patient mobs, and a hurt one
  // (low HP) that wants a beat before re-committing.
  const scoreWatch = personality.patience * 0.45 + (1 - aggression) * 0.35
    + (1 - personality.boldness) * 0.20 + (1 - hpFrac) * 0.15 + jitter();

  let best: Intent = 'circle';
  let bestScore = scoreCircle;
  if (scorePress > bestScore) { best = 'press'; bestScore = scorePress; }
  if (scoreClose > bestScore) { best = 'close'; bestScore = scoreClose; }
  if (scoreWatch > bestScore) { best = 'watch'; bestScore = scoreWatch; }
  return CHOICE[best];
}

/** Roll a personality from optional spec defaults + seeded jitter. Kept here so
 *  the spawn site and any test share one definition. */
export function rollPersonality(
  rng: () => number,
  defaults?: Partial<Personality>,
): Personality {
  const j = (base: number) => Math.min(1, Math.max(0, base + (rng() - 0.5) * 0.5));
  return {
    boldness: j(defaults?.boldness ?? 0.5),
    patience: j(defaults?.patience ?? 0.5),
    packLoyalty: j(defaults?.packLoyalty ?? 0.5),
  };
}
