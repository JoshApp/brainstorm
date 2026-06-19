import { staminaStore, type StaminaState } from '../state/hud-stores';
import { hudStyleStore, getHudStyle } from './hud-style';
import { bind } from './hud';

// Stamina gauge — three rectangular pip-style segments in a flex row
// at the bottom-centre. The bar's value is continuous internally
// (frac 0..1); we map it across three segments with REAL gaps between
// them so the read is "you have N actions in the tank" at a glance.
//
// Depletion is right-to-left: the rightmost segment drains first,
// then the middle, then the left. A heavy attack spends half a
// segment, a dodge or ranged shot spends a full one.
//
// Auto-hides when rested. Stamina is irrelevant most of the time —
// you only spend it on heavy swings, ranged shots, dodges — so a
// permanent gauge would be HUD clutter. It fades in the instant
// you spend and fades back out once it's full again, so it reads
// as a transient "you're winded" signal rather than chrome.
//
// Store-bound (staminaStore), so the DOM only updates when the
// fraction actually moves; idling at full produces zero churn.

interface Segment {
  track: HTMLDivElement;
  fill: HTMLDivElement;
  reserved: HTMLDivElement;
}

let container: HTMLDivElement | null = null;
const segments: Segment[] = [];

const BAR_W = 200;       // matches the HP pip row's rough footprint
const BAR_H = 8;         // taller than the previous 5px sliver — easier to read
const SEGMENTS = 3;      // dodge / ranged = 1 each, heavy = ½
const GAP_PX = 4;        // visible gap between segments

function makeSegment(): Segment {
  const track = document.createElement('div');
  Object.assign(track.style, {
    position: 'relative',
    flex: '1',
    height: '100%',
    border: '1px solid rgba(150, 180, 200, 0.30)',
    background: 'rgba(8, 12, 16, 0.5)',
    boxShadow: 'inset 0 0 4px rgba(0,0,0,0.7)',
    overflow: 'hidden',
  } as Partial<CSSStyleDeclaration>);

  const fill = document.createElement('div');
  Object.assign(fill.style, {
    width: '100%',
    height: '100%',
    transformOrigin: 'left center',
    background: 'linear-gradient(180deg, rgba(150, 195, 215, 0.92), rgba(70, 110, 140, 0.92))',
    boxShadow: '0 0 6px rgba(120, 180, 210, 0.35)',
  } as Partial<CSSStyleDeclaration>);
  track.appendChild(fill);

  // Reserved (locked charge) overlay — a hatched amber strip that
  // appears just past the leading edge of the live fill while a heavy
  // is held. Per-segment, so a reservation that crosses the gap
  // between two segments visibly does so without bridging the gap.
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

export function createStaminaBar() {
  if (container) return;
  container = document.createElement('div');
  container.id = 'stamina-bar'; container.classList.add('game-hud');
  Object.assign(container.style, {
    position: 'fixed',
    left: '50%',
    bottom: 'calc(40px + env(safe-area-inset-bottom, 0px))',
    transform: 'translateX(-50%)',
    width: `${BAR_W}px`,
    height: `${BAR_H}px`,
    display: 'flex',
    gap: `${GAP_PX}px`,
    zIndex: '10',
    pointerEvents: 'none',
    opacity: '0',
    transition: 'opacity 0.45s ease-out',
  } as Partial<CSSStyleDeclaration>);

  for (let i = 0; i < SEGMENTS; i++) {
    const seg = makeSegment();
    segments.push(seg);
    container.appendChild(seg.track);
  }

  document.body.appendChild(container);

  // Exhausted flash — a brief red glow around the whole row when the
  // player bottoms out, so a gated dash / shot reads as "you're gassed"
  // rather than an unresponsive tap. Injected once.
  if (!document.getElementById('stamina-flash-kf')) {
    const style = document.createElement('style');
    style.id = 'stamina-flash-kf';
    style.textContent =
      '@keyframes staminaGassed{0%{filter:drop-shadow(0 0 0 rgba(230,90,70,0))}' +
      '35%{filter:drop-shadow(0 0 4px rgba(230,90,70,0.95))}' +
      '100%{filter:drop-shadow(0 0 0 rgba(230,90,70,0))}}';
    document.head.appendChild(style);
  }

  bind(staminaStore, render);

  // Re-evaluate visibility immediately on style switch (don't wait for
  // the next stamina sync). The render() guard above does the rest.
  hudStyleStore.subscribe(() => {
    if (!container) return;
    if (getHudStyle().stamina !== 'bar') container.style.opacity = '0';
  });
}

/** Re-pulse the gassed flash imperatively. Called when a committal action
 *  (dash / shot) is gated because the bar's empty, so the rejected tap reads
 *  as "you're out" right then, not just from the ambient red. */
export function flashStaminaBar(): void {
  if (!container) return;
  if (getHudStyle().stamina !== 'bar') return;
  container.style.opacity = '1';
  container.style.animation = 'none';
  void container.offsetWidth;       // force reflow so the animation restarts
  container.style.animation = 'staminaGassed 0.5s ease-out';
}

function render({ frac, rested, exhausted, reserved }: StaminaState) {
  if (!container) return;
  if (getHudStyle().stamina !== 'bar') {
    container.style.opacity = '0';
    return;
  }
  const f = Math.max(0, Math.min(1, frac));
  const reservedEnd = Math.min(f + Math.max(0, reserved), 1);

  // Per-segment fill — right-to-left depletion. The leftmost segment
  // covers value range [0, 1/3]; the rightmost covers [2/3, 1]. As
  // `f` drops from 1 → 0, the rightmost segment's `(f - 2/3) / (1/3)`
  // ratio hits zero first, then the middle's, then the left's.
  for (let i = 0; i < SEGMENTS; i++) {
    const seg = segments[i];
    const segMin = i / SEGMENTS;
    const segMax = (i + 1) / SEGMENTS;
    const span = segMax - segMin;
    const segFill = Math.max(0, Math.min(1, (f - segMin) / span));
    seg.fill.style.transform = `scaleX(${segFill})`;
    seg.fill.style.background = frac < 0.2
      ? 'linear-gradient(180deg, rgba(210, 110, 90, 0.92), rgba(150, 50, 40, 0.92))'
      : 'linear-gradient(180deg, rgba(150, 195, 215, 0.92), rgba(70, 110, 140, 0.92))';

    // Reserved slice within this segment — intersect [f, reservedEnd]
    // with [segMin, segMax].
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

  container.style.animation = exhausted ? 'staminaGassed 0.5s ease-out' : 'none';
  container.style.opacity = rested && !exhausted && reserved === 0 ? '0' : '1';
}
