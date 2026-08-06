import type { PropSpec } from './types';

// ── WHAT A PROP IS, BEYOND ITS PHYSICS ───────────────────────────────────────
//
// Written 2026-08-05 answering Josh: *"about things like cobwebs, candles,
// pillars, general decoration — I don't know how we can class these props so the
// generator knows where and when to use them. I feel like if we do this right it
// can evolve into something that can craft procedural rooms that are not
// boring."*
//
// See docs/LEVEL-ARCHITECTURE.md §5 for the full argument. The short version is
// that a prop has THREE orthogonal properties and we modelled one:
//
//   1. PHYSICS  — does it block movement or sight?  → placement-authority.ts
//                 (PlaceKind). Already correct; untouched by this file.
//   2. ROLE     — what it is to the room's SHAPE. A mass is architecture, a
//                 furnishing is an object someone put there, a trace is evidence.
//   3. CLAIM    — what its presence ASSERTS about the room.
//
// ── WHY CLAIM IS THE ONE THAT MATTERS ────────────────────────────────────────
//
// Every prop implicitly makes a claim. A lit candle says SOMEONE IS HERE. A
// cobweb says NOBODY HAS BEEN, for a long time. Those two statements cannot both
// be true, and a room containing both stops meaning anything — it becomes a bag
// of props rather than a place.
//
// That is exactly the reported bug "the merchant stands inside his own cobwebs".
// It was patched with a feature apron, and the apron was a reasonable patch, but
// distance was never the fault: a living vendor (tended) and webs (abandoned)
// should not have been in the same room at ANY separation.
//
// The rule this file exists to enforce:
//
//   > A room commits to one or two CLAIMS, and only admits props that support
//   > them.
//
// That single constraint is the difference between a room built from independent
// random draws and a room that reads as evidence for one story. Same generator,
// same prop count, completely different read — because everything in it agrees.
//
// ── WHY ROLE MATTERS TOO ─────────────────────────────────────────────────────
//
// Today a pillar and a cobweb are both "props" and both get scattered by a
// decoration pass. That conflation IS the "hand-authored rooms grow random
// pillars" complaint: a MASS is a composition decision being made by a
// decoration pass. Naming the role is the first step to moving masses back where
// they belong (the FIT stage — docs/LEVEL-ARCHITECTURE.md §4).

/** What a prop is to the room's SHAPE. */
export type PropRole =
  /** Architecture. Reads as structure and wants rhythm, not scatter: pillars,
   *  statues, fallen columns, rubble banks, buttresses. Belongs to the
   *  composition, not the decorator. */
  | 'mass'
  /** An object someone deliberately put here. Implies agency: braziers, vases,
   *  benches, niches. */
  | 'furnishing'
  /** Evidence of history. Never structural, and the cheapest way to make a room
   *  feel used: webs, stains, scorch, dust, bones, cracks. */
  | 'trace';

/** What a prop's presence ASSERTS about the room. */
export type Claim =
  | 'tended'      // someone is here, or was recently
  | 'abandoned'   // nobody has been here in a long time
  | 'desecrated'  // something happened here, and it was bad
  | 'flooded'     // water got in and stayed
  | 'burned';     // fire came through

export const ALL_CLAIMS: readonly Claim[] = [
  'tended', 'abandoned', 'desecrated', 'flooded', 'burned',
];

/**
 * Which claims cannot coexist.
 *
 * MUST be symmetric — if tended contradicts abandoned then abandoned contradicts
 * tended, and a one-sided entry would make admission depend on which prop was
 * asked about first. A test pins the symmetry rather than trusting the table.
 *
 * Note what is deliberately NOT here: abandoned/desecrated coexist happily (a
 * ransacked shrine nobody has returned to), and burned/abandoned likewise. Only
 * genuine contradictions belong, or the rule starves rooms of props.
 */
const CONTRADICTS: Record<Claim, readonly Claim[]> = {
  tended:     ['abandoned', 'desecrated', 'flooded', 'burned'],
  abandoned:  ['tended'],
  desecrated: ['tended'],
  flooded:    ['tended', 'burned'],
  burned:     ['tended', 'flooded'],
};

export interface PropFacts {
  role: PropRole;
  /** What this prop asserts. Empty = asserts nothing, admitted anywhere. */
  claims: readonly Claim[];
}

/** Neutral: structural or functional things that assert nothing about the room's
 *  history and must never be filtered out. */
const NEUTRAL_MASS: PropFacts = { role: 'mass', claims: [] };
const NEUTRAL_FURNISHING: PropFacts = { role: 'furnishing', claims: [] };

// ── THE TABLE ────────────────────────────────────────────────────────────────
//
// Keyed by ModelSpec id, because that is what a `kind: 'model'` prop actually
// carries — the decorators emit `{ kind: 'model', model: RUBBLE_CHUNK }`, so
// `p.kind` is the literal string 'model' for nearly all clutter. (Worth knowing:
// placement-authority's own DECOR_KINDS set keys on `p.kind` and therefore never
// matches any of these; see propPlaceKindHint below.)
const BY_MODEL_ID: Record<string, PropFacts> = {
  // ── masses: architecture, wants rhythm ──
  'ruined-column':          { role: 'mass', claims: ['abandoned'] },
  'fallen-pillar-segment':  { role: 'mass', claims: ['abandoned'] },
  'wall-buttress':          NEUTRAL_MASS,
  'corner-mound':           { role: 'mass', claims: ['abandoned'] },
  'corner-mound-large':     { role: 'mass', claims: ['abandoned'] },
  'corner-mound-small':     { role: 'mass', claims: ['abandoned'] },
  'wall-pile':              { role: 'mass', claims: ['abandoned'] },
  'iron-bars':              NEUTRAL_MASS,

  // ── furnishings: someone put this here ──
  'iron-brazier':           { role: 'furnishing', claims: ['tended'] },
  // NEUTRAL, unlike its small siblings. A monumental brazier is a RITUAL
  // FIXTURE, not housekeeping — a boss hall burning one is telling you this is a
  // place of importance, which is a different assertion from a lit candle in a
  // corridor saying somebody comes through here. Classifying it 'tended' made
  // every hand-authored boss hall argue with its own floor debris: measured at
  // 40 of 220 depth-3 rooms, ALL of them this prop.
  'great-brazier':          { role: 'furnishing', claims: [] },
  'cresset-pike':           { role: 'furnishing', claims: ['tended'] },
  // ── WALL BRACKETS ARE ARCHITECTURE, NOT HOUSEKEEPING ──
  //
  // Both of these were 'tended' — a burning fixture says someone keeps it lit —
  // and the reasoning is the same one the great brazier below already overturned
  // once. Measured the moment the skin resolver started consulting this table:
  // 42 of 1308 polygon rooms contradicted themselves, every single case a wall
  // bracket arguing with a cobweb or a body on the floor.
  //
  // The rule that resolves it, and it is the same rule as the brazier's:
  // PORTABLE OR PLACED asserts tending; ARCHITECTURAL does not. A candle
  // somebody set down, a brazier somebody dragged in — those are housekeeping. A
  // bracket bolted into the masonry is part of the building, and in a dungeon
  // whose baseline is torchlight (CLAUDE.md, "the player's lamp is the
  // baseline") it is not evidence of anything. Otherwise every lit room in the
  // game is tended and NO room can ever be abandoned — which makes the whole
  // claim vocabulary a single value.
  //
  // The stub keeps its claim, because a bracket with no fire left IS evidence.
  'wall-cresset':           NEUTRAL_FURNISHING,
  'wall-torch':             NEUTRAL_FURNISHING,
  'wall-stub':              { role: 'furnishing', claims: ['abandoned'] },   // a cresset with no fire left
  'ossuary-niche':          { role: 'furnishing', claims: [] },              // a charnel house is TENDED by its own lights
  'ossuary-niche-small':    { role: 'furnishing', claims: [] },
  'vase-tall':              NEUTRAL_FURNISHING,
  'vase-squat':             NEUTRAL_FURNISHING,
  'vase-flask':             NEUTRAL_FURNISHING,
  'vase-broken':            { role: 'furnishing', claims: ['desecrated'] },
  'broken-planks':          { role: 'furnishing', claims: ['abandoned'] },

  // ── traces: evidence, never structural ──
  'cobweb-corner':          { role: 'trace', claims: ['abandoned'] },
  'cobweb-barrier':         { role: 'trace', claims: ['abandoned'] },
  'bone-pile':              { role: 'trace', claims: ['desecrated'] },
  'ash-mound':              { role: 'trace', claims: ['burned'] },
  'wall-scorch':            { role: 'trace', claims: ['burned'] },
  'sand-drift':             { role: 'trace', claims: ['abandoned'] },
  'rubble-chunk':           { role: 'trace', claims: [] },
  'stone-shards':           { role: 'trace', claims: [] },
  'floor-crack':            { role: 'trace', claims: [] },
  'wall-gouge':             { role: 'trace', claims: ['desecrated'] },
  'lurker':                 { role: 'trace', claims: [] },
};

/** Keyed by PropSpec.kind, for props that aren't models. */
const BY_KIND: Record<string, PropFacts> = {
  vase:          NEUTRAL_FURNISHING,
  'vase-cluster': NEUTRAL_FURNISHING,
  cobweb:        { role: 'trace', claims: ['abandoned'] },
  pillar:        NEUTRAL_MASS,
  torch:         { role: 'furnishing', claims: ['tended'] },
};

/**
 * What this prop is, or null if it isn't classified.
 *
 * NULL MEANS "NOT MINE", AND IS ALWAYS ADMITTED. Events, stairs, spawns, loot
 * and anything else the room's PLAN put there are not decoration and must never
 * be filtered by a decoration rule — a claim conflict is a reason not to add a
 * cobweb, never a reason to delete the merchant.
 */
export function propFacts(prop: PropSpec): PropFacts | null {
  const kind = (prop as { kind?: string }).kind;
  if (kind === 'model') {
    const id = (prop as { model?: { id?: string } }).model?.id;
    return id ? BY_MODEL_ID[id] ?? null : null;
  }
  return kind ? BY_KIND[kind] ?? null : null;
}

/** Do these two claims conflict? Order-independent by construction. */
export function claimsConflict(a: Claim, b: Claim): boolean {
  return CONTRADICTS[a].includes(b) || CONTRADICTS[b].includes(a);
}

/**
 * May a room holding `roomClaims` admit this prop?
 *
 * Unclassified props and props that assert nothing are always admitted — the
 * rule only ever REFUSES a prop that would contradict the room's story.
 */
export function roomAdmits(roomClaims: readonly Claim[], prop: PropSpec): boolean {
  const facts = propFacts(prop);
  if (!facts || facts.claims.length === 0) return true;
  for (const pc of facts.claims) {
    for (const rc of roomClaims) {
      if (claimsConflict(pc, rc)) return false;
    }
  }
  return true;
}

/** Same question, for a producer that knows the model id but hasn't built the
 *  PropSpec yet — so it can pick a different variant instead of placing and
 *  being refused. */
export function claimsAdmitModel(roomClaims: readonly Claim[], modelId: string): boolean {
  const facts = BY_MODEL_ID[modelId];
  if (!facts || facts.claims.length === 0) return true;
  return !facts.claims.some((pc) => roomClaims.some((rc) => claimsConflict(pc, rc)));
}

/**
 * The placement kind a classified prop SHOULD have, from its role.
 *
 * placement-authority.ts classifies by `PropSpec.kind`, which is the literal
 * 'model' for every decorator prop — so its DECOR_KINDS set currently matches
 * none of them and they all default to 'blocker'. That default is safe (an
 * unknown prop is kept out of an event's apron) but it is not right: a scattering
 * of bone dust is not a pillar. This is the bridge, so the two files agree on one
 * classification instead of keeping two.
 */
export function propPlaceKindHint(prop: PropSpec): 'blocker' | 'decor' | null {
  const facts = propFacts(prop);
  if (!facts) return null;
  // A mass is the thing that must stay out of an event's apron. A trace is flat
  // evidence you walk over. A furnishing is small and floor-standing — decor,
  // because dressing an event with one is the point.
  return facts.role === 'mass' ? 'blocker' : 'decor';
}

/**
 * What a room's claims ARE, given whatever its type declared.
 *
 * A type that declares claims fixes them (a shop is tended because a living
 * vendor stands in it). A type with no opinion draws ONE from the dungeon's
 * palette — which is deliberately most rooms, because a plain combat room
 * reading as burned on one floor and flooded on the next is most of where room
 * variety comes from, and it costs no authoring.
 *
 * **`tended` is never drawn.** It is the one claim that asserts a living
 * presence, so it may only ever arrive from identity — a vendor, a kept sanctum.
 * A randomly-tended room is a room that lies about someone being there, and the
 * player would learn to stop reading the signal.
 */
export function resolveRoomClaims(
  declared: readonly Claim[] | undefined,
  rand: () => number,
): readonly Claim[] {
  if (declared && declared.length) return declared;
  // Weighted toward ABANDONED: that is the dungeon's baseline state, and a
  // baseline only reads as one when most rooms are it.
  const roll = rand();
  if (roll < 0.56) return ['abandoned'];
  if (roll < 0.78) return ['desecrated'];
  if (roll < 0.90) return ['burned'];
  return ['flooded'];
}
