// Boss intro title card — the "fog gate" beat.
//
// Mounts once at boot, hidden. The boss-bar controller (ui/boss-bar.ts)
// fires showBossIntro(name, line?) on first aggro — the same moment the
// boss bar appears. The card holds for ~1.8s and fades; the bar
// remains for the rest of the fight.
//
// Visual: large italic name centered horizontally, narrower subtitle
// beneath. Sits over the live world (no full-screen black) so the
// player can still see the boss approaching. Drop shadow + bright
// red-orange tint to read against any backdrop.

let card: HTMLDivElement | null = null;
let nameEl: HTMLDivElement | null = null;
let lineEl: HTMLDivElement | null = null;
let hideTimer: number = -1;

const HOLD_MS = 1800;
const FADE_OUT_MS = 600;

function ensureCard(): HTMLDivElement {
  if (card) return card;
  card = document.createElement('div');
  card.id = 'boss-intro-card';
  Object.assign(card.style, {
    position: 'fixed',
    inset: '0',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
    opacity: '0',
    zIndex: '50',
    color: 'rgba(245, 220, 200, 0.96)',
    fontFamily: 'Georgia, "Iowan Old Style", "Times New Roman", serif',
    textAlign: 'center',
    letterSpacing: '0.16em',
    textShadow: '0 0 18px rgba(80, 10, 6, 0.85), 0 2px 12px rgba(0, 0, 0, 0.85)',
    transition: `opacity ${FADE_OUT_MS}ms ease-out`,
    padding: '0 28px',
  } as Partial<CSSStyleDeclaration>);

  nameEl = document.createElement('div');
  Object.assign(nameEl.style, {
    fontSize: 'clamp(28px, 7vw, 56px)',
    fontStyle: 'italic',
    fontWeight: '300',
    margin: '0 0 0.4em 0',
    color: 'rgba(255, 180, 130, 0.98)',
  } as Partial<CSSStyleDeclaration>);

  lineEl = document.createElement('div');
  Object.assign(lineEl.style, {
    fontSize: 'clamp(13px, 2.4vw, 18px)',
    fontStyle: 'italic',
    opacity: '0.78',
    letterSpacing: '0.22em',
    maxWidth: '560px',
    lineHeight: '1.4',
  } as Partial<CSSStyleDeclaration>);

  card.appendChild(nameEl);
  card.appendChild(lineEl);
  document.body.appendChild(card);
  return card;
}

/** Show the boss intro card. Idempotent within a single boss fight —
 *  calling twice in the same engagement just resets the hold timer. */
export function showBossIntro(name: string, line: string = ''): void {
  const el = ensureCard();
  if (nameEl) nameEl.textContent = name;
  if (lineEl) lineEl.textContent = line;
  // Snap to visible, then auto-fade after the hold window.
  el.style.transition = 'opacity 0ms';
  el.style.opacity = '1';
  if (hideTimer >= 0) window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    el.style.transition = `opacity ${FADE_OUT_MS}ms ease-out`;
    el.style.opacity = '0';
    hideTimer = -1;
  }, HOLD_MS);
}

/** Force-hide — used on level teardown so a card lingering from a
 *  previous floor doesn't bleed across descents. */
export function hideBossIntro(): void {
  if (!card) return;
  card.style.transition = `opacity 200ms ease-out`;
  card.style.opacity = '0';
  if (hideTimer >= 0) { window.clearTimeout(hideTimer); hideTimer = -1; }
}
