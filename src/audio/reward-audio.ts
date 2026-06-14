// Reward audio — the one place that turns reward EVENTS into sound. Subscribes
// to the broadcast bus so the effect/state code stays sound-agnostic (it just
// emits gold:absorbed / level:up). Keeps "noticeable without overwhelming":
//   · coins CASCADE — rapid pickups climb a semitone each, so a haul reads as a
//     pleasant rising stream, not a flat machine-gun of identical clinks;
//   · level-up gets a single restrained resonant swell.

import { on } from '../broadcast/event-bus';
import { playCoin, playLevelUp } from './sfx';

let cascade = 0;
let lastCoinAt = -Infinity;
// Coins absorbed within this of each other keep climbing the pitch; a gap
// resets to the base note so the next pickup doesn't start mid-cascade.
const CASCADE_GAP_MS = 350;

export function initRewardAudio(): void {
  on((e) => {
    if (e.type === 'gold:absorbed') {
      const now = performance.now();
      cascade = now - lastCoinAt < CASCADE_GAP_MS ? cascade + 1 : 0;
      lastCoinAt = now;
      playCoin(cascade);
    } else if (e.type === 'level:up') {
      playLevelUp();
    }
  });
}
