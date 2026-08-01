import { on } from '../broadcast/event-bus';
import { xpStore, goldStore, type XpState } from '../state/hud-stores';
import { getCount } from '../player/inventory';
import { KEY_ID } from '../content/drop-tables';
import { hudStyleStore, getHudStyle } from './hud-style';
import { bind } from './hud';
import { projectToScreen, flyToHud } from './fly-to-hud';

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

// Small brass key glyph — matches the coin's inline-icon style. Shown beside
// the gold count when the player is carrying skeleton keys.
const SVG_KEY = `<svg width="13" height="13" viewBox="0 0 16 16" style="display:inline-block;vertical-align:-2px;margin-right:4px;"><circle cx="5" cy="6" r="3.2" fill="none" stroke="rgba(210,180,110,0.95)" stroke-width="1.6"/><path d="M7.3 7.6 L13 13 M11 11 l1.6 -1.6 M12.4 12.4 l1.2 -1.2" stroke="rgba(210,180,110,0.95)" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>`;

let goldContainer: HTMLDivElement | null = null;
let goldEl: HTMLDivElement | null = null;
let keysEl: HTMLDivElement | null = null;
let prevKeys = -1;

let xpContainer: HTMLDivElement | null = null;
let xpBarEl: HTMLDivElement | null = null;
let xpFillEl: HTMLDivElement | null = null;
let xpLevelEl: HTMLDivElement | null = null;
let xpFractionEl: HTMLDivElement | null = null;

let levelToast: HTMLDivElement | null = null;
let goldTickEl: HTMLDivElement | null = null;   // floating "+N" that accumulates across a coin stream
let levelBloomEl: HTMLDivElement | null = null; // warm radial flash on level-up

let xpPulseTimer = 0;
let goldPulseTimer = 0;
let levelPulseTimer = 0;

// Gold "+N" tick state. Coins absorb one-by-one (the cascade), so we ACCUMULATE
// the gain into a single floating number that holds while the stream lands,
// then floats up + fades once it stops — reads with the rising coin sound
// instead of flashing per coin.
let prevGold = 0;
let goldSeeded = false;   // first goldStore bind seeds prevGold without a spurious tick (load / continue-run)
let goldTickAmount = 0;
let goldTickLeft = 0;
const GOLD_TICK_HOLD = 0.55;   // s — keeps showing/growing while coins land
const GOLD_TICK_FADE = 0.45;   // s — rise + fade tail after the last coin
let levelBloomLeft = 0;
const LEVEL_BLOOM_DUR = 0.7;   // matches the level-up swell

export function createXpGoldHud(): void {
  if (xpContainer) return;

  // ── GOLD (top-right corner, just below the depth counter) ──────
  goldContainer = document.createElement('div');
  goldContainer.id = 'gold-hud'; goldContainer.classList.add('game-hud');
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
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  } as Partial<CSSStyleDeclaration>);
  // Keys count sits to the LEFT of the gold, hidden while you carry none. Pale
  // brass so it reads as currency-but-not-gold.
  keysEl = document.createElement('div');
  keysEl.id = 'keys-indicator';   // fly-to-hud target for key pickups
  Object.assign(keysEl.style, {
    color: 'rgba(210, 185, 130, 0.92)',
    display: 'none',
    transition: 'transform 180ms ease-out',
  } as Partial<CSSStyleDeclaration>);
  // Gold gets its own span so per-frame innerHTML rewrites don't wipe the keys.
  goldEl = document.createElement('div');
  goldEl.style.transition = 'transform 180ms ease-out, color 180ms ease-out';
  goldContainer.append(keysEl, goldEl);
  document.body.appendChild(goldContainer);

  // Floating "+N" gold tick — sits just under the gold counter, rises + fades.
  goldTickEl = document.createElement('div');
  Object.assign(goldTickEl.style, {
    position: 'fixed',
    right: 'calc(16px + env(safe-area-inset-right, 0px))',
    top: 'calc(94px + env(safe-area-inset-top, 0px))',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: '13px',
    fontWeight: '700',
    letterSpacing: '0.08em',
    color: 'rgba(255, 224, 150, 0.95)',
    textShadow: '0 0 7px rgba(255,180,70,0.7), 0 1px 2px rgba(0,0,0,0.9)',
    pointerEvents: 'none',
    zIndex: '10',
    opacity: '0',
    userSelect: 'none', WebkitUserSelect: 'none',
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(goldTickEl);

  // Level-up warm bloom — a gentle gold radial flash that punctuates the swell
  // (the centred toast carries the words; this gives it a pulse of light).
  levelBloomEl = document.createElement('div');
  Object.assign(levelBloomEl.style, {
    position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '19',
    opacity: '0', willChange: 'opacity',
    background: 'radial-gradient(ellipse at center, rgba(255,210,120,0.28) 0%, rgba(220,150,60,0.10) 40%, transparent 68%)',
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(levelBloomEl);

  // ── XP BAR (very bottom edge, full width, slim) ────────────────
  // Spans the entire bottom edge of the screen as a thin bar — the
  // ARPG / MMO convention. Numbers flank the bar on either side
  // rather than living inside the chunky band, so the bar itself
  // stays unobtrusive while still being readable. HP pips sit
  // comfortably above it.
  xpContainer = document.createElement('div');
  xpContainer.id = 'xp-bar-hud'; xpContainer.classList.add('game-hud');
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

  // Bottom-edge XP bar belongs to the CLASSIC style; minimal/cinematic
  // use the corner sigil instead. Gold stays visible across all styles.
  const applyXpVisibility = () => {
    if (!xpContainer) return;
    xpContainer.style.display = getHudStyle().xp === 'bar' ? 'flex' : 'none';
  };
  hudStyleStore.subscribe(applyXpVisibility);
  applyXpVisibility();

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

  // Data → DOM: bound to the HUD stores (synced each frame), so the bar,
  // level label and gold re-render only when their value actually changes.
  bind(xpStore, ({ level, inLevel, next }: XpState) => {
    if (!xpLevelEl || !xpFillEl || !xpFractionEl) return;
    xpLevelEl.textContent = `LVL ${level}`;
    const pct = next > 0 ? Math.min(100, (inLevel / next) * 100) : 100;
    xpFillEl.style.width = `${pct}%`;
    xpFractionEl.textContent = `${inLevel} / ${next}`;
  });
  bind(goldStore, (gold) => {
    if (!goldEl) return;
    goldEl.innerHTML = `${SVG_COIN}${gold}`;
    // Accumulate the gain into the floating "+N" (held + grown while a coin
    // stream lands; floats off once it stops). First bind seeds prevGold so a
    // continue-run's existing gold doesn't fling a spurious "+N" on load.
    const delta = gold - prevGold;
    prevGold = gold;
    if (!goldSeeded) { goldSeeded = true; return; }
    if (delta > 0 && goldTickEl) {
      goldTickAmount += delta;
      goldTickLeft = GOLD_TICK_HOLD + GOLD_TICK_FADE;
      goldTickEl.textContent = `+${goldTickAmount}`;
    }
  });

  on((e) => {
    if (e.type === 'xp:absorbed') xpPulseTimer = 0.22;
    else if (e.type === 'gold:absorbed') { goldPulseTimer = 0.22; spawnGoldFleck(e.worldPos); }
    else if (e.type === 'level:up') {
      levelPulseTimer = 0.8;
      levelBloomLeft = LEVEL_BLOOM_DUR;
      showLevelToast(e.level);
    }
  });
}

// Diegetic "gold drains into the purse": each absorbed coin launches a small
// gold fleck that flies UP into the gold counter, popping the pulse on arrival —
// so earning gold reads as coins going somewhere, not a silent number bump. The
// fleck starts from the coin's REAL on-screen position (projected from where it
// was absorbed) so it's continuous with the coin, not a fake spawn near the
// bottom edge. Falls back to lower-centre only when the projection is
// unavailable. Capped so a big cascade can't flood the DOM.
const FLECK_SVG = `<svg width="14" height="14" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.5" fill="rgba(255,200,90,0.95)" stroke="rgba(255,230,160,0.95)" stroke-width="1"/></svg>`;

function spawnGoldFleck(worldPos?: { x: number; y: number; z: number }): void {
  const from = (worldPos && projectToScreen(worldPos))
    ?? { x: window.innerWidth / 2 + (Math.random() - 0.5) * 90, y: window.innerHeight * 0.72 };

  const el = document.createElement('div');
  el.innerHTML = FLECK_SVG;
  el.style.filter = 'drop-shadow(0 0 4px rgba(255,190,80,0.7))';
  flyToHud({
    from, targetEl: goldContainer, node: el, size: 14,
    accent: 'rgba(255,200,90,0.9)',
    onLand: () => { goldPulseTimer = 0.22; },
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

/** Per-frame update — pulse-animation decay only. The data (bar, level, gold)
 *  is store-bound in createXpGoldHud; this just eases the on-event flourishes
 *  (xp/gold absorb, level-up) back to rest. */
export function updateXpGoldHud(dt: number): void {
  if (!goldEl || !xpFillEl || !xpLevelEl || !xpFractionEl) return;

  // Keys — cheap poll of the inventory count (small bag); refresh the chip only
  // when it changes. Hidden while you carry none so it doesn't clutter.
  if (keysEl) {
    const keys = getCount(KEY_ID);
    if (keys !== prevKeys) {
      prevKeys = keys;
      keysEl.style.display = keys > 0 ? 'block' : 'none';
      if (keys > 0) keysEl.innerHTML = `${SVG_KEY}${keys}`;
    }
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

  // Floating "+N" gold tick: holds at rest while coins land (GOLD_TICK_LEFT
  // keeps resetting above the fade window), then rises + fades over the tail.
  if (goldTickEl) {
    if (goldTickLeft > 0) {
      goldTickLeft -= dt;
      const fade = Math.max(0, Math.min(1, goldTickLeft / GOLD_TICK_FADE));   // 1 → 0 over the tail
      goldTickEl.style.opacity = String(fade);
      goldTickEl.style.transform = `translateY(${-(1 - fade) * 14}px)`;
      if (goldTickLeft <= 0) goldTickAmount = 0;
    } else if (goldTickEl.style.opacity !== '0') {
      goldTickEl.style.opacity = '0';
      goldTickAmount = 0;
    }
  }

  // Level-up bloom — gold radial flash easing out over the swell.
  if (levelBloomEl) {
    if (levelBloomLeft > 0) {
      levelBloomLeft -= dt;
      const t = Math.max(0, levelBloomLeft / LEVEL_BLOOM_DUR);
      levelBloomEl.style.opacity = String(t * t);   // quick bloom, soft tail
    } else if (levelBloomEl.style.opacity !== '0') {
      levelBloomEl.style.opacity = '0';
    }
  }
}
