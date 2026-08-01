// THE DIEGETIC PICKUP — a thing you take FLIES INTO the HUD slot that tallies it,
// starting from where the object actually was in the world and shrinking as it
// goes. One shared gesture for every pickup channel:
//
//   gold coin  → gold counter
//   key        → key counter
//   item/relic → satchel button
//
// The whole point is that the streak begins at the object's REAL on-screen
// position (projected from its world transform), not at a fixed screen-centre /
// screen-bottom point. That kills the old "it floats into the player and then a
// FAKE thing spawns mid-screen and drifts to the corner" discontinuity — now the
// chip you see leaving is visually continuous with the object that was there.
//
// Presentation only: this never touches inventory, gold, or combat state. The
// grant already happened; this is the flourish that says where it went.

import * as THREE from 'three';
import { worldToScreen } from './hud';
import { cachedCanvasRect } from './canvas-rect';

// ── Shared projection context ────────────────────────────────────────────────
// The pickup listeners (acquisition-beat, xp-gold-hud) live on the event bus and
// have no camera of their own. The world-ui tick DOES (it already projects the
// interact label + overlay each frame), so it publishes the live camera+canvas
// here. That lets any listener turn a world position into a screen point without
// threading the camera through the event payload.
let _camera: THREE.Camera | null = null;
let _canvas: HTMLCanvasElement | null = null;

/** Called each frame by the world-ui system with the live camera + canvas. */
export function setFlyContext(camera: THREE.Camera, canvas: HTMLCanvasElement): void {
  _camera = camera;
  _canvas = canvas;
}

const _v = new THREE.Vector3();

/** Project a world position to a CSS-pixel screen point using the shared
 *  context. Returns null if the context isn't set yet or the point is behind
 *  the camera (caller should fall back to a sensible default screen point). */
export function projectToScreen(world: { x: number; y: number; z: number }): { x: number; y: number } | null {
  if (!_camera || !_canvas) return null;
  _v.set(world.x, world.y, world.z);
  const p = worldToScreen(_v, _camera, cachedCanvasRect(_canvas));
  if (p.behind) return null;
  return { x: p.x, y: p.y };
}

// ── The flight ───────────────────────────────────────────────────────────────
// A global soft cap so a big cascade (a chest bursting a dozen coins, a mass
// pickup) can't flood the DOM with in-flight chips.
let inFlight = 0;
const MAX_IN_FLIGHT = 14;

export interface FlyToHudOpts {
  /** Screen start point in CSS px — project the object's world pos first. */
  from: { x: number; y: number };
  /** The HUD slot to fly into (its live rect is read at launch). */
  targetEl: HTMLElement | null;
  /** Caller-built visual (an <img>, an SVG glyph, a framed thumbnail). It is
   *  positioned + animated here; caller only styles its INNER look. */
  node: HTMLElement;
  /** Box size in px (the chip is centred on `from`). Default 40. */
  size?: number;
  /** Accent colour for the landing pulse glow (CSS colour). */
  accent?: string;
  /** Items: pop the object into view + hold a beat before it flies (the
   *  "here's what you got" read). Currency skips this and flies at once. */
  present?: boolean;
  /** Total flight time (ms). Defaults: 1000 with `present`, ~500 without. */
  durationMs?: number;
  /** Fires when the chip lands (after the target pulse is kicked off). */
  onLand?: () => void;
}

/** Fly a chip from a screen point into a HUD slot, shrinking as it arrives. */
export function flyToHud(o: FlyToHudOpts): void {
  if (inFlight >= MAX_IN_FLIGHT) { o.onLand?.(); return; }
  const size = o.size ?? 40;
  const node = o.node;
  node.classList.add('game-hud');
  Object.assign(node.style, {
    position: 'fixed', left: `${o.from.x}px`, top: `${o.from.y}px`,
    width: `${size}px`, height: `${size}px`, marginLeft: `${-size / 2}px`, marginTop: `${-size / 2}px`,
    pointerEvents: 'none', zIndex: '60', willChange: 'transform, opacity',
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(node);
  inFlight++;

  const r = o.targetEl?.getBoundingClientRect();
  const end = r && r.width > 0
    ? { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    : { x: window.innerWidth - 40, y: 40 };   // HUD not mounted → top-right fallback
  const dx = end.x - o.from.x, dy = end.y - o.from.y;
  // Bow the arc UPWARD so it lifts before curving into the slot (reads as
  // "rising into" the HUD rather than sliding flatly across).
  const lift = Math.min(96, Math.abs(dx) * 0.2 + 48);

  const frames: Keyframe[] = o.present
    ? [
        { transform: 'translate(0px,0px) scale(0.35)', opacity: 0, offset: 0 },
        { transform: 'translate(0px,0px) scale(1.15)', opacity: 1, offset: 0.13 },
        { transform: 'translate(0px,0px) scale(1.0)',  opacity: 1, offset: 0.24 },
        { transform: 'translate(0px,0px) scale(1.0)',  opacity: 1, offset: 0.40 },   // hold — "here it is"
        { transform: `translate(${dx * 0.5}px,${dy * 0.5 - lift}px) scale(0.7)`, opacity: 0.95, offset: 0.72 },
        { transform: `translate(${dx}px,${dy}px) scale(0.22)`, opacity: 0.1, offset: 1 },
      ]
    : [
        { transform: 'translate(0px,0px) scale(1)', opacity: 0.95, offset: 0 },
        { transform: `translate(${dx * 0.5}px,${dy * 0.5 - lift}px) scale(0.92)`, opacity: 1, offset: 0.5 },
        { transform: `translate(${dx}px,${dy}px) scale(0.3)`, opacity: 0, offset: 1 },
      ];
  const dur = o.durationMs ?? (o.present ? 1000 : 470 + Math.random() * 120);
  const anim = node.animate(frames, {
    duration: dur,
    easing: o.present ? 'cubic-bezier(0.4, 0.0, 0.2, 1)' : 'cubic-bezier(0.45, 0, 0.55, 1)',
    fill: 'forwards',
  });
  const done = () => {
    node.remove();
    inFlight = Math.max(0, inFlight - 1);
    pulseTarget(o.targetEl, o.accent);
    o.onLand?.();
  };
  anim.onfinish = done;
  anim.oncancel = done;
}

/** The HUD slot drinks the chip in — a quick scale pop + a coloured breath. */
function pulseTarget(el: HTMLElement | null, accent?: string): void {
  if (!el) return;
  const prev = el.style.filter;
  const glow = accent ? `drop-shadow(0 0 9px ${accent})` : 'drop-shadow(0 0 8px rgba(255,210,140,0.85))';
  el.animate(
    [
      { transform: 'scale(1)', filter: prev || 'none' },
      { transform: 'scale(1.2)', filter: glow },
      { transform: 'scale(1)', filter: prev || 'none' },
    ],
    { duration: 300, easing: 'ease-out' },
  );
}
