import { getXp, getGold } from '../state/run-state';
import { on } from '../broadcast/event-bus';

// XP + gold readout — pinned to the top-RIGHT of the screen, opposite
// the depth counter. Mirrors the depth counter's "barely there" visual
// language: thin gold text, modest opacity, no panel chrome. The bar's
// JOB is to confirm "yes the kill counted" — not to dominate the HUD.
//
// Layout:
//     [GOLD glyph]  142
//     [XP   glyph]  18 / 50
//
// "/50" is the next-level threshold once the leveling system exists —
// for now we show just the raw XP number. Add the bar fill when levels
// land.

let container: HTMLDivElement | null = null;
let goldEl: HTMLDivElement | null = null;
let xpEl: HTMLDivElement | null = null;
let pulseTimer = 0;
let lastXp = -1;
let lastGold = -1;

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
    gap: '4px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: '12px',
    fontWeight: '500',
    letterSpacing: '0.18em',
    textShadow: '0 0 6px rgba(0,0,0,0.85)',
    pointerEvents: 'none',
    zIndex: '10',
    userSelect: 'none',
    WebkitUserSelect: 'none',
  } as Partial<CSSStyleDeclaration>);

  goldEl = document.createElement('div');
  Object.assign(goldEl.style, {
    color: 'rgba(255, 210, 110, 0.85)',
    transition: 'transform 180ms ease-out, color 180ms ease-out',
  } as Partial<CSSStyleDeclaration>);
  container.appendChild(goldEl);

  xpEl = document.createElement('div');
  Object.assign(xpEl.style, {
    color: 'rgba(140, 180, 255, 0.85)',
    transition: 'transform 220ms ease-out, color 220ms ease-out',
  } as Partial<CSSStyleDeclaration>);
  container.appendChild(xpEl);

  document.body.appendChild(container);

  // XP absorb event — fired each time a wisp lands on the player. Kick
  // a brief scale-pulse on the XP line so the absorb feels like it
  // landed somewhere.
  on((e) => {
    if (e.type === 'xp:absorbed') pulseTimer = 0.22;
  });
}

/** Per-frame update. Cheap — only mutates DOM when the values change. */
export function updateXpGoldHud(dt: number): void {
  if (!container || !goldEl || !xpEl) return;
  const xp = getXp();
  const gold = getGold();
  if (gold !== lastGold) {
    goldEl.textContent = `◆ ${gold}`;
    lastGold = gold;
  }
  if (xp !== lastXp) {
    xpEl.textContent = `✦ ${xp}`;
    lastXp = xp;
  }
  // Pulse decay
  if (pulseTimer > 0) {
    pulseTimer -= dt;
    const t = Math.max(0, pulseTimer / 0.22);
    const scale = 1 + t * 0.18;
    xpEl.style.transform = `scale(${scale})`;
    xpEl.style.color = `rgba(${Math.round(180 + t * 75)}, ${Math.round(200 + t * 40)}, 255, ${0.85 + t * 0.15})`;
  } else {
    xpEl.style.transform = 'scale(1)';
    xpEl.style.color = 'rgba(140, 180, 255, 0.85)';
  }
}
