import { staminaStore, type StaminaState } from '../state/hud-stores';
import { hudStyleStore, getHudStyle } from './hud-style';
import { STAMINA_COLORS } from './hud-design';
import { bind } from './hud';

// MINIMAL-style stamina indicator — a thin arc around screen-centre
// (where the gaze focuses in first-person). Full circle at rest;
// depletes counter-clockwise as stamina is spent. Auto-hides while
// rested so the centre of the screen is clean during exploration.
//
//   - Idle (rested + full): hidden.
//   - Spending: full ring → depletes counter-clockwise from 12 o'clock.
//   - Exhausted: tints red, holds visible until refilled.
//
// Cheap: one SVG, two <circle> nodes (track + arc). Only the arc's
// stroke-dashoffset updates per state change.

const SIZE = 56;
const STROKE = 2.5;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUM = 2 * Math.PI * RADIUS;

let root: HTMLDivElement | null = null;
let arc: SVGCircleElement | null = null;
let track: SVGCircleElement | null = null;
let unsubStyle: (() => void) | null = null;

export function createStaminaArc(): void {
  if (root) return;
  root = document.createElement('div');
  root.id = 'stamina-arc';
  Object.assign(root.style, {
    position: 'fixed',
    left: '50%',
    top: '50%',
    width: `${SIZE}px`,
    height: `${SIZE}px`,
    transform: 'translate(-50%, -50%)',
    pointerEvents: 'none',
    zIndex: '9',  // below the charge ring (zIndex 20)
    opacity: '0',
    transition: 'opacity 280ms ease-out',
  } as Partial<CSSStyleDeclaration>);

  const svgNs = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNs, 'svg');
  svg.setAttribute('width', String(SIZE));
  svg.setAttribute('height', String(SIZE));
  svg.setAttribute('viewBox', `0 0 ${SIZE} ${SIZE}`);
  svg.style.filter = 'drop-shadow(0 0 3px rgba(0,0,0,0.85))';

  // Backing track — almost invisible; just enough to suggest the ring.
  track = document.createElementNS(svgNs, 'circle');
  track.setAttribute('cx', String(SIZE / 2));
  track.setAttribute('cy', String(SIZE / 2));
  track.setAttribute('r', String(RADIUS));
  track.setAttribute('fill', 'none');
  track.setAttribute('stroke', 'rgba(255, 220, 140, 0.10)');
  track.setAttribute('stroke-width', String(STROKE));
  svg.appendChild(track);

  // Foreground arc — starts at 12 o'clock, depletes counter-clockwise as
  // stamina drops. (Clockwise feels like "filling" — counter-clockwise
  // reads as "draining".)
  arc = document.createElementNS(svgNs, 'circle');
  arc.setAttribute('cx', String(SIZE / 2));
  arc.setAttribute('cy', String(SIZE / 2));
  arc.setAttribute('r', String(RADIUS));
  arc.setAttribute('fill', 'none');
  arc.setAttribute('stroke', STAMINA_COLORS.full);
  arc.setAttribute('stroke-width', String(STROKE));
  arc.setAttribute('stroke-linecap', 'round');
  // Rotate so 12 o'clock = arc start; flip horizontally to drain CCW.
  arc.setAttribute('transform', `rotate(-90 ${SIZE / 2} ${SIZE / 2}) scale(-1 1) translate(${-SIZE} 0)`);
  arc.setAttribute('stroke-dasharray', String(CIRCUM));
  arc.setAttribute('stroke-dashoffset', '0');
  arc.style.transition = 'stroke-dashoffset 140ms ease-out, stroke 220ms ease-out';
  svg.appendChild(arc);

  root.appendChild(svg);
  document.body.appendChild(root);

  unsubStyle = hudStyleStore.subscribe(() => applyVisibility());

  bind(staminaStore, render);
}

function applyVisibility(): void {
  if (!root) return;
  // Will be overridden by render() — but if the mode flips off we hide
  // now without waiting for a stamina update.
  if (getHudStyle().stamina !== 'breath') root.style.opacity = '0';
}

function render({ frac, rested, exhausted }: StaminaState): void {
  if (!root || !arc) return;
  if (getHudStyle().stamina !== 'breath') {
    root.style.opacity = '0';
    return;
  }
  const f = Math.max(0, Math.min(1, frac));
  // Hide entirely when rested and full — the indicator should ONLY
  // appear when stamina is in motion.
  const visible = !rested || exhausted || f < 0.999;
  root.style.opacity = visible ? (exhausted ? '1' : '0.85') : '0';

  // Dashoffset goes from 0 (full ring) to CIRCUM (no ring) as f drops.
  arc.setAttribute('stroke-dashoffset', String(CIRCUM * (1 - f)));

  // Red tint when nearly gone; restored amber once safely above the floor.
  arc.setAttribute('stroke', f < 0.2
    ? 'rgba(210, 110, 90, 0.95)'
    : STAMINA_COLORS.full);
}

export function disposeStaminaArc(): void {
  unsubStyle?.();
  unsubStyle = null;
  if (root?.parentNode) root.parentNode.removeChild(root);
  root = null;
  arc = null;
  track = null;
}
