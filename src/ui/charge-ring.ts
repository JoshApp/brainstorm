// Charge-ring HUD overlay — visual telegraph for hold-to-charge.
//
// A small circular ring sits over the bottom-right attack zone. As the
// player holds the touch still, the ring fills CLOCKWISE from 12-o'clock
// — the same gesture a console game would map to a "press and hold"
// indicator. Fills over 550ms (from the 250ms tap-cancel threshold up
// to the fully-charged 800ms point). Disappears the moment the touch
// releases or drags.
//
// Cheap: one DOM element (an SVG circle), no per-frame allocations,
// updated by setting stroke-dashoffset directly. Mounted once at boot,
// hidden until the engine reports a non-zero progress.

import { getChargeProgress } from '../controls/charge-input';

const SIZE = 96;                  // px — outer SVG dimension
const STROKE = 6;                 // ring stroke width
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUM = 2 * Math.PI * RADIUS;

let root: HTMLDivElement | null = null;
let arc: SVGCircleElement | null = null;
let glow: SVGCircleElement | null = null;
let lastProgress = -1;

export function createChargeRing(): void {
  if (root) return;

  root = document.createElement('div');
  root.id = 'charge-ring';
  Object.assign(root.style, {
    position: 'fixed',
    // Sits at the bottom-right corner above the attack-zone, in the
    // same area the player's thumb is already on. Lifted clear of the
    // safe-area and the on-screen HUD pips.
    right: 'calc(48px + env(safe-area-inset-right, 0px))',
    bottom: 'calc(140px + env(safe-area-inset-bottom, 0px))',
    width: `${SIZE}px`,
    height: `${SIZE}px`,
    pointerEvents: 'none',
    opacity: '0',
    transition: 'opacity 120ms ease-out',
    zIndex: '20',
  } as Partial<CSSStyleDeclaration>);

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${SIZE} ${SIZE}`);
  svg.setAttribute('width', String(SIZE));
  svg.setAttribute('height', String(SIZE));

  // Backing track — faint stroke so the ring is visible even at 0%.
  const track = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  track.setAttribute('cx', String(SIZE / 2));
  track.setAttribute('cy', String(SIZE / 2));
  track.setAttribute('r', String(RADIUS));
  track.setAttribute('fill', 'none');
  track.setAttribute('stroke', 'rgba(220, 200, 160, 0.20)');
  track.setAttribute('stroke-width', String(STROKE));
  svg.appendChild(track);

  // Foreground arc — fills with charge progress. Starts at 12 o'clock
  // and sweeps clockwise via stroke-dashoffset.
  arc = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  arc.setAttribute('cx', String(SIZE / 2));
  arc.setAttribute('cy', String(SIZE / 2));
  arc.setAttribute('r', String(RADIUS));
  arc.setAttribute('fill', 'none');
  arc.setAttribute('stroke', 'rgba(255, 210, 130, 0.95)');
  arc.setAttribute('stroke-width', String(STROKE));
  arc.setAttribute('stroke-linecap', 'round');
  // Rotate so the arc starts at 12 o'clock (default is 3 o'clock).
  arc.setAttribute('transform', `rotate(-90 ${SIZE / 2} ${SIZE / 2})`);
  arc.setAttribute('stroke-dasharray', String(CIRCUM));
  arc.setAttribute('stroke-dashoffset', String(CIRCUM));
  svg.appendChild(arc);

  // Inner glow ring — wider, blurry, only visible at high charge.
  glow = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  glow.setAttribute('cx', String(SIZE / 2));
  glow.setAttribute('cy', String(SIZE / 2));
  glow.setAttribute('r', String(RADIUS - 4));
  glow.setAttribute('fill', 'none');
  glow.setAttribute('stroke', 'rgba(255, 220, 140, 0.0)');
  glow.setAttribute('stroke-width', '14');
  glow.setAttribute('filter', 'blur(6px)');
  svg.appendChild(glow);

  root.appendChild(svg);
  document.body.appendChild(root);
}

/** Called once per frame from the main loop. Reads the live charge
 *  progress and updates the ring. Early-outs when progress hasn't
 *  changed so we're not writing the DOM 60 times per second for
 *  nothing. */
export function tickChargeRing(): void {
  if (!root || !arc || !glow) return;
  const p = getChargeProgress();
  if (p === lastProgress) return;
  lastProgress = p;

  if (p <= 0) {
    root.style.opacity = '0';
    arc.setAttribute('stroke-dashoffset', String(CIRCUM));
    glow.setAttribute('stroke', 'rgba(255, 220, 140, 0.0)');
    return;
  }
  root.style.opacity = '1';
  // Dashoffset = full circumference at 0, zero at full charge.
  arc.setAttribute('stroke-dashoffset', String(CIRCUM * (1 - p)));
  // Glow ramps in past 50% so the player can FEEL the difference at
  // the higher charge tiers.
  const glowAlpha = Math.max(0, (p - 0.5) * 1.4);
  glow.setAttribute('stroke', `rgba(255, 220, 140, ${glowAlpha.toFixed(3)})`);
}
