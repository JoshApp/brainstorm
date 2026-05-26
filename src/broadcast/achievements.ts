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

// Removed 'hello-crawler' (fired on first swing — terrible timing, popped
// the broadcast UI in the middle of a player's first combat moment).
// Tone-Bible-grade achievements should never interrupt the crunchy moment;
// they should land between encounters.
const ACHIEVEMENTS: Achievement[] = [
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

// Minimum gap between achievement pops. Without this, killing the first
// enemy without taking damage triggers two pops on the same frame
// (first-blood + untouched), stacking visually and chiming twice in 100ms
// right at the kill — too noisy during combat.
const POP_GAP_MS = 1800;

export function initAchievements() {
  const unlocked = new Set<string>();
  const state: TrackedState = {
    hasSwung: false,
    hasKilled: false,
    hasTakenDamage: false,
  };
  const queue: Achievement[] = [];
  let lastPopTime = -Infinity;

  function pumpQueue() {
    if (queue.length === 0) return;
    const now = performance.now();
    const wait = Math.max(0, lastPopTime + POP_GAP_MS - now);
    setTimeout(() => {
      const next = queue.shift();
      if (!next) return;
      lastPopTime = performance.now();
      broadcastPop(next.title, next.desc);
      if (queue.length > 0) pumpQueue();
    }, wait);
  }

  on((event) => {
    for (const ach of ACHIEVEMENTS) {
      if (unlocked.has(ach.id)) continue;
      if (ach.trigger(event, state)) {
        unlocked.add(ach.id);
        queue.push(ach);
      }
    }
    if (queue.length > 0) pumpQueue();

    // Update state AFTER trigger checks so this event isn't reflected yet.
    if (event.type === 'attack:swing') state.hasSwung = true;
    if (event.type === 'enemy:killed') state.hasKilled = true;
    if (event.type === 'player:damaged') state.hasTakenDamage = true;
  });
}
