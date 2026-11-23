import { staminaStore, type StaminaState } from '../state/hud-stores';
import { hudStyleStore, getHudStyle } from './hud-style';
import { bind } from './hud';

// MINIMAL-style stamina (the default HUD) — three carved, pointed segments
// just above the hearts, in the hearts' own frame (dark iron, gold hairline),
// filled pale verdigris; a lit edge rides the draining end (Lamplight concept,
// 2026-11-23: Josh asked for the concept's look).
//
//   - Idle (rested + full): hidden. It shows while you spend it, then goes.
//   - Spending: depletes RIGHT-to-LEFT, the rightmost segment first. While
//     it drains, a bright edge burns at the end of the fill.
//   - Low (< 20%) or exhausted: the fill turns ember-red; exhausted holds it
//     visible until refilled.
//   - A held heavy charge shows its reservation as a hatched slice past the
//     live fill.
//
// One inline SVG; per change only clip widths and the edge move.

const SEGMENTS = 3;
const VB_W = 240, VB_H = 14, SEG_STEP = 80, SEG_PAD = 2, SEG_W = 76;
const BAR_W = 220;      // px on screen

/** A pointed segment: a long hexagon, ends drawn to a point. */
const segPoints = (x0: number, x1: number): string =>
  `${x0},7 ${x0 + 6},1.5 ${x1 - 6},1.5 ${x1},7 ${x1 - 6},12.5 ${x0 + 6},12.5`;

interface Segment { clip: SVGRectElement; fill: SVGPolygonElement; edge: SVGRectElement; res: SVGRectElement; }

let root: HTMLDivElement | null = null;
const segments: Segment[] = [];
let unsubStyle: (() => void) | null = null;
let prevFrac = 1;
/** The fill gradients' url() refs (ids are unique per build). */
let okFill = '';
let lowFill = '';

const NS = 'http://www.w3.org/2000/svg';
function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

export function createStaminaArc(): void {
  if (root) return;
  root = document.createElement('div');
  root.id = 'stamina-line'; root.classList.add('game-hud');
  Object.assign(root.style, {
    position: 'fixed',
    left: '50%',
    bottom: `calc(48px + env(safe-area-inset-bottom, 0px))`,
    transform: 'translateX(-50%)',
    width: `${BAR_W}px`,
    pointerEvents: 'none',
    zIndex: '10',
    opacity: '0',
    transition: 'opacity 320ms ease-out',
    filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.85))',
  } as Partial<CSSStyleDeclaration>);

  const uid = Math.random().toString(36).slice(2, 7);
  const svg = el('svg', { viewBox: `0 0 ${VB_W} ${VB_H}`, width: '100%', 'aria-hidden': 'true' });
  svg.style.display = 'block';
  svg.style.overflow = 'visible';
  const defs = el('defs', {});
  const grad = el('linearGradient', { id: `sg-${uid}`, x1: 0, y1: 0, x2: 0, y2: 1 });
  grad.append(el('stop', { offset: 0, 'stop-color': '#d8eaa8' }), el('stop', { offset: 0.5, 'stop-color': '#9cc05e' }), el('stop', { offset: 1, 'stop-color': '#4f7a2a' }));
  const low = el('linearGradient', { id: `sl-${uid}`, x1: 0, y1: 0, x2: 0, y2: 1 });
  low.append(el('stop', { offset: 0, 'stop-color': '#ffb08a' }), el('stop', { offset: 0.5, 'stop-color': '#d8604a' }), el('stop', { offset: 1, 'stop-color': '#7a2418' }));
  const hatch = el('pattern', { id: `sh-${uid}`, width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' });
  hatch.append(el('rect', { width: 3, height: 6, fill: 'rgba(255,225,170,0.85)' }), el('rect', { x: 3, width: 3, height: 6, fill: 'rgba(255,225,170,0.25)' }));
  defs.append(grad, low, hatch);
  svg.appendChild(defs);

  for (let i = 0; i < SEGMENTS; i++) {
    const x0 = i * SEG_STEP + SEG_PAD, x1 = x0 + SEG_W;
    const cp = el('clipPath', { id: `sc-${uid}-${i}` });
    const clip = el('rect', { x: x0, y: 0, width: SEG_W, height: VB_H });
    cp.appendChild(clip);
    const shape = el('clipPath', { id: `ss-${uid}-${i}` });
    shape.appendChild(el('polygon', { points: segPoints(x0 + 1.5, x1 - 1.5) }));
    defs.append(cp, shape);
    // Track: the hearts' empty frame.
    svg.appendChild(el('polygon', { points: segPoints(x0, x1), fill: 'rgba(14,8,8,0.78)', stroke: 'rgba(180,140,80,0.55)', 'stroke-width': 1 }));
    const fill = el('polygon', { points: segPoints(x0 + 1.5, x1 - 1.5), fill: `url(#sg-${uid})`, 'clip-path': `url(#sc-${uid}-${i})` });
    svg.appendChild(fill);
    const g = el('g', { 'clip-path': `url(#ss-${uid}-${i})` });
    const res = el('rect', { x: x0, y: 0, width: 0, height: VB_H, fill: `url(#sh-${uid})`, opacity: 0 });
    g.appendChild(res);
    svg.appendChild(g);
    const edge = el('rect', { x: x0, y: 2.5, width: 1.6, height: 9, fill: '#f4ffd8', opacity: 0 });
    edge.style.filter = 'drop-shadow(0 0 3px #d8ffa0)';
    svg.appendChild(edge);
    segments.push({ clip, fill, edge, res });
  }
  okFill = `url(#sg-${uid})`;
  lowFill = `url(#sl-${uid})`;
  root.appendChild(svg);
  document.body.appendChild(root);

  unsubStyle = hudStyleStore.subscribe(() => applyVisibility());

  bind(staminaStore, render);
}

function applyVisibility(): void {
  if (!root) return;
  if (getHudStyle().stamina !== 'breath') root.style.opacity = '0';
}

function render({ frac, rested, exhausted, reserved }: StaminaState): void {
  if (!root) return;
  if (getHudStyle().stamina !== 'breath') {
    root.style.opacity = '0';
    return;
  }
  const f = Math.max(0, Math.min(1, frac));
  // Stay visible while a charge is reserving so the hatched preview is seen
  // even when otherwise rested.
  const visible = !rested || exhausted || f < 0.999 || reserved > 0;
  root.style.opacity = visible ? (exhausted ? '1' : '0.92') : '0';
  const draining = f < prevFrac - 1e-4;
  prevFrac = f;
  const fillRef = f < 0.2 || exhausted ? lowFill : okFill;
  const reservedEnd = Math.min(f + Math.max(0, reserved), 1);

  for (let i = 0; i < SEGMENTS; i++) {
    const seg = segments[i];
    const x0 = i * SEG_STEP + SEG_PAD;
    const segMin = i / SEGMENTS, segMax = (i + 1) / SEGMENTS, span = segMax - segMin;
    const segFill = Math.max(0, Math.min(1, (f - segMin) / span));
    seg.clip.setAttribute('width', (SEG_W * segFill).toFixed(2));
    seg.fill.setAttribute('fill', fillRef);
    // The lit edge burns at the end of the fill while it drains.
    const edgeOn = draining && segFill > 0.02 && segFill < 0.98;
    seg.edge.setAttribute('x', (x0 + SEG_W * segFill - 0.8).toFixed(2));
    seg.edge.setAttribute('opacity', edgeOn ? '0.95' : '0');
    // Reserved slice within this segment: [f, reservedEnd] ∩ [segMin, segMax].
    const sliceStart = Math.max(f, segMin), sliceEnd = Math.min(reservedEnd, segMax);
    if (reserved > 0 && sliceEnd > sliceStart) {
      seg.res.setAttribute('x', (x0 + SEG_W * ((sliceStart - segMin) / span)).toFixed(2));
      seg.res.setAttribute('width', (SEG_W * ((sliceEnd - sliceStart) / span)).toFixed(2));
      seg.res.setAttribute('opacity', '1');
    } else {
      seg.res.setAttribute('opacity', '0');
    }
  }
}

export function disposeStaminaArc(): void {
  unsubStyle?.();
  unsubStyle = null;
  if (root?.parentNode) root.parentNode.removeChild(root);
  root = null;
  segments.length = 0;
}
