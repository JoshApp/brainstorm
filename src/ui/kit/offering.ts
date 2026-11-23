// OFFERING — one thing you could give up, on a deal screen (the basin, an
// altar). Lamplight: the offering is lit from its glyph's side in the colour
// of what is at stake (blood red, coin gold, pale steel), not washed flat; an
// offering you cannot pay goes inert rather than merely faint.
//
// Giving is never one press. The first press (tap, click, Enter, A) arms the
// offering and says so; the second, within a few seconds, gives it. Moving to
// another offering disarms. A sacrifice should not happen by a stray thumb.

import { injectKitStyles } from './style';
import { promptDevice } from './prompts';

export interface OfferingOptions {
  label: string;
  /** The line under the label: what the place says about this offering. */
  note: string;
  /** Carved glyph for the stake (an image URL). */
  glyph: string;
  /** The stake's colour, "r, g, b". */
  stake: string;
  enabled: boolean;
  /** Said instead of `note` when the offering can't be paid: why not. */
  inertNote?: string;
  onGive: () => void;
}

const ARM_MS = 4000;
let armedEl: HTMLElement | null = null;
let disarmArmed: (() => void) | null = null;

export function makeOffering(o: OfferingOptions): HTMLButtonElement {
  injectKitStyles();
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'lk-offer';
  b.dataset.focus = '';
  b.dataset.fkey = `offer:${o.label}`;
  b.style.setProperty('--stake', o.stake);
  b.disabled = !o.enabled;
  b.innerHTML = '<img class="lk-offer-glyph" alt=""><span class="lk-offer-label"></span><span class="lk-offer-note"></span>';
  (b.querySelector('.lk-offer-glyph') as HTMLImageElement).src = o.glyph;
  (b.querySelector('.lk-offer-label') as HTMLElement).textContent = o.label;
  const noteEl = b.querySelector('.lk-offer-note') as HTMLElement;
  noteEl.textContent = !o.enabled && o.inertNote ? o.inertNote : o.note;

  let timer = 0;
  const disarm = (): void => {
    clearTimeout(timer);
    b.classList.remove('armed');
    noteEl.textContent = o.note;
    if (armedEl === b) { armedEl = null; disarmArmed = null; }
  };
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    if (b.disabled) return;
    if (!b.classList.contains('armed')) {
      if (armedEl && armedEl !== b) disarmArmed?.();
      b.classList.add('armed');
      armedEl = b;
      disarmArmed = disarm;
      noteEl.textContent = promptDevice() === 'touch' ? 'Tap again to give it.' : 'Press again to give it.';
      timer = window.setTimeout(disarm, ARM_MS);
      return;
    }
    disarm();
    o.onGive();
  });
  // Leaving the offering (another focus, the pointer moving off) takes it back.
  b.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') disarm(); });
  // Keys / controller: focus moving off the offering disarms it.
  new MutationObserver((records) => {
    for (const r of records) {
      const was = (r.oldValue ?? '').split(' ').includes('is-focused');
      if (was && !b.classList.contains('is-focused')) disarm();
    }
  }).observe(b, { attributes: true, attributeFilter: ['class'], attributeOldValue: true });
  return b;
}
