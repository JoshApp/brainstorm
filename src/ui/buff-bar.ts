import { get } from '../ecs/world';
import { BUFFS } from '../content/buffs';
import { FONT_UI } from './hud';

// Active-buff indicators stacked above the HP bar. Each active buff shows:
//   - a colored icon dot (matching the buff's spec color)
//   - its displayName (e.g. "BLOODTHIRST")
//   - the seconds remaining as a numeric counter
//   - a horizontal drain bar at the bottom that shrinks as the buff expires
//
// Pills are reused across frames (created when a new buff appears, removed
// when one expires) so the DOM doesn't churn. When a buff is REFRESHED (a
// new application before it expires), the pill briefly flashes brighter.

interface BuffPill {
  root: HTMLDivElement;
  fill: HTMLDivElement;
  countdown: HTMLSpanElement;
  initialDuration: number;
  lastRemaining: number;
  lastDisplayedSecond: number;  // for redrawing countdown only when integer changes
}

let container: HTMLDivElement | null = null;
const pills = new Map<string, BuffPill>();

export function createBuffBar() {
  if (container) return;
  container = document.createElement('div');
  container.id = 'buff-bar'; container.classList.add('game-hud');
  Object.assign(container.style, {
    position: 'fixed',
    left: '50%',
    bottom: 'calc(56px + env(safe-area-inset-bottom, 0px))',  // bumped above HP pips
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
      // Buff refreshed — reset the time-bar reference + brief flash.
      pill.initialDuration = active.remaining;
      flashRefresh(pill);
    }

    const fraction = pill.initialDuration > 0
      ? Math.max(0, Math.min(1, active.remaining / pill.initialDuration))
      : 0;
    pill.fill.style.width = `${(fraction * 100).toFixed(1)}%`;

    // Update countdown text only when the integer second changes (avoids
    // per-frame DOM writes).
    const displayed = Math.ceil(active.remaining);
    if (displayed !== pill.lastDisplayedSecond) {
      pill.countdown.textContent = `${displayed}s`;
      pill.lastDisplayedSecond = displayed;
    }

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

function flashRefresh(pill: BuffPill) {
  // Brief brighten + scale-bump so the player notices a refresh.
  pill.root.style.transition = 'transform 0.12s ease-out, box-shadow 0.12s ease-out';
  pill.root.style.transform = 'scale(1.08)';
  const originalShadow = pill.root.style.boxShadow;
  pill.root.style.boxShadow = `0 0 16px ${pill.root.style.borderLeftColor}`;
  setTimeout(() => {
    pill.root.style.transform = 'scale(1)';
    pill.root.style.boxShadow = originalShadow;
  }, 120);
}

function createPill(label: string, color: number): BuffPill {
  const root = document.createElement('div');
  const cssColor = `#${color.toString(16).padStart(6, '0')}`;
  const cssColorDim = `${cssColor}33`;
  Object.assign(root.style, {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    minWidth: '110px',
    padding: '6px 12px 7px 10px',
    background: `linear-gradient(90deg, ${cssColorDim} 0%, rgba(20, 12, 8, 0.85) 70%)`,
    border: `1px solid ${cssColor}66`,
    borderLeft: `3px solid ${cssColor}`,
    borderRadius: '3px',
    color: cssColor,
    fontFamily: FONT_UI,
    fontSize: '12px',
    fontWeight: '600',
    letterSpacing: '0.15em',
    textShadow: '0 0 6px rgba(0,0,0,0.9)',
    overflow: 'hidden',
    boxShadow: `0 0 8px ${cssColor}33`,
  } as Partial<CSSStyleDeclaration>);

  // Colored icon dot on the left.
  const dot = document.createElement('div');
  Object.assign(dot.style, {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: cssColor,
    boxShadow: `0 0 6px ${cssColor}, 0 0 12px ${cssColor}88`,
    flexShrink: '0',
  } as Partial<CSSStyleDeclaration>);

  // Label.
  const labelEl = document.createElement('div');
  labelEl.textContent = label;
  Object.assign(labelEl.style, {
    flex: '1',
    whiteSpace: 'nowrap',
  } as Partial<CSSStyleDeclaration>);

  // Numeric countdown ("3s") on the right.
  const countdown = document.createElement('span');
  countdown.textContent = '';
  Object.assign(countdown.style, {
    fontFamily: 'monospace',
    fontSize: '11px',
    color: cssColor,
    opacity: '0.85',
    fontWeight: '700',
    letterSpacing: '0',
  } as Partial<CSSStyleDeclaration>);

  // Drain bar at the bottom — fills the pill width, drains as buff expires.
  const fill = document.createElement('div');
  Object.assign(fill.style, {
    position: 'absolute',
    left: '0',
    bottom: '0',
    height: '2px',
    background: cssColor,
    opacity: '0.85',
    width: '100%',
    transition: 'width 0.1s linear',
    boxShadow: `0 0 6px ${cssColor}`,
  } as Partial<CSSStyleDeclaration>);

  root.append(dot, labelEl, countdown, fill);
  return { root, fill, countdown, initialDuration: 1, lastRemaining: 1, lastDisplayedSecond: -1 };
}
