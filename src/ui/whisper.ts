// Whisper — a diegetic, NON-PAUSING line of in-world text. The grim register
// of the Tone Bible: a dead delver's scrawl as you pass it, a body's epitaph as
// your lamp finds it. The dungeon does not stop for you to read — the line
// fades up low on the screen, holds, fades out, while you keep moving.
//
// Three text surfaces, three jobs (don't mix them):
//   - whisper()      — THIS. In-world grim text, no pause, ambient discovery.
//   - showNote()     — a paper note you stop and READ (parchment modal, pauses).
//   - broadcastPop() — the voice in the deep's snark (top-right, its own tone).
//
// pointerEvents:none and no screen-manager involvement, so it never grabs input
// or pauses the world. ONE line at a time: a new discovery PREEMPTS the current
// one (you looked at a new thing — read that now), and a source can DISMISS its
// own line early when you look away, so text doesn't linger after you've stopped
// attending to it.

const HOLD_MS = 4200;       // time fully visible before fading on its own
const FADE_MS = 650;        // normal fade-in / fade-out duration
const QUICK_FADE_MS = 200;  // snappy fade on preempt / look-away dismiss
const GAP_MS = 320;         // beat between a source's sequenced lines

interface Pending { text: string; token: unknown; }

let container: HTMLDivElement | null = null;
let activeLine: HTMLDivElement | null = null;
let activeToken: unknown = null;       // who owns the line currently showing
let holdTimer = 0;
// Same-SOURCE continuations queued behind the active line (e.g. a corpse's
// epitaph → reaction). A DIFFERENT source preempts instead of queueing, and
// clears this — you looked at a new thing, so its old follow-ups are moot.
let queue: Pending[] = [];

function ensureContainer(): HTMLDivElement {
  if (container) return container;
  const c = document.createElement('div');
  Object.assign(c.style, {
    position: 'fixed',
    left: '50%',
    // Low on the screen, above the controls/safe-area but clearly "in the
    // world," not a HUD chip up top.
    bottom: 'calc(20% + env(safe-area-inset-bottom, 0px))',
    transform: 'translateX(-50%)',
    width: 'min(560px, calc(100vw - 48px))',
    textAlign: 'center',
    pointerEvents: 'none',
    zIndex: '40',
    // Grim register — the same warm serif the note card uses, dimmer.
    fontFamily: '"Iowan Old Style", "Palatino", "Times New Roman", serif',
    fontStyle: 'italic',
    fontSize: '17px',
    lineHeight: '1.5',
    letterSpacing: '0.01em',
    color: '#c9b48f',
    textShadow: '0 2px 10px rgba(0,0,0,0.9), 0 0 18px rgba(0,0,0,0.7)',
  });
  document.body.appendChild(c);
  container = c;
  return c;
}

// Fade a line out over `ms` and remove it from the DOM after.
function fadeOutAndRemove(line: HTMLDivElement, ms: number): void {
  line.style.transition = `opacity ${ms}ms ease`;
  line.style.opacity = '0';
  window.setTimeout(() => line.remove(), ms);
}

// Mount + fade in a line, set the hold timer that fades it and drains the next
// same-source continuation.
function showLine(text: string, token: unknown): void {
  const root = ensureContainer();
  const line = document.createElement('div');
  line.textContent = text;
  Object.assign(line.style, { opacity: '0', transition: `opacity ${FADE_MS}ms ease` });
  root.appendChild(line);
  activeLine = line;
  activeToken = token;
  requestAnimationFrame(() => { line.style.opacity = '1'; });

  holdTimer = window.setTimeout(() => {
    if (activeLine !== line) return;
    fadeOutAndRemove(line, FADE_MS);
    activeLine = null;
    activeToken = null;
    const next = queue.shift();
    if (next) window.setTimeout(() => showLine(next.text, next.token), GAP_MS);
  }, FADE_MS + HOLD_MS);
}

/** Surface an in-world line, no pause. A line from a DIFFERENT source PREEMPTS
 *  whatever's showing (you looked at a new thing — read that now); a line from
 *  the SAME `token` queues behind (a source's own sequenced lines, e.g. a
 *  corpse's epitaph → reaction). `token` also lets a source dismiss its own line
 *  early (see dismissWhisper). */
export function whisper(text: string, token?: unknown): void {
  if (!text) return;
  const tok = token ?? null;
  // Same source as the line currently showing → sequence behind it.
  if (activeLine && activeToken === tok) { queue.push({ text, token: tok }); return; }
  // Different source → preempt: drop any pending continuations + fast-fade the old.
  window.clearTimeout(holdTimer);
  queue = [];
  if (activeLine) { fadeOutAndRemove(activeLine, QUICK_FADE_MS); activeLine = null; }
  showLine(text, tok);
}

/** Fast-fade the current line IF it belongs to `token` (or unconditionally when
 *  `token` is omitted). A reveal source calls this when you look away / leave
 *  range, so its line doesn't sit out its full hold after you've moved on. The
 *  token gate means looking away from rune A never kills rune B's line. */
export function dismissWhisper(token?: unknown): void {
  if (!activeLine) return;
  if (token !== undefined && activeToken !== token) return;
  window.clearTimeout(holdTimer);
  queue = [];
  fadeOutAndRemove(activeLine, QUICK_FADE_MS);
  activeLine = null;
  activeToken = null;
}
