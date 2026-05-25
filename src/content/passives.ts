import type { PassiveSpec } from '../ecs/types';

// Passive library. Passives are trigger + effects pairs attached to an entity.
// Currently used for the player only; later, equipped items grant passives to
// the player while equipped, and enemies can have intrinsic passives too.

export const PASSIVES: Record<string, PassiveSpec> = {
  // Demo passive: kill an enemy, gain 2.7 seconds of regen-pulse (heals 1 HP
  // every 0.45s, ~6 HP healed total — capped at max HP). Proves trigger →
  // effect → buff → buff-tick-effect end-to-end.
  reaper: {
    id: 'reaper',
    trigger: {
      on: 'killed',
      effects: [
        { type: 'apply-buff', buffId: 'regen-pulse', duration: 2.7 },
      ],
    },
  },
};
