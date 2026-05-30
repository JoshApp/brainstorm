import { bossStore, type BossState } from '../state/hud-stores';
import { bind } from './hud';
import type { Enemy } from '../mobs/enemy';

// Dark Souls-style boss bar — a wide, thin, deep-red bar at the bottom centre
// with the boss's name above it. Appears the moment the boss becomes aware of
// the player (the "fog gate" beat), drains as you damage it, and lingers a
// beat at empty on death before fading. A slower trailing bar behind the fill
// shows recent damage as a "chip" lag, the way Souls/fighting games do.
//
// Split in two:
//   - the CONTROLLER (tickBossBar / resetBossBar) finds the live boss enemy
//     and pushes hp/name into bossStore; engaged + death-fade state lives here.
//   - the WIDGET (createBossBar) binds bossStore and renders. No polling.

// ── Widget ──────────────────────────────────────────────────────────────

let root: HTMLDivElement | null = null;
let nameEl: HTMLDivElement | null = null;
let fillEl: HTMLDivElement | null = null;
let trailEl: HTMLDivElement | null = null;

export function createBossBar() {
  if (root) return;

  root = document.createElement('div');
  root.id = 'boss-bar';
  Object.assign(root.style, {
    position: 'fixed',
    left: '50%',
    // Sits above the player HP pips (which live at bottom ~20px).
    bottom: 'calc(48px + env(safe-area-inset-bottom, 0px))',
    transform: 'translateX(-50%)',
    width: 'min(560px, 78vw)',
    zIndex: '11',
    pointerEvents: 'none',
    opacity: '0',
    transition: 'opacity 0.5s ease-out',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '5px',
  } as Partial<CSSStyleDeclaration>);

  nameEl = document.createElement('div');
  Object.assign(nameEl.style, {
    fontFamily: 'Georgia, "Times New Roman", serif',  // in-world voice = serif
    fontSize: '15px',
    letterSpacing: '0.16em',
    textTransform: 'uppercase',
    color: 'rgba(220, 200, 190, 0.92)',
    textShadow: '0 0 8px rgba(0,0,0,0.95)',
  } as Partial<CSSStyleDeclaration>);

  // Track (the bar frame) holds the trailing + fill bars.
  const track = document.createElement('div');
  Object.assign(track.style, {
    position: 'relative',
    width: '100%',
    height: '9px',
    background: 'rgba(10, 6, 6, 0.82)',
    border: '1px solid rgba(150, 40, 30, 0.55)',
    boxShadow: '0 0 10px rgba(0,0,0,0.7), inset 0 0 6px rgba(0,0,0,0.8)',
  } as Partial<CSSStyleDeclaration>);

  // Trailing "chip" bar — lags behind the fill on damage.
  trailEl = document.createElement('div');
  Object.assign(trailEl.style, {
    position: 'absolute',
    left: '0', top: '0', bottom: '0',
    width: '100%',
    background: 'rgba(200, 140, 90, 0.55)',   // warm amber lag
    transition: 'width 0.55s ease-out',
  } as Partial<CSSStyleDeclaration>);

  // Fill bar — the live HP. Deep blood red.
  fillEl = document.createElement('div');
  Object.assign(fillEl.style, {
    position: 'absolute',
    left: '0', top: '0', bottom: '0',
    width: '100%',
    background: 'linear-gradient(to bottom, rgba(170,30,24,0.98), rgba(110,16,14,0.98))',
    transition: 'width 0.16s ease-out',
  } as Partial<CSSStyleDeclaration>);

  track.appendChild(trailEl);
  track.appendChild(fillEl);
  root.appendChild(nameEl);
  root.appendChild(track);
  document.body.appendChild(root);

  bind(bossStore, render);
}

function render(s: BossState) {
  if (!root || !nameEl || !fillEl || !trailEl) return;
  root.style.opacity = s.visible ? '1' : '0';
  if (!s.visible) return;
  nameEl.textContent = s.name;
  const pct = s.max > 0 ? Math.max(0, Math.min(1, s.hp / s.max)) * 100 : 0;
  fillEl.style.width = `${pct}%`;
  trailEl.style.width = `${pct}%`;
}

// ── Controller ────────────────────────────────────────────────────────────

let engaged = false;
let fadeTimer = -1;          // >= 0 while counting down the post-death linger
let lastName = '';
let lastMax = 0;

const DEATH_LINGER = 1.6;    // seconds the empty bar holds before fading

/** Per-frame. Finds the live boss; shows + drains the bar once it's aware of
 *  the player; lingers empty on death, then hides. */
export function tickBossBar(enemies: Enemy[], dt: number): void {
  const boss = enemies.find((e) => e.isBoss && e.alive);
  if (boss) {
    // Engage on first awareness — the fog-gate moment.
    if (!engaged && boss.aiState !== 'idle' && boss.aiState !== 'returning') {
      engaged = true;
    }
    if (engaged) {
      lastName = boss.bossName;
      lastMax = boss.maxHp;
      fadeTimer = -1;
      bossStore.set({ visible: true, name: boss.bossName, hp: Math.max(0, boss.hp), max: boss.maxHp });
    }
    return;
  }
  // No live boss. If we were engaged, the boss just died — hold the empty
  // bar a beat (the kill lands), then fade out.
  if (engaged) {
    if (fadeTimer < 0) {
      fadeTimer = DEATH_LINGER;
      bossStore.set({ visible: true, name: lastName, hp: 0, max: lastMax });
    }
    fadeTimer -= dt;
    if (fadeTimer <= 0) {
      engaged = false;
      fadeTimer = -1;
      bossStore.set({ visible: false, name: '', hp: 0, max: 0 });
    }
  }
}

/** Reset on level load / teardown — no boss, bar hidden. */
export function resetBossBar(): void {
  engaged = false;
  fadeTimer = -1;
  lastName = '';
  lastMax = 0;
  bossStore.set({ visible: false, name: '', hp: 0, max: 0 });
}
