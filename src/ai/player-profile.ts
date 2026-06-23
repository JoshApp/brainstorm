// Player profile — the behavioral fingerprint that makes the deep KNOW you.
//
// Moment-to-moment we increment cheap counters off the event bus (no AI). The
// persisted aggregates + a ring of recent runs ARE the memory. describePlayer()
// renders them into a compact "dossier" string that rides in every AI request's
// context — so the voice and the awards reference who you actually are ("still
// feeding the fire") instead of speaking generically.
//
// This is the cheap, templated dossier. The AI-summarized dossier (a periodic
// 'kind:dossier' compression) is the next step when the facts outgrow a few
// lines; until then the structured facts are small enough to feed directly.
//
// Cross-run aggregates persist to localStorage (SpacetimeDB later — the Worker
// is stateless, so the profile is the production form of "the deep remembers").

import { on } from '../broadcast/event-bus';
import { getRunState } from '../state/run-state';
import { getPlayerName } from '../state/meta-state';

const STORE_KEY = 'delve:player-profile';
const MAX_RECENT_RUNS = 6;

interface RunMemory { depth: number; kills: number; killedBy: string; }

interface PlayerProfile {
  runs: number;
  deaths: number;
  deepest: number;
  deathCauses: Record<string, number>;
  weaponUse: Record<string, number>;
  bossesDown: number;
  bargainsTaken: number;
  notesRead: number;
  itemsTaken: number;
  recentRuns: RunMemory[];
}

function blank(): PlayerProfile {
  return {
    runs: 0, deaths: 0, deepest: 0,
    deathCauses: {}, weaponUse: {},
    bossesDown: 0, bargainsTaken: 0, notesRead: 0, itemsTaken: 0,
    recentRuns: [],
  };
}

let profile: PlayerProfile = blank();

function load(): void {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) profile = { ...blank(), ...JSON.parse(raw) };
  } catch { /* fresh */ }
}
function save(): void {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(profile)); } catch { /* ignore */ }
}
function bump(map: Record<string, number>, key: string): void {
  if (!key) return;
  map[key] = (map[key] ?? 0) + 1;
}

/** Subscribe to the high-signal events. Cheap counters only — no AI, no save on
 *  hot events (only on checkpoints: boss, floor, death). */
export function initPlayerProfile(): void {
  load();
  // The handler is wrapped: a profile bug must NEVER throw into emit() and
  // break the game systems that fire these events. Best-effort, always.
  on((e) => {
    try {
      switch (e.type) {
        case 'attack:hit': if (e.cls) bump(profile.weaponUse, String(e.cls)); break;
        case 'item:picked-up': profile.itemsTaken++; break;
        case 'note:read': profile.notesRead++; break;
        case 'transaction:accepted': profile.bargainsTaken++; break;
        case 'boss:defeated': profile.bossesDown++; save(); break;
        case 'level:loaded': {
          const d = getRunState()?.depth ?? 0;
          if (d > profile.deepest) profile.deepest = d;
          save();
          break;
        }
      }
    } catch { /* never break the emitter */ }
  });
}

/** Record a death — called from death.ts (it holds the rich facts). Persist the
 *  cause histogram + recent-runs ring; this is the cross-run memory's core. */
export function recordDeath(facts: RunMemory): void {
  profile.runs++;
  profile.deaths++;
  bump(profile.deathCauses, facts.killedBy || 'the dark');
  if (facts.depth > profile.deepest) profile.deepest = facts.depth;
  profile.recentRuns.unshift({
    depth: facts.depth, kills: facts.kills, killedBy: facts.killedBy || 'the dark',
  });
  profile.recentRuns = profile.recentRuns.slice(0, MAX_RECENT_RUNS);
  save();
}

function topKey(map: Record<string, number>): string | null {
  let best: string | null = null;
  let n = -1;
  for (const k in map) if (map[k] > n) { best = k; n = map[k]; }
  return best;
}

/** The compact dossier fed into every AI request's context. Cheap, templated,
 *  high-signal — the structured facts that let the deep sound like it knows you. */
export function describePlayer(): string {
  const name = getPlayerName() ?? 'a nameless delver';
  const run = getRunState();
  const lines: string[] = [];

  lines.push(`${name}: watched ${profile.runs} times, dead ${profile.deaths}, deepest depth ${profile.deepest}.`);

  const weapon = topKey(profile.weaponUse);
  if (weapon) lines.push(`Fights mostly with ${weapon}.`);

  const causes = Object.entries(profile.deathCauses).sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (causes.length) lines.push(`Dies to: ${causes.map(([c, n]) => `${c} (${n})`).join(', ')}.`);

  const tells: string[] = [];
  if (profile.bargainsTaken >= 3) tells.push('takes what the dungeon offers');
  if (profile.notesRead >= 3) tells.push('reads what it finds');
  if (profile.runs >= 3 && profile.bossesDown === 0) tells.push('has never felled a great thing');
  if (tells.length) lines.push(`Notable: ${tells.join('; ')}.`);

  if (run) lines.push(`This descent: depth ${run.depth}, ${run.kills} slain.`);

  return lines.join(' ');
}
