import { get } from '../ecs/world';
import { BUFFS } from '../content/buffs';

// Active-buff indicators stacked above the HP bar. Each active buff shows:
//   - its displayName (e.g. "REGEN")
//   - a horizontal time bar that drains as the buff expires
//   - a colored left-edge accent so multiple buffs are distinguishable
//
// Tracked by buff id; pills are reused across frames (created when a new buff
// appears, removed when one expires) so the DOM doesn't churn.

interface BuffPill {
  root: HTMLDivElement;
  fill: HTMLDivElement;
  label: HTMLDivElement;
  initialDuration: number;  // captured the first frame the buff was seen
  lastRemaining: number;
}

let container: HTMLDivElement | null = null;
const pills = new Map<string, BuffPill>();

export function createBuffBar() {
  if (container) return;
  container = document.createElement('div');
  container.id = 'buff-bar';
  Object.assign(container.style, {
    position: 'fixed',
    left: '50%',
    bottom: 'calc(48px + env(safe-area-inset-bottom, 0px))',
    transform: 'translateX(-50%)',
    display: 'flex',
    gap: '6px',
    zIndex: '10',
    pointerEvents: 'none',
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(container);
}

export function updateBuffBar() {
  if (!container) return;
  const player = get('player');
  if (!player) return;

  const seen = new Set<string>();

  for (const active of player.buffs) {
    const spec = BUFFS[active.specId];
    if (!spec) continue;
    seen.add(active.specId);

    let pill = pills.get(active.specId);
    if (!pill) {
      pill = createPill(spec.displayName ?? active.specId, spec.color ?? 0xffffff);
      container.appendChild(pill.root);
      pill.initialDuration = active.remaining;
      pills.set(active.specId, pill);
    } else if (active.remaining > pill.lastRemaining) {
      // Buff was refreshed — reset the time-bar reference duration.
      pill.initialDuration = active.remaining;
    }

    const fraction = pill.initialDuration > 0
      ? Math.max(0, Math.min(1, active.remaining / pill.initialDuration))
      : 0;
    pill.fill.style.width = `${(fraction * 100).toFixed(1)}%`;
    pill.lastRemaining = active.remaining;
  }

  // Remove pills for buffs that are no longer active.
  for (const [id, pill] of pills) {
    if (!seen.has(id)) {
      pill.root.remove();
      pills.delete(id);
    }
  }
}

function createPill(label: string, color: number): BuffPill {
  const root = document.createElement('div');
  const cssColor = `#${color.toString(16).padStart(6, '0')}`;
  Object.assign(root.style, {
    position: 'relative',
    minWidth: '70px',
    padding: '4px 10px 4px 12px',
    background: 'rgba(20, 12, 8, 0.7)',
    border: `1px solid ${cssColor}55`,
    borderLeft: `3px solid ${cssColor}`,
    borderRadius: '3px',
    color: cssColor,
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: '12px',
    fontWeight: '500',
    letterSpacing: '0.15em',
    textShadow: '0 0 6px rgba(0,0,0,0.85)',
    overflow: 'hidden',
  } as Partial<CSSStyleDeclaration>);

  const fill = document.createElement('div');
  Object.assign(fill.style, {
    position: 'absolute',
    left: '0',
    bottom: '0',
    height: '2px',
    background: cssColor,
    opacity: '0.7',
    width: '100%',
    transition: 'width 0.1s linear',
  } as Partial<CSSStyleDeclaration>);

  const labelEl = document.createElement('div');
  labelEl.textContent = label;

  root.appendChild(fill);
  root.appendChild(labelEl);
  return { root, fill, label: labelEl, initialDuration: 1, lastRemaining: 1 };
}
