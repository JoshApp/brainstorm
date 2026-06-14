import * as THREE from 'three';
import { CONFIG } from '../config';
import { worldToScreen } from './hud';
import { on } from '../broadcast/event-bus';

// ── Floating combat numbers — WORLD-ANCHORED, grimdark / Souls register ──
//
// Each number is pinned to a WORLD point and reprojected every frame
// (updateDamageNumbers, driven from the 'hud' system), so it stays over the
// spot it was struck as you turn — it does NOT slide with the camera. It rises
// in WORLD space (metres/sec) and fades over its life; behind the camera it
// just hides.
//
// Restraint is the look: an old-style SERIF in bone-white, a thin hard edge +
// soft dark drop for legibility on the torchlit dark, calm scale settle (no
// punch). Colour is RATIONED — white default, muted gold crit, deep blood
// execute, desaturated element tint for DoT, cool ash graze.
//
// Legibility: SIZE SCALES WITH DAMAGE off a readable floor; numbers spawn at
// HEAD height so they rise off the silhouette; per-number JITTER fans rapid
// hits apart.

const FONT = "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, 'Times New Roman', serif";
const POP_MS = 180;        // gentle settle, not a punch
const HEAD_LIFT = 0.45;    // world metres above the passed point (off the torso)
const MAX_ACTIVE = 64;     // hard cap — drop the oldest past this
const HALO = '0 1px 2px rgba(0,0,0,0.92), 0 0 6px rgba(0,0,0,0.6)';

interface LabelStyle {
  size: number;          // px
  fill: string;
  strokeColor: string;
  strokePx: number;
  glow: string;          // text-shadow
  scaleStart: number;    // settle start scale
  pop: string;           // easing for the settle
  vy: number;            // WORLD rise speed, metres/sec
  lifetime: number;      // seconds
  jitter: number;        // ± px horizontal scatter (screen space)
  weight: string;
  letterSpacing: string;
}

interface ActiveNum {
  el: HTMLDivElement;    // outer (positioned each frame)
  wpos: THREE.Vector3;   // world anchor — rises over time
  vy: number;
  age: number;
  lifetime: number;
  jitterX: number;       // fixed screen-px offset (keeps the fan)
}

let _camera: THREE.Camera | null = null;
const _scratch = new THREE.Vector3();
const active: ActiveNum[] = [];

/** Damage → font size, floored at `base`, saturating at `max` around `ref`. */
function sizeFor(amount: number, base: number, max: number, ref: number): number {
  return base + (max - base) * Math.min(1, Math.max(0, amount) / ref);
}

/** A DoT element colour, DESATURATED toward bone-ash so it reads as a muted
 *  hue rather than a bright pip. */
function dotTint(hex: number, alpha: number): string {
  let r = (hex >> 16) & 0xff, g = (hex >> 8) & 0xff, b = hex & 0xff;
  const BR = 206, BG = 196, BB = 174, mix = 0.5;
  r = Math.round(r + (BR - r) * mix);
  g = Math.round(g + (BG - g) * mix);
  b = Math.round(b + (BB - b) * mix);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Mount a label anchored to `worldPos` (already lifted to head height). It is
 *  reprojected + risen + faded each frame by updateDamageNumbers. */
function floatLabel(worldPos: THREE.Vector3, text: string, st: LabelStyle): void {
  const wpos = worldPos.clone();
  const jitterX = (Math.random() * 2 - 1) * st.jitter;
  const rot = (Math.random() * 2 - 1) * 3;

  const outer = document.createElement('div');
  Object.assign(outer.style, {
    position: 'fixed',
    left: '-9999px',
    top: '-9999px',
    transform: 'translate(-50%, -50%)',
    pointerEvents: 'none',
    zIndex: '15',
    opacity: '1',
    willChange: 'left, top, opacity',
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

  // Place this frame (avoid a flash from the off-screen seed) + run the settle.
  if (_camera) {
    const p = worldToScreen(wpos, _camera);
    if (!p.behind) { outer.style.left = `${p.x + jitterX}px`; outer.style.top = `${p.y}px`; }
    else outer.style.opacity = '0';
  }
  requestAnimationFrame(() => { inner.style.transform = `scale(1) rotate(${rot}deg)`; });

  active.push({ el: outer, wpos, vy: st.vy, age: 0, lifetime: st.lifetime, jitterX });
  if (active.length > MAX_ACTIVE) { active.shift()!.el.remove(); }
}

/** Per-frame: reproject every live number against the camera, rise it in world
 *  space, fade it, and retire it at end of life. Driven from the 'hud' system
 *  with realDt (so numbers keep moving at wall-clock during hit-pause/slow-mo). */
export function updateDamageNumbers(camera: THREE.Camera, dt: number): void {
  _camera = camera;
  for (let i = active.length - 1; i >= 0; i--) {
    const a = active[i];
    a.age += dt;
    if (a.age >= a.lifetime) { a.el.remove(); active.splice(i, 1); continue; }
    a.wpos.y += a.vy * dt;
    _scratch.copy(a.wpos);
    const p = worldToScreen(_scratch, camera);
    if (p.behind) { a.el.style.opacity = '0'; continue; }
    a.el.style.left = `${p.x + a.jitterX}px`;
    a.el.style.top = `${p.y}px`;
    const t = a.age / a.lifetime;
    a.el.style.opacity = String(Math.max(0, 1 - t * t));   // linger, then fall off
  }
}

/** A short-lived WORD — combat status punctuation like "STAGGERED". */
export function spawnStatusText(
  camera: THREE.Camera,
  worldPos: THREE.Vector3,
  text: string,
  color: string = 'rgba(238, 226, 198, 0.98)',
) {
  _camera = camera;
  _scratch.copy(worldPos); _scratch.y += HEAD_LIFT;
  floatLabel(_scratch, text, {
    size: 18,
    fill: color,
    strokeColor: 'rgba(8, 5, 2, 0.9)',
    strokePx: 1.6,
    glow: HALO,
    scaleStart: 1.15,
    pop: 'ease-out',
    vy: 0.5,
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
  /** A GRAZE — a cleaved secondary target that took reduced (falloff) damage. */
  graze: boolean = false,
  /** An EXECUTE — a finisher on a staggered foe: biggest, deep blood-red. */
  execute: boolean = false,
) {
  graze = graze && !crit && !execute;
  _camera = camera;
  _scratch.copy(worldPos); _scratch.y += HEAD_LIFT;

  if (execute) {
    floatLabel(_scratch, String(amount), {
      size: sizeFor(amount, 44, 60, 14),
      fill: 'rgba(214, 52, 38, 0.99)',
      strokeColor: 'rgba(14, 0, 0, 0.95)',
      strokePx: 2.6,
      glow: `${HALO}, 0 0 16px rgba(150, 0, 0, 0.55)`,
      scaleStart: 1.5,
      pop: 'ease-out',
      vy: 0.6,
      lifetime: CONFIG.DAMAGE_NUMBER_LIFETIME * 1.6,
      jitter: 10,
      weight: '700',
      letterSpacing: '0',
    });
    return;
  }
  if (crit) {
    floatLabel(_scratch, `${amount}`, {
      size: sizeFor(amount, 32, 50, 16),
      fill: 'rgba(232, 200, 124, 0.99)',
      strokeColor: 'rgba(36, 18, 0, 0.92)',
      strokePx: 2.2,
      glow: `${HALO}, 0 0 12px rgba(210, 150, 40, 0.5)`,
      scaleStart: 1.3,
      pop: 'ease-out',
      vy: 0.7,
      lifetime: CONFIG.DAMAGE_NUMBER_LIFETIME * 1.45,
      jitter: 12,
      weight: '700',
      letterSpacing: '0',
    });
    return;
  }
  if (graze) {
    floatLabel(_scratch, String(amount), {
      size: sizeFor(amount, 22, 30, 16),
      fill: 'rgba(186, 192, 196, 0.82)',
      strokeColor: 'rgba(4, 6, 8, 0.85)',
      strokePx: 1.4,
      glow: HALO,
      scaleStart: 0.92,
      pop: 'ease-out',
      vy: 0.7,
      lifetime: CONFIG.DAMAGE_NUMBER_LIFETIME * 1.1,
      jitter: 18,
      weight: '600',
      letterSpacing: '0',
    });
    return;
  }
  // Regular chip hit — bone, damage-scaled, calm.
  floatLabel(_scratch, String(amount), {
    size: sizeFor(amount, 28, 46, 16),
    fill: 'rgba(235, 224, 200, 0.97)',
    strokeColor: 'rgba(6, 4, 2, 0.9)',
    strokePx: 1.8,
    glow: HALO,
    scaleStart: 0.9,
    pop: 'cubic-bezier(0.2, 1.2, 0.35, 1)',
    vy: 0.6,
    lifetime: CONFIG.DAMAGE_NUMBER_LIFETIME * 1.25,
    jitter: 14,
    weight: '700',
    letterSpacing: '0',
  });
}

// ── DoT (damage-over-time) tick numbers ──────────────────────────────────
let _dotCamera: THREE.Camera | null = null;
const _dotPos = new THREE.Vector3();

export function initDotDamageNumbers(camera: THREE.Camera): void {
  _dotCamera = camera;
  _camera = camera;
  on((e) => {
    if (e.type !== 'enemy:dot') return;
    const cam = _dotCamera ?? _camera;
    if (!cam) return;
    _dotPos.set(e.x, e.y + HEAD_LIFT, e.z);
    floatLabel(_dotPos, String(e.amount), {
      size: sizeFor(e.amount, 22, 32, 14),
      fill: dotTint(e.color, 0.95),
      strokeColor: 'rgba(6, 4, 2, 0.88)',
      strokePx: 1.5,
      glow: HALO,
      scaleStart: 0.92,
      pop: 'ease-out',
      vy: 0.7,
      lifetime: CONFIG.DAMAGE_NUMBER_LIFETIME * 1.1,
      jitter: 16,
      weight: '600',
      letterSpacing: '0',
    });
  });
}
