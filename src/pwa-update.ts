// PWA update suppression + safe-moment application.
//
// Default behavior (before this module): vite-plugin-pwa in autoUpdate
// mode + skipWaiting=true would activate a new SW the moment it
// finishes installing, then controllerchange would reload the page
// while the player was mid-floor on Depth 12. Bad for players, terrible
// for the harness (which is meant to run long deterministic episodes).
//
// Policy:
//   - New SWs install into the WAITING state (registerType: 'prompt'
//     in vite.config.ts). They do NOT activate automatically.
//   - getUpdateStatus() reports whether one is pending.
//   - applyUpdate() applies it: posts SKIP_WAITING to the waiting SW,
//     listens for controllerchange, reloads.
//   - At the title screen, the boot code auto-applies any pending
//     update silently (no in-progress run state to lose).
//   - When the harness is active, NEVER auto-apply — the CLI driver
//     must call applyUpdate() between episodes.

import { registerSW } from 'virtual:pwa-register';
import { isHarnessPaused } from './harness/pause';

type UpdateStatus = 'none' | 'pending';
let status: UpdateStatus = 'none';
let updateSW: ((reloadPage?: boolean) => Promise<void>) | null = null;
const listeners: Array<(s: UpdateStatus) => void> = [];

export function setupPwaAutoUpdate(): void {
  if (!('serviceWorker' in navigator)) return;

  // registerSW from virtual:pwa-register: returns a function that triggers
  // SKIP_WAITING + auto-reload on call. We only call it when we decide
  // a moment is safe.
  updateSW = registerSW({
    onNeedRefresh() {
      status = 'pending';
      for (const fn of listeners) fn(status);
    },
    // onOfflineReady fires when the very first SW install completes.
    // Nothing to do — the player can use the app offline now.
    onOfflineReady() { /* noop */ },
  });
}

/** Current update status. 'pending' = a new SW is installed and waiting
 *  to activate; applyUpdate() will take it. */
export function getUpdateStatus(): UpdateStatus {
  return status;
}

/** Apply a pending update: SKIP_WAITING → controllerchange → reload.
 *  Safe to call when status is 'none' (resolves immediately).
 *
 *  When the harness is active, the caller is responsible for picking
 *  the right moment — this function does no harness-state checking. */
export async function applyUpdate(): Promise<void> {
  if (status !== 'pending' || !updateSW) return;
  showUpdateToast();
  // updateSW(true) calls registration.waiting.postMessage({type:'SKIP_WAITING'}),
  // listens for controllerchange, and reloads the page.
  await updateSW(true);
}

/** Subscribe to status changes. Returns an unsubscribe. */
export function onUpdateStatusChange(fn: (s: UpdateStatus) => void): () => void {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

/** Apply if pending AND the moment is judged safe. Currently safe =
 *  no harness pause + no in-run state (caller's responsibility to gate
 *  by 'on title screen / between floors'). Returns true if applied. */
export async function maybeApplyUpdateSilently(): Promise<boolean> {
  if (status !== 'pending') return false;
  // Refuse if the harness is active — it would yank any running
  // episode out from under the operator. The harness has its own
  // explicit applyUpdate() entry point.
  if (isHarnessPaused()) return false;
  await applyUpdate();
  return true;
}

function showUpdateToast() {
  const toast = document.createElement('div');
  toast.textContent = 'UPDATING…';
  Object.assign(toast.style, {
    position: 'fixed',
    top: 'calc(16px + env(safe-area-inset-top, 0px))',
    left: '50%',
    transform: 'translateX(-50%)',
    padding: '8px 16px',
    background: 'rgba(20, 26, 48, 0.95)',
    border: '1px solid rgba(150, 200, 255, 0.6)',
    borderRadius: '3px',
    color: '#e6f0ff',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: '13px',
    letterSpacing: '0.25em',
    fontWeight: '500',
    zIndex: '9999',
    pointerEvents: 'none',
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(toast);
}
