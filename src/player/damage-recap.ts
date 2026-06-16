// Damage attribution + recap — the game's awareness of WHAT is hurting the
// player and HOW MUCH.
//
// Every landed blow on the player is recorded here from the damage pipeline
// (damagePlayer → recordPlayerDamage). The recap is the single seam read for:
//   - the killer: the most recent blow → the death feed + the bloodstain epitaph
//   - the end-screen breakdown: "what took you", biggest source first
//   - (future) balance telemetry, leaderboard death context
//
// Scope is PER LIFE. A death reloads the page (RISE AGAIN), so module state
// starts fresh each life; resetDamageRecap() exists for any future
// revive-without-reload path.

import { ENEMIES } from '../content/enemies';
import type { EntityId } from '../ecs/types';

export interface DamageTally {
  /** Readable source: 'a ghoul', 'a spike trap', 'their own bargain', 'the dark'. */
  label: string;
  /** Total applied damage from this source this life. */
  total: number;
  /** Number of landed hits. */
  hits: number;
  /** True while EVERY hit from this source was a DoT tick (bleed/poison/burn). */
  dot: boolean;
}

const tallies = new Map<string, DamageTally>();
let lastLabel: string | null = null;

function article(name: string): 'a' | 'an' {
  return /^[aeiou]/i.test(name) ? 'an' : 'a';
}

/** Resolve a blow to a readable source label. An explicit `cause`
 *  (environmental) wins; an enemy EntityId ('enemy-<spec>-<n>') resolves to
 *  its spec's display name; anything else is 'the dark'. */
function labelFor(source: EntityId | null, cause?: string): string {
  if (cause) return cause;
  if (source) {
    const m = /^enemy-(.+)-\d+$/.exec(source);
    if (m) {
      const name = ENEMIES[m[1]]?.name ?? m[1].replace(/-/g, ' ');
      return `${article(name)} ${name}`;
    }
  }
  return 'the dark';
}

/** Record a landed blow on the player. Called by damagePlayer when applied
 *  damage > 0. `dot` (the pipeline's `quiet` flag) marks DoT ticks. */
export function recordPlayerDamage(
  source: EntityId | null,
  applied: number,
  dot: boolean,
  cause?: string,
): void {
  const label = labelFor(source, cause);
  const t = tallies.get(label);
  if (t) {
    t.total += applied;
    t.hits += 1;
    t.dot = t.dot && dot;
  } else {
    tallies.set(label, { label, total: applied, hits: 1, dot });
  }
  lastLabel = label;
}

/** What dealt the killing (most recent) blow — for the feed + epitaph. */
export function killingBlowLabel(): string {
  return lastLabel ?? 'the dark';
}

/** This life's damage recap, biggest source first. */
export function getDamageRecap(): DamageTally[] {
  return [...tallies.values()].sort((a, b) => b.total - a.total);
}

/** Total damage taken this life. */
export function totalDamageTaken(): number {
  let sum = 0;
  for (const t of tallies.values()) sum += t.total;
  return sum;
}

/** Clear the recap for a fresh life (for any future revive-without-reload). */
export function resetDamageRecap(): void {
  tallies.clear();
  lastLabel = null;
}
