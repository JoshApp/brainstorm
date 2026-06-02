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
}

export interface ScreenHandle {
  /** Unique id for this screen (e.g. 'inventory', 'note', 'title'). */
  id: string;
  /** The screen's root DOM element. Manager sets z-index on it. */
  root: HTMLElement;
  policy?: ScreenPolicy;
  /** Called when the backdrop is tapped (a dismiss request). The screen
   *  decides whether to actually close itself. Screens without a backdrop
   *  never get this callback. */
  onDismissRequest?: () => void;
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

export function closeScreen(id: string): void {
  if (openScreens.delete(id)) applyState();
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
  };
}
