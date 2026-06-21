// Boot-loop safe mode.
//
// If the app crashes DURING boot — a corrupt save, a bad cached build, a
// device-specific init failure — the player gets a white screen and is stuck,
// reloading into the same crash forever. We mark "boot started" in localStorage
// and clear it once the first frame renders. If a boot finds the PREVIOUS boot
// started recently and never completed, that's a failure; after two in a row we
// stop trying and show a safe-mode screen (try again / wipe local data / report)
// instead of re-crashing. Normal players never see it — bootSucceeded() clears
// the flag on the first good frame.

import { hasCommunityLink, openCommunityLink } from './links';

const KEY = 'delve:boot-guard';
const WINDOW_MS = 60_000; // an incomplete boot older than this is an abandoned tab, not a crash
const MAX_FAILS = 2;

interface BootState { booting: boolean; fails: number; t: number; }

function read(): BootState {
  try { return JSON.parse(localStorage.getItem(KEY) || '') as BootState; }
  catch { return { booting: false, fails: 0, t: 0 }; }
}
function write(s: BootState): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode — skip */ }
}

/** Call at the very start of boot. Returns false if we entered SAFE MODE, in
 *  which case the caller must NOT continue booting. */
export function beginBoot(): boolean {
  const s = read();
  const recentIncomplete = s.booting && (Date.now() - (s.t || 0) < WINDOW_MS);
  const fails = recentIncomplete ? (s.fails || 0) + 1 : 0;
  write({ booting: true, fails, t: Date.now() });
  if (fails >= MAX_FAILS) { showSafeMode(); return false; }
  return true;
}

/** Call once the first frame has rendered — boot is proven good. */
export function bootSucceeded(): void {
  write({ booting: false, fails: 0, t: Date.now() });
}

function showSafeMode(): void {
  const root = document.createElement('div');
  Object.assign(root.style, {
    position: 'fixed', inset: '0', zIndex: '99999',
    background: 'linear-gradient(180deg, rgba(0,0,0,0.97), rgba(12,3,2,0.99))',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    gap: '16px', padding: '24px', textAlign: 'center',
    fontFamily: '"Iowan Old Style", "Palatino", serif', color: 'rgba(220, 180, 140, 0.9)',
  } as Partial<CSSStyleDeclaration>);

  const head = document.createElement('div');
  head.textContent = 'the descent will not begin';
  Object.assign(head.style, {
    fontSize: 'clamp(18px, 4.5vw, 26px)', fontStyle: 'italic', letterSpacing: '0.08em',
    textShadow: '0 0 18px rgba(140, 30, 20, 0.45)', color: 'rgba(230, 190, 150, 0.92)',
  } as Partial<CSSStyleDeclaration>);
  root.appendChild(head);

  const sub = document.createElement('div');
  sub.textContent = 'something below refuses you. try once more, or clear what you carry and begin anew.';
  Object.assign(sub.style, { fontSize: '13px', color: 'rgba(180, 150, 120, 0.7)', maxWidth: '440px', lineHeight: '1.5' } as Partial<CSSStyleDeclaration>);
  root.appendChild(sub);

  const row = document.createElement('div');
  Object.assign(row.style, { display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center', marginTop: '6px' } as Partial<CSSStyleDeclaration>);

  const retry = makeBtn('TRY ONCE MORE', true);
  retry.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    write({ booting: false, fails: 0, t: Date.now() }); // clear the loop flag, then a clean reload
    window.location.reload();
  });
  row.appendChild(retry);

  const wipe = makeBtn('CLEAR THE SLATE', false);
  wipe.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (wipe.dataset.armed !== '1') { wipe.dataset.armed = '1'; wipe.textContent = 'ERASE ALL — TAP AGAIN'; return; }
    try {
      // Wipe everything DELVE owns (save, meta, settings) — the corrupt-state
      // escape hatch. A two-tap confirm so it isn't a single mis-tap away.
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('delve:')) keys.push(k); }
      keys.forEach((k) => localStorage.removeItem(k));
    } catch { /* ignore */ }
    window.location.reload();
  });
  row.appendChild(wipe);
  root.appendChild(row);

  if (hasCommunityLink()) {
    const join = makeBtn('TELL THE DEEP', false);
    join.style.marginTop = '6px';
    join.style.opacity = '0.7';
    join.addEventListener('pointerdown', (e) => { e.preventDefault(); openCommunityLink(); });
    root.appendChild(join);
  }

  document.body.appendChild(root);
}

function makeBtn(label: string, primary: boolean): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  Object.assign(b.style, {
    padding: '11px 26px', minHeight: '44px', borderRadius: '30px',
    border: primary ? '1px solid rgba(255, 190, 120, 0.55)' : '1px solid rgba(150, 110, 70, 0.4)',
    background: primary ? 'linear-gradient(180deg, rgba(80, 42, 22, 0.85), rgba(50, 24, 10, 0.85))' : 'transparent',
    color: primary ? 'rgba(255, 230, 200, 0.98)' : 'rgba(200, 165, 130, 0.8)',
    fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: '14px', fontWeight: '600',
    letterSpacing: '0.22em', cursor: 'pointer', touchAction: 'manipulation',
  } as Partial<CSSStyleDeclaration>);
  return b;
}
