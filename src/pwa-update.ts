// PWA auto-update wiring.
//
// vite-plugin-pwa is configured with registerType:'autoUpdate' + workbox.skipWaiting,
// which means a freshly-found service worker takes over immediately instead of
// waiting for the user to close the app. BUT — the currently-running page keeps
// running the OLD bundle until it reloads. Without explicit help, the user has
// to close and reopen the app to actually see new code.
//
// This module closes that gap. Two pieces:
//
// 1. Listen for `controllerchange` — fires when a new SW takes over. When this
//    happens, reload the page once so the user sees the new bundle.
//
// 2. Poll for SW updates every 60s. Default browser behavior only checks every
//    24 hours; for an iteration-heavy game we want updates to roll out within
//    a minute or two of `git push`.

export function setupPwaAutoUpdate() {
  if (!('serviceWorker' in navigator)) return;

  // ── (1) Auto-reload when a new service worker takes over ─────────────
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    // Tiny visible cue so the player isn't startled by an instant reload.
    showUpdateToast();
    // Reload after a brief delay so the toast actually paints once.
    setTimeout(() => window.location.reload(), 600);
  });

  // ── (2) Poll for updates ─────────────────────────────────────────────
  navigator.serviceWorker.ready
    .then((registration) => {
      // Check immediately, then every minute.
      registration.update().catch(() => {});
      setInterval(() => {
        registration.update().catch(() => {});
      }, 60_000);
    })
    .catch(() => {
      // No SW available — nothing to poll.
    });
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
