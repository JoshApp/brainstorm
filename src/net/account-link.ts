// Account linking — the 2-tap "save my progress" upgrade, via Clerk.
//
// Clerk's SDK is LAZY-LOADED (dynamic import) so it never touches the main
// bundle — most players never link, and a linker pays the cost once. Flow:
// issue a link code as the current anon player → sign in with Clerk (Google /
// Discord / Twitch) → reconnect to SpacetimeDB as that identity → redeem the
// code, merging the new identity into this player. A pending code in
// localStorage lets the flow survive an OAuth page reload. See
// docs/ALPHA-AND-BACKEND.md.

import { freshLinkCode, issueLinkCode, redeemLinkCode, reconnectWithToken } from './delve-net';

// Clerk publishable key — public by design (safe in the client). Production uses
// the pk_live key via VITE_CLERK_PUBLISHABLE_KEY (set repo var
// CLERK_PUBLISHABLE_KEY in the deploy workflow); absent → the dev pk_test key, so
// local + un-configured builds still work. The flow below (issue code → Clerk
// sign-in → reconnect → redeem) is provider-agnostic; which socials appear
// (Google / Discord / Twitch) is Clerk-dashboard config, not code.
const CLERK_PUBLISHABLE_KEY =
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ||
  'pk_test_cGxlYXNhbnQtc3BvbmdlLTE4LmNsZXJrLmFjY291bnRzLmRldiQ';
const PENDING_KEY = 'delve:pending-link';

// Clerk instance, typed loosely — this is the one integration seam, and
// fighting Clerk's generics here buys nothing.
let clerk: any = null;

async function loadClerk(): Promise<any> {
  if (clerk) return clerk;
  const { Clerk } = await import('@clerk/clerk-js');
  const c = new Clerk(CLERK_PUBLISHABLE_KEY);
  await c.load();
  clerk = c;
  return c;
}

function setPending(code: string): void {
  try { localStorage.setItem(PENDING_KEY, code); } catch { /* storage off */ }
}
function getPending(): string | null {
  try { return localStorage.getItem(PENDING_KEY); } catch { return null; }
}
function clearPending(): void {
  try { localStorage.removeItem(PENDING_KEY); } catch { /* storage off */ }
}

/** Finish a link that's mid-flight — called on boot (after an OAuth reload)
 *  and right after a popup sign-in. No-op unless a code is pending AND Clerk
 *  has a session. Does NOT load Clerk in the common (no-pending) case, so boot
 *  stays cheap. Idempotent. */
export async function completePendingLink(): Promise<void> {
  const code = getPending();
  if (!code) return; // common path — boot pays nothing
  try {
    const c = await loadClerk();
    if (!c.session) return; // signed out / abandoned — leave the code for a retry
    const token = await c.session.getToken();
    if (!token) return;
    await reconnectWithToken(token); // become the Clerk identity
    // Clear the pending code ONLY if the redeem actually dispatched on a live
    // connection. If the reconnect errored (offline / bad token), redeem returns
    // false and we KEEP the code — it's the only copy (link_code is private), so
    // a premature clear would strand the link with no retry.
    if (redeemLinkCode(code)) clearPending();
  } catch (err) {
    console.warn('[net] completePendingLink failed:', err); // keep the code for a retry
  }
}

/** Start the 2-tap upgrade: issue a code as the current player, then open
 *  Clerk sign-in. Resolves true once linked (popup path); a full-page OAuth
 *  redirect resolves on the next load via completePendingLink(). */
export async function startAccountUpgrade(): Promise<boolean> {
  const code = freshLinkCode();
  issueLinkCode(code);
  setPending(code);

  const c = await loadClerk();
  if (c.session) {
    // Already signed in — just attach this identity to our player.
    await completePendingLink();
    return true;
  }

  // Open Clerk's sign-in (the enabled social buttons). A popup returns control
  // here via the listener; a full redirect finishes on reload.
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => { if (!settled) { settled = true; resolve(); } };
    try {
      const off = c.addListener((res: any) => {
        if (res.session) { try { off?.(); } catch { /* noop */ } finish(); }
      });
    } catch { /* ignore */ }
    try { c.openSignIn({}); } catch { finish(); }
  });

  await completePendingLink();
  return true;
}

/** Sign out of the linked account. The per-device anon identity still works,
 *  and still resolves to the same (merged) player. */
export async function signOutAccount(): Promise<void> {
  const c = await loadClerk();
  try { await c.signOut(); } catch { /* noop */ }
}
