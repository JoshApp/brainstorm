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
}

export interface PatchVersion {
  /** Human label — version number or codename. */
  version: string;
  /** ISO yyyy-mm-dd. Converted to absolute at author time (no
   *  relative dates — this is a permanent record). */
  date: string;
  entries: PatchEntry[];
}

/** Newest first. The viewer renders top-to-bottom in this order. */
export const PATCHLOG: PatchVersion[] = [
  {
    version: '0.4',
    date: '2026-05-29',
    entries: [
      { tag: 'content', text: 'Acid spitter — a blue ooze that hangs back and lobs corrosive bolts. Appears from depth 5.' },
      { tag: 'content', text: 'New light sources: iron brazier, cresset pike, and wall cresset.' },
      { tag: 'add', text: 'Light fixtures now share one pool — braziers and pikes can stand in for torches without raising the light budget.' },
      { tag: 'add', text: 'Lantern flame reworked into a layered, flickering flame stack.' },
      { tag: 'add', text: 'Item preview labels hold a fixed size; the blood altar reveals an item’s stats only when you lean in to inspect it.' },
      { tag: 'fix', text: 'Removed the X-shaped wall slivers that appeared in the middle of rooms.' },
      { tag: 'fix', text: 'Stairs no longer clip halfway into side walls, and the stray wall above them is gone.' },
      { tag: 'fix', text: 'Doorways are no longer blocked by a stray wall face; doors now have a proper frame above them.' },
      { tag: 'fix', text: 'Props blocking a corridor are nudged aside; every stairway is now guaranteed reachable.' },
      { tag: 'tune', text: 'Plain vases shatter in a single hit.' },
      { tag: 'tune', text: 'Healing fountains read cleaner — the surrounding candles were removed.' },
      { tag: 'tune', text: 'Brazier and pike placement is quieter and hugs room edges instead of cluttering the centre.' },
      { tag: 'tech', text: 'Off-screen lights are frustum-culled for better mobile performance.' },
    ],
  },
];

/** Most recent version label — handy for a "what’s new" badge or a
 *  title-screen line without pulling the whole log. */
export function latestPatchVersion(): PatchVersion | null {
  return PATCHLOG[0] ?? null;
}
