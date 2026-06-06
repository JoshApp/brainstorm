import { hpStore, type HpState } from '../state/hud-stores';
import { hudStyleStore, getHudStyle } from './hud-style';
import { HEALTH_COLORS } from './hud-design';
import { bind } from './hud';

// TotK-style heart row for the MINIMAL HUD style. One heart per HP with
// quarter-heart granularity (4 chunks per heart, like Zelda). Brick-red
// fill, dark-iron empty frame, hairline gold edge so the silhouette
// reads on a torchlit floor without shouting.
//
// Layout:
//   - Up to 10 hearts per row, wraps UP to a second row when max HP > 10.
//   - Sits at the bottom-center, above the XP bar slot. Hidden under
//     Classic (pip bar wins) and Cinematic (all HUD off — feel only).
//
// Rendering:
//   - Each heart is an inline <svg> with two paths: a frame (always
//     drawn) and a fill (clipped horizontally by a <rect> whose width
//     = fraction × heart width). Right-to-left quarter wipe so chunks
//     fall off the right edge as you take damage — the classic Zelda
//     read.
//
// Data flow: bound to hpStore + hudStyleStore. No per-frame work.

const HEART_PX = 28;
const HEART_GAP = 4;
const ROW_GAP = 4;
const PER_ROW = 10;

// Quarter-heart granularity: damage chunks of 0.25 HP. With integer HP
// this is effectively whole hearts, but the same code handles fractional
// HP (DoT ticks, % damage) without flicker.
const STEPS = 4;

let root: HTMLDivElement | null = null;
let hearts: HeartSvg[] = [];
let builtMax = -1;
let unsubStyle: (() => void) | null = null;

interface HeartSvg {
  el: SVGSVGElement;
  clip: SVGRectElement;
  frame: SVGPathElement;
  fill: SVGPathElement;
}

// 24×24 viewBox heart path. Standard rounded silhouette.
const HEART_PATH =
  'M12 21.35 L10.55 20.03 C5.4 15.36 2 12.28 2 8.5 ' +
  'C2 5.42 4.42 3 7.5 3 C9.24 3 10.91 3.81 12 5.09 ' +
  'C13.09 3.81 14.76 3 16.5 3 C19.58 3 22 5.42 22 8.5 ' +
  'C22 12.28 18.6 15.36 13.45 20.04 Z';

export function createHealthHearts(): void {
  if (root) return;
  root = document.createElement('div');
  root.id = 'health-hearts';
  Object.assign(root.style, {
    position: 'fixed',
    left: '50%',
    // Above the XP bar (which sits at bottom: env(safe-area-inset-bottom)).
    bottom: `calc(14px + env(safe-area-inset-bottom, 0px))`,
    transform: 'translateX(-50%)',
    display: 'flex',
    flexDirection: 'column-reverse',
    alignItems: 'center',
    gap: `${ROW_GAP}px`,
    pointerEvents: 'none',
    zIndex: '10',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    opacity: '0',
    transition: 'opacity 240ms ease-out',
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(root);

  // Re-evaluate visibility when the style switches.
  unsubStyle = hudStyleStore.subscribe(() => applyVisibility());

  bind(hpStore, render);
}

function applyVisibility(): void {
  if (!root) return;
  const mode = getHudStyle().health;
  root.style.opacity = mode === 'pips' ? '1' : '0';
}

function buildHearts(max: number): void {
  if (!root) return;
  root.replaceChildren();
  hearts = [];
  // Build rows bottom-up; flexDirection: column-reverse means the FIRST
  // row appended is at the BOTTOM, the second row stacks above.
  const rows = Math.max(1, Math.ceil(max / PER_ROW));
  let idx = 0;
  for (let r = 0; r < rows; r++) {
    const row = document.createElement('div');
    Object.assign(row.style, {
      display: 'flex',
      gap: `${HEART_GAP}px`,
    } as Partial<CSSStyleDeclaration>);
    const count = Math.min(PER_ROW, max - idx);
    for (let i = 0; i < count; i++) {
      const heart = buildHeart(idx);
      hearts.push(heart);
      row.appendChild(heart.el);
      idx++;
    }
    root.appendChild(row);
  }
  builtMax = max;
}

function buildHeart(i: number): HeartSvg {
  const svgNs = 'http://www.w3.org/2000/svg';
  const el = document.createElementNS(svgNs, 'svg');
  el.setAttribute('width', String(HEART_PX));
  el.setAttribute('height', String(HEART_PX));
  el.setAttribute('viewBox', '0 0 24 24');
  el.style.display = 'block';
  el.style.filter = 'drop-shadow(0 1px 2px rgba(0,0,0,0.85))';

  // Per-heart clipPath that wipes the fill from right to left.
  const clipId = `heart-clip-${i}-${Math.random().toString(36).slice(2, 7)}`;
  const defs = document.createElementNS(svgNs, 'defs');
  const clipPath = document.createElementNS(svgNs, 'clipPath');
  clipPath.setAttribute('id', clipId);
  const clip = document.createElementNS(svgNs, 'rect');
  clip.setAttribute('x', '0');
  clip.setAttribute('y', '0');
  clip.setAttribute('width', '24');
  clip.setAttribute('height', '24');
  clipPath.appendChild(clip);
  defs.appendChild(clipPath);
  el.appendChild(defs);

  // Empty heart frame — dark iron + hairline gold edge.
  const frame = document.createElementNS(svgNs, 'path');
  frame.setAttribute('d', HEART_PATH);
  frame.setAttribute('fill', 'rgba(14, 8, 8, 0.78)');
  frame.setAttribute('stroke', 'rgba(180, 140, 80, 0.55)');
  frame.setAttribute('stroke-width', '1.2');
  frame.setAttribute('stroke-linejoin', 'round');
  el.appendChild(frame);

  // Filled heart — clipped by the rect above.
  const fill = document.createElementNS(svgNs, 'path');
  fill.setAttribute('d', HEART_PATH);
  fill.setAttribute('fill', HEALTH_COLORS.full);
  fill.setAttribute('stroke', 'rgba(80, 18, 18, 0.9)');
  fill.setAttribute('stroke-width', '0.8');
  fill.setAttribute('stroke-linejoin', 'round');
  fill.setAttribute('clip-path', `url(#${clipId})`);
  el.appendChild(fill);

  return { el, clip, frame, fill };
}

function render({ hp, max }: HpState): void {
  if (!root) return;
  if (max <= 0) return;
  if (max !== builtMax) buildHearts(max);

  const frac = max > 0 ? Math.max(0, Math.min(1, hp / max)) : 0;
  // Resting opacity dims when full so the row recedes; critical pins to
  // full opacity so a near-death heart still SHOUTS.
  const critical = frac < 0.2;
  const warning = frac < 0.4;
  root.style.opacity = getHudStyle().health === 'pips'
    ? (critical ? '1' : warning ? '0.95' : '0.85')
    : '0';

  const fillColor = critical ? HEALTH_COLORS.critical
                  : warning  ? HEALTH_COLORS.warning
                  :            HEALTH_COLORS.full;

  // Walk each heart, fill from left (heart 0) to right with quarter-heart
  // steps. Damage drops from the right edge of the last partially-full
  // heart, classic Zelda style.
  let remaining = hp;
  for (let i = 0; i < hearts.length; i++) {
    const h = hearts[i];
    const heartFrac = Math.max(0, Math.min(1, remaining));
    // Quantize to STEPS-quarter granularity.
    const quantized = Math.round(heartFrac * STEPS) / STEPS;
    h.clip.setAttribute('width', String(24 * quantized));
    h.fill.setAttribute('fill', fillColor);
    remaining = Math.max(0, remaining - 1);
  }
}

export function disposeHealthHearts(): void {
  unsubStyle?.();
  unsubStyle = null;
  if (root?.parentNode) root.parentNode.removeChild(root);
  root = null;
  hearts = [];
  builtMax = -1;
}

