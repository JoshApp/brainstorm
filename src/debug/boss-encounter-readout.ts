// On-screen DEV readout of the boss-encounter container — engaged/completed
// state + every tracked body's alive/HP. Surfaces a stuck member (a body the
// fight is waiting on that you can't see) so a hung encounter is diagnosable
// at a glance instead of guessed at. Mounted only in debug mode.

import { bossEncounterDebug } from '../mobs/boss-encounter';

let el: HTMLDivElement | null = null;

export function initBossEncounterReadout(): void {
  if (el) return;
  el = document.createElement('div');
  el.id = 'boss-encounter-debug';
  Object.assign(el.style, {
    position: 'fixed',
    left: 'calc(16px + env(safe-area-inset-left, 0px))',
    top: 'calc(150px + env(safe-area-inset-top, 0px))',   // under the dark-adapt readout
    font: '11px monospace',
    lineHeight: '1.35',
    color: 'rgba(230, 170, 150, 0.92)',
    background: 'rgba(0, 0, 0, 0.45)',
    padding: '4px 7px',
    borderRadius: '3px',
    whiteSpace: 'pre',
    pointerEvents: 'none',
    zIndex: '60',
    userSelect: 'none',
    WebkitUserSelect: 'none',
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(el);
}

/** Per-frame. No-op when not mounted. Hidden until the encounter has bodies. */
export function updateBossEncounterReadout(): void {
  if (!el) return;
  const s = bossEncounterDebug();
  if (s.members.length === 0) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  const head = `boss eng:${s.engaged ? 1 : 0} done:${s.completed ? 1 : 0} ph:${s.phase}`;
  const rows = s.members.map((m) =>
    `  ${m.kind} ${m.alive ? 'ALIVE' : 'dead '}${m.dying ? '(dying)' : ''} hp ${m.hp}/${m.max}`,
  );
  el.textContent = [head, ...rows].join('\n');
}
