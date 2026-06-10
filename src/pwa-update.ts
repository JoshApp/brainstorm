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
import { getSettings } from './settings/settings';

// Hook fired by main.ts right before a reload is triggered. Lets the
// dev path capture mid-floor state (player pose / HP / buffs) so the
// next boot can restore it via applyDevSnapshot. Set from main.ts at
// boot; left null in tests / harness.
let beforeReloadHook: (() => void) | null = null;

/** Register a function to call just before any reload triggered by
 *  applyUpdate. Used by main.ts to capture the dev snapshot. */
export function setBeforeReloadHook(fn: () => void): void {
  beforeReloadHook = fn;
}

type UpdateStatus = 'none' | 'pending';
// How often to re-check for a new service worker. 15s keeps the
// iteration loop tight (deploy → live in well under a minute) at a
// trivial cost: each poll is a conditional GET of sw.js (a few hundred
// bytes, 304 when unchanged).
const POLL_INTERVAL_MS = 15_000;

let status: UpdateStatus = 'none';
let updateSW: ((reloadPage?: boolean) => Promise<void>) | null = null;
let registration: ServiceWorkerRegistration | null = null;
const listeners: Array<(s: UpdateStatus) => void> = [];

export function setupPwaAutoUpdate(): void {
  if (!('serviceWorker' in navigator)) return;

  // registerSW from virtual:pwa-register: registers the SW and returns
  // a function that triggers SKIP_WAITING + auto-reload on call. We
  // only call updateSW(true) when WE decide a moment is safe (see
  // applyUpdate / maybeApplyUpdateSilently).
  //
  // CRITICAL: registerSW does NOT poll for new SWs on its own. Without
  // an explicit periodic update() call, the browser only checks for
  // new SWs on hard navigation. On a long-lived PWA tab that means
  // "never." The polling below is what makes "deploy → live quickly"
  // actually work (interval = POLL_INTERVAL_MS).
  updateSW = registerSW({
    onRegisteredSW(_swUrl, reg) {
      if (!reg) return;
      registration = reg;   // captured so awaitBootUpdate can inspect it
      // Initial check immediately, then every POLL_INTERVAL_MS.
      reg.update().catch(() => { /* offline / no-op */ });
      window.setInterval(() => {
        reg.update().catch(() => { /* offline / no-op */ });
      }, POLL_INTERVAL_MS);
    },
    onNeedRefresh() {
      status = 'pending';
      for (const fn of listeners) fn(status);
      // DEV mode: apply immediately on detection, no waiting for a safe
      // moment. The mid-floor reload costs the player kills/positions
      // since the last floor entry — the cost of fast iteration. Still
      // respects the harness pause (CLI driver applies between episodes).
      if (getSettings().devAutoUpdate && !isHarnessPaused()) {
        void applyUpdate();
      }
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

/** Poll the captured registration until it exists (registerSW resolves it
 *  asynchronously), or give up after `timeoutMs`. */
function waitForRegistration(timeoutMs: number): Promise<ServiceWorkerRegistration | null> {
  if (registration) return Promise.resolve(registration);
  return new Promise((resolve) => {
    let waited = 0;
    const iv = window.setInterval(() => {
      if (registration) { window.clearInterval(iv); resolve(registration); }
      else if ((waited += 100) >= timeoutMs) { window.clearInterval(iv); resolve(null); }
    }, 100);
  });
}

/**
 * BOOT GATE — call once at startup, BEFORE revealing the title, while a loading
 * veil is up. Resolves:
 *   - true  → a fresh build is downloading/ready; we applied it (a reload is
 *             imminent). The caller should KEEP the veil up — the page is about
 *             to navigate to the new build.
 *   - false → nothing to update (or offline / first-ever load / auto-update off
 *             / timed out). The caller drops the veil and shows the title.
 *
 * This is what turns "stale menu flashes, then reloads a beat later" into
 * "wait on the loading screen, land on the fresh build." It resolves FAST in
 * the common up-to-date case (one conditional GET of sw.js, nothing installing)
 * so boot isn't taxed when there's no update.
 */
export async function awaitBootUpdate(maxWaitMs = 6000): Promise<boolean> {
  if (!('serviceWorker' in navigator) || isHarnessPaused() || !getSettings().autoUpdate) return false;
  // No controller = first-ever load (or a hard reload): nothing is cached to
  // update FROM, and the first SW install is not an "update" — don't wait on it.
  if (!navigator.serviceWorker.controller) return false;
  // Already know one's waiting — take it now.
  if (status === 'pending') { void applyUpdate(); return true; }

  return await new Promise<boolean>((resolve) => {
    let settled = false;
    let timer = 0;
    const done = (updating: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      unsub();
      resolve(updating);
    };
    // A new SW finished installing → apply it (reload). Keep the veil up.
    const unsub = onUpdateStatusChange((s) => { if (s === 'pending') { void applyUpdate(); done(true); } });
    // Hard cap so a hung/flaky network never strands us on the loading screen.
    timer = window.setTimeout(() => done(false), maxWaitMs);
    // Fast path: once the registration's check settles with nothing installing
    // or waiting, there's no update — proceed immediately (no full-timeout wait).
    void (async () => {
      const reg = await waitForRegistration(3000);
      if (!reg || settled) return;
      try { await reg.update(); } catch { /* offline */ }
      if (settled) return;
      if (!reg.installing && !reg.waiting) done(false);
      // else: a worker is installing → the onUpdateStatusChange handler above
      // resolves us true once it reaches the waiting state (onNeedRefresh).
    })();
  });
}

/** Apply a pending update: SKIP_WAITING → controllerchange → reload.
 *  Safe to call when status is 'none' (resolves immediately).
 *
 *  When the harness is active, the caller is responsible for picking
 *  the right moment — this function does no harness-state checking. */
export async function applyUpdate(): Promise<void> {
  if (status !== 'pending' || !updateSW) return;
  // Fire the pre-reload hook so callers can persist any mid-floor
  // state they want to restore on next boot (see dev-snapshot.ts).
  // Synchronous + try/catch — a buggy hook shouldn't block updates.
  if (beforeReloadHook) {
    try { beforeReloadHook(); } catch { /* swallow — don't block reload */ }
  }
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
