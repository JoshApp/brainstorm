import type { DomainId } from '../content/domains';
import { getDomain } from '../content/domains';
import { hexCss } from '../style/color-utils';

// DOMAIN VISUAL LANGUAGE — one icon + one colour per domain, plus CURSED as its
// own identity (the chaos mark). Item cards, previews, and pickups draw from
// this so a domain reads at a glance the way stats do (see ui/stat-icons.ts):
// blood is a crimson droplet, ash an ember flame, rot a green spore, cursed a
// violet chaos-star. Colours are each domain's own register colour (the same
// tint the accent text already uses), so the whole legend stays coherent.

export interface DomainVisual {
  /** Inner markup of a 0 0 24 24 SVG (paths only; fill = currentColor). */
  path: string;
  /** CSS colour (the domain's register colour, or the cursed violet). */
  color: string;
  /** The packed 0xRRGGBB int behind `color`, for alpha tints (frames/glows). */
  hex: number;
  label: string;
}

// ── glyphs (single 24-viewBox, filled) ─────────────────────────────────────
const DROPLET = '<path d="M12 3s6 7 6 11a6 6 0 1 1-12 0c0-4 6-11 6-11z"/>';                                   // blood
const BONE    = '<rect x="6" y="10.6" width="12" height="2.8" rx="1.4"/><circle cx="6.4" cy="9.2" r="2"/><circle cx="6.4" cy="14.8" r="2"/><circle cx="17.6" cy="9.2" r="2"/><circle cx="17.6" cy="14.8" r="2"/>'; // bone
const SPORE   = '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="4.5" r="1.7"/><circle cx="19.5" cy="12" r="1.7"/><circle cx="12" cy="19.5" r="1.7"/><circle cx="4.5" cy="12" r="1.7"/>'; // rot
const FLAME   = '<path d="M12 2c2 4 5 5 5 9a5 5 0 0 1-10 0c0-2.2 1-3.4 2.2-4.4-.2 2 .8 3.2 1.8 3.2 0-3-1.2-5.2 1-7.8z"/>'; // ash
const SPARK   = '<path d="M12 2l1.8 7.4L21 12l-7.2 2.6L12 22l-1.8-7.4L3 12l7.2-2.6L12 2z"/>';                    // dawn
const HALO    = '<path d="M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm0 3.2a4.8 4.8 0 1 1 0 9.6 4.8 4.8 0 0 1 0-9.6z"/>'; // grace
const CHEVRON = '<path d="M12 3l7.5 9.5h-4.3V21H8.8v-8.5H4.5L12 3z"/>';                                          // valor
const COIN    = '<path d="M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm0 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8z"/>';             // greed
const EYE     = '<path d="M12 5C6 5 2 12 2 12s4 7 10 7 10-7 10-7-4-7-10-7zm0 3.6a3.4 3.4 0 1 1 0 6.8 3.4 3.4 0 0 1 0-6.8z"/>'; // forbidden
const CHAOS   = '<path d="M12 2l1.7 4.6 4.2-2.5-2.5 4.2L20 10l-4.6 1.7 2.5 4.2-4.2-2.5L12 18l-1.7-4.6-4.2 2.5 2.5-4.2L4 10l4.6-1.7-2.5-4.2 4.2 2.5L12 2z"/>'; // cursed / chaos

const GLYPH: Record<DomainId, string> = {
  blood: DROPLET,
  bone: BONE,
  rot: SPORE,
  ash: FLAME,
  dawn: SPARK,
  grace: HALO,
  valor: CHEVRON,
  greed: COIN,
  forbidden: EYE,
};

/** The icon + colour + label for a domain. */
export function domainVisual(id: DomainId): DomainVisual {
  const d = getDomain(id);
  return { path: GLYPH[id], color: hexCss(d.register.color), hex: d.register.color, label: d.name };
}

/** CURSED — its own identity (the chaos): a violet chaos-star. Cursed items are
 *  often domainless; this gives them a visual home. `cursed` reads as the deep's
 *  independent corruption, riding a domain or standing alone. */
export const CURSED_VISUAL: DomainVisual = {
  path: CHAOS,
  color: hexCss(0xc05bd6),
  hex: 0xc05bd6,
  label: 'Cursed',
};

/** Build a small inline <svg> for a domain/cursed glyph, tinted to its colour. */
export function domainIconEl(v: DomainVisual, px = 12): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(px));
  svg.setAttribute('height', String(px));
  svg.style.flexShrink = '0';
  svg.style.display = 'inline-block';
  svg.style.verticalAlign = '-2px';
  svg.style.color = v.color;
  svg.style.fill = 'currentColor';
  svg.style.overflow = 'visible';
  svg.innerHTML = v.path;
  return svg;
}
