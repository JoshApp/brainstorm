// FOCUS — the one notion of "the thing you're on" that every menu shares.
//
// Touch, mouse, keyboard and controller all move the same focus and press the
// same confirm, so a screen never asks which device it is talking to
// (docs/UI-SYSTEM.md, the Lamplight pass). A screen makes a scope over its
// root; elements marked `data-focus` are what can be chosen. The newest open
// scope is the one that listens.
//
//   - mouse: hovering focuses
//   - touch: the screen's own tap handlers act; a tap also focuses
//   - keyboard: arrows / WASD move (here). Enter / Space / E confirm through
//     the screen manager: input-desktop already routes them to
//     confirmTopScreen(), so a screen with a scope registers
//     `onConfirm: () => scope.confirm()` on its openScreen handle. Handling
//     Enter here as well fired the confirm twice (2026-11-23: one Enter armed
//     NEW DESCENT and the second, phantom one abandoned the run).
//   - controller: input-gamepad calls navTopFocus while a menu owns the frame;
//     A reaches the same onConfirm through confirmTopScreen()
//
// Movement is spatial: the nearest element in the pressed direction, weighted
// against sideways drift, so a grid, a column or a row all navigate the way
// they look.

import { noteKeyboardMouseActivity } from '../../controls/active-device';

export interface FocusScopeOptions {
  /** Called when focus lands on an element (any device). */
  onFocus?: (el: HTMLElement) => void;
  /** Called on confirm (Enter, Space, controller A). Default: el.click(). */
  onConfirm?: (el: HTMLElement) => void;
  /** Where focus starts. Default: the first focusable. */
  initial?: HTMLElement | null;
  /** False while another screen sits over this one: the scope then ignores
   *  keys and controller input (so Enter in the codex can't fire CONTINUE). */
  isActive?: () => boolean;
}

export interface FocusScope {
  readonly root: HTMLElement;
  readonly focused: HTMLElement | null;
  setFocus(el: HTMLElement | null): void;
  /** Move focus one step; returns false at an edge. */
  move(dx: number, dy: number): boolean;
  confirm(): void;
  destroy(): void;
}

const stack: FocusScope[] = [];
const activeOf = new WeakMap<FocusScope, () => boolean>();

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('[data-focus]')].filter((el) => el.offsetParent !== null);
}

/** The element nearest `from` in direction (dx, dy), or null. */
export function nearestInDirection(from: HTMLElement, candidates: HTMLElement[], dx: number, dy: number): HTMLElement | null {
  const a = from.getBoundingClientRect();
  const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
  let best: HTMLElement | null = null, bestScore = Infinity;
  for (const el of candidates) {
    if (el === from) continue;
    const b = el.getBoundingClientRect();
    const bx = b.left + b.width / 2, by = b.top + b.height / 2;
    const along = (bx - ax) * dx + (by - ay) * dy;
    if (along <= 4) continue;
    const score = along + Math.abs((bx - ax) * dy - (by - ay) * dx) * 2.2;
    if (score < bestScore) { bestScore = score; best = el; }
  }
  return best;
}

export function createFocusScope(root: HTMLElement, opts: FocusScopeOptions = {}): FocusScope {
  let focused: HTMLElement | null = null;

  const scope: FocusScope = {
    root,
    get focused() { return focused; },
    setFocus(el) {
      if (el === focused) return;
      focused?.classList.remove('is-focused');
      focused = el;
      if (el) {
        el.classList.add('is-focused');
        opts.onFocus?.(el);
      }
    },
    move(dx, dy) {
      const list = focusables(root);
      if (!focused || !focused.isConnected) { scope.setFocus(list[0] ?? null); return !!list[0]; }
      const next = nearestInDirection(focused, list, dx, dy);
      if (next) scope.setFocus(next);
      return !!next;
    },
    confirm() {
      if (!focused) return;
      if (opts.onConfirm) opts.onConfirm(focused);
      else focused.click();
    },
    destroy() {
      root.removeEventListener('pointermove', onPointerMove);
      const i = stack.indexOf(scope);
      if (i >= 0) stack.splice(i, 1);
    },
  };

  function onPointerMove(e: PointerEvent): void {
    if (e.pointerType !== 'mouse') return;
    const el = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-focus]');
    if (el && root.contains(el)) scope.setFocus(el);
  }
  root.addEventListener('pointermove', onPointerMove);

  stack.push(scope);
  activeOf.set(scope, opts.isActive ?? (() => true));
  scope.setFocus(opts.initial ?? focusables(root)[0] ?? null);
  return scope;
}

/** The newest live scope, or null if it is covered by another screen. Never
 *  falls through to an older scope: input meant for the covering screen must
 *  not land on the one beneath it. */
function top(): FocusScope | null {
  for (let i = stack.length - 1; i >= 0; i--) {
    const s = stack[i];
    if (!s.root.isConnected) continue;
    return (activeOf.get(s)?.() ?? true) ? s : null;
  }
  return null;
}

/** Controller / keyboard: move the newest scope's focus. */
export function navTopFocus(dx: number, dy: number): boolean {
  const s = top();
  return s ? s.move(dx, dy) : false;
}

/** Controller / keyboard: confirm on the newest scope. True if one handled it. */
export function confirmTopFocus(): boolean {
  const s = top();
  if (!s || !s.focused) return false;
  s.confirm();
  return true;
}

export function hasFocusScope(): boolean { return top() !== null; }

// Keyboard: one listener for every scope, for MOVEMENT only. Confirm and back
// belong to the screen manager (see the header).
const KEY_DIRS: Record<string, [number, number]> = {
  ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
  KeyW: [0, -1], KeyS: [0, 1], KeyA: [-1, 0], KeyD: [1, 0],
};
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => {
    const s = top();
    if (!s) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    const dir = KEY_DIRS[e.code];
    if (dir) {
      e.preventDefault();
      noteKeyboardMouseActivity();
      s.move(dir[0], dir[1]);
    }
  });
}
