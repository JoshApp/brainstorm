import {
  getXp, getGold, getLevel, getXpInLevel, getXpForNextLevel,
} from '../state/run-state';
import { on } from '../broadcast/event-bus';

// Top-right HUD strip — level + XP progress bar + gold count with a
// coin glyph. Mirrors the depth counter's "barely there" presence so
// the eye registers it peripherally without it dominating the view.
//
// Layout (right-aligned):
//
//     LVL 3   ▮▮▮▯▯▯▯▯▯▯
//                  ◯ 142
//
// XP bar is a row of pips so jumps from absorbed wisps read visually
// (one pip ≈ one XP point at level 1). Gold uses an inline SVG coin
// glyph + the running total. Both lines pulse on the corresponding
// absorb event so the player gets a confirm twitch each pickup.

const SVG_COIN = `<svg width="14" height="14" viewBox="0 0 16 16" style="display:inline-block;vertical-align:-2px;margin-right:5px;"><circle cx="8" cy="8" r="6.5" fill="rgba(200,140,40,0.95)" stroke="rgba(255,200,90,0.95)" stroke-width="1"/><circle cx="8" cy="8" r="3.5" fill="none" stroke="rgba(255,220,140,0.7)" stroke-width="1"/></svg>`;
const SVG_ESSENCE = `<svg width="14" height="14" viewBox="0 0 16 16" style="display:inline-block;vertical-align:-2px;margin-right:5px;"><circle cx="8" cy="8" r="4.5" fill="rgba(140,200,255,0.6)"/><circle cx="8" cy="8" r="6.5" fill="none" stroke="rgba(140,200,255,0.5)" stroke-width="1"/></svg>`;

let container: HTMLDivElement | null = null;
let levelEl: HTMLDivElement | null = null;
let xpBarEl: HTMLDivElement | null = null;
let xpFillEl: HTMLDivElement | null = null;
let xpTextEl: HTMLDivElement | null = null;
let goldEl: HTMLDivElement | null = null;
let levelToast: HTMLDivElement | null = null;

let xpPulseTimer = 0;
let goldPulseTimer = 0;
let levelPulseTimer = 0;
let lastXp = -1;
let lastGold = -1;
let lastLevel = -1;
let lastNextLevel = -1;

export function createXpGoldHud(): void {
  if (container) return;
  container = document.createElement('div');
  container.id = 'xp-gold-hud';
  Object.assign(container.style, {
    position: 'fixed',
    right: 'calc(16px + env(safe-area-inset-right, 0px))',
    top: 'calc(48px + env(safe-area-inset-top, 0px))',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: '5px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: '12px',
    fontWeight: '500',
    letterSpacing: '0.16em',
    textShadow: '0 0 6px rgba(0,0,0,0.85)',
    pointerEvents: 'none',
    zIndex: '10',
    userSelect: 'none',
    WebkitUserSelect: 'none',
  } as Partial<CSSStyleDeclaration>);

  // ── Level + XP bar row ──────────────────────────────────────────
  const xpRow = document.createElement('div');
  Object.assign(xpRow.style, {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  } as Partial<CSSStyleDeclaration>);

  levelEl = document.createElement('div');
  Object.assign(levelEl.style, {
    color: 'rgba(180, 220, 255, 0.9)',
    fontWeight: '700',
    letterSpacing: '0.20em',
    transition: 'transform 280ms ease-out, color 280ms ease-out',
  } as Partial<CSSStyleDeclaration>);
  xpRow.appendChild(levelEl);

  // The XP bar — a track with a glowing fill. Sized so it can read a
  // few levels of progress (pips would clutter at high totals).
  xpBarEl = document.createElement('div');
  Object.assign(xpBarEl.style, {
    width: '110px',
    height: '7px',
    background: 'rgba(20, 20, 28, 0.65)',
    border: '1px solid rgba(120, 160, 220, 0.40)',
    borderRadius: '2px',
    overflow: 'hidden',
    boxShadow: 'inset 0 0 3px rgba(0,0,0,0.7)',
  } as Partial<CSSStyleDeclaration>);
  xpFillEl = document.createElement('div');
  Object.assign(xpFillEl.style, {
    height: '100%',
    width: '0%',
    background: 'linear-gradient(180deg, rgba(160,220,255,0.95), rgba(80,140,220,0.85))',
    boxShadow: '0 0 6px rgba(140,200,255,0.55)',
    transition: 'width 220ms ease-out',
  } as Partial<CSSStyleDeclaration>);
  xpBarEl.appendChild(xpFillEl);
  xpRow.appendChild(xpBarEl);

  // Small fraction text under the bar — "12 / 30"
  xpTextEl = document.createElement('div');
  Object.assign(xpTextEl.style, {
    fontSize: '10px',
    color: 'rgba(160, 200, 240, 0.7)',
    letterSpacing: '0.14em',
    transition: 'color 220ms ease-out',
  } as Partial<CSSStyleDeclaration>);

  container.appendChild(xpRow);
  container.appendChild(xpTextEl);

  // ── Gold row ────────────────────────────────────────────────────
  goldEl = document.createElement('div');
  Object.assign(goldEl.style, {
    color: 'rgba(255, 210, 110, 0.9)',
    fontWeight: '600',
    fontSize: '13px',
    letterSpacing: '0.10em',
    marginTop: '2px',
    transition: 'transform 180ms ease-out, color 180ms ease-out',
  } as Partial<CSSStyleDeclaration>);
  container.appendChild(goldEl);

  document.body.appendChild(container);

  // ── Level-up toast ──────────────────────────────────────────────
  // Big center "LEVEL N" pop on level transitions. Stays out of the
  // way after 1.2s. Keeps levelling FEELING like an event without
  // demanding a modal.
  levelToast = document.createElement('div');
  Object.assign(levelToast.style, {
    position: 'fixed',
    left: '50%',
    top: '38%',
    transform: 'translate(-50%, -50%) scale(0.8)',
    color: 'rgba(220, 240, 255, 0.98)',
    textShadow: '0 0 14px rgba(120, 180, 255, 0.85), 0 0 24px rgba(80, 140, 220, 0.5), 0 2px 0 rgba(0,0,0,0.8)',
    fontFamily: '"Iowan Old Style", Palatino, serif',
    fontSize: 'clamp(28px, 6vw, 44px)',
    fontWeight: '600',
    letterSpacing: '0.30em',
    pointerEvents: 'none',
    zIndex: '20',
    opacity: '0',
    transition: 'opacity 320ms ease-out, transform 480ms cubic-bezier(0.2, 0.7, 0.2, 1)',
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(levelToast);

  on((e) => {
    if (e.type === 'xp:absorbed') xpPulseTimer = 0.22;
    else if (e.type === 'gold:absorbed') goldPulseTimer = 0.22;
    else if (e.type === 'level:up') {
      levelPulseTimer = 0.8;
      showLevelToast(e.level);
    }
  });
}

function showLevelToast(level: number) {
  if (!levelToast) return;
  levelToast.textContent = `LEVEL ${level}`;
  levelToast.style.transition = 'none';
  levelToast.style.opacity = '0';
  levelToast.style.transform = 'translate(-50%, -50%) scale(0.6)';
  void levelToast.offsetWidth;
  levelToast.style.transition = 'opacity 220ms ease-out, transform 360ms cubic-bezier(0.2, 0.7, 0.2, 1)';
  levelToast.style.opacity = '1';
  levelToast.style.transform = 'translate(-50%, -50%) scale(1.0)';
  setTimeout(() => {
    if (!levelToast) return;
    levelToast.style.transition = 'opacity 480ms ease-out, transform 600ms ease-out';
    levelToast.style.opacity = '0';
    levelToast.style.transform = 'translate(-50%, -50%) scale(1.15)';
  }, 900);
}

/** Per-frame update. */
export function updateXpGoldHud(dt: number): void {
  if (!container || !levelEl || !xpFillEl || !xpTextEl || !goldEl) return;
  const xp = getXp();
  const gold = getGold();
  const level = getLevel();
  const inLevel = getXpInLevel();
  const next = getXpForNextLevel();

  if (level !== lastLevel) {
    levelEl.textContent = `LVL ${level}`;
    lastLevel = level;
  }
  if (xp !== lastXp || next !== lastNextLevel) {
    const pct = next > 0 ? Math.min(100, (inLevel / next) * 100) : 100;
    xpFillEl.style.width = `${pct}%`;
    xpTextEl.innerHTML = `${SVG_ESSENCE}${inLevel} / ${next}`;
    lastXp = xp;
    lastNextLevel = next;
  }
  if (gold !== lastGold) {
    goldEl.innerHTML = `${SVG_COIN}${gold}`;
    lastGold = gold;
  }

  // Pulse decays.
  if (xpPulseTimer > 0) {
    xpPulseTimer -= dt;
    const t = Math.max(0, xpPulseTimer / 0.22);
    xpTextEl.style.color = `rgba(${Math.round(180 + t * 75)}, ${Math.round(220 + t * 30)}, 255, ${0.85 + t * 0.15})`;
  } else {
    xpTextEl.style.color = 'rgba(160, 200, 240, 0.7)';
  }
  if (goldPulseTimer > 0) {
    goldPulseTimer -= dt;
    const t = Math.max(0, goldPulseTimer / 0.22);
    goldEl.style.transform = `scale(${1 + t * 0.18})`;
    goldEl.style.color = `rgba(255, ${Math.round(220 + t * 30)}, ${Math.round(110 + t * 100)}, ${0.85 + t * 0.15})`;
  } else {
    goldEl.style.transform = 'scale(1)';
    goldEl.style.color = 'rgba(255, 210, 110, 0.9)';
  }
  if (levelPulseTimer > 0) {
    levelPulseTimer -= dt;
    const t = Math.max(0, levelPulseTimer / 0.8);
    levelEl.style.transform = `scale(${1 + t * 0.30})`;
    levelEl.style.color = `rgba(${Math.round(180 + t * 75)}, ${Math.round(220 + t * 30)}, 255, ${0.90 + t * 0.10})`;
  } else {
    levelEl.style.transform = 'scale(1)';
    levelEl.style.color = 'rgba(180, 220, 255, 0.9)';
  }
}
