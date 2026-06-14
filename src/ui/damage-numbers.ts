import * as THREE from 'three';
import { CONFIG } from '../config';
import { worldToScreen } from './hud';
import { on } from '../broadcast/event-bus';

// ── Floating combat numbers — the "STAMPED IMPACT" style ─────────────────
//
// DOM overlay above the canvas. Each number is a short-lived label that pops
// in (a fast scale punch), drifts up, and fades. Built for legibility on the
// dark, busy dungeon:
//   - HARD OUTLINE (-webkit-text-stroke + paint-order:stroke fill) instead of
//     a soft glow — the #1 readability win; numbers read as branded into the
//     scene on any backdrop.
//   - SIZE SCALES WITH DAMAGE (with a solid floor) so a chip and a haymaker
//     feel different, and nothing is ever tiny.
//   - JITTER + ROTATION per number so rapid / stacked hits fan out instead of
//     overlapping into an unreadable blur.
//   - Two layers: an OUTER that handles the slow rise + fade, an INNER that
//     handles the fast scale pop — so the punch reads without slowing the drift.
//
// Palette (grimdark): bone for chip hits, gold for crits, blood for executes,
// cool grey for grazes, element tint for DoT ticks.

const FONT = "'Helvetica Neue', system-ui, -apple-system, Arial, sans-serif";
const CONDENSE = 0.9;   // horizontal squeeze → a stamped, heavy numeral
const POP_MS = 150;     // fast scale punch, independent of the rise/fade

interface LabelStyle {
  size: number;          // px
  fill: string;
  strokeColor: string;
  strokePx: number;
  glow: string;          // text-shadow
  scaleStart: number;    // pop-in start scale (>1 = burst-shrink, <1 = punch-up)
  pop: string;           // easing for the scale pop
  rise: number;          // px the label drifts up over its life
  lifetime: number;      // seconds
  jitter: number;        // ± px horizontal scatter
  condense: number;      // x-squeeze (1 = none; numbers use < 1)
  letterSpacing: string;
}

/** Damage → font size, floored at `base`, saturating at `max` around `ref`
 *  damage. Keeps chip hits readable while letting big hits feel big. */
function sizeFor(amount: number, base: number, max: number, ref: number): number {
  return base + (max - base) * Math.min(1, Math.max(0, amount) / ref);
}

/** Lighten a packed hex toward white (a raw bleed-red / poison-green is too
 *  dark to read as text on the dark dungeon). */
function tintToRgba(hex: number, whiteMix: number, alpha: number): string {
  let r = (hex >> 16) & 0xff, g = (hex >> 8) & 0xff, b = hex & 0xff;
  r = Math.round(r + (255 - r) * whiteMix);
  g = Math.round(g + (255 - g) * whiteMix);
  b = Math.round(b + (255 - b) * whiteMix);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Mount a floating label at a screen point and run its pop + rise + fade. */
function floatLabel(sx: number, sy: number, text: string, st: LabelStyle): void {
  const jitterX = (Math.random() * 2 - 1) * st.jitter;
  const rot = (Math.random() * 2 - 1) * 4;

  // OUTER — slow rise + fade over the full lifetime.
  const outer = document.createElement('div');
  Object.assign(outer.style, {
    position: 'fixed',
    left: `${sx + jitterX}px`,
    top: `${sy}px`,
    transform: 'translate(-50%, -50%)',
    pointerEvents: 'none',
    zIndex: '15',
    opacity: '1',
    willChange: 'transform, opacity',
    transition: `transform ${st.lifetime}s ease-out, opacity ${st.lifetime}s ease-out`,
  } as Partial<CSSStyleDeclaration>);

  // INNER — fast scale punch, the actual glyph.
  const inner = document.createElement('div');
  inner.textContent = text;
  Object.assign(inner.style, {
    fontFamily: FONT,
    fontWeight: '900',
    fontSize: `${st.size}px`,
    lineHeight: '1',
    letterSpacing: st.letterSpacing,
    color: st.fill,
    textShadow: st.glow,
    transformOrigin: 'center',
    transform: `scale(${st.scaleStart * st.condense}, ${st.scaleStart}) rotate(${rot}deg)`,
    transition: `transform ${POP_MS}ms ${st.pop}`,
    willChange: 'transform',
  } as Partial<CSSStyleDeclaration>);
  // Hard outline that doesn't erode the fill (stroke painted behind).
  inner.style.setProperty('-webkit-text-stroke', `${st.strokePx}px ${st.strokeColor}`);
  inner.style.setProperty('paint-order', 'stroke fill');

  outer.appendChild(inner);
  document.body.appendChild(outer);

  requestAnimationFrame(() => {
    outer.style.transform = `translate(-50%, calc(-50% - ${st.rise}px))`;
    outer.style.opacity = '0';
    inner.style.transform = `scale(${st.condense}, 1) rotate(${rot}deg)`;
  });

  setTimeout(() => outer.remove(), st.lifetime * 1000 + 120);
}

/** A short-lived WORD that floats off a world point — combat status
 *  punctuation like "STAGGERED". Spaced caps, bone + hard outline so it reads
 *  as an event, not a number. */
export function spawnStatusText(
  camera: THREE.Camera,
  worldPos: THREE.Vector3,
  text: string,
  color: string = 'rgba(255, 236, 170, 0.98)',
) {
  const p = worldToScreen(worldPos, camera);
  if (p.behind) return;
  floatLabel(p.x, p.y, text, {
    size: 19,
    fill: color,
    strokeColor: 'rgba(8, 5, 2, 0.95)',
    strokePx: 2.6,
    glow: '0 0 12px rgba(255, 180, 40, 0.45), 0 0 3px rgba(0,0,0,0.95)',
    scaleStart: 1.25,
    pop: 'cubic-bezier(0.2, 1.5, 0.3, 1)',
    rise: CONFIG.DAMAGE_NUMBER_RISE * 1.3,
    lifetime: CONFIG.DAMAGE_NUMBER_LIFETIME * 1.3,
    jitter: 6,
    condense: 1,                 // words read better un-squeezed
    letterSpacing: '0.16em',
  });
}

export function spawnDamageNumber(
  camera: THREE.Camera,
  worldPos: THREE.Vector3,
  amount: number,
  crit: boolean = false,
  /** A GRAZE — a cleaved secondary target that took reduced (falloff) damage.
   *  Cool + smaller so it reads as "this one only got clipped". Crit/execute
   *  win over graze. */
  graze: boolean = false,
  /** An EXECUTE — a finisher on a staggered foe. The loudest number: huge,
   *  blood-red, biggest punch. Wins over crit/graze. */
  execute: boolean = false,
) {
  graze = graze && !crit && !execute;
  const p = worldToScreen(worldPos, camera);
  if (p.behind) return;

  if (execute) {
    floatLabel(p.x, p.y, String(amount), {
      size: sizeFor(amount, 48, 66, 14),
      fill: 'rgba(255, 74, 54, 0.99)',
      strokeColor: 'rgba(16, 0, 0, 0.96)',
      strokePx: 3.5,
      glow: '0 0 18px rgba(225, 25, 25, 0.95), 0 0 34px rgba(150, 0, 0, 0.7), 0 0 3px rgba(0,0,0,0.95)',
      scaleStart: 2.0,
      pop: 'ease-out',
      rise: 74,
      lifetime: CONFIG.DAMAGE_NUMBER_LIFETIME * 1.5,
      jitter: 10,
      condense: CONDENSE,
      letterSpacing: '-0.03em',
    });
    return;
  }
  if (crit) {
    floatLabel(p.x, p.y, `${amount}!`, {
      size: sizeFor(amount, 34, 56, 16),
      fill: 'rgba(255, 226, 120, 0.99)',
      strokeColor: 'rgba(48, 22, 0, 0.95)',
      strokePx: 3,
      glow: '0 0 14px rgba(255, 185, 55, 0.75), 0 0 3px rgba(0,0,0,0.95)',
      scaleStart: 1.7,
      pop: 'ease-out',
      rise: 64,
      lifetime: CONFIG.DAMAGE_NUMBER_LIFETIME * 1.4,
      jitter: 13,
      condense: CONDENSE,
      letterSpacing: '-0.03em',
    });
    return;
  }
  if (graze) {
    floatLabel(p.x, p.y, String(amount), {
      size: sizeFor(amount, 19, 28, 16),
      fill: 'rgba(198, 210, 220, 0.9)',
      strokeColor: 'rgba(4, 6, 8, 0.9)',
      strokePx: 2,
      glow: '0 0 5px rgba(0,0,0,0.85)',
      scaleStart: 0.78,
      pop: 'cubic-bezier(0.18, 1.6, 0.3, 1)',
      rise: 40,
      lifetime: CONFIG.DAMAGE_NUMBER_LIFETIME,
      jitter: 18,
      condense: CONDENSE,
      letterSpacing: '-0.02em',
    });
    return;
  }
  // Regular chip hit — bone, damage-scaled, punchy.
  floatLabel(p.x, p.y, String(amount), {
    size: sizeFor(amount, 23, 42, 16),
    fill: 'rgba(247, 230, 198, 0.98)',
    strokeColor: 'rgba(6, 4, 2, 0.95)',
    strokePx: 2.6,
    glow: '0 0 9px rgba(255, 150, 60, 0.30), 0 0 2px rgba(0,0,0,0.9)',
    scaleStart: 0.75,
    pop: 'cubic-bezier(0.18, 1.7, 0.3, 1)',
    rise: 48,
    lifetime: CONFIG.DAMAGE_NUMBER_LIFETIME,
    jitter: 14,
    condense: CONDENSE,
    letterSpacing: '-0.03em',
  });
}

// ── DoT (damage-over-time) tick numbers ──────────────────────────────────
// Bleed/poison/burn ticks have no attack/projectile caller to float a number,
// so the enemy emits `enemy:dot` and this subscriber draws it — tinted to the
// element, a touch smaller than a hit so ticks read as attrition. Wire once at
// boot via initDotDamageNumbers(camera).
let _dotCamera: THREE.Camera | null = null;
const _dotPos = new THREE.Vector3();

export function initDotDamageNumbers(camera: THREE.Camera): void {
  _dotCamera = camera;
  on((e) => {
    if (e.type !== 'enemy:dot') return;
    if (!_dotCamera) return;
    _dotPos.set(e.x, e.y, e.z);
    const p = worldToScreen(_dotPos, _dotCamera);
    if (p.behind) return;
    floatLabel(p.x, p.y, String(e.amount), {
      size: sizeFor(e.amount, 20, 32, 14),
      fill: tintToRgba(e.color, 0.5, 0.97),
      strokeColor: 'rgba(6, 4, 2, 0.92)',
      strokePx: 2.2,
      glow: `0 0 8px ${tintToRgba(e.color, 0.1, 0.8)}, 0 0 2px rgba(0,0,0,0.9)`,
      scaleStart: 0.78,
      pop: 'cubic-bezier(0.18, 1.6, 0.3, 1)',
      rise: 42,
      lifetime: CONFIG.DAMAGE_NUMBER_LIFETIME,
      jitter: 16,
      condense: CONDENSE,
      letterSpacing: '-0.02em',
    });
  });
}
