import type { ModelSpec } from '../ecs/model-types';
import { claimsAdmitModel, type Claim } from './prop-taxonomy';

// ── INTENT IN, MODEL OUT ─────────────────────────────────────────────────────
//
// Written answering Josh: *"what if the placement is all about intent and what
// gets rendered is decided by the skinner — the same generator can generate
// different themed floors, models describe themselves, and the building passes
// can say 'I want a light source here' optionally with constraints, and what
// gets put there is up to the skinning resolver."*
//
// Yes, and there is a name for it. In procedural level generation it is the
// SEMANTIC DRESSING split: a placement pass emits *tokens of intent* ("cover
// here", "light here") and a separate dressing pass realises each token from the
// current biome's palette. Structurally it is an Abstract Factory whose products
// are chosen at runtime, and this codebase already has two hand-rolled instances
// of it — `lit-fixture-pool.ts` (one intent, one palette, hardcoded) and the
// `shape → model` switch inside `poly-floor.ts:lightRoom`. Neither can be
// swapped, so neither buys a theme. This is the general version.
//
// ── THE PART THAT MAKES IT BETTER THAN A LOOKUP TABLE ────────────────────────
//
// The naive version is `Record<Intent, ModelSpec>` per theme. It works and it
// rots, because every placer still has to know what fits: is there a wall to
// hang this on, is there headroom, does a lit candle contradict the cobwebs this
// room already committed to? That knowledge migrates into the placers, one
// special case at a time, and the theme table becomes a thing you must keep in
// sync with five call sites.
//
// So the split here is by WHO OWNS THE FACT:
//
//   THE REQUEST owns the SITUATION.  How much floor is free, how much headroom,
//   what the room has already claimed about itself. The placer knows this and
//   nothing else does.
//
//   THE CANDIDATE owns its REQUIREMENTS. How much room it needs, what it asserts
//   about a place (via prop-taxonomy). Intrinsic — true in every theme.
//
//   THE SKIN owns TASTE. Which candidates exist for an intent, and at what
//   weight. That is the only thing a theme actually is.
//
//   THE RESOLVER owns the MATCH, and REFUSES. A candidate that doesn't fit is
//   dropped, not squeezed in. `resolveSkin` returning null is a real answer —
//   "nothing in this palette belongs here" — and callers must handle it.
//
// The payoff is that a theme becomes a DATA FILE. Adding "flooded catacombs"
// means writing a palette, not touching a single placement pass. And the claim
// filter means a theme cannot accidentally contradict itself: ask a desecrated
// room for a light and the tended candles are already gone from the pool.
//
// PURE. No THREE, no scene, rand injected — so a floor's dressing is
// deterministic per seed and a test can swap skins and prove the seam is real.

/**
 * What a pass ASKS FOR. Deliberately coarse: an intent is a role in the room,
 * not a shopping list. If you find yourself wanting `light.wall.torch.iron`, the
 * thing you actually want is a second skin.
 */
export type Intent =
  /** A bracket on a wall. Needs a wall; the caller has already found one. */
  | 'light.wall'
  /** A source standing on the floor. Takes floor space. */
  | 'light.floor'
  /** A glow ON the ground — light without an object. Takes nothing. */
  | 'light.pool'
  /** Light from above. Needs headroom. */
  | 'light.shaft'
  /** Small scatter: sherds, dust, bone. The cheapest "someone was here". */
  | 'debris.small'
  /** The pile that gathers where a floor meets a wall. */
  | 'debris.corner'
  /** Architecture standing in the room. Wants rhythm, not scatter. */
  | 'mass.pillar';

/** What the placer knows about the spot, and nothing else does. */
export interface SkinRequest {
  intent: Intent;
  /**
   * What the room has committed to asserting (prop-taxonomy). A candidate whose
   * own claim contradicts one of these is refused — this is how a merchant's
   * room stops being able to draw a cobweb, at the palette level, rather than by
   * every pass remembering to check.
   */
  claims?: readonly Claim[];
  /** Free radius on the floor, metres. Candidates needing more are refused. */
  footprint?: number;
  /** Headroom, metres. Candidates needing more are refused. */
  headroom?: number;
  /**
   * A colour the request wants carried through, when the candidate is built
   * rather than fixed. Ignored by fixed models — a skin may simply not have a
   * tintable answer, and that is allowed.
   */
  tint?: number;
}

/** One thing a skin can offer, and what it needs to be offered. */
export interface SkinCandidate {
  /**
   * The model, or a builder for the parametric ones (a god ray sized to the
   * ceiling, a floor glow in the requested tint). A builder gets the request so
   * it can honour `tint` and `headroom`.
   */
  model: ModelSpec | ((req: SkinRequest) => ModelSpec);
  /** Relative likelihood within its intent. Default 1. */
  weight?: number;
  /** Floor radius it occupies, metres. Compared against `request.footprint`. */
  needsFootprint?: number;
  /** Headroom it needs to read, metres. Compared against `request.headroom`. */
  needsHeadroom?: number;
  /**
   * Model id used for the claim check, when `model` is a builder and so has no
   * id until it is called. Fixed models are read straight off the spec.
   */
  id?: string;
}

/** A theme. The whole of it — there is nothing else to a skin but its taste. */
export interface Skin {
  id: string;
  /** For debug overlays and the audit. */
  name: string;
  palette: Partial<Record<Intent, readonly SkinCandidate[]>>;
}

function candidateId(c: SkinCandidate): string | null {
  if (c.id) return c.id;
  return typeof c.model === 'function' ? null : c.model.id;
}

/** Does this candidate fit the situation the request describes? */
function admits(c: SkinCandidate, req: SkinRequest): boolean {
  if (c.needsFootprint !== undefined && req.footprint !== undefined
      && c.needsFootprint > req.footprint) return false;
  if (c.needsHeadroom !== undefined && req.headroom !== undefined
      && c.needsHeadroom > req.headroom) return false;
  // A builder with no declared id asserts nothing — a god ray and a floor glow
  // are light, not evidence, and have no business being filtered by a room's
  // story. Fixed models go through the real taxonomy.
  const id = candidateId(c);
  if (id && req.claims?.length && !claimsAdmitModel(req.claims, id)) return false;
  return true;
}

/**
 * Ask a skin for something to put here.
 *
 * Returns null when nothing in the palette fits — a REAL answer, not a failure.
 * A room with 1.4m of headroom genuinely cannot host a shaft, and the honest
 * response is an empty spot rather than a shaft jammed into a crawlspace. Every
 * caller must have somewhere to go when the answer is nothing; if you don't,
 * you wanted a guarantee and this is the wrong tool for it.
 */
export function resolveSkin(
  skin: Skin,
  req: SkinRequest,
  rand: () => number,
): ModelSpec | null {
  const pool = (skin.palette[req.intent] ?? []).filter((c) => admits(c, req));
  if (pool.length === 0) return null;
  const total = pool.reduce((s, c) => s + (c.weight ?? 1), 0);
  let roll = rand() * total;
  let chosen = pool[pool.length - 1];
  for (const c of pool) { roll -= c.weight ?? 1; if (roll <= 0) { chosen = c; break; } }
  return typeof chosen.model === 'function' ? chosen.model(req) : chosen.model;
}

/** Everything a skin can answer at all. Used by the audit to report a palette's
 *  coverage, so a half-written theme is visible rather than silently thin. */
export function skinCoverage(skin: Skin): readonly Intent[] {
  return (Object.keys(skin.palette) as Intent[])
    .filter((i) => (skin.palette[i] ?? []).length > 0);
}
