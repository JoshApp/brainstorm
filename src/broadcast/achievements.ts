import { on, type GameEvent } from './event-bus';
import { broadcastPop } from '../ui/broadcast-pop';

// The DCC tribute layer — snarky achievement pops triggered by in-world events.
// Each achievement fires at most once per session. Tone per CLAUDE.md Tone
// Layering: this layer IS allowed to be funny, sponsor-aware, fourth-wall-aware.
// The dungeon stays cruel; the system narrating the dungeon is a jackass.

interface Achievement {
  id: string;
  title: string;
  desc: string;
  /** Returns true if this event triggers the achievement. */
  trigger: (event: GameEvent, state: TrackedState) => boolean;
}

interface TrackedState {
  hasSwung: boolean;
  hasKilled: boolean;
  hasTakenDamage: boolean;
}

const ACHIEVEMENTS: Achievement[] = [
  {
    id: 'hello-crawler',
    title: 'Hello, Crawler',
    desc: 'The dungeon notes your enthusiasm.',
    trigger: (e) => e.type === 'attack:swing',
  },
  {
    id: 'first-blood',
    title: 'First Blood',
    desc: 'Statistically improbable for someone of your demographic.',
    trigger: (e) => e.type === 'enemy:killed',
  },
  {
    id: 'untouched',
    title: 'Untouched',
    desc: 'Lucky. Subsequent floors have been notified.',
    trigger: (e, s) => e.type === 'enemy:killed' && !s.hasTakenDamage,
  },
  {
    id: 'brief-forgotten',
    title: 'Brief and Forgotten',
    desc: 'Added to the Depth-1 leaderboard. It is long.',
    trigger: (e) => e.type === 'player:killed',
  },
  {
    id: 'pacifist',
    title: 'Pacifist',
    desc: 'Bold choice. The audience is split.',
    trigger: (e, s) => e.type === 'player:killed' && !s.hasSwung,
  },
];

export function initAchievements() {
  const unlocked = new Set<string>();
  const state: TrackedState = {
    hasSwung: false,
    hasKilled: false,
    hasTakenDamage: false,
  };

  on((event) => {
    // Update tracked state FIRST so achievements can read it on the same event.
    // (For "untouched": when the killed event fires, hasTakenDamage reflects
    // damage taken before this moment.)
    for (const ach of ACHIEVEMENTS) {
      if (unlocked.has(ach.id)) continue;
      if (ach.trigger(event, state)) {
        unlocked.add(ach.id);
        broadcastPop(ach.title, ach.desc);
      }
    }

    // Update state AFTER trigger checks so this event isn't reflected yet.
    if (event.type === 'attack:swing') state.hasSwung = true;
    if (event.type === 'enemy:killed') state.hasKilled = true;
    if (event.type === 'player:damaged') state.hasTakenDamage = true;
  });
}
