// Screen manager.
//
// Every full-screen / panel / overlay (inventory, settings, note, title,
// end, future menus) registers as a "screen" with a POLICY describing
// what it does to the rest of the app:
//
//   pausesWorld   — skip world updates while this screen is open
//   hidesHud      — hide bottom HUD (joystick, attack zone, HP, etc.)
//   dimsScene     — fade the WebGL canvas behind so the screen reads cleanly
//   needsBackdrop — show the shared dark-veil backdrop behind this screen
//   layer         — z-index bucket (panel < modal < title < system)
//
// The manager composes the effective state across all open screens:
// pause-if-any-pauses, hide-hud-if-any-hides, etc. Background side-effects
// (body class toggles, backdrop visibility, scene dim) are applied
// automatically; screen authors don't touch them.
//
// Why this and not the old input-mode? Old API knew about "menus" but had
// no per-menu policy — every menu paused + showed backdrop, no other
// states were supported. Adding the title screen forced ad-hoc workarounds
// (manual body.hud-hidden, manual z-index war). This system makes the
// rules explicit + scales: new screen = one open() call, no glue.

export type ScreenLayer = 'panel' | 'modal' | 'title' | 'system';

export interface ScreenPolicy {
  pausesWorld?: boolean;
  hidesHud?: boolean;
  dimsScene?: boolean;
  needsBackdrop?: boolean;
  layer?: ScreenLayer;
  /** Does this screen need the mouse cursor (PC)? Menus with buttons do
   *  (inventory, settings, death screen) → opening one auto-releases
   *  pointer lock. Transient tap-anywhere/press-key overlays (the note
   *  card) do NOT — they stay in mouse-look so dismissing returns you to
   *  FPS without a stray cursor. Default true. */
  needsCursor?: boolean;
}

export interface ScreenHandle {
  /** Unique id for this screen (e.g. 'inventory', 'note', 'title'). */
  id: string;
  /** The screen's root DOM element. Manager sets z-index on it. */
  root: HTMLElement;
  policy?: ScreenPolicy;
  /** Called on a DISMISS / BACK request — a backdrop tap, or the ESC key
   *  routed through the input scheme. The screen decides whether to actually
   *  close. This is the "cancel/back" half. */
  onDismissRequest?: () => void;
  /** Called on an ADVANCE / CONFIRM request — Space, Enter, or the interact
   *  key, routed through the input scheme while this is the top-most screen.
   *  The "accept" half, for prompts that dismiss-or-advance on a keypress (note
   *  card, transition card). Prompts set this so they DON'T each bolt a global
   *  keydown listener on the window — the controller stays contained. */
  onConfirm?: () => void;
  /** Tear this screen down NOW, no questions asked — used by closeAllScreens on
   *  a run transition. Distinct from onDismissRequest, which is a REQUEST the
   *  screen may decline; a force-close may not be declined. Supply it whenever
   *  closing involves more than removing `root` (timers, listeners, a 3D
   *  preview rig, an internal `closed` flag). Omit it and the manager removes
   *  `root` from the DOM as a backstop, so a screen that never opted in still
   *  cannot survive the transition. */
  onForceClose?: () => void;
}

// ── Z-index buckets ───────────────────────────────────────────────────
// Backdrop sits between gameplay HUD (≤ 95) and panel-layer screens (100).
// Screens within a layer get a small offset based on open-order so
// later-opened panels stack on top.
const LAYER_Z: Record<ScreenLayer, number> = {
  panel: 100,
  modal: 200,
  title: 9000,
  system: 9500,
};
const BACKDROP_Z = 90;

// ── State ─────────────────────────────────────────────────────────────
// Insertion-ordered Map so iteration yields open-order.
const openScreens = new Map<string, ScreenHandle>();
const stateListeners = new Set<() => void>();

let backdrop: HTMLDivElement | null = null;

// When a screen last closed (performance.now ms) — see msSinceLastScreenClose.
let lastClosedAt = -Infinity;

// Desktop pointer-lock coherence (paired with the exitPointerLock in
// applyState): `cursorWasFree` tracks whether a cursor-needing screen was up
// last apply, so we can detect the transition BACK to gameplay (last menu
// closed) and re-acquire game focus. `reacquireFocus` is registered by the
// desktop input scheme (it owns the canvas + the lock); calling it inside the
// close gesture (closeScreen → applyState) satisfies the browser's
// user-gesture requirement for requestPointerLock. No-op on mobile (the
// handler gates on isDesktopLike). This is the whole "in a menu → cursor; back
// in gameplay → mouse-look" rule, owned in ONE place.
let cursorWasFree = false;
let reacquireFocus: (() => void) | null = null;

/** Register how the app re-acquires game focus when the last cursor-needing
 *  screen closes (desktop: request pointer lock on the canvas). */
export function setReacquireFocusHandler(fn: () => void): void {
  reacquireFocus = fn;
}

function ensureBackdrop(): HTMLDivElement {
  if (backdrop) return backdrop;
  backdrop = document.createElement('div');
  backdrop.id = 'screen-backdrop';
  Object.assign(backdrop.style, {
    position: 'fixed',
    inset: '0',
    background: 'rgba(0, 0, 0, 0.55)',
    zIndex: String(BACKDROP_Z),
    display: 'none',
    opacity: '0',
    pointerEvents: 'auto',
    transition: 'opacity 0.12s ease-out',
  } as Partial<CSSStyleDeclaration>);
  // Backdrop tap = dismiss request to the TOP-MOST screen that has one.
  backdrop.addEventListener('click', () => { dismissTopScreen(); });
  document.body.appendChild(backdrop);
  return backdrop;
}

// ── Public API ────────────────────────────────────────────────────────

export function openScreen(handle: ScreenHandle): void {
  if (openScreens.has(handle.id)) {
    // Replace existing entry with the new handle (allows policy updates).
    openScreens.delete(handle.id);
  }
  openScreens.set(handle.id, handle);
  // Assign z-index based on layer + position-in-layer (later = higher).
  const layer = handle.policy?.layer ?? 'panel';
  const baseZ = LAYER_Z[layer];
  let offset = 0;
  for (const s of openScreens.values()) {
    if ((s.policy?.layer ?? 'panel') === layer) {
      s.root.style.zIndex = String(baseZ + offset);
      offset++;
    }
  }
  applyState();
}

// When a screen last closed (performance.now ms). A world-tap arriving
// immediately after a close is almost always the trailing half of the
// SAME click that dismissed the screen (the note/menu closes on
// pointerdown, but the canvas's tap fires on the later mouseup/touchend
// — by then the screen is gone, so the tap would fall through to the
// world and e.g. re-open the corpse note you just dismissed). Callers
// gate world taps on msSinceLastScreenClose() to swallow that straggler.
export function closeScreen(id: string): void {
  if (openScreens.delete(id)) {
    lastClosedAt = performance.now();
    applyState();
  }
}

/**
 * Force EVERY open screen shut. The teardown authority for a run transition.
 *
 * A page reload used to be the only thing that guaranteed a clean UI, because
 * this manager could track what was open but had no way to shut it: `closeScreen`
 * only forgets a screen, and each screen removes its own DOM in its own closer.
 * So quitting a run, abandoning it, or rising after death all had to
 * `location.reload()` — which is why they cost a full boot, and why anything that
 * skipped the reload left the inventory or the settings panel hanging over the
 * title screen.
 *
 * Order matters: reverse open-order, so a modal stacked on a panel comes down
 * first and never briefly becomes the top screen. Every screen gets its
 * `onForceClose`, or — failing that — has its root pulled from the DOM, so a
 * screen whose author never opted in still cannot survive. `applyState` runs
 * ONCE at the end rather than per close: the body classes, backdrop and pointer
 * lock should settle to the final state, not flicker through N intermediate ones.
 */
export function closeAllScreens(): void {
  if (openScreens.size === 0) return;
  const stack = [...openScreens.values()].reverse();
  openScreens.clear();
  for (const s of stack) {
    if (s.onForceClose) {
      try { s.onForceClose(); } catch { /* a broken teardown must not strand the rest */ }
    } else {
      s.root.remove();
    }
  }
  // A screen's own closer calls closeScreen(), which is a no-op now that the map
  // is cleared — but it may also have re-opened something (a BACK handler). Clear
  // once more so "close everything" means it.
  openScreens.clear();
  lastClosedAt = performance.now();
  applyState();
}

/** Milliseconds since the most recent screen close (Infinity if none). */
export function msSinceLastScreenClose(): number {
  return performance.now() - lastClosedAt;
}

export function isScreenOpen(id: string): boolean {
  return openScreens.has(id);
}

export function isAnyScreenOpen(): boolean {
  return openScreens.size > 0;
}

/** Fire onDismissRequest on the top-most open screen that has one.
 *  Walks in reverse open-order so the most recently opened panel
 *  handles it first. Returns true if a dismiss was dispatched —
 *  callers (backdrop tap, ESC key) use this to decide whether to
 *  fall through to other behaviour. */
export function dismissTopScreen(): boolean {
  const stack = [...openScreens.values()].reverse();
  for (const s of stack) {
    if (s.onDismissRequest) {
      s.onDismissRequest();
      return true;
    }
  }
  return false;
}

/** Fire onConfirm on the top-most open screen that has one (advance/accept —
 *  the Space/Enter/interact half, mirroring dismissTopScreen's ESC/back half).
 *  Returns true if a confirm was dispatched, so the input scheme can swallow the
 *  key instead of letting it fall through to a game verb. */
export function confirmTopScreen(): boolean {
  const stack = [...openScreens.values()].reverse();
  for (const s of stack) {
    if (s.onConfirm) {
      s.onConfirm();
      return true;
    }
  }
  return false;
}

/** True if any open screen pauses the world. Used by the main loop to
 *  gate world updates and by attack-input to drop strikes during menus.
 *
 *  pausesWorld DEFAULTS to true (see defaultPolicy) — every modal screen
 *  freezes the world unless it explicitly opts out with
 *  `pausesWorld: false`. So opening the inventory, settings, a note, or a
 *  descent summary stops time: enemies can't hit you while you read a
 *  menu, and the moment resumes cleanly on close. A non-modal overlay
 *  that wants the world to keep running must say so. */
export function isWorldPausedByScreen(): boolean {
  for (const s of openScreens.values()) {
    if (s.policy?.pausesWorld ?? defaultPolicy(s).pausesWorld) return true;
  }
  return false;
}

/** Subscribe to "open screen set changed" notifications. Returns
 *  unsubscribe. */
export function onScreenStateChanged(fn: () => void): () => void {
  stateListeners.add(fn);
  return () => stateListeners.delete(fn);
}

// ── Internal: apply effective policy ─────────────────────────────────

function applyState() {
  // Desktop pointer-lock consistency: ANY open screen means the player
  // needs the cursor, so release pointer lock automatically — no more
  // "press Esc before you can click RISE AGAIN" on the death screen. The
  // model is simply: in a screen → free cursor; in gameplay → mouse-look.
  // Returning to gameplay (no screens) can't auto-re-lock (the browser
  // requires a click gesture); the canvas click handler re-locks
  // (input-desktop.ts). No-op on mobile (no pointerLockElement).
  // Only screens that NEED the cursor force this — a note card stays in
  // mouse-look so dismissing it doesn't leave a stray cursor.
  let needsCursor = false;
  for (const s of openScreens.values()) {
    if (s.policy?.needsCursor ?? true) { needsCursor = true; break; }
  }
  if (needsCursor && document.pointerLockElement) {
    document.exitPointerLock?.();
  }
  // The mirror of the release above: when the LAST cursor-needing screen
  // closes, hand focus back to gameplay (re-lock the pointer on desktop). Fires
  // exactly once, on the free→not-free transition, inside the close gesture so
  // the browser permits the lock request — no more "click the world to re-grab
  // the mouse (and accidentally swing)" after closing a menu.
  if (cursorWasFree && !needsCursor) reacquireFocus?.();
  cursorWasFree = needsCursor;

  let anyBackdrop = false;
  let hidesHud = false;
  let dimsScene = false;
  for (const s of openScreens.values()) {
    const p = s.policy ?? {};
    if (p.needsBackdrop ?? defaultPolicy(s).needsBackdrop) anyBackdrop = true;
    if (p.hidesHud) hidesHud = true;
    if (p.dimsScene) dimsScene = true;
  }

  // HUD hide / scene dim — driven by body classes (CSS in index.html).
  document.body.classList.toggle('hud-hidden', hidesHud);
  document.body.classList.toggle('scene-dimmed', dimsScene);

  // Backdrop — fade in/out. Created lazily on first need.
  if (anyBackdrop) {
    const bd = ensureBackdrop();
    bd.style.display = 'block';
    requestAnimationFrame(() => { if (bd) bd.style.opacity = '1'; });
  } else if (backdrop) {
    const bd = backdrop;
    bd.style.opacity = '0';
    setTimeout(() => {
      // Only hide if nothing has re-requested the backdrop in the meantime.
      if (bd && !needsBackdropEffective()) bd.style.display = 'none';
    }, 150);
  }

  for (const fn of stateListeners) fn();
}

function needsBackdropEffective(): boolean {
  for (const s of openScreens.values()) {
    const p = s.policy ?? {};
    if (p.needsBackdrop ?? defaultPolicy(s).needsBackdrop) return true;
  }
  return false;
}

/** Defaults applied when a policy field is omitted. Most screens want
 *  a backdrop; opt-out for the title + end which provide their own. */
function defaultPolicy(_h: ScreenHandle): Required<ScreenPolicy> {
  return {
    pausesWorld: true,
    hidesHud: false,
    dimsScene: false,
    needsBackdrop: true,
    layer: 'panel',
    needsCursor: true,
  };
}
