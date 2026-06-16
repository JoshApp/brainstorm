// The death feed — the voice in the deep noticing a death elsewhere.
//
// Presentation half of the netcode (transport is delve-net.ts). When some
// OTHER delver dies, the watching thing remarks on it: a broadcast pop in
// the cosmic-announcer register (cruel wit, present tense — never the
// in-world grimdark voice). See the Tone Layering section of CLAUDE.md.

import { onDeathElsewhere } from './delve-net';
import { broadcastPop } from '../ui/broadcast-pop';

// The wit, not the fact. The fact (who, how deep) is the title; one of
// these tags is the voice's aside. Present tense, no exclamations, no
// modern slang — it profits from the death either way.
const VOICE_TAGS = [
  'The dark keeps the tally.',
  'You are still here. It notices that too.',
  'The stairs go deeper than they got.',
  'It is patient. With all of you.',
  'One more name for the deep.',
  'It does not mourn. It counts.',
];

function pickTag(): string {
  return VOICE_TAGS[Math.floor(Math.random() * VOICE_TAGS.length)];
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Wire the feed: every death-by-another becomes a line from the deep. */
export function initDeathFeed(): void {
  onDeathElsewhere((d) => {
    const killer = d.killedBy?.trim();
    // Name the cause when we have it ("A ghoul took Vesper, depth 11"),
    // else the plain fall. Old deaths (pre-attribution) carry no cause.
    const title = killer
      ? `${cap(killer)} took ${d.name}, depth ${d.depth}`
      : `${d.name} fell on depth ${d.depth}`;
    broadcastPop(title, pickTag());
  });
}
