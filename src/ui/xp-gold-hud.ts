import {
  getXp, getGold, getLevel, getXpInLevel, getXpForNextLevel,
} from '../state/run-state';
import { on } from '../broadcast/event-bus';

// Wide ARPG-style XP bar pinned along the BOTTOM edge of the screen,
// just above the HP pips. The numbers (level + current/next) live
// INSIDE the bar — no separate readout. Gold counter is split out to
// the top-right corner with the coin glyph (the only thing left up
// there).
//
//   ┌─ bottom edge ────────────────────────────────────────────────┐
//   │ ┌──────────────────────────────────────────────────────────┐ │
//   │ │ LVL 3       ▮▮▮▯▯▯▯▯▯▯▯▯▯▯▯▯▯▯▯▯       12 / 30          │ │
//   │ └──────────────────────────────────────────────────────────┘ │
//   └──────────────────────────────────────────────────────────────┘

const SVG_COIN = `<svg width="14" height="14" viewBox="0 0 16 16" style="display:inline-block;vertical-align:-2px;margin-right:5px;"><circle cx="8" cy="8" r="6.5" fill="rgba(200,140,40,0.95)" stroke="rgba(255,200,90,0.95)" stroke-width="1"/><circle cx="8" cy="8" r="3.5" fill="none" stroke="rgba(255,220,140,0.7)" stroke-width="1"/></svg>`;

let goldContainer: HTMLDivElement | null = null;
let goldEl: HTMLDivElement | null = null;

let xpContainer: HTMLDivElement | null = null;
let xpBarEl: HTMLDivElement | null = null;
let xpFillEl: HTMLDivElement | null = null;
let xpLevelEl: HTMLDivElement | null = null;
let xpFractionEl: HTMLDivElement | null = null;

let levelToast: HTMLDivElement | null = null;

let xpPulseTimer = 0;
let goldPulseTimer = 0;
let levelPulseTimer = 0;
let lastXp = -1;
let lastGold = -1;
let lastLevel = -1;
let lastNextLevel = -1;

export function createXpGoldHud(): void {
  if (xpContainer) return;

  // ── GOLD (top-right corner, just below the depth counter) ──────
  goldContainer = document.createElement('div');
  goldContainer.id = 'gold-hud';
  Object.assign(goldContainer.style, {
    position: 'fixed',
    right: 'calc(16px + env(safe-area-inset-right, 0px))',
    // Below the 40px inventory button (which sits at top: 16px + safe area)
    // with a 16px gap so the gold doesn't overlap the bag icon.
    top: 'calc(72px + env(safe-area-inset-top, 0px))',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: '14px',
    fontWeight: '600',
    letterSpacing: '0.10em',
    color: 'rgba(255, 210, 110, 0.9)',
    textShadow: '0 0 6px rgba(0,0,0,0.85)',
    pointerEvents: 'none',
    zIndex: '10',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    transition: 'transform 180ms ease-out, color 180ms ease-out',
  } as Partial<CSSStyleDeclaration>);
  goldEl = goldContainer;   // single line — alias
  document.body.appendChild(goldContainer);

  // ── XP BAR (very bottom edge, full width, slim) ────────────────
  // Spans the entire bottom edge of the screen as a thin bar — the
  // ARPG / MMO convention. Numbers flank the bar on either side
  // rather than living inside the chunky band, so the bar itself
  // stays unobtrusive while still being readable. HP pips sit
  // comfortably above it.
  xpContainer = document.createElement('div');
  xpContainer.id = 'xp-bar-hud';
  Object.assign(xpContainer.style, {
    position: 'fixed',
    left: '0',
    right: '0',
    bottom: 'env(safe-area-inset-bottom, 0px)',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '0 14px 4px',
    pointerEvents: 'none',
    zIndex: '10',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  } as Partial<CSSStyleDeclaration>);

  // LVL chip on the left.
  xpLevelEl = document.createElement('div');
  Object.assign(xpLevelEl.style, {
    flex: '0 0 auto',
    color: 'rgba(220, 240, 255, 0.95)',
    fontSize: '11px',
    fontWeight: '700',
    letterSpacing: '0.20em',
    textShadow: '0 1px 3px rgba(0,0,0,0.95), 0 0 6px rgba(0,0,0,0.7)',
    minWidth: '46px',
    textAlign: 'right',
    transition: 'transform 280ms ease-out, color 280ms ease-out',
  } as Partial<CSSStyleDeclaration>);

  // The bar — slim, fills the remaining width.
  xpBarEl = document.createElement('div');
  Object.assign(xpBarEl.style, {
    flex: '1 1 auto',
    position: 'relative',
    height: '6px',
    background: 'rgba(14, 14, 22, 0.78)',
    border: '1px solid rgba(120, 160, 220, 0.45)',
    borderRadius: '3px',
    overflow: 'hidden',
    boxShadow: 'inset 0 0 3px rgba(0,0,0,0.85), 0 1px 4px rgba(0,0,0,0.4)',
  } as Partial<CSSStyleDeclaration>);
  xpFillEl = document.createElement('div');
  Object.assign(xpFillEl.style, {
    position: 'absolute',
    left: '0', top: '0', bottom: '0',
    width: '0%',
    background: 'linear-gradient(180deg, rgba(170,225,255,0.95), rgba(70,130,210,0.95))',
    boxShadow: '0 0 6px rgba(140,200,255,0.55)',
    transition: 'width 220ms ease-out',
  } as Partial<CSSStyleDeclaration>);
  xpBarEl.appendChild(xpFillEl);

  // Fraction on the right.
  xpFractionEl = document.createElement('div');
  Object.assign(xpFractionEl.style, {
    flex: '0 0 auto',
    color: 'rgba(200, 220, 255, 0.85)',
    fontSize: '10px',
    fontWeight: '600',
    letterSpacing: '0.10em',
    fontVariantNumeric: 'tabular-nums',
    textShadow: '0 1px 3px rgba(0,0,0,0.95), 0 0 6px rgba(0,0,0,0.7)',
    minWidth: '52px',
    transition: 'color 280ms ease-out',
  } as Partial<CSSStyleDeclaration>);

  xpContainer.appendChild(xpLevelEl);
  xpContainer.appendChild(xpBarEl);
  xpContainer.appendChild(xpFractionEl);
  document.body.appendChild(xpContainer);

  // ── Level-up toast (centre screen) ─────────────────────────────
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
  if (!goldEl || !xpFillEl || !xpLevelEl || !xpFractionEl) return;
  const xp = getXp();
  const gold = getGold();
  const level = getLevel();
  const inLevel = getXpInLevel();
  const next = getXpForNextLevel();

  if (level !== lastLevel) {
    xpLevelEl.textContent = `LVL ${level}`;
    lastLevel = level;
  }
  if (xp !== lastXp || next !== lastNextLevel) {
    const pct = next > 0 ? Math.min(100, (inLevel / next) * 100) : 100;
    xpFillEl.style.width = `${pct}%`;
    xpFractionEl.textContent = `${inLevel} / ${next}`;
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
    xpFractionEl.style.color = `rgba(${Math.round(220 + t * 35)}, ${Math.round(240 + t * 15)}, 255, ${0.92 + t * 0.08})`;
  } else {
    xpFractionEl.style.color = 'rgba(220, 240, 255, 0.92)';
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
    xpLevelEl.style.transform = `scale(${1 + t * 0.25})`;
    xpLevelEl.style.color = `rgba(${Math.round(220 + t * 35)}, ${Math.round(240 + t * 15)}, 255, ${0.98})`;
  } else {
    xpLevelEl.style.transform = 'scale(1)';
    xpLevelEl.style.color = 'rgba(220, 240, 255, 0.98)';
  }
}
