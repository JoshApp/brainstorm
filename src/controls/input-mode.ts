// Central input-mode controller.
//
// The game has TWO kinds of states that matter to input:
//   - menus are open (inventory, settings) — gameplay input ignored;
//     world ticks paused; tap-attack zone deactivated.
//   - gameplay (no menus) — normal touch + camera + attack.
//
// Multiple menus can be open at once (e.g. settings opened ON TOP of
// inventory). Tracked as a Set, so closing one menu doesn't accidentally
// resume the world if another is still up — exactly the "pause stack"
// Josh asked for, implemented as a set rather than a stack since order
// doesn't matter for "is anything paused".
//
// Anyone who wants to react to mode changes subscribes via
// onMenuStateChanged; the input-mode module owns its own shared full-
// screen backdrop that fades in/out automatically.

const openMenus = new Set<string>();
const listeners = new Set<() => void>();
const dismissListeners = new Set<() => void>();
let backdrop: HTMLDivElement | null = null;

function notify() {
  for (const fn of listeners) fn();
  updateBackdrop();
}

/**
 * Fire when the user wants to dismiss the open menu(s) — currently
 * triggered by clicking the shared backdrop. Each registered menu
 * decides whether to close itself (typically yes, if it's open).
 */
export function onDismissRequest(fn: () => void): () => void {
  dismissListeners.add(fn);
  return () => dismissListeners.delete(fn);
}

/** Mark a menu as open. Idempotent; multiple opens of the same id stack as one. */
export function openMenu(id: string) {
  const wasEmpty = openMenus.size === 0;
  openMenus.add(id);
  if (wasEmpty) notify();
}

/** Mark a menu as closed. World only resumes once the set is empty. */
export function closeMenu(id: string) {
  const had = openMenus.delete(id);
  if (had && openMenus.size === 0) notify();
}

/** True if anything in the menu set is open — game loop checks this to skip ticks. */
export function isAnyMenuOpen(): boolean {
  return openMenus.size > 0;
}

/** Subscribe to "transition into a menu" or "transition out of all menus" events. */
export function onMenuStateChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Install the shared full-screen backdrop. Called once at boot from main.ts.
 * The backdrop blocks all clicks behind it (so gameplay UI under it can't be
 * accidentally tapped through) and provides a dim/blur veil to focus the
 * player on the open menu.
 */
export function installMenuBackdrop() {
  if (backdrop) return;
  backdrop = document.createElement('div');
  backdrop.id = 'menu-backdrop';
  Object.assign(backdrop.style, {
    position: 'fixed',
    inset: '0',
    background: 'rgba(0, 0, 0, 0.55)',
    zIndex: '90',           // below menu panels (100) and menu open-buttons (15);
                            // above all gameplay HUD (joystick / use / potion / HP)
    display: 'none',
    pointerEvents: 'auto',  // intercepts clicks so HUD under it doesn't fire
    transition: 'opacity 0.12s ease-out',
    opacity: '0',
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(backdrop);

  // Tap-anywhere-outside-menu to dismiss. Each registered menu reacts.
  backdrop.addEventListener('click', () => {
    for (const fn of [...dismissListeners]) fn();
  });
}

function updateBackdrop() {
  if (!backdrop) return;
  if (isAnyMenuOpen()) {
    backdrop.style.display = 'block';
    // Force a reflow then fade in, so the transition runs.
    requestAnimationFrame(() => { if (backdrop) backdrop.style.opacity = '1'; });
  } else {
    backdrop.style.opacity = '0';
    // Hide fully after the fade-out completes.
    setTimeout(() => { if (backdrop && !isAnyMenuOpen()) backdrop.style.display = 'none'; }, 150);
  }
}
