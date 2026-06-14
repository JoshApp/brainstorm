import * as THREE from 'three';
import type { ReadableStore } from '../state/store';

// Shared HUD toolkit — the "better way to render + hook into updating data"
// the per-widget code used to reinvent:
//
//   - theme tokens: one place for the fonts + core palette instead of the
//     same rgba()/font-stack strings pasted into every widget.
//   - worldToScreen(): the project→NDC→pixel math that was copy-pasted into
//     damage-numbers / interact-label / item-preview / tutorial-hints.
//   - bind()/bindText(): subscribe a DOM update to a reactive store so a
//     widget re-renders ONLY when its data changes, replacing the
//     "poll a getter every frame, diff against a hand-kept lastX" pattern.

// ── Theme tokens ─────────────────────────────────────────────────────────
export const FONT_UI = 'system-ui, -apple-system, sans-serif';
export const FONT_SERIF = '"Iowan Old Style", Palatino, serif';

export const COLORS = {
  /** Warm torchlight amber — gold counter, HP, most readouts. */
  amber: 'rgba(255, 210, 110, 0.9)',
  /** Dim parchment — depth counter, secondary text. */
  parchment: 'rgba(200, 160, 130, 0.55)',
  /** Cold blue — XP / level. */
  xp: 'rgba(220, 240, 255, 0.95)',
  /** Standard drop shadow for legibility over the dark scene. */
  shadow: '0 0 6px rgba(0,0,0,0.85)',
};

// ── World → screen projection ────────────────────────────────────────────
const _ndc = new THREE.Vector3();
const _view = new THREE.Vector3();

export interface ScreenPoint {
  x: number;
  y: number;
  /** Projected NDC depth: [-1, 1] is between the near and far clip planes;
   *  <-1 is in front of the near plane; >1 is past the far plane OR behind the
   *  camera. NOTE: a SHORT far plane (the dungeon's is ~13m) makes >1 fire for
   *  perfectly visible-but-distant points, so do NOT use this to decide
   *  on-screen-ness — use `behind` (which is true ONLY when actually behind the
   *  camera). x/y are valid for any point in FRONT of the camera, including
   *  ones past the far plane. */
  z: number;
  /** True ONLY when the point is behind the camera (its x/y are meaningless
   *  then). False for everything in front, even past the far clip plane — so a
   *  long-range hit still gets usable screen coords. */
  behind: boolean;
}

/** Project a world position to screen pixels. Pass a canvas bounding `rect`
 *  for canvas-relative coordinates (most world-anchored labels); omit it for
 *  full-window coordinates (e.g. floating damage numbers). */
export function worldToScreen(
  worldPos: THREE.Vector3,
  camera: THREE.Camera,
  rect?: DOMRect,
): ScreenPoint {
  _ndc.copy(worldPos).project(camera);
  // "Behind the camera" is a VIEW-SPACE question, not an NDC one: in eye space
  // the camera looks down -z, so z >= 0 is at/behind the camera. Deriving it
  // from NDC z (>1) is wrong here because our far plane is only ~13m — distant
  // but perfectly in-front points (common for ranged-weapon hits) also push
  // NDC z past 1 and would be falsely flagged behind, suppressing their HUD
  // labels / damage numbers. The perspective divide keeps x/y correct for any
  // in-front point, even past the far plane, so those still place correctly.
  _view.copy(worldPos).applyMatrix4(camera.matrixWorldInverse);
  const w = rect ? rect.width : window.innerWidth;
  const h = rect ? rect.height : window.innerHeight;
  const ox = rect ? rect.left : 0;
  const oy = rect ? rect.top : 0;
  return {
    x: (_ndc.x * 0.5 + 0.5) * w + ox,
    y: (-_ndc.y * 0.5 + 0.5) * h + oy,
    z: _ndc.z,
    behind: _view.z >= 0,
  };
}

// ── Reactive binding ─────────────────────────────────────────────────────
/** Run `render` with the store's current value now and on every change.
 *  Returns an unsubscribe closure. */
export function bind<T>(store: ReadableStore<T>, render: (value: T) => void): () => void {
  return store.subscribe(render);
}

/** Bind an element's textContent to a store, formatting through `fmt`. Skips
 *  the DOM write when the formatted text is unchanged. */
export function bindText<T>(
  el: HTMLElement,
  store: ReadableStore<T>,
  fmt: (value: T) => string,
): () => void {
  return store.subscribe((v) => {
    const s = fmt(v);
    if (el.textContent !== s) el.textContent = s;
  });
}
