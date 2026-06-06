// Patch log — what the player reads on the title screen, newest first.
//
// AUTHORED, NOT INFERRED. Every entry's `text` is written by Claude at
// commit time as a `Patch-summary` trailer in the broadcast voice
// (cosmic-announcer / DCC tribute) — present tense, terse, fourth-
// wall-aware. The generator at scripts/gen-patchlog.ts assembles the
// log from those trailers; it doesn't parse subjects or guess tags
// for un-trailered commits.
//
// The layered LLM authorship paradigm in action: the narration layer
// (Claude, today) produces the player-facing text at COMMIT TIME, the
// build pipeline collates it, the screen displays it. No runtime LLM
// call needed for the log — Phase 5's planned "announcer transform"
// already happened when the commit was written.
//
// See CLAUDE.md "Commit message format" for the contract + voice
// guidance future Claude sessions read.

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
