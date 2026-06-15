// FALLEN DELVERS — the bodies on the floor. Each is someone who came down here
// before you and failed, authored as DATA. Today these are hand-written ghosts;
// the SAME shape is what async multiplayer (Phase 4) will fill with real
// players' deaths — so the spawn/loot/epitaph code reads from this seam, not
// from hardcoded strings, and the source can swap underneath without a rewrite.
//
// Two voices on one body (Tone Layering):
//   - `epitaph`  — IN-WORLD grim text. What the scene says. Whispered, no pause.
//   - `reaction` — the VOICE IN THE DEEP's snark, OPTIONAL, fired when you loot
//                  them. The place is indifferent; the thing that watches is not.

import type { CorpseDecay } from './corpse-model';

export type CorpsePose = 'crawled' | 'curled' | 'slumped';

export interface FallenDelver {
  /** Who they were. Some named, some swallowed by the dark. */
  name: string;
  /** In-world line that whispers up when your lamp finds the body. Terse. */
  epitaph: string;
  /** Body pose variant — see spawnCorpse. */
  pose: CorpsePose;
  /** Decay state. Default 'fleshy'; 'skeletal' = long dead (bone, skull, ribs). */
  decay?: CorpseDecay;
  /**
   * What they died holding. `'roll'` = a depth-appropriate loot roll (most
   * bodies); an item id = that specific thing; omitted = they carried nothing
   * worth taking (pure atmosphere + epitaph).
   */
  carried?: 'roll' | string;
  /** Optional one-off snark from the voice in the deep when you loot them. */
  reaction?: string;
  /**
   * The DEEP read — a longer, in-world account shown on the parchment note when
   * you deliberately READ the body (vs the short epitaph that whispers as you
   * pass). This is the Phase-5 LLM seam: ambient epitaphs stay cheap/cached,
   * but choosing to stop and read is the rare, deliberate moment worth a richer
   * (even live-generated) account. Omitted → the note shows the epitaph alone.
   */
  account?: string;
}

export const FALLEN: FallenDelver[] = [
  {
    name: 'a nameless oblate',
    epitaph: 'Curled here, as if asleep. Not asleep.',
    pose: 'curled',
    carried: 'roll',
  },
  {
    name: 'Corwin Ashfoot',
    epitaph: 'He made it no further than this.',
    account: 'He kept a ledger of every floor he cleared, in a hand that grew worse the deeper it went. The last page is this one. The ink is his.',
    pose: 'crawled',
    carried: 'roll',
    reaction: 'He thought he was the one. They all do.',
  },
  {
    name: 'the Penitent',
    epitaph: 'Knelt to something. It did not kneel back.',
    account: 'Three nights he knelt at the basin and asked to be made clean. On the fourth he stopped asking. The robe was empty when the dark gave it back, and still warm.',
    pose: 'slumped',
    carried: 'roll',
  },
  {
    name: 'Mira of the Hollow Road',
    epitaph: 'She died reaching for the door.',
    account: 'She carried a key to no door anyone living has found. She died with her hand out — an arm’s length of stone between her and whatever it opened.',
    pose: 'crawled',
    carried: 'roll',
    reaction: 'So close. I do enjoy the close ones.',
  },
  {
    name: 'a delver, like you',
    epitaph: 'Hands still around the haft. It did not help.',
    pose: 'slumped',
    carried: 'roll',
    reaction: 'You took the blade from the hand that failed it. Good. Waste nothing.',
  },
  {
    name: 'Brother Vael',
    epitaph: 'No marks on him. The dark is enough.',
    pose: 'curled',
    decay: 'skeletal',
    // Carried nothing — stripped long ago, or came down with empty hands.
  },
  {
    name: 'the Tithed',
    epitaph: 'Whatever she carried, she paid it all.',
    pose: 'slumped',
    carried: 'roll',
  },
  {
    name: 'someone forgotten',
    epitaph: 'Face-down, pointed downward still. Greedy to the last.',
    pose: 'crawled',
    carried: 'roll',
    reaction: 'Another for the count. They never look up.',
  },
  {
    name: 'a child of the surface',
    epitaph: 'Too far from the sky to be found.',
    pose: 'curled',
    decay: 'skeletal',
  },
];

/** Pick a fallen delver. Deterministic given `rand`. */
export function pickFallen(rand: () => number): FallenDelver {
  return FALLEN[Math.floor(rand() * FALLEN.length) % FALLEN.length];
}
