// Small top-left depth indicator. Just text — no border, no background.
// Stays out of the way; the player only glances at it.

let label: HTMLDivElement | null = null;

export function createDepthCounter(depth: number) {
  if (label) return;

  label = document.createElement('div');
  label.id = 'depth-counter';
  Object.assign(label.style, {
    position: 'fixed',
    left: 'calc(16px + env(safe-area-inset-left, 0px))',
    top: 'calc(48px + env(safe-area-inset-top, 0px))',  // below the style switcher
    color: 'rgba(200, 160, 130, 0.55)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: '12px',
    fontWeight: '400',
    letterSpacing: '0.25em',
    textShadow: '0 0 6px rgba(0,0,0,0.85)',
    pointerEvents: 'none',
    zIndex: '10',
    userSelect: 'none',
    WebkitUserSelect: 'none',
  } as Partial<CSSStyleDeclaration>);
  label.textContent = `DEPTH ${depth}`;
  document.body.appendChild(label);
}

export function setDepth(depth: number, sanctuary: boolean = false) {
  if (!label) return;
  label.textContent = sanctuary ? `DEPTH ${depth} — SANCTUARY` : `DEPTH ${depth}`;
}
