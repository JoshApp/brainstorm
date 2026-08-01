// DOMAIN FRAMING — an item's card doesn't just LIST its domain, it's DRESSED in
// it. The frame, the inner wash behind the text, and the glyph watermark all take
// the domain's register colour, so a blood relic reads crimson and a rot charm
// reads sickly-green before a word is parsed. Cursed items wear the violet chaos
// mark instead (their own identity, per domain-icons.ts). This is the visual half
// of the coherent legend that domain-icons.ts started — the icons name the domain,
// the framing STEEPS the whole preview in it.
//
// Domainless, uncursed items get NO frame — the absence is meaningful (a plain
// mundane thing is plain), so we never wash a card that has no domain to speak of.

import type { ItemSpec } from '../content/items';
import { domainVisual, CURSED_VISUAL, type DomainVisual } from './domain-icons';
import { hexRgba } from '../style/color-utils';

/** The framing identity for an item: its domain, or CURSED, or null (plain). */
export function itemFraming(item: ItemSpec): DomainVisual | null {
  if (item.rarity === 'cursed') return CURSED_VISUAL;
  if (item.domain) return domainVisual(item.domain);
  return null;
}

export interface DomainFrameOpts {
  /** Watermark glyph in the corner (the big faint domain sigil). Default true. */
  watermark?: boolean;
  /** Strength multiplier for wash/glow (0.6 subtle, 1 normal, 1.4 loud). Default 1. */
  intensity?: number;
  /** Tint only the border + shadows (no appended wash/watermark children). Use for
   *  SCROLLING containers where absolute decoration would scroll with content. */
  chromeOnly?: boolean;
}

// The card container this is applied to must be able to hold absolutely-positioned
// decoration children (the wash + watermark sit BEHIND the content). We set
// position:relative and let the real content stack above via z-index.
export function applyDomainFrame(card: HTMLElement, f: DomainVisual, opts: DomainFrameOpts = {}): void {
  const k = opts.intensity ?? 1;
  const hex = f.hex;

  card.style.position = 'relative';
  card.style.borderRadius = card.style.borderRadius || '5px';
  // Tinted border + a soft outer breath in the domain colour — the frame.
  card.style.border = `1px solid ${hexRgba(hex, 0.5 * k)}`;
  card.style.boxShadow = `0 4px 18px rgba(0,0,0,0.6), 0 0 16px ${hexRgba(hex, 0.22 * k)}, inset 0 0 22px ${hexRgba(hex, 0.10 * k)}`;

  if (opts.chromeOnly) return;

  // Inner wash — a faint vertical gradient of the domain colour behind the text.
  // Sits at the very back so bullets/stat rows read over it.
  const wash = document.createElement('div');
  Object.assign(wash.style, {
    position: 'absolute', inset: '0', borderRadius: 'inherit', pointerEvents: 'none',
    background: `linear-gradient(160deg, ${hexRgba(hex, 0.16 * k)} 0%, ${hexRgba(hex, 0.05 * k)} 45%, transparent 78%)`,
    zIndex: '0',
  } as Partial<CSSStyleDeclaration>);
  card.appendChild(wash);

  // Hot top edge in the domain colour (echoes theme's ember top edge, tinted).
  const topEdge = document.createElement('div');
  Object.assign(topEdge.style, {
    position: 'absolute', top: '0', left: '10%', right: '10%', height: '1.5px',
    background: `linear-gradient(90deg, transparent, ${hexRgba(hex, 0.85 * k)}, transparent)`,
    pointerEvents: 'none', zIndex: '2', borderRadius: 'inherit',
  } as Partial<CSSStyleDeclaration>);
  card.appendChild(topEdge);

  // Big faint domain sigil watermarked into the lower-right — the "inside
  // appearance" the item takes on from its domain.
  if (opts.watermark !== false) {
    const mark = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    mark.setAttribute('viewBox', '0 0 24 24');
    Object.assign(mark.style, {
      position: 'absolute', right: '-6px', bottom: '-8px',
      width: '76px', height: '76px',
      color: hexRgba(hex, 0.14 * k), fill: 'currentColor',
      pointerEvents: 'none', zIndex: '0', overflow: 'visible',
    } as Partial<CSSStyleDeclaration>);
    mark.innerHTML = f.path;
    card.appendChild(mark);
  }

  // Ensure the real content (already-appended children EXCEPT our decoration)
  // stacks above the wash/watermark. We lift every non-decoration child.
  for (const child of Array.from(card.children)) {
    const el = child as HTMLElement;
    if (el === wash || el === topEdge) continue;
    if (el instanceof SVGElement && el.style.position === 'absolute') continue;
    if (!el.style.position) el.style.position = 'relative';
    if (!el.style.zIndex) el.style.zIndex = '1';
  }
}
