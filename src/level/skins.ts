import type { Skin } from './skin';
import { WALL_TORCH } from '../content/torch';
import { WALL_CRESSET, IRON_BRAZIER, CRESSET_PIKE, floorGlow } from '../content/light-props';
import { godRay } from '../content/god-ray';
import {
  RUBBLE_CHUNK, ASH_MOUND, STONE_SHARDS, IRON_BARS,
  CORNER_MOUND, CORNER_MOUND_LARGE, CORNER_MOUND_SMALL, LURKER,
  WALL_SCORCH, WALL_GOUGE,
} from '../content/clutter';

// ── THE SKIN CATALOG ─────────────────────────────────────────────────────────
//
// A theme is a palette and nothing else (see skin.ts for why). This file is the
// whole of DELVE's set-dressing taste, and it is DATA — the content layer can
// retune what the dungeon is made of without opening a placement pass.
//
// ── ONE SKIN, DELIBERATELY ───────────────────────────────────────────────────
//
// There is exactly one skin here today and it reproduces the current dungeon
// exactly. That is the point of the first pass: the seam is what shipped, not a
// look nobody asked for. A second theme is a data-only change to this file, and
// tests/skin.test.ts builds a throwaway one to prove that claim rather than
// asserting it.
//
// When a second skin does land, the thing to keep honest is COVERAGE. A palette
// missing an intent isn't a subtler theme, it's a room with a hole in it —
// `resolveSkin` returns null and the caller falls back to nothing. `delve skins`
// prints coverage for exactly this reason.

/**
 * THE CRYPT — worked stone, iron, fire. The dungeon as it stands.
 *
 * Weights match what shipped: the wall pool has always been 75/25 torch/cresset
 * (lit-fixture-pool.ts), and the floor and overhead intents had exactly one
 * answer each because they were hardcoded call sites rather than choices.
 */
export const CRYPT_SKIN: Skin = {
  id: 'crypt',
  name: 'The Crypt',
  palette: {
    // Brackets. Torch-heavy so the cresset stays a silhouette break rather than
    // the new default — the reasoning lit-fixture-pool.ts has carried all along.
    'light.wall': [
      { model: WALL_TORCH, weight: 75 },
      { model: WALL_CRESSET, weight: 25 },
    ],
    // Standing sources. The brazier is the squat one and fits anywhere a light
    // was going to go; the pike is tall and thin, so it needs headroom the
    // brazier doesn't and reads badly in a crawlspace.
    'light.floor': [
      { model: IRON_BRAZIER, weight: 70, needsFootprint: 0.45 },
      { model: CRESSET_PIKE, weight: 30, needsFootprint: 0.3, needsHeadroom: 2.4 },
    ],
    // A glow on the ground: light without an object. Tintable, takes no space,
    // and asserts nothing about the room — light is not evidence.
    'light.pool': [
      { model: (req) => floorGlow(req.tint ?? 0x6cc6e0) },
    ],
    // From above. A shaft in a low room reads as a mistake, so the headroom
    // requirement is real — SHAFT_MIN_HEIGHT in light-plan.ts already refuses
    // these, and this is the same rule stated where the model is chosen.
    'light.shaft': [
      { model: (req) => godRay({ tint: req.tint, ceilingHeight: req.headroom ?? 3.2 }),
        needsHeadroom: 3.6 },
    ],
    // Scatter on the floor. Dealt ROUND-ROBIN by the debris pass rather than
    // rolled (see skinCandidates), so these carry no weights — the order in this
    // list is the only thing that survives, and it is shuffled per room anyway.
    'debris.small': [
      { model: RUBBLE_CHUNK },
      { model: ASH_MOUND },
      { model: STONE_SHARDS },
      { model: IRON_BARS },
    ],
    // Marks on the masonry. Flat, so no footprint and no headroom to check —
    // the whole candidate is its id.
    'wall.damage': [
      { model: WALL_SCORCH },
      { model: WALL_GOUGE },
    ],
    // The pile that gathers where a floor meets a wall. Weighted: small is the
    // common case and large is the punctuation.
    //
    // The LURKER's 0.4 against a ~10 sum is about 4% per corner slot. A session
    // of 15-30 rooms sees one or two, and the goal is not a jump scare — it is
    // the paranoia of "was that there before?".
    'debris.corner': [
      { model: CORNER_MOUND_SMALL, weight: 5 },
      { model: CORNER_MOUND, weight: 4 },
      { model: CORNER_MOUND_LARGE, weight: 1 },
      { model: LURKER, weight: 0.4 },
    ],
  },
};

/** Every skin the game knows. Keyed by id so a URL flag or a floor spec can name
 *  one; today the map exists so adding the second theme is an entry, not a
 *  refactor. */
export const SKINS: Readonly<Record<string, Skin>> = {
  [CRYPT_SKIN.id]: CRYPT_SKIN,
};

/**
 * The skin in force. A single module-level value rather than something threaded
 * through every pass — matching the codebase's module-state convention, and
 * honest about the fact that a floor has ONE theme at a time.
 */
let active: Skin = CRYPT_SKIN;

export function activeSkin(): Skin { return active; }

/**
 * Swap the theme, by catalog id or by handing one over directly.
 *
 * The object form is not a test hook bolted on: a floor spec, an act, or a
 * one-off signature vault has every reason to carry its own palette without
 * first being entered in the global catalog. An unknown id falls back to the
 * crypt rather than leaving `active` undefined — with no skin, every request
 * returns null and the whole dungeon quietly goes dark.
 */
export function setActiveSkin(skin: string | Skin): void {
  active = typeof skin === 'string' ? (SKINS[skin] ?? CRYPT_SKIN) : skin;
}
