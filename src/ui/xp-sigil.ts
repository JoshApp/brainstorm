import { on } from '../broadcast/event-bus';
import { xpStore, type XpState } from '../state/hud-stores';
import { hudStyleStore, getHudStyle } from './hud-style';
import { XP_COLORS } from './hud-design';
import { bind, FONT_SERIF } from './hud';

// MINIMAL + CINEMATIC style XP indicator — a circular sigil at the
// bottom-right corner with the level NUMBER engraved in the middle and
// a thin violet arc tracing progress to next level around it.
//
//   - Resting: dim, just the level number and a faint progress arc.
//   - XP gained: arc grows by the delta.
//   - Level up: gold flash + scale-bump pulse, then settles back at
//     the higher level.
//
// One SVG, one DOM update per state change. Per-frame work only during
// the brief level-up pulse decay.

const SIZE = 64;
const STROKE = 3;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUM = 2 * Math.PI * RADIUS;

let root: HTMLDivElement | null = null;
let arc: SVGCircleElement | null = null;
let track: SVGCircleElement | null = null;
let levelText: SVGTextElement | null = null;
let unsubStyle: (() => void) | null = null;
let levelPulseTimer = 0;

export function createXpSigil(): void {
  if (root) return;
  root = document.createElement('div');
  root.id = 'xp-sigil'; root.classList.add('game-hud');
  Object.assign(root.style, {
    position: 'fixed',
    right: `calc(16px + env(safe-area-inset-right, 0px))`,
    bottom: `calc(28px + env(safe-area-inset-bottom, 0px))`,
    width: `${SIZE}px`,
    height: `${SIZE}px`,
    pointerEvents: 'none',
    zIndex: '10',
    opacity: '0',
    transition: 'opacity 280ms ease-out, transform 320ms cubic-bezier(0.2, 0.7, 0.2, 1)',
    transformOrigin: 'center center',
  } as Partial<CSSStyleDeclaration>);

  const svgNs = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNs, 'svg');
  svg.setAttribute('width', String(SIZE));
  svg.setAttribute('height', String(SIZE));
  svg.setAttribute('viewBox', `0 0 ${SIZE} ${SIZE}`);
  svg.style.filter = 'drop-shadow(0 1px 3px rgba(0,0,0,0.9))';

  // Faint inner disc — gives the sigil a body so the number reads.
  const disc = document.createElementNS(svgNs, 'circle');
  disc.setAttribute('cx', String(SIZE / 2));
  disc.setAttribute('cy', String(SIZE / 2));
  disc.setAttribute('r', String(RADIUS - STROKE * 0.6));
  disc.setAttribute('fill', 'rgba(10, 8, 18, 0.55)');
  disc.setAttribute('stroke', 'rgba(120, 90, 180, 0.30)');
  disc.setAttribute('stroke-width', '1');
  svg.appendChild(disc);

  // Backing track for the progress arc.
  track = document.createElementNS(svgNs, 'circle');
  track.setAttribute('cx', String(SIZE / 2));
  track.setAttribute('cy', String(SIZE / 2));
  track.setAttribute('r', String(RADIUS));
  track.setAttribute('fill', 'none');
  track.setAttribute('stroke', 'rgba(160, 120, 200, 0.18)');
  track.setAttribute('stroke-width', String(STROKE));
  svg.appendChild(track);

  // Progress arc — violet, fills clockwise from 12 o'clock as you earn XP.
  arc = document.createElementNS(svgNs, 'circle');
  arc.setAttribute('cx', String(SIZE / 2));
  arc.setAttribute('cy', String(SIZE / 2));
  arc.setAttribute('r', String(RADIUS));
  arc.setAttribute('fill', 'none');
  arc.setAttribute('stroke', XP_COLORS.full);
  arc.setAttribute('stroke-width', String(STROKE));
  arc.setAttribute('stroke-linecap', 'round');
  arc.setAttribute('transform', `rotate(-90 ${SIZE / 2} ${SIZE / 2})`);
  arc.setAttribute('stroke-dasharray', String(CIRCUM));
  arc.setAttribute('stroke-dashoffset', String(CIRCUM));
  arc.style.transition = 'stroke-dashoffset 260ms ease-out, stroke 360ms ease-out';
  svg.appendChild(arc);

  // The level number engraved in the centre — serif for the arcane feel.
  levelText = document.createElementNS(svgNs, 'text');
  levelText.setAttribute('x', String(SIZE / 2));
  levelText.setAttribute('y', String(SIZE / 2));
  levelText.setAttribute('text-anchor', 'middle');
  levelText.setAttribute('dominant-baseline', 'central');
  levelText.setAttribute('font-family', FONT_SERIF);
  levelText.setAttribute('font-size', '22');
  levelText.setAttribute('font-weight', '600');
  levelText.setAttribute('fill', 'rgba(230, 220, 255, 0.95)');
  levelText.style.letterSpacing = '0.02em';
  levelText.textContent = '1';
  svg.appendChild(levelText);

  root.appendChild(svg);
  document.body.appendChild(root);

  unsubStyle = hudStyleStore.subscribe(() => applyVisibility());

  bind(xpStore, render);

  on((e) => {
    if (e.type === 'level:up') levelPulseTimer = 0.9;
  });

  applyVisibility();
}

function applyVisibility(): void {
  if (!root) return;
  const mode = getHudStyle().xp;
  root.style.opacity = mode === 'sigil' ? '0.88' : '0';
}

function render({ level, inLevel, next }: XpState): void {
  if (!root || !arc || !levelText) return;
  if (getHudStyle().xp !== 'sigil') return;
  const frac = next > 0 ? Math.max(0, Math.min(1, inLevel / next)) : 1;
  arc.setAttribute('stroke-dashoffset', String(CIRCUM * (1 - frac)));
  if (levelText.textContent !== String(level)) levelText.textContent = String(level);
}

/** Per-frame: ease the level-up flare back to rest. Called from the same
 *  render system that ticks the other HUD pulses. */
export function tickXpSigil(dt: number): void {
  if (!root || !arc || !levelText) return;
  if (levelPulseTimer <= 0) return;
  levelPulseTimer -= dt;
  const t = Math.max(0, levelPulseTimer / 0.9);
  // Pulse fades the gold flash + scale back to rest.
  const scale = 1 + t * 0.25;
  root.style.transform = `scale(${scale.toFixed(3)})`;
  arc.setAttribute('stroke', t > 0.05 ? XP_COLORS.levelUp : XP_COLORS.full);
  const tint = Math.round(220 + t * 35);
  levelText.setAttribute('fill', `rgba(${tint}, ${tint - 10}, 255, 1)`);
  if (levelPulseTimer <= 0) {
    root.style.transform = 'scale(1)';
    arc.setAttribute('stroke', XP_COLORS.full);
    levelText.setAttribute('fill', 'rgba(230, 220, 255, 0.95)');
  }
}

export function disposeXpSigil(): void {
  unsubStyle?.();
  unsubStyle = null;
  if (root?.parentNode) root.parentNode.removeChild(root);
  root = null;
  arc = null;
  track = null;
  levelText = null;
}
