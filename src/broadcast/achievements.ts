import { on, type GameEvent } from './event-bus';
import { broadcastPop } from '../ui/broadcast-pop';

// Tiny "achievements queued" badge in the top-right. Pulses softly while
// the queue has items so the player knows pops are held, not dropped. The
// number animates down as each pop fires.
let indicatorEl: HTMLDivElement | null = null;
function updateIndicator(count: number) {
  if (count <= 0) {
    if (indicatorEl) indicatorEl.style.opacity = '0';
    return;
  }
  if (!indicatorEl) {
    const el = document.createElement('div');
    Object.assign(el.style, {
      position: 'fixed',
      top: 'calc(16px + env(safe-area-inset-top, 0px))',
      right: 'calc(16px + env(safe-area-inset-right, 0px))',
      padding: '4px 9px',
      background: 'rgba(20, 26, 48, 0.78)',
      border: '1px solid rgba(150, 200, 255, 0.55)',
      borderRadius: '12px',
      color: '#cfe5ff',
      fontFamily: 'system-ui, -apple-system, "Helvetica Neue", sans-serif',
      fontSize: '11px',
      fontWeight: '600',
      letterSpacing: '0.08em',
      zIndex: '49',
      pointerEvents: 'none',
      transition: 'opacity 220ms ease, transform 220ms ease',
      animation: 'achievementBadgePulse 2.4s ease-in-out infinite',
      transform: 'scale(1)',
    });
    // Inject the pulse keyframes once.
    if (!document.getElementById('achievement-badge-keyframes')) {
      const style = document.createElement('style');
      style.id = 'achievement-badge-keyframes';
      style.textContent =
        '@keyframes achievementBadgePulse { ' +
        '0%, 100% { box-shadow: 0 0 0 0 rgba(150, 200, 255, 0.25); } ' +
        '50% { box-shadow: 0 0 14px 2px rgba(150, 200, 255, 0.45); } }';
      document.head.appendChild(style);
    }
    document.body.appendChild(el);
    indicatorEl = el;
  }
  indicatorEl.textContent = `+${count} HELD`;
  indicatorEl.style.opacity = '1';
}

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

// Minimum gap between achievement pops once the queue starts draining.
const POP_GAP_MS = 1800;

// "Calm" = no combat event for this long. We hold achievement pops while
// the player is actively in combat (swinging, hitting, taking damage,
// killing) and drain the queue once things settle. Player gets a moment
// to breathe and the achievement isn't an interruption.
const COMBAT_COOLDOWN_MS = 3500;

// Combat events that reset the cooldown timer. Pickups + deaths don't
// count — pickups are calm moments, and the death sequence is a fine
// place to show the post-mortem achievement.
const COMBAT_EVENT_TYPES = new Set<GameEvent['type']>([
  'attack:swing',
  'attack:hit',
  'enemy:killed',
  'player:damaged',
]);

export function initAchievements() {
  const unlocked = new Set<string>();
  const state: TrackedState = {
    hasSwung: false,
    hasKilled: false,
    hasTakenDamage: false,
  };
  const queue: Achievement[] = [];
  let lastPopTime = -Infinity;
  let lastCombatTime = -Infinity;
  let draining = false;

  function tryDrain() {
    if (draining) return;
    if (queue.length === 0) return;
    const now = performance.now();
    const sinceCombat = now - lastCombatTime;
    const sincePop = now - lastPopTime;
    if (sinceCombat < COMBAT_COOLDOWN_MS) return;
    const wait = Math.max(0, POP_GAP_MS - sincePop);
    draining = true;
    setTimeout(() => {
      draining = false;
      const next = queue.shift();
      if (!next) return;
      lastPopTime = performance.now();
      broadcastPop(next.title, next.desc);
      updateIndicator(queue.length);
      // Chain through the rest of the queue with gaps; the calm check
      // runs again per pop so a fresh combat event interrupts mid-drain.
      tryDrain();
    }, wait);
  }

  on((event) => {
    if (COMBAT_EVENT_TYPES.has(event.type)) {
      lastCombatTime = performance.now();
    }

    for (const ach of ACHIEVEMENTS) {
      if (unlocked.has(ach.id)) continue;
      if (ach.trigger(event, state)) {
        unlocked.add(ach.id);
        queue.push(ach);
        updateIndicator(queue.length);
      }
    }
    tryDrain();

    // Update state AFTER trigger checks so this event isn't reflected yet.
    if (event.type === 'attack:swing') state.hasSwung = true;
    if (event.type === 'enemy:killed') state.hasKilled = true;
    if (event.type === 'player:damaged') state.hasTakenDamage = true;
  });

  // Tick from a setInterval rather than the main loop — achievement
  // delivery doesn't need to be frame-perfect, and this keeps the module
  // self-contained (no main.ts wiring required).
  setInterval(tryDrain, 500);
}
