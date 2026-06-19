import { bossStore, type BossState } from '../state/hud-stores';
import { bind } from './hud';
import { isBossEngaged, levelHasFogWall } from './boss-engagement';
import {
  liveBossMembers, engageBossEncounter, isBossEncounterEngaged,
  isBossEncounterComplete, tickBossEncounter,
} from '../mobs/boss-encounter';
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
// Pool of bar rows (track + trail + fill), grown to match the boss count.
interface BarRow { track: HTMLDivElement; trail: HTMLDivElement; fill: HTMLDivElement }
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

  track.appendChild(trail);
  track.appendChild(fill);
  return { track, trail, fill };
}

export function createBossBar() {
  if (root) return;

  root = document.createElement('div');
  root.id = 'boss-bar'; root.classList.add('game-hud');
  Object.assign(root.style, {
    position: 'fixed',
    left: '50%',
    // Sits ABOVE the entire bottom-centre player HUD stack: hearts
    // (top ~42px) → stamina-bar / stamina-arc (top ~45-54px) → buff
    // pills (top ~81px). The old 48px sat ON TOP of the stamina-arc
    // (Minimal style's breath bar at 50-54px) so the boss bar
    // visibly buried it. Anchor at 88px so the boss bar's bottom
    // edge clears the tallest player widget (buffs at ~81px) with a
    // small breathing gap.
    bottom: 'calc(88px + env(safe-area-inset-bottom, 0px))',
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
    const bar = s.bars[i];
    const pct = bar.max > 0 ? Math.max(0, Math.min(1, bar.hp / bar.max)) * 100 : 0;
    row.fill.style.width = `${pct}%`;
    row.trail.style.width = `${pct}%`;
  }
}

// ── Controller ────────────────────────────────────────────────────────────
//
// A pure VIEW of the boss-encounter container (mobs/boss-encounter.ts) — it
// renders the encounter's live members as bars and lingers on the
// encounter's authoritative "complete" signal. It does NOT decide when the
// fight is over itself any more (the container owns that); it only owns the
// player-commit trigger (fog cross / aggro) + the death-linger animation.

let fadeTimer = -1;          // >= 0 while counting down the post-death linger
let faded = false;           // terminal: linger finished, bar stays hidden
let lastName = '';
let lastBars: { hp: number; max: number }[] = [];
// Beat between CROSSING the fog gate and the boss REVEAL. You commit (the gate
// seals), walk a few steps into the arena over only the boss's floor-shadow —
// then the encounter engages all at once: the boss drops, the bar slams in, the
// music + room mood hit. The staged "bamm" entrance. (Fog levels only; a
// fog-less aggro reveals immediately — there's no walk-in to earn.)
const ENGAGE_DELAY = 1.2;
let engageCountdown = -1;     // >= 0 while counting down after the cross

const DEATH_LINGER = 1.6;    // seconds the empty bar(s) hold before fading

/** Per-frame. Drives the encounter container, then renders it: a bar per
 *  live member (the king, or its split princes) once engaged; lingers on
 *  the container's `complete` signal, then hides. */
export function tickBossBar(dt: number): void {
  tickBossEncounter();   // authoritative "boss done" detection (fires boss:defeated)
  const members = liveBossMembers();

  if (!isBossEncounterComplete()) {
    // Engagement: fog cross (fog levels) or first aggro (fog-less levels).
    if (!isBossEncounterEngaged() && members.length > 0) {
      const fogWallReady = levelHasFogWall() && isBossEngaged();
      const legacyAggro = !levelHasFogWall()
        && members.some((b) => b.aiState !== 'idle' && b.aiState !== 'returning');
      // Fog cross gets the staged walk-in beat; a fog-less aggro reveals at once.
      if (fogWallReady && engageCountdown < 0) engageCountdown = ENGAGE_DELAY;
      const delayElapsed = engageCountdown >= 0 && (engageCountdown -= dt) <= 0;
      if ((fogWallReady && delayElapsed) || legacyAggro) {
        engageBossEncounter();   // drop + bar + music + mood all hit here — the "bamm"
        // Intro card fires ONCE (the king). The split princes inherit the
        // engaged container, so they never re-trigger it.
        const lead = members[0];
        const spec = ENEMIES[lead.kind];
        const bs = spec ? bossSpecForEnemy(spec) : undefined;
        showBossIntro(bs?.defaultName ?? lead.bossName, bs?.introLine ?? '');
      }
    }
    if (isBossEncounterEngaged() && members.length > 0) {
      const bars = members.map((b) => ({ hp: Math.max(0, b.hp), max: b.maxHp }));
      lastName = members[0].bossName;
      lastBars = bars.map((b) => ({ hp: 0, max: b.max }));   // empty copies for the linger
      fadeTimer = -1;
      bossStore.set({ visible: true, name: members[0].bossName, bars });
    }
    return;
  }

  // The encounter is DONE — hold the empty bar(s) a beat, then fade out and
  // STAY out. `faded` is the terminal latch: without it, once the linger
  // ends (fadeTimer back to -1) the `fadeTimer < 0` test below re-triggers
  // the whole linger next frame, so the bar shows forever. In the real game
  // a descent reloads the level (resetBossBar) before that bites; a test
  // chamber never transitions, so the loop was visible there.
  if (faded) return;
  if (fadeTimer < 0) {
    fadeTimer = DEATH_LINGER;
    bossStore.set({ visible: true, name: lastName, bars: lastBars });
  }
  fadeTimer -= dt;
  if (fadeTimer <= 0) {
    faded = true;
    fadeTimer = -1;
    bossStore.set({ visible: false, name: '', bars: [] });
  }
}

/** Reset the BAR's view state on level load. The encounter + fog-wall
 *  flags are reset earlier (in the loader, before the build registers the
 *  new boss) — NOT here, which runs after the build. */
export function resetBossBar(): void {
  fadeTimer = -1;
  faded = false;
  engageCountdown = -1;
  lastName = '';
  lastBars = [];
  hideBossIntro();
  bossStore.set({ visible: false, name: '', bars: [] });
}
