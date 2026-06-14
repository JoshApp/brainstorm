import * as THREE from 'three';
import { CONFIG } from '../config';
import { worldToScreen } from './hud';
import { on } from '../broadcast/event-bus';

// ── Floating combat numbers — the grimdark / Souls register ──────────────
//
// DOM overlay above the canvas. Restraint is the aesthetic: an old-style
// SERIF in bone-white, a thin hard edge + soft dark drop for legibility on
// the torchlit dark, and a CALM motion — a small settle, a slow drift up, a
// long fade. No bounce, no confetti. Colour is RATIONED: white is the
// default; only the exceptional hit earns a tint (gold crit, blood execute,
// a desaturated element hue for DoT). Reads as "carved into the world",
// matching the in-world voice.
//
// Legibility still comes first (the reason for the restyle): SIZE SCALES WITH
// DAMAGE with a floor so chips stay readable and big hits feel big; numbers
// spawn at HEAD height so they rise off the silhouette into the dark above the
// enemy, clear of the body + reticle; and per-number JITTER fans rapid hits
// out instead of letting them stack into a blur.
//
// Two layers: an OUTER that drifts up + fades over the lifetime, an INNER that
// does the (gentle) scale settle — so the motion reads without coupling.

const FONT = "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, 'Times New Roman', serif";
const POP_MS = 180;        // gentle settle, not a punch
const HEAD_LIFT = 0.45;    // world metres lifted above the passed point (off the torso)

// Shared soft dark drop — the Souls legibility trick (a halo, not a glow).
const HALO = '0 1px 2px rgba(0,0,0,0.92), 0 0 6px rgba(0,0,0,0.6)';

interface LabelStyle {
  size: number;          // px
  fill: string;
  strokeColor: string;
  strokePx: number;
  glow: string;          // text-shadow (HALO, optionally + a faint tint)
  scaleStart: number;    // settle start scale
  pop: string;           // easing for the settle
  rise: number;          // px the label drifts up over its life
  lifetime: number;      // seconds
  jitter: number;        // ± px horizontal scatter
  weight: string;
  letterSpacing: string;
}

const _lift = new THREE.Vector3();

/** Lift the world point to head height and project it. Returns null if the
 *  point is behind the camera. */
function projectHead(camera: THREE.Camera, worldPos: THREE.Vector3): { x: number; y: number } | null {
  _lift.copy(worldPos);
  _lift.y += HEAD_LIFT;
  const p = worldToScreen(_lift, camera);
  if (p.behind) return null;
  return { x: p.x, y: p.y };
}

/** Damage → font size, floored at `base`, saturating at `max` around `ref`
 *  damage. Chips stay readable; big hits feel big. */
function sizeFor(amount: number, base: number, max: number, ref: number): number {
  return base + (max - base) * Math.min(1, Math.max(0, amount) / ref);
}

/** A DoT element colour, DESATURATED toward bone-ash so it reads as a muted
 *  hue (poison sickly-green, bleed dried-red) rather than a bright pip. */
function dotTint(hex: number, alpha: number): string {
  let r = (hex >> 16) & 0xff, g = (hex >> 8) & 0xff, b = hex & 0xff;
  const BR = 206, BG = 196, BB = 174, mix = 0.5;   // toward bone-ash
  r = Math.round(r + (BR - r) * mix);
  g = Math.round(g + (BG - g) * mix);
  b = Math.round(b + (BB - b) * mix);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Mount a floating label at a screen point; run its settle + rise + fade. */
function floatLabel(sx: number, sy: number, text: string, st: LabelStyle): void {
  const jitterX = (Math.random() * 2 - 1) * st.jitter;
  const rot = (Math.random() * 2 - 1) * 3;

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
    transition: `transform ${st.lifetime}s ease-out, opacity ${st.lifetime}s ease-in`,
  } as Partial<CSSStyleDeclaration>);

  const inner = document.createElement('div');
  inner.textContent = text;
  Object.assign(inner.style, {
    fontFamily: FONT,
    fontWeight: st.weight,
    fontSize: `${st.size}px`,
    lineHeight: '1',
    letterSpacing: st.letterSpacing,
    color: st.fill,
    textShadow: st.glow,
    transformOrigin: 'center',
    transform: `scale(${st.scaleStart}) rotate(${rot}deg)`,
    transition: `transform ${POP_MS}ms ${st.pop}`,
    willChange: 'transform',
  } as Partial<CSSStyleDeclaration>);
  inner.style.setProperty('-webkit-text-stroke', `${st.strokePx}px ${st.strokeColor}`);
  inner.style.setProperty('paint-order', 'stroke fill');

  outer.appendChild(inner);
  document.body.appendChild(outer);

  requestAnimationFrame(() => {
    outer.style.transform = `translate(-50%, calc(-50% - ${st.rise}px))`;
    outer.style.opacity = '0';
    inner.style.transform = `scale(1) rotate(${rot}deg)`;
  });

  setTimeout(() => outer.remove(), st.lifetime * 1000 + 120);
}

/** A short-lived WORD — combat status punctuation like "STAGGERED". Spaced
 *  serif caps in bone so it reads as an event, not a number. */
export function spawnStatusText(
  camera: THREE.Camera,
  worldPos: THREE.Vector3,
  text: string,
  color: string = 'rgba(238, 226, 198, 0.98)',
) {
  const p = projectHead(camera, worldPos);
  if (!p) return;
  floatLabel(p.x, p.y, text, {
    size: 18,
    fill: color,
    strokeColor: 'rgba(8, 5, 2, 0.9)',
    strokePx: 1.6,
    glow: HALO,
    scaleStart: 1.15,
    pop: 'ease-out',
    rise: CONFIG.DAMAGE_NUMBER_RISE * 1.2,
    lifetime: CONFIG.DAMAGE_NUMBER_LIFETIME * 1.5,
    jitter: 6,
    weight: '700',
    letterSpacing: '0.18em',
  });
}

export function spawnDamageNumber(
  camera: THREE.Camera,
  worldPos: THREE.Vector3,
  amount: number,
  crit: boolean = false,
  /** A GRAZE — a cleaved secondary target that took reduced (falloff) damage.
   *  Ash-dim + smaller so it reads as "this one only got clipped". */
  graze: boolean = false,
  /** An EXECUTE — a finisher on a staggered foe: biggest, deep blood-red. */
  execute: boolean = false,
) {
  graze = graze && !crit && !execute;
  const p = projectHead(camera, worldPos);
  if (!p) return;

  if (execute) {
    floatLabel(p.x, p.y, String(amount), {
      size: sizeFor(amount, 44, 60, 14),
      fill: 'rgba(214, 52, 38, 0.99)',           // deep blood
      strokeColor: 'rgba(14, 0, 0, 0.95)',
      strokePx: 2.6,
      glow: `${HALO}, 0 0 16px rgba(150, 0, 0, 0.55)`,
      scaleStart: 1.5,
      pop: 'ease-out',
      rise: 56,
      lifetime: CONFIG.DAMAGE_NUMBER_LIFETIME * 1.6,
      jitter: 10,
      weight: '700',
      letterSpacing: '0',
    });
    return;
  }
  if (crit) {
    floatLabel(p.x, p.y, `${amount}`, {
      size: sizeFor(amount, 32, 50, 16),
      fill: 'rgba(232, 200, 124, 0.99)',         // muted gold
      strokeColor: 'rgba(36, 18, 0, 0.92)',
      strokePx: 2.2,
      glow: `${HALO}, 0 0 12px rgba(210, 150, 40, 0.5)`,
      scaleStart: 1.3,
      pop: 'ease-out',
      rise: 50,
      lifetime: CONFIG.DAMAGE_NUMBER_LIFETIME * 1.45,
      jitter: 12,
      weight: '700',
      letterSpacing: '0',
    });
    return;
  }
  if (graze) {
    floatLabel(p.x, p.y, String(amount), {
      size: sizeFor(amount, 19, 27, 16),
      fill: 'rgba(186, 192, 196, 0.82)',         // cool ash
      strokeColor: 'rgba(4, 6, 8, 0.85)',
      strokePx: 1.4,
      glow: HALO,
      scaleStart: 0.92,
      pop: 'ease-out',
      rise: 34,
      lifetime: CONFIG.DAMAGE_NUMBER_LIFETIME * 1.1,
      jitter: 18,
      weight: '600',
      letterSpacing: '0',
    });
    return;
  }
  // Regular chip hit — bone, damage-scaled, calm.
  floatLabel(p.x, p.y, String(amount), {
    size: sizeFor(amount, 24, 40, 16),
    fill: 'rgba(235, 224, 200, 0.97)',           // bone / ash white
    strokeColor: 'rgba(6, 4, 2, 0.9)',
    strokePx: 1.8,
    glow: HALO,
    scaleStart: 0.9,
    pop: 'cubic-bezier(0.2, 1.2, 0.35, 1)',
    rise: 40,
    lifetime: CONFIG.DAMAGE_NUMBER_LIFETIME * 1.25,
    jitter: 14,
    weight: '700',
    letterSpacing: '0',
  });
}

// ── DoT (damage-over-time) tick numbers ──────────────────────────────────
// Bleed/poison/burn ticks have no attack/projectile caller to float a number,
// so the enemy emits `enemy:dot` and this subscriber draws it — a desaturated
// element tint, a touch smaller than a hit so ticks read as attrition. Wire
// once at boot via initDotDamageNumbers(camera).
let _dotCamera: THREE.Camera | null = null;
const _dotPos = new THREE.Vector3();

export function initDotDamageNumbers(camera: THREE.Camera): void {
  _dotCamera = camera;
  on((e) => {
    if (e.type !== 'enemy:dot') return;
    if (!_dotCamera) return;
    _dotPos.set(e.x, e.y, e.z);
    const p = projectHead(_dotCamera, _dotPos);
    if (!p) return;
    floatLabel(p.x, p.y, String(e.amount), {
      size: sizeFor(e.amount, 20, 30, 14),
      fill: dotTint(e.color, 0.95),
      strokeColor: 'rgba(6, 4, 2, 0.88)',
      strokePx: 1.5,
      glow: HALO,
      scaleStart: 0.92,
      pop: 'ease-out',
      rise: 34,
      lifetime: CONFIG.DAMAGE_NUMBER_LIFETIME * 1.1,
      jitter: 16,
      weight: '600',
      letterSpacing: '0',
    });
  });
}
