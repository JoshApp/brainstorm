// Charge-ring HUD overlay — visual telegraph for hold-to-charge.
//
// Anchors to the THUMB position (set by input-touch's per-frame tick)
// rather than a fixed corner — feedback lives where the gesture is.
// The ring uses screen pixels (not the canvas's renderer space) so it
// scales correctly across DPRs without needing a custom render layer.
//
// Two states the player should be able to read at a glance:
//   - RAMPING (0 < progress < 1): clockwise arc fills, soft amber.
//   - FULLY COOKED (progress >= 1): the ring PULSES + brightens to a
//     hot gold. This is the "release NOW" tell. Overcharging past
//     the sweet spot still fires the max-payoff swing; we just
//     emphasise the moment so the player learns to release there.
//
// Cheap: one DOM element + an SVG circle. No per-frame allocations.
// Updated by setting stroke-dashoffset + style.left/top/transform.

import { getChargeProgress, getChargePosition, isChargePerfectWindow } from '../controls/charge-input';

const SIZE = 96;                  // px — outer SVG dimension
const STROKE = 6;                 // ring stroke width
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUM = 2 * Math.PI * RADIUS;
// Hot-gold pulse oscillation rate while the charge is overcooked.
const PULSE_HZ = 2.4;

let root: HTMLDivElement | null = null;
let arc: SVGCircleElement | null = null;
let glow: SVGCircleElement | null = null;

export function createChargeRing(): void {
  if (root) return;

  root = document.createElement('div');
  root.id = 'charge-ring'; root.classList.add('game-hud');
  Object.assign(root.style, {
    position: 'fixed',
    // Centred on (0,0) — input-touch's tick repositions per frame
    // by setting left/top. Translate -50% so the anchor is the ring
    // CENTRE, not its corner.
    left: '0px',
    top:  '0px',
    width: `${SIZE}px`,
    height: `${SIZE}px`,
    transform: 'translate(-50%, -50%)',
    pointerEvents: 'none',
    opacity: '0',
    transition: 'opacity 120ms ease-out',
    zIndex: '20',
    // Will-change hint so the browser composites this on its own
    // layer — sub-pixel movement during touch-track stays smooth.
    willChange: 'left, top, opacity',
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
  track.setAttribute('stroke', 'rgba(220, 200, 160, 0.22)');
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

  // Inner glow ring — wider, blurry. Drives the "fully cooked" pulse.
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
 *  progress + thumb position; updates ring position, arc fill, and
 *  glow / pulse. Early-outs when no charge is in flight. */
export function tickChargeRing(): void {
  if (!root || !arc || !glow) return;
  const p = getChargeProgress();
  const pos = getChargePosition();

  if (p <= 0 || !pos) {
    root.style.opacity = '0';
    return;
  }
  root.style.opacity = '1';
  // Position the ring at the thumb. CSS left/top + the transform=
  // -50% above centre the circle on the touch point.
  root.style.left = `${pos.x}px`;
  root.style.top  = `${pos.y}px`;

  // Arc fill — dashoffset goes from full circumference (0%) to 0
  // (100%). Clamp at 1 so overcharges show a full ring rather than
  // a negative offset.
  const visible = Math.min(1, p);
  arc.setAttribute('stroke-dashoffset', String(CIRCUM * (1 - visible)));

  // Below 100%: smooth amber ramp. Glow ramps in past 50% so the
  // higher charge tiers gain a soft halo.
  // At/above 100%: SWEET SPOT — both the arc colour and the glow
  // pulse on a sine wave so the eye locks onto the moment to
  // release. Frequency tuned to feel "ready, ready, ready" without
  // being strobe-y.
  if (isChargePerfectWindow()) {
    // PERFECT-RELEASE window — flash bright white so "release NOW" is
    // unmistakable. Distinct from the gold full-charge pulse below: white =
    // overcharge available, gold = full but you've held past the window.
    arc.setAttribute('stroke', 'rgba(255, 255, 255, 1)');
    glow.setAttribute('stroke', 'rgba(235, 245, 255, 0.95)');
  } else if (p >= 1) {
    const phase = (performance.now() / 1000) * (Math.PI * 2 * PULSE_HZ);
    const pulse = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(phase));   // 0.55..1.0
    arc.setAttribute('stroke', `rgba(255, 240, 180, ${(0.85 + 0.15 * pulse).toFixed(3)})`);
    glow.setAttribute('stroke', `rgba(255, 230, 150, ${(0.55 * pulse).toFixed(3)})`);
  } else {
    arc.setAttribute('stroke', 'rgba(255, 210, 130, 0.95)');
    const glowAlpha = Math.max(0, (p - 0.5) * 1.4);
    glow.setAttribute('stroke', `rgba(255, 220, 140, ${glowAlpha.toFixed(3)})`);
  }
}
