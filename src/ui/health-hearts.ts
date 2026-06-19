import { hpStore, type HpState } from '../state/hud-stores';
import { hudStyleStore, getHudStyle } from './hud-style';
import { HEALTH_COLORS } from './hud-design';
import { heartFillFractions, heartCount, HEART_HP } from './heart-fill';
import { bind } from './hud';

// TotK-style heart row for the MINIMAL HUD style. Each heart is worth TWO HP,
// so a single point of damage leaves a HALF-broken heart (left half filled,
// right half empty — the classic Zelda read, produced by the right-to-left
// horizontal clip). Brick-red fill, dark-iron empty frame, hairline gold edge.
//
// Layout:
//   - ceil(maxHP / 2) hearts, up to 10 per row, wraps UP to a second row.
//   - Bottom-center, above the XP bar slot. Hidden under Classic / Cinematic.
//
// Rendering:
//   - Each heart is an inline <svg>: a frame (always drawn) + a fill clipped
//     by a <rect> whose width = fraction × heart width. Damage wipes the fill
//     from the right, so 1 HP into a 2-HP heart reads as a half heart.
//   - When health is LOW the whole row pulses (scale + red glow), the
//     "you're about to die" heartbeat à la Tears of the Kingdom.
//
// Data flow: bound to hpStore + hudStyleStore. No per-frame work.

const HEART_PX = 28;
const HEART_GAP = 4;
const ROW_GAP = 4;
const PER_ROW = 10;

// HP-per-heart + the half-heart fill math live in ./heart-fill (pure, testable).

// Health fraction at/below which the row pulses (your last heart-ish).
const LOW_BLINK_FRAC = 0.25;

let root: HTMLDivElement | null = null;
let bar: HTMLDivElement | null = null;   // inner wrapper that carries the low-HP pulse
let hearts: HeartSvg[] = [];
let builtMax = -1;
let prevHp = Infinity;   // last rendered hp — detects a fresh wound to re-alarm
let wasLow = false;      // was the previous frame in the low-HP band
let unsubStyle: (() => void) | null = null;

interface HeartSvg {
  el: SVGSVGElement;
  clip: SVGRectElement;
  frameClip: SVGRectElement;
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
  root.id = 'health-hearts'; root.classList.add('game-hud');
  Object.assign(root.style, {
    position: 'fixed',
    left: '50%',
    // Above the XP bar (which sits at bottom: env(safe-area-inset-bottom)).
    bottom: `calc(14px + env(safe-area-inset-bottom, 0px))`,
    transform: 'translateX(-50%)',
    pointerEvents: 'none',
    zIndex: '10',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    opacity: '0',
    transition: 'opacity 240ms ease-out',
  } as Partial<CSSStyleDeclaration>);

  // Inner bar carries the heart rows AND the low-HP pulse animation, so the
  // root keeps owning centering + base opacity without the two fighting.
  bar = document.createElement('div');
  Object.assign(bar.style, {
    display: 'flex',
    flexDirection: 'column-reverse',
    alignItems: 'center',
    gap: `${ROW_GAP}px`,
    transformOrigin: 'center bottom',
  } as Partial<CSSStyleDeclaration>);
  root.appendChild(bar);

  // Inject the low-HP heartbeat keyframes once (no stylesheet otherwise).
  if (!document.getElementById('health-hearts-keyframes')) {
    const style = document.createElement('style');
    style.id = 'health-hearts-keyframes';
    // A double-thump heartbeat: two quick swells then a rest — the TotK
    // "danger" pulse. Scale + a red glow/brightness flash on the row.
    style.textContent = `
      @keyframes heartLowPulse {
        0%   { transform: scale(1);    filter: none; }
        12%  { transform: scale(1.10); filter: drop-shadow(0 0 6px rgba(255,70,50,0.95)) brightness(1.35); }
        24%  { transform: scale(1);    filter: none; }
        36%  { transform: scale(1.08); filter: drop-shadow(0 0 5px rgba(255,70,50,0.85)) brightness(1.25); }
        48%  { transform: scale(1);    filter: none; }
        100% { transform: scale(1);    filter: none; }
      }`;
    document.head.appendChild(style);
  }

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
  if (!bar) return;
  bar.replaceChildren();
  hearts = [];
  const total = heartCount(max);
  // Build rows bottom-up; flexDirection: column-reverse means the FIRST row
  // appended is at the BOTTOM, the second row stacks above.
  const rows = Math.max(1, Math.ceil(total / PER_ROW));
  let idx = 0;
  for (let r = 0; r < rows; r++) {
    const row = document.createElement('div');
    Object.assign(row.style, {
      display: 'flex',
      gap: `${HEART_GAP}px`,
    } as Partial<CSSStyleDeclaration>);
    const count = Math.min(PER_ROW, total - idx);
    for (let i = 0; i < count; i++) {
      const heart = buildHeart(idx);
      hearts.push(heart);
      row.appendChild(heart.el);
      idx++;
    }
    bar.appendChild(row);
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

  const rnd = Math.random().toString(36).slice(2, 7);
  const defs = document.createElementNS(svgNs, 'defs');

  // Per-heart clipPath that wipes the FILL from right to left.
  const clipId = `heart-clip-${i}-${rnd}`;
  const clipPath = document.createElementNS(svgNs, 'clipPath');
  clipPath.setAttribute('id', clipId);
  const clip = document.createElementNS(svgNs, 'rect');
  clip.setAttribute('x', '0');
  clip.setAttribute('y', '0');
  clip.setAttribute('width', '24');
  clip.setAttribute('height', '24');
  clipPath.appendChild(clip);
  defs.appendChild(clipPath);

  // A SECOND clip for the empty FRAME. Normally full-width (a whole heart
  // container), but the trailing heart of an ODD max HP only HOLDS half a
  // heart — clip its container to the left half so it reads as a true half-
  // heart, not a full heart with a healable-looking empty right half.
  const frameClipId = `heart-frameclip-${i}-${rnd}`;
  const frameClipPath = document.createElementNS(svgNs, 'clipPath');
  frameClipPath.setAttribute('id', frameClipId);
  const frameClip = document.createElementNS(svgNs, 'rect');
  frameClip.setAttribute('x', '0');
  frameClip.setAttribute('y', '0');
  frameClip.setAttribute('width', '24');
  frameClip.setAttribute('height', '24');
  frameClipPath.appendChild(frameClip);
  defs.appendChild(frameClipPath);
  el.appendChild(defs);

  // Empty heart frame — dark iron + hairline gold edge.
  const frame = document.createElementNS(svgNs, 'path');
  frame.setAttribute('d', HEART_PATH);
  frame.setAttribute('fill', 'rgba(14, 8, 8, 0.78)');
  frame.setAttribute('stroke', 'rgba(180, 140, 80, 0.55)');
  frame.setAttribute('stroke-width', '1.2');
  frame.setAttribute('stroke-linejoin', 'round');
  frame.setAttribute('clip-path', `url(#${frameClipId})`);
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

  return { el, clip, frameClip, frame, fill };
}

function render({ hp, max }: HpState): void {
  if (!root || !bar) return;
  if (max <= 0) return;
  if (max !== builtMax) buildHearts(max);

  const frac = max > 0 ? Math.max(0, Math.min(1, hp / max)) : 0;
  // Resting opacity dims when full so the row recedes; critical pins to full
  // opacity so a near-death heart still SHOUTS.
  const critical = frac < 0.2;
  const warning = frac < 0.4;
  root.style.opacity = getHudStyle().health === 'pips'
    ? (critical ? '1' : warning ? '0.95' : '0.85')
    : '0';

  const fillColor = critical ? HEALTH_COLORS.critical
                  : warning  ? HEALTH_COLORS.warning
                  :            HEALTH_COLORS.full;

  // Low-HP heartbeat: a finite BURST when you DROP into low health (or take a
  // hit while already low), then it settles — low health stays a steady red
  // read instead of strobing forever (which becomes noise you stop seeing).
  // Each new wound re-alarms.
  const low = hp > 0 && frac <= LOW_BLINK_FRAC;
  const tookDamage = hp < prevHp;
  if (low && (tookDamage || !wasLow)) {
    // Restart the finite pulse: 'none' + reflow + re-set replays the same
    // animation name. Two double-thumps (~1.6s) then quiet.
    bar.style.animation = 'none';
    void bar.offsetWidth;
    bar.style.animation = 'heartLowPulse 0.8s ease-in-out 2';
  } else if (!low) {
    bar.style.animation = 'none';
  }
  prevHp = hp;
  wasLow = low;

  // Each heart spans HEART_HP (2) HP; damage wipes from the right, so 1 HP
  // leaves a half heart. The frame CONTAINER is clipped to the heart's real HP
  // capacity: full for every heart except the trailing one of an ODD max, whose
  // slot is only half a heart — so at full health it reads as a whole half-heart
  // token, not a damaged (healable) heart.
  const fractions = heartFillFractions(hp, hearts.length);
  for (let i = 0; i < hearts.length; i++) {
    const capacity = Math.max(0, Math.min(1, (max - i * HEART_HP) / HEART_HP));
    hearts[i].frameClip.setAttribute('width', String(24 * capacity));
    hearts[i].clip.setAttribute('width', String(24 * fractions[i]));
    hearts[i].fill.setAttribute('fill', fillColor);
  }
}

export function disposeHealthHearts(): void {
  unsubStyle?.();
  unsubStyle = null;
  if (root?.parentNode) root.parentNode.removeChild(root);
  root = null;
  bar = null;
  hearts = [];
  builtMax = -1;
  prevHp = Infinity;
  wasLow = false;
}
