import { getSettings } from '../settings/settings';

// ONE place that decides where the thumb buttons sit and how big they are.
//
// Before this, every HUD widget hand-rolled its own `position: fixed` CSS
// string. That is how the parry button shipped overlapping the weapon-swap
// chip's column on its first draft — with the geometry spread across five
// files, nothing could see the collision, and neither could I: both thumb
// buttons gate on `isDesktopLike()`, which tests TOUCH CAPABILITY rather than
// viewport, so headless Chrome hides them at every size and `snap` is blind to
// the entire right rail. The layout could only be checked by arithmetic.
//
// So the rail lives here as DATA, in one readable table, and the buttons render
// from it. Two things fall out that were impossible before: a player-facing SIZE
// scale (the single most-cited mobile comfort setting), and a DEV drag mode that
// can move a button and print numbers to bake back into the defaults —
// see debug/hud-edit.ts.

export type ThumbButtonId = 'dodge' | 'parry';

export interface ThumbButtonRect {
  /** Distance from the right edge, px, BEFORE the safe-area inset is added. */
  right: number;
  /** Distance from the bottom edge, px, before the safe-area inset. */
  bottom: number;
  /** Diameter in px at scale 1. */
  size: number;
}

// THE RIGHT RAIL, at scale 1. Keep this table honest — it is the only place the
// geometry is written down, and the next button added should be checked against
// it rather than against whatever CSS happened to be nearby.
//
//   dodge  right  20-94,  bottom  28-102   (biggest — the most-used button)
//   parry  right 108-164, bottom  46-102   (second priority, on the thumb arc)
//   swap   right  22-80,  bottom 150-208   (weapon-swap-chip.ts, sidearm only)
//   rite   right  20-86,  bottom 110-176   (rite-button.ts, not created today)
//
// Parry sits up-and-LEFT of dodge rather than above it: the thumb pivots from
// the corner in an ARC, and the vertical column is already spoken for by the
// swap chip.
export const THUMB_DEFAULTS: Record<ThumbButtonId, ThumbButtonRect> = {
  dodge: { right: 20, bottom: 28, size: 74 },
  parry: { right: 108, bottom: 46, size: 56 },
};

// DEV-only positional overrides, set by the drag mode. Never read in prod: the
// setter is gated at its call site and this map stays empty, so the defaults
// above are what ships.
const overrides = new Map<ThumbButtonId, { right: number; bottom: number }>();

export function setThumbOverride(id: ThumbButtonId, right: number, bottom: number): void {
  overrides.set(id, { right: Math.round(right), bottom: Math.round(bottom) });
}
export function getThumbOverride(id: ThumbButtonId): { right: number; bottom: number } | null {
  return overrides.get(id) ?? null;
}
export function clearThumbOverrides(): void {
  overrides.clear();
}

/** Player-facing size multiplier. Clamped here rather than trusting the store,
 *  because a bad persisted value would otherwise render an untappable button. */
export function hudButtonScale(): number {
  const s = getSettings().hudButtonScale;
  return Math.max(0.8, Math.min(1.4, typeof s === 'number' ? s : 1));
}

/** The live rect for a button: defaults, plus any DEV override, times the
 *  player's size scale. Position is scaled too, so a bigger button doesn't
 *  creep off the edge or into its neighbour. */
export function thumbRect(id: ThumbButtonId): ThumbButtonRect {
  const base = THUMB_DEFAULTS[id];
  const o = overrides.get(id);
  const k = hudButtonScale();
  return {
    right: Math.round((o?.right ?? base.right) * k),
    bottom: Math.round((o?.bottom ?? base.bottom) * k),
    size: Math.round(base.size * k),
  };
}

/** Apply a rect to an element as fixed-position CSS, safe-area aware. */
export function applyThumbRect(el: HTMLElement, r: ThumbButtonRect): void {
  el.style.right = `calc(${r.right}px + env(safe-area-inset-right, 0px))`;
  el.style.bottom = `calc(${r.bottom}px + env(safe-area-inset-bottom, 0px))`;
  el.style.width = `${r.size}px`;
  el.style.height = `${r.size}px`;
}
