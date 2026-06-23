// "Achievement Unlocked" toast in the DCC tribute register.
//
// Visually distinct from the in-world UI on purpose, per CLAUDE.md Tone
// Layering — this is the COSMIC BROADCAST FRAME, not the dungeon. So:
// - cool color palette (cyan/violet instead of the dungeon's warm orange/red)
// - sans-serif, ALL CAPS header, "transmission" feel
// - slides in from top-right with a chime
// - stacks if multiple fire in quick succession
//
// The dungeon's UI stays warm and atmospheric. The narrator's UI is sterile,
// system-message, "you are being watched and judged."

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

export function broadcastPop(title: string, desc: string, headerText = 'ACHIEVEMENT UNLOCKED') {
  const root = ensureContainer();
  playBroadcastChime();

  const card = document.createElement('div');
  Object.assign(card.style, {
    background: 'linear-gradient(135deg, rgba(20, 26, 48, 0.92), rgba(40, 28, 60, 0.92))',
    border: '1px solid rgba(150, 200, 255, 0.45)',
    borderLeft: '3px solid rgba(180, 220, 255, 0.95)',
    color: '#e6f0ff',
    fontFamily: 'system-ui, -apple-system, "Helvetica Neue", sans-serif',
    padding: '10px 14px',
    borderRadius: '4px',
    boxShadow: '0 4px 20px rgba(0,0,0,0.5), 0 0 24px rgba(120, 180, 255, 0.18)',
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
    fontWeight: '700',
    letterSpacing: '0.22em',
    color: 'rgba(160, 210, 255, 0.85)',
    marginBottom: '4px',
  });
  card.appendChild(header);

  const titleEl = document.createElement('div');
  titleEl.textContent = title;
  Object.assign(titleEl.style, {
    fontSize: '15px',
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: '2px',
    lineHeight: '1.25',
  });
  card.appendChild(titleEl);

  const descEl = document.createElement('div');
  descEl.textContent = desc;
  Object.assign(descEl.style, {
    fontSize: '12px',
    color: 'rgba(220, 230, 245, 0.78)',
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
