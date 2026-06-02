import { bossStore, type BossState } from '../state/hud-stores';
import { bind } from './hud';
import type { Enemy } from '../mobs/enemy';
import { isBossEngaged, levelHasFogWall, resetBossEngagement } from './boss-engagement';
import { ENEMIES } from '../content/enemies';
import { bossSpecForEnemy } from '../content/bosses';
import { showBossIntro, hideBossIntro } from './boss-intro-card';

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
let barsEl: HTMLDivElement | null = null;
// Pool of bar rows (track + trail + fill + 50% marker), grown to match the
// boss count.
interface BarRow { track: HTMLDivElement; trail: HTMLDivElement; fill: HTMLDivElement; marker: HTMLDivElement }
const barRows: BarRow[] = [];

function makeBarRow(): BarRow {
  const track = document.createElement('div');
  Object.assign(track.style, {
    position: 'relative',
    width: '100%',
    background: 'rgba(10, 6, 6, 0.82)',
    border: '1px solid rgba(150, 40, 30, 0.55)',
    boxShadow: '0 0 10px rgba(0,0,0,0.7), inset 0 0 6px rgba(0,0,0,0.8)',
  } as Partial<CSSStyleDeclaration>);

  const trail = document.createElement('div');
  Object.assign(trail.style, {
    position: 'absolute', left: '0', top: '0', bottom: '0', width: '100%',
    background: 'rgba(200, 140, 90, 0.55)',   // warm amber lag
    transition: 'width 0.55s ease-out',
  } as Partial<CSSStyleDeclaration>);

  const fill = document.createElement('div');
  Object.assign(fill.style, {
    position: 'absolute', left: '0', top: '0', bottom: '0', width: '100%',
    background: 'linear-gradient(to bottom, rgba(170,30,24,0.98), rgba(110,16,14,0.98))',
    transition: 'width 0.16s ease-out',
  } as Partial<CSSStyleDeclaration>);

  // Halfway notch — a thin dark tick at 50% (a Souls-style phase marker).
  // Shown only on the king's single wide bar.
  const marker = document.createElement('div');
  Object.assign(marker.style, {
    position: 'absolute', left: '50%', top: '-1px', bottom: '-1px', width: '2px',
    marginLeft: '-1px',
    background: 'rgba(20, 10, 8, 0.95)',
    boxShadow: '0 0 2px rgba(0,0,0,0.9)',
  } as Partial<CSSStyleDeclaration>);

  track.appendChild(trail);
  track.appendChild(fill);
  track.appendChild(marker);
  return { track, trail, fill, marker };
}

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

  // Bars container — a column of one-or-more tracks (one per live boss).
  barsEl = document.createElement('div');
  Object.assign(barsEl.style, {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    gap: '8px', width: '100%',   // spaced so the stacked prince bars read separately
  } as Partial<CSSStyleDeclaration>);

  root.appendChild(nameEl);
  root.appendChild(barsEl);
  document.body.appendChild(root);

  bind(bossStore, render);
}

function render(s: BossState) {
  if (!root || !nameEl || !barsEl) return;
  root.style.opacity = s.visible ? '1' : '0';
  if (!s.visible) return;
  nameEl.textContent = s.name;

  const n = s.bars.length;
  // Grow the row pool to match the boss count (rows are reused/hidden).
  while (barRows.length < n) {
    const row = makeBarRow();
    barRows.push(row);
    barsEl.appendChild(row.track);
  }
  // Multiple bosses (the split princes) → thinner, narrower bars so the
  // stack reads as "lesser" than the king's single wide bar.
  const multi = n > 1;
  for (let i = 0; i < barRows.length; i++) {
    const row = barRows[i];
    if (i >= n) { row.track.style.display = 'none'; continue; }
    row.track.style.display = 'block';
    row.track.style.height = multi ? '6px' : '9px';
    row.track.style.width = multi ? '64%' : '100%';
    // 50% notch only on the king's single wide bar.
    row.marker.style.display = multi ? 'none' : 'block';
    const bar = s.bars[i];
    const pct = bar.max > 0 ? Math.max(0, Math.min(1, bar.hp / bar.max)) * 100 : 0;
    row.fill.style.width = `${pct}%`;
    row.trail.style.width = `${pct}%`;
  }
}

// ── Controller ────────────────────────────────────────────────────────────

let engaged = false;
let fadeTimer = -1;          // >= 0 while counting down the post-death linger
let lastName = '';
let lastBars: { hp: number; max: number }[] = [];

const DEATH_LINGER = 1.6;    // seconds the empty bar(s) hold before fading

/** Per-frame. Finds ALL live boss enemies (the king, or its split princes)
 *  and shows a bar each once the fight is engaged; lingers empty on death,
 *  then hides. The split staying tracked here keeps it part of the fight. */
export function tickBossBar(enemies: Enemy[], dt: number): void {
  const bosses = enemies.filter((e) => e.isBoss && e.alive);
  if (bosses.length > 0) {
    // Engagement rule:
    //   - If the level has a fog-wall (a boss-mist prop was spawned),
    //     require the cross trigger to fire first.
    //   - Otherwise (test scenarios, legacy levels), engage the moment any
    //     boss aggros.
    const fogWallReady = levelHasFogWall() && isBossEngaged();
    const legacyAggro = !levelHasFogWall()
      && bosses.some((b) => b.aiState !== 'idle' && b.aiState !== 'returning');
    if (!engaged && (fogWallReady || legacyAggro)) {
      engaged = true;
      // Intro title card fires ONCE on first engagement (the king). The
      // split princes inherit `engaged`, so they don't re-trigger it.
      const lead = bosses[0];
      const spec = ENEMIES[lead.kind];
      const bs = spec ? bossSpecForEnemy(spec) : undefined;
      showBossIntro(bs?.defaultName ?? lead.bossName, bs?.introLine ?? '');
    }
    if (engaged) {
      const bars = bosses.map((b) => ({ hp: Math.max(0, b.hp), max: b.maxHp }));
      lastName = bosses[0].bossName;
      lastBars = bars.map((b) => ({ hp: 0, max: b.max }));   // empty copies for the linger
      fadeTimer = -1;
      bossStore.set({ visible: true, name: bosses[0].bossName, bars });
    }
    return;
  }
  // No live boss. If we were engaged, the fight just ended (the last boss
  // died) — hold the empty bar(s) a beat, then fade out.
  if (engaged) {
    if (fadeTimer < 0) {
      fadeTimer = DEATH_LINGER;
      bossStore.set({ visible: true, name: lastName, bars: lastBars });
    }
    fadeTimer -= dt;
    if (fadeTimer <= 0) {
      engaged = false;
      fadeTimer = -1;
      bossStore.set({ visible: false, name: '', bars: [] });
    }
  }
}

/** Reset on level load / teardown — no boss, bar hidden. */
export function resetBossBar(): void {
  engaged = false;
  fadeTimer = -1;
  lastName = '';
  lastBars = [];
  hideBossIntro();
  resetBossEngagement();
  bossStore.set({ visible: false, name: '', bars: [] });
}
