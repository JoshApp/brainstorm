// Patch log — the raw, factual record of what changed, newest first.
//
// THIS IS DATA, NOT VOICE. Every entry here is terse and literal: what
// changed, no flavour, no announcer snark. That's deliberate and it
// mirrors how the rest of the game is built —
//
//   raw event/record now  →  presentation derived from it later
//
// Phase 5 (the LLM layer) will read this same structure and TRANSFORM
// it into the cosmic-announcer voice for an in-game "dispatches" feed
// ("Patch 0.4.1: the braziers have stopped eating you. The dungeon
// regrets nothing."). The wiki / changelog export reads the same data.
// Keep entries factual so the transform has clean material to work
// from — the voice is a VIEW over this log, never baked into it.
//
// Authoring: add a new PatchVersion at the TOP of PATCHLOG for each
// shippable batch. Keep each entry to one line. Pick the closest tag.

export type PatchTag = 'add' | 'fix' | 'tune' | 'content' | 'tech';

export interface PatchEntry {
  tag: PatchTag;
  /** Factual, terse, player-readable. No voice. */
  text: string;
  /** Optional system tags from a commit's `Patch-area` trailer
   *  (combat, ui, level, etc.). Used by future filtered views — the
   *  in-game patchlog screen doesn't render this today. */
  area?: readonly string[];
}

export interface PatchVersion {
  /** Human label — version number or codename. */
  version: string;
  /** ISO yyyy-mm-dd. Converted to absolute at author time (no
   *  relative dates — this is a permanent record). */
  date: string;
  entries: PatchEntry[];
}

import { GENERATED_PATCHLOG } from './patchlog.generated';

// The log is AUTO-GENERATED from the git history by
// scripts/gen-patchlog.ts (runs on every build via the package.json
// "prebuild" hook). To change what appears here, write good commit
// subjects — the generator groups commits by day into "Build N"
// versions, infers a tag per commit, and filters housekeeping.
//
// Manual highlights (optional): anything in MANUAL_HIGHLIGHTS is
// prepended ABOVE the generated builds — use it for a curated
// "what's new" banner when a release deserves more than the raw
// commit subjects. Empty by default; the generated log stands alone.
const MANUAL_HIGHLIGHTS: PatchVersion[] = [];

/** Newest first. The viewer renders top-to-bottom in this order. */
export const PATCHLOG: PatchVersion[] = [
  ...MANUAL_HIGHLIGHTS,
  ...(GENERATED_PATCHLOG as unknown as PatchVersion[]),
];

/** Most recent version label — handy for a "what’s new" badge or a
 *  title-screen line without pulling the whole log. */
export function latestPatchVersion(): PatchVersion | null {
  return PATCHLOG[0] ?? null;
}
