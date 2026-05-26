import { on, type GameEvent } from './event-bus';
import { broadcastPop } from '../ui/broadcast-pop';
import { recordAchievement, hasAchievement, addStashEntry } from '../state/meta-state';
import type { Rarity } from '../content/items';

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
  /** Stash tier granted on first unlock. Optional — some achievements
   *  are pure flavor. Tiers map to the existing item rarity pool. */
  reward?: Rarity;
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
    reward: 'mundane',
  },
  {
    id: 'untouched',
    title: 'Untouched',
    desc: 'Lucky. Subsequent floors have been notified.',
    trigger: (e, s) => e.type === 'enemy:killed' && !s.hasTakenDamage,
    reward: 'uncommon',
  },
  {
    id: 'wraith-slain',
    title: 'Magic Bypass',
    desc: 'The dungeon files an exception.',
    trigger: (e) => e.type === 'enemy:killed' && e.enemyId === 'wraith',
    reward: 'fabled',
  },
  {
    id: 'depth-3-reached',
    title: 'Deeper Than Most',
    desc: 'You are no longer in the tutorial.',
    trigger: (e) => e.type === 'level:loaded' && parseDepth(e.levelId) >= 3,
    reward: 'uncommon',
  },
  {
    id: 'depth-5-reached',
    title: 'The Dungeon Notices',
    desc: 'Sponsorship inquiries forthcoming.',
    trigger: (e) => e.type === 'level:loaded' && parseDepth(e.levelId) >= 5,
    reward: 'rare',
  },
  {
    id: 'brief-forgotten',
    title: 'Brief and Forgotten',
    desc: 'Added to the Depth-1 leaderboard. It is long.',
    trigger: (e) => e.type === 'player:killed',
    reward: 'mundane',
  },
  {
    id: 'pacifist',
    title: 'Pacifist',
    desc: 'Bold choice. The audience is split.',
    trigger: (e, s) => e.type === 'player:killed' && !s.hasSwung,
    reward: 'cursed',
  },
];

function parseDepth(levelId: string): number {
  const m = levelId.match(/^depth-(\d+)$/);
  return m ? parseInt(m[1], 10) : 1;
}

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
  // Per-run tracked state for triggers that need it (pacifist needs to
  // know you never swung this run, etc.). NOT persisted — resets at boot.
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
      tryDrain();
    }, wait);
  }

  on((event) => {
    if (COMBAT_EVENT_TYPES.has(event.type)) {
      lastCombatTime = performance.now();
    }

    for (const ach of ACHIEVEMENTS) {
      // Unlock state is PERSISTED in meta-state, not just session.
      // hasAchievement covers "already unlocked in a previous run".
      if (hasAchievement(ach.id)) continue;
      if (ach.trigger(event, state)) {
        const isFirst = recordAchievement(ach.id);
        if (isFirst && ach.reward) {
          // Grant a loot box of the reward tier. Source name shows in
          // the stash UI so the player remembers what they did to earn it.
          addStashEntry(ach.reward, ach.title);
        }
        queue.push(ach);
        updateIndicator(queue.length);
      }
    }
    tryDrain();

    if (event.type === 'attack:swing') state.hasSwung = true;
    if (event.type === 'enemy:killed') state.hasKilled = true;
    if (event.type === 'player:damaged') state.hasTakenDamage = true;
  });

  // Tick from a setInterval rather than the main loop — achievement
  // delivery doesn't need to be frame-perfect, and this keeps the module
  // self-contained (no main.ts wiring required).
  setInterval(tryDrain, 500);
}
