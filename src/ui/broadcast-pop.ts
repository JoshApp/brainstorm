// The voice in the deep — its remarks surface here (kills scored, firsts,
// foolishness). Per CLAUDE.md Tone Layering: there is NO show, NO system, NO
// "Achievement Unlocked" (banned) — the thing that lives below simply SAYS it.
//
// Visually distinct from the in-world HUD on purpose, but OF the place:
// - near-black depth palette with a dim violet cast (it speaks from below,
//   not from a studio) — never the dungeon's warm torch orange
// - serif, a quiet lowered header ("it notices"), no system-message chrome
// - slides in from top-right with a chime; stacks if several fire

import { playBroadcastChime } from '../audio/sfx';

const POP_DURATION_MS = 2800;
const POP_SLIDE_MS = 280;
const STACK_GAP_PX = 12;

let container: HTMLDivElement | null = null;

function ensureContainer() {
  if (container) return container;
  container = document.createElement('div');
  container.id = 'broadcast-stack'; container.classList.add('game-hud');
  Object.assign(container.style, {
    position: 'fixed',
    top: 'calc(16px + env(safe-area-inset-top, 0px))',
    right: 'calc(16px + env(safe-area-inset-right, 0px))',
    display: 'flex',
    flexDirection: 'column',
    gap: `${STACK_GAP_PX}px`,
    pointerEvents: 'none',
    zIndex: '50',
    maxWidth: 'min(340px, 70vw)',
  });
  document.body.appendChild(container);
  return container;
}

export function broadcastPop(title: string, desc: string, headerText = 'it notices') {
  const root = ensureContainer();
  playBroadcastChime();

  const card = document.createElement('div');
  Object.assign(card.style, {
    background: 'linear-gradient(160deg, rgba(12, 10, 18, 0.94), rgba(24, 16, 34, 0.94))',
    border: '1px solid rgba(140, 110, 180, 0.35)',
    borderLeft: '3px solid rgba(150, 110, 200, 0.8)',
    color: '#d8cfc0',
    fontFamily: 'Georgia, "Times New Roman", serif',
    padding: '10px 14px',
    borderRadius: '3px',
    boxShadow: '0 4px 20px rgba(0,0,0,0.6), 0 0 24px rgba(110, 70, 160, 0.14)',
    backdropFilter: 'blur(4px)',
    WebkitBackdropFilter: 'blur(4px)',
    transform: 'translateX(120%)',
    opacity: '0',
    transition: `transform ${POP_SLIDE_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity ${POP_SLIDE_MS}ms ease-out`,
    willChange: 'transform, opacity',
  });

  const header = document.createElement('div');
  header.textContent = headerText;
  Object.assign(header.style, {
    fontSize: '10px',
    fontStyle: 'italic',
    letterSpacing: '0.28em',
    textTransform: 'lowercase',
    color: 'rgba(160, 130, 200, 0.8)',
    marginBottom: '4px',
  });
  card.appendChild(header);

  const titleEl = document.createElement('div');
  titleEl.textContent = title;
  Object.assign(titleEl.style, {
    fontSize: '15px',
    fontWeight: '600',
    color: '#efe8da',
    marginBottom: '2px',
    lineHeight: '1.25',
  });
  card.appendChild(titleEl);

  const descEl = document.createElement('div');
  descEl.textContent = desc;
  Object.assign(descEl.style, {
    fontSize: '12px',
    fontStyle: 'italic',
    color: 'rgba(200, 188, 168, 0.75)',
    lineHeight: '1.35',
  });
  card.appendChild(descEl);

  root.appendChild(card);

  // Slide in on next frame
  requestAnimationFrame(() => {
    card.style.transform = 'translateX(0)';
    card.style.opacity = '1';
  });

  // Slide out + remove
  setTimeout(() => {
    card.style.transform = 'translateX(120%)';
    card.style.opacity = '0';
    setTimeout(() => card.remove(), POP_SLIDE_MS + 50);
  }, POP_DURATION_MS);
}
