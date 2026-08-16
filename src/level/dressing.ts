// ── THE DRESSING MANIFEST — what a room gets for free ────────────────────────
//
// Josh, 2026-08-16: *"i would like to get rid of things and simplify things and
// then rebuild it kinda... basically lets start with a simple room and then fill
// it intentional this time."*
//
// The word doing the work there is INTENTIONAL. Until now a room's contents were
// the sum of about seventeen independent producers, each with its own count
// formula and its own dice, spread across three files. No one of them was wrong.
// Together they meant nobody — not Josh, not a future content layer, not the
// session that wrote half of them — could answer "what is actually in this room,
// and who decided that" without reading every producer in the chain. A room
// filled by seventeen anonymous votes cannot be filled intentionally, because
// there is no seat at the table where the intent would go.
//
// So: ONE LIST. Every automatic dressing producer in the game is named here with
// an on/off and the reason it is set that way. Turning the dungeon down to bare
// stone is a data edit; turning a piece back on is a data edit AND a decision
// somebody wrote down. That is the whole point — the note field is not a comment,
// it is the record of why this thing is allowed in a room.
//
// ── WHAT THIS IS NOT ────────────────────────────────────────────────────────
//
// NOT a budget, and deliberately not. The v3 floor-content plan (a per-floor
// combat/feature/event budget) is a different and larger idea that belongs to the
// generator, not to the decorator; this file has no counts in it and should never
// grow any. It answers one question — MAY this producer run — and leaves how much
// and where exactly where they already live.
//
// NOT a skin or a palette. WHAT a piece of debris is made of is the skin's
// business (docs/LEVEL-ARCHITECTURE.md §9). Whether the floor gets scattered
// debris at all is this file's.
//
// NOT the placement authority. Whether a prop FITS — occupancy, clearance, claim
// contradictions — is placement-authority.ts and prop-taxonomy.ts, untouched.
// A producer switched on here still has to earn its spot the usual way.
//
// ── HOW TO REBUILD FROM HERE ────────────────────────────────────────────────
//
// Turn ONE thing on. Look at a floor. Decide whether the room is better with it
// than without it. Write down which, in the note. That is the loop this file
// exists to make cheap, and it is the loop that was impossible when the answer
// to "why is there a fallen pillar here" was "because area >= 50".

/** One automatic dressing producer. */
export interface DressingEntry {
  /** Is this producer allowed to run at all? */
  on: boolean;
  /** WHY it is set the way it is. Load-bearing: this is the record of the
   *  decision, and a flag flipped without one is the thing this file exists to
   *  stop happening. */
  note: string;
}

/**
 * Every automatic dressing producer, by id.
 *
 * The ids are the producer's name, not the model's — several of these deal from
 * a skin pool and place a different model every time.
 */
export const DRESSING: Record<string, DressingEntry> = {
  // ── ROOM: structural (things that change the room's silhouette) ────────────
  'corner-mound': {
    on: false,
    note: 'Silt slumping out of a corner. Cut in the 2026-08-16 strip: it is the '
      + 'single most-placed mass in the game and it says nothing — every corner of '
      + 'every room slowly filling with the same drift.',
  },
  'wall-buttress': {
    on: false,
    note: 'Floor-to-ceiling column against a wall. Cut by name — Josh, 2026-08-16: '
      + '"lets get rid of the butresses." It was authored when a wall was a flat '
      + 'plane and needed something to break its silhouette; the masonry does that '
      + 'itself now, and a buttress against a wall that already reads as built is '
      + 'just a box in the way.',
  },
  'ossuary-niche': {
    on: false,
    note: 'Bone shelf set into a wall, the large one searchable. Off in the strip. '
      + 'A real beat and a candidate to come back FIRST when rebuilding — it is the '
      + 'one wall piece here that is a place rather than a texture.',
  },
  'ruined-column': {
    on: false,
    note: 'Chest-high broken column, free-standing, blocks a walk. Off in the '
      + 'strip: an obstacle nobody chose to put there.',
  },
  'fallen-pillar': {
    on: false,
    note: 'The piece that fell off a column, lying on the floor, dashable. Off with '
      + 'the column it was telling a story about — half a story is worse than none.',
  },
  'light-accent': {
    on: false,
    note: 'A brazier or cresset in a big room with no centrepiece. Off in the strip, '
      + 'and this one is doctrine as much as taste: an uncommon light is supposed to '
      + 'mean something is happening there (CLAUDE.md, "Lighting as signal"), and a '
      + '22% roll in any room over 50m2 is decoration wearing a signal costume.',
  },
  'wall-pile': {
    on: false,
    note: 'Rubble slumped at the foot of a wall, leaning into the room. Kept in the '
      + 'first cut of the strip — Josh, 2026-08-16: "leave the kinda broken wall '
      + 'pieces on the bottom" — and then cut an hour later, same day: "also get rid '
      + 'of wall piles sorry lets start new with geometry." The second call is the '
      + 'one that matters and it is a different decision, not a correction: broken '
      + 'stone at the foot of a wall is something the WALL should do, in its own '
      + 'geometry, not a prop leaned against it afterwards.',
  },

  // ── SHELL TRIM (built by the room shell itself, not by a decorator) ───────
  //
  // These three are not props. They are emitted by the room SHELL — poly-dressing.ts
  // for polygon rooms, builder's trimSegment for rects — which is why turning off
  // every producer in the strip left them standing and Josh had to point at a
  // screenshot: *"remove the butresses and lower untextured strips."* They are
  // still automatic dressing nobody asked a room for, so they belong on this list
  // with everything else rather than in a second, invisible one.
  'shell-coursing': {
    on: false,
    note: 'PER-COURSE DEPTH in the wall face — every course of every wall pushed '
      + 'proud or recessed by a random amount, with a step quad between courses, a '
      + 'slow bow across the span, and a handful of single blocks left standing '
      + 'proud. Cut by name: Josh, 2026-08-16, "get rid of the banding in the wall '
      + 'shell, where it displaces bands with different offsets etc. because that '
      + 'isnt properly built, i wanna have clean walls for the start."\n'
      + 'This is the LAST of the three systems that were each independently giving '
      + 'a wall depth — the profile bands (wall-profile.ts, now plain), the shell '
      + 'trim (now off), and this. All three were authored when the wall was a flat '
      + 'plane with a painted pattern and geometry was the only way to get a shadow '
      + 'line onto it. The masonry displaces itself now, so all three were arguing '
      + 'with it at a coarser scale.\n'
      + 'OFF DOES NOT MEAN GONE. makeCoursedWall still runs and still emits the '
      + 'same tessellation, which the wall-contact and prop-contact AO passes need '
      + 'vertices for; it just builds the face at depth zero. The steps and the '
      + 'proud blocks stop being emitted at all, so this is fewer triangles rather '
      + 'than more.',
  },
  'shell-pilaster': {
    on: false,
    note: 'ENGAGED PIERS — the vertical dressed-stone strips standing against a '
      + 'wall. The "buttresses" in the screenshot: the prop buttress had already '
      + 'gone, these had not, and from inside a room they read the same. Authored '
      + 'when a wall was a flat plane that needed vertical relief; the masonry '
      + 'supplies that now, and a smooth pale strip over textured stone reads as '
      + 'untextured rather than as architecture.',
  },
  'shell-skirting': {
    on: false,
    note: 'The base course where wall meets floor — the "lower untextured strips". '
      + 'Same argument as the plinth band in wall-profile.ts, which went for the '
      + 'same reason on the same day: it was the only source of a shadow line at '
      + 'the floor joint, and it is not any more.',
  },
  'shell-cornice': {
    on: false,
    note: 'The band where wall meets ceiling. Its own entry rather than sharing the '
      + 'skirting flag, because it is a different decision — it is far from the eye '
      + 'and does not read as untextured the way the skirting does, so it is the '
      + 'more likely of the two to come back. Off for now because keeping a cornice '
      + 'while cutting the skirting leaves a room banded at the top only.',
  },
  'wall-collapse': {
    on: false,
    note: 'THE COLLAPSED PATCH — a cluster of missing stones with the rubble they '
      + 'left heaped at the foot of the wall. Cut by name: Josh, 2026-08-16, "also '
      + 'the kinda rubble at the base of walls." Note this is SHELL geometry, not '
      + 'the wall-pile prop, which is a separate entry and also off — two producers '
      + 'were putting broken stone at the bottom of a wall and both had to be found. '
      + 'Worth bringing back deliberately one day: the hole and the rubble under it '
      + 'are one authored idea (wall-courses.ts: "a hole with no rubble is a '
      + 'texture; rubble with no hole is a prop somebody put there").',
  },

  // ── ROOM: surface (things scattered on top of the room) ────────────────────
  'floor-debris': {
    on: false,
    note: 'Edge-biased scatter, ~1 per 14m2, dealt round-robin from the skin. Off '
      + 'in the strip. The most numerous producer in the game by a wide margin.',
  },
  'floor-crack': {
    on: false,
    note: 'Decal cracks, ~1 per 20m2. Off in the strip — the floor stone cracks and '
      + 'chips in its own height field now, so this is a second crack rhythm laid '
      + 'over one that is already there.',
  },
  'cobweb-corner': {
    on: false,
    note: 'Faint webs slung in room corners, destructible. Off in the strip.',
  },
  'wall-damage': {
    on: false,
    note: 'Scorches and gouges stamped high on a clear wall (1.1-1.7m). Off in the '
      + 'strip, and note this is NOT the "broken wall pieces" Josh kept — those are '
      + 'wall-pile, down at the floor. This is a mark on the face.',
  },

  // ── CORRIDOR ──────────────────────────────────────────────────────────────
  'corridor-debris': {
    on: false,
    note: 'A couple of pieces per 3m of corridor, pushed to the walls. Off in the '
      + 'strip. A corridor is a transition; it reads better empty than dressed.',
  },
  'corridor-beats': {
    on: false,
    note: 'The corridor BEAT system — a gouge, a set of iron bars, a niche, a drag '
      + 'smear staged along a passage against its squeeze/pass/promise intent. Off '
      + 'in the strip with the rest of the corridor dressing. The most sophisticated '
      + 'producer here by a distance and the one most worth bringing back '
      + 'deliberately: it is the only decorator in the game that reasons about what '
      + 'a stretch of dungeon is FOR.',
  },
  'corridor-crack': {
    on: false,
    note: 'One crack per corridor over 3m. Off with the room cracks, same reason.',
  },

  // ── FLOOR-LEVEL BEATS (once per floor, not per room) ──────────────────────
  'decor-corpse': {
    on: false,
    note: 'The decorative fallen delver — 7% of floors, no loot, pure story. Cut by '
      + 'name: Josh, 2026-08-16, "the dead delvers." NOTE THE SCOPE: this is the '
      + 'DECOR corpse only. The loot-director\'s searchable corpse is a loot anchor '
      + '(removing it removes loot) and network bloodstains are real other-player '
      + 'deaths — the async-multiplayer pillar. Neither is touched by this flag.',
  },
  'bone-shrine': {
    on: false,
    note: 'A corpse arranged by somebody, with a candle. Off with the decor corpse — '
      + 'it is the same beat with staging, so keeping it would half-honour the cut.',
  },
  'origin-arch': {
    on: false,
    note: 'The sealed double doors behind the spawn on every descent — the way you '
      + 'came in, shut at your back. Cut by name: Josh, 2026-08-16, "lets get rid of '
      + 'the door that spawns in each floors first room when you descend, we want '
      + 'clean rooms." It is a good beat and it is not clutter, but it is a piece of '
      + 'architecture nobody asked the room for, standing in the one room the player '
      + 'looks at hardest.',
  },
  'wall-rune': {
    on: true,
    note: 'KEPT. A glyph scrawled on the longest wall, revealed by the lamp. Not '
      + 'clutter: it is the lamp-reveal discovery surface, it costs no floor space, '
      + 'and some of them lie. This is content, and Josh did not name it.',
  },
  'mouth-cobweb': {
    on: true,
    note: 'KEPT. A web curtain across the mouth of a DEAD END only, one swing to '
      + 'clear. Not clutter: it gates a detour you chose, and the dead-end fence is '
      + 'the hardest in poly-decor.ts for a measured reason (a web on a through-room '
      + 'put 85% of a floor behind it).',
  },
};

/**
 * May this dressing producer run?
 *
 * Unknown ids return TRUE. A producer added later and not yet listed keeps
 * working — the manifest is a place to make decisions, not a gate that silently
 * swallows new work because somebody forgot to register it. (The test pins that
 * every id used in the codebase IS listed, which is the right place to catch it.)
 */
export function dressing(id: string): boolean {
  return DRESSING[id]?.on ?? true;
}

/** Ids currently switched on — for debug readouts and the floor report. */
export function dressingOn(): string[] {
  return Object.keys(DRESSING).filter((k) => DRESSING[k].on);
}
