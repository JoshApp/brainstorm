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
// or pauses the world. Lines queue so two discoveries don't stack on top of
// each other.

const HOLD_MS = 4200;       // time fully visible before fading
const FADE_MS = 900;        // fade-in / fade-out duration
const GAP_MS = 350;         // beat between queued lines

let container: HTMLDivElement | null = null;
const queue: string[] = [];
let showing = false;

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

function drainQueue(): void {
  if (showing) return;
  const text = queue.shift();
  if (text == null) return;
  showing = true;

  const root = ensureContainer();
  const line = document.createElement('div');
  line.textContent = text;
  Object.assign(line.style, {
    opacity: '0',
    transition: `opacity ${FADE_MS}ms ease`,
  });
  root.appendChild(line);

  // Fade in next frame.
  requestAnimationFrame(() => { line.style.opacity = '1'; });

  // Hold, then fade out, then remove + advance the queue.
  setTimeout(() => {
    line.style.opacity = '0';
    setTimeout(() => {
      line.remove();
      showing = false;
      setTimeout(drainQueue, GAP_MS);
    }, FADE_MS);
  }, FADE_MS + HOLD_MS);
}

/** Surface an in-world line, no pause. Queues behind any line already showing. */
export function whisper(text: string): void {
  if (!text) return;
  queue.push(text);
  drainQueue();
}
