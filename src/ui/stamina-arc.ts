import { staminaStore, type StaminaState } from '../state/hud-stores';
import { hudStyleStore, getHudStyle } from './hud-style';
import { bind } from './hud';

// MINIMAL-style stamina indicator — three rectangular GREEN pip
// segments sitting just above the hearts row at the bottom-centre.
// Same 3-segment layout as the Classic bar, in the Minimal palette.
//
//   - Idle (rested + full): hidden.
//   - Spending: depletes RIGHT-to-LEFT — rightmost segment empties
//     first, then middle, then left.
//   - Exhausted: tints red and holds visible until refilled.
//
// Cheap: per-segment fill div, only the segment whose value range the
// stamina fraction crosses re-styles per change.

interface Segment {
  track: HTMLDivElement;
  fill: HTMLDivElement;
  reserved: HTMLDivElement;
}

const BAR_W = 220;
const BAR_H = 7;        // taller than the previous 4px sliver — easier to read
const SEGMENTS = 3;
const GAP_PX = 4;

let root: HTMLDivElement | null = null;
const segments: Segment[] = [];
let unsubStyle: (() => void) | null = null;

function makeSegment(): Segment {
  const track = document.createElement('div');
  Object.assign(track.style, {
    position: 'relative',
    flex: '1',
    height: '100%',
    border: '1px solid rgba(120, 180, 140, 0.28)',
    background: 'rgba(8, 16, 12, 0.55)',
    boxShadow: 'inset 0 0 3px rgba(0,0,0,0.7)',
    overflow: 'hidden',
  } as Partial<CSSStyleDeclaration>);

  const fill = document.createElement('div');
  Object.assign(fill.style, {
    width: '100%',
    height: '100%',
    transformOrigin: 'left center',
    background: 'linear-gradient(180deg, rgba(150, 220, 160, 0.92), rgba(60, 140, 90, 0.92))',
    boxShadow: '0 0 5px rgba(140, 220, 160, 0.45)',
    transition: 'transform 140ms ease-out, background 220ms ease-out',
  } as Partial<CSSStyleDeclaration>);
  track.appendChild(fill);

  // Reserved (locked charge) overlay — a hatched amber strip that
  // appears just past the leading edge of the live fill while a heavy
  // is held. Per-segment so a reservation that crosses the gap between
  // two segments visibly does so without bridging the gap. Tinted
  // warm against the green Minimal palette so the lock reads as a
  // distinct "this is committed" beat.
  const reserved = document.createElement('div');
  Object.assign(reserved.style, {
    position: 'absolute',
    top: '0', height: '100%',
    left: '0', width: '0%',
    backgroundImage: 'repeating-linear-gradient(135deg, rgba(255,225,170,0.85) 0 3px, rgba(255,225,170,0.25) 3px 6px)',
    opacity: '0',
    transition: 'opacity 0.12s ease-out',
  } as Partial<CSSStyleDeclaration>);
  track.appendChild(reserved);

  return { track, fill, reserved };
}

export function createStaminaArc(): void {
  if (root) return;
  root = document.createElement('div');
  root.id = 'stamina-line';
  Object.assign(root.style, {
    position: 'fixed',
    left: '50%',
    bottom: `calc(50px + env(safe-area-inset-bottom, 0px))`,
    transform: 'translateX(-50%)',
    width: `${BAR_W}px`,
    height: `${BAR_H}px`,
    display: 'flex',
    gap: `${GAP_PX}px`,
    pointerEvents: 'none',
    zIndex: '10',
    opacity: '0',
    transition: 'opacity 280ms ease-out',
  } as Partial<CSSStyleDeclaration>);

  for (let i = 0; i < SEGMENTS; i++) {
    const seg = makeSegment();
    segments.push(seg);
    root.appendChild(seg.track);
  }

  document.body.appendChild(root);

  unsubStyle = hudStyleStore.subscribe(() => applyVisibility());

  bind(staminaStore, render);
}

function applyVisibility(): void {
  if (!root) return;
  if (getHudStyle().stamina !== 'breath') root.style.opacity = '0';
}

function render({ frac, rested, exhausted, reserved }: StaminaState): void {
  if (!root) return;
  if (getHudStyle().stamina !== 'breath') {
    root.style.opacity = '0';
    return;
  }
  const f = Math.max(0, Math.min(1, frac));
  // Stay visible while a charge is reserving so the hatched preview
  // is actually seen even when otherwise rested.
  const visible = !rested || exhausted || f < 0.999 || reserved > 0;
  root.style.opacity = visible ? (exhausted ? '1' : '0.88') : '0';

  const reservedEnd = Math.min(f + Math.max(0, reserved), 1);

  for (let i = 0; i < SEGMENTS; i++) {
    const seg = segments[i];
    const segMin = i / SEGMENTS;
    const segMax = (i + 1) / SEGMENTS;
    const span = segMax - segMin;
    const segFill = Math.max(0, Math.min(1, (f - segMin) / span));
    seg.fill.style.transform = `scaleX(${segFill.toFixed(3)})`;
    seg.fill.style.background = f < 0.2
      ? 'linear-gradient(180deg, rgba(220, 110, 90, 0.92), rgba(160, 60, 50, 0.92))'
      : 'linear-gradient(180deg, rgba(150, 220, 160, 0.92), rgba(60, 140, 90, 0.92))';

    // Reserved slice within this segment — intersect [f, reservedEnd]
    // with [segMin, segMax]. Mirrors the Classic bar's per-segment
    // reservation math.
    if (reserved > 0) {
      const sliceStart = Math.max(f, segMin);
      const sliceEnd = Math.min(reservedEnd, segMax);
      if (sliceEnd > sliceStart) {
        const left = (sliceStart - segMin) / span;
        const width = (sliceEnd - sliceStart) / span;
        seg.reserved.style.left = `${left * 100}%`;
        seg.reserved.style.width = `${width * 100}%`;
        seg.reserved.style.opacity = '1';
      } else {
        seg.reserved.style.opacity = '0';
      }
    } else {
      seg.reserved.style.opacity = '0';
    }
  }
}

export function disposeStaminaArc(): void {
  unsubStyle?.();
  unsubStyle = null;
  if (root?.parentNode) root.parentNode.removeChild(root);
  root = null;
  segments.length = 0;
}
