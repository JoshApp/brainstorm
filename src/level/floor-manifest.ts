import type { LevelSpec, PropSpec } from './types';

// Floor manifest — the per-floor budget for "set-piece" content
// (fountains, altars, future encounters, future shops).
//
// Why this exists:
//   Vaults bake some set-pieces into their authored prop lists (e.g.
//   'fountain-shrine' lives inside the ENCOUNTER_FOUNTAIN vault). If the
//   procgen spine happens to pick TWO fountain-bearing vaults on the
//   same floor, the player walks into a dungeon level with two heal
//   fountains — a free top-up that breaks the run's tension.
//
// The fix is what every good roguelike does (Hades, Spelunky, Dead
// Cells, DCSS): PLAN the floor's content first, then place it.
//   1. Roll a manifest before placement: "this floor allows max 1
//      fountain, max 1 altar."
//   2. After all vaults have contributed their props, count the
//      set-pieces and STRIP any excess.
//
// Future (step 2): the manifest will also PUSH content into
// vault-declared encounter slots. Same data structure, more fields.

/** A content kind the manifest tracks. Add a kind here only when you
 *  want a per-floor cap on it. PropSpec kinds not listed are unlimited
 *  (e.g. pillars, vases, chests — those are placed per-vault by
 *  design). */
export type ContentKind = 'fountain' | 'altar';

/** Which PropSpec kinds map to which manifest content kind. Anything
 *  not in this map is unconstrained. */
const PROP_KIND_TO_CONTENT: Partial<Record<PropSpec['kind'], ContentKind>> = {
  fountain: 'fountain',
  altar: 'altar',
};

export interface FloorManifest {
  /** Max instances of each kind allowed on this floor. */
  caps: Record<ContentKind, number>;
}

/**
 * Roll a manifest for a floor at the given depth. Right now caps are
 * constant per kind — the depth knob is here so future scaling (e.g.
 * encounters arriving at depth 2+, shops at depth 4+) plugs in
 * naturally without touching call sites.
 */
export function rollManifest(_depth: number, _rand: () => number): FloorManifest {
  return {
    caps: {
      // Never more than one heal fountain per floor. Two would let the
      // player top off twice without earning it — kills run tension.
      fountain: 1,
      // Same for altars. One altar per floor stays special; two on the
      // same map dilutes the "this chamber is for the rite" beat.
      altar: 1,
    },
  };
}

/**
 * Walk the flat props list and drop any set-pieces that exceed the
 * manifest's caps. Survivors are picked by deterministic shuffle via
 * the passed `rand` so two players on the same run-seed see the same
 * floor.
 *
 * V1 limitation: only strips the matching prop, not its companion
 * group siblings (a dropped fountain leaves its flanking candles in
 * place). The "abandoned shrine" silhouette reads as grimdark-
 * appropriate so we accept it. A future pass can track group
 * provenance during expansion if visuals demand tighter cleanup.
 */
export function reconcileManifest(
  spec: LevelSpec,
  manifest: FloorManifest,
  rand: () => number,
): void {
  // Bucket every capped prop by its content kind.
  const byKind: Partial<Record<ContentKind, PropSpec[]>> = {};
  for (const p of spec.props) {
    const ck = PROP_KIND_TO_CONTENT[p.kind];
    if (!ck) continue;
    (byKind[ck] ??= []).push(p);
  }

  const toRemove = new Set<PropSpec>();
  for (const k of Object.keys(byKind) as ContentKind[]) {
    const props = byKind[k]!;
    const cap = manifest.caps[k] ?? 0;
    if (props.length <= cap) continue;
    // Shuffle so the survivor is random across the floor, not always
    // the first-placed instance (which would bias toward the start
    // vault).
    shuffleInPlace(props, rand);
    for (let i = cap; i < props.length; i++) toRemove.add(props[i]);
  }

  if (toRemove.size > 0) {
    spec.props = spec.props.filter((p) => !toRemove.has(p));
  }
}

// Fisher–Yates with a caller-supplied rand for determinism.
function shuffleInPlace<T>(arr: T[], rand: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
