/**
 * Per-domain VISUALS — the category glyph (a small carved sigil) + the domain's
 * UI colour. The sigil sits at the card's top ornament so players read a card's
 * domain — and learn synergies — before any text. Inner SVG uses currentColor,
 * so the container's `color` (the domain colour) tints it.
 *
 * Sigils are deliberately simple occult marks (not emoji), in the grimdark
 * register: blood ▽ · bone ✕bones · rot spiral · greed coin · dawn sun ·
 * grace flame · valor sword · wonder star.
 */
import type { Domain } from './cards';

export interface DomainVisual { color: string; svg: string }

export const DOMAIN_VISUAL: Record<Domain, DomainVisual> = {
  blood: {
    color: '#c5402f',
    svg: '<polygon points="4,6 20,6 12,20"/>',
  },
  bone: {
    color: '#e6ddca',
    svg: '<g stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></g><g fill="currentColor"><circle cx="6" cy="6" r="2.1"/><circle cx="18" cy="6" r="2.1"/><circle cx="6" cy="18" r="2.1"/><circle cx="18" cy="18" r="2.1"/></g>',
  },
  rot: {
    color: '#86b33f',
    svg: '<path d="M12 4 a8 8 0 1 1 -7.5 11 a5 5 0 1 0 8.5 -3.5 a2.4 2.4 0 1 1 -3 2.2" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  },
  greed: {
    color: '#c9a23c',
    svg: '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2.2"/><circle cx="12" cy="12" r="3.2"/>',
  },
  dawn: {
    color: '#f2d57e',
    svg: '<circle cx="12" cy="12" r="4.2"/><g stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="2.5" x2="12" y2="5.8"/><line x1="12" y1="18.2" x2="12" y2="21.5"/><line x1="2.5" y1="12" x2="5.8" y2="12"/><line x1="18.2" y1="12" x2="21.5" y2="12"/><line x1="5.2" y1="5.2" x2="7.5" y2="7.5"/><line x1="16.5" y1="16.5" x2="18.8" y2="18.8"/><line x1="18.8" y1="5.2" x2="16.5" y2="7.5"/><line x1="7.5" y1="16.5" x2="5.2" y2="18.8"/></g>',
  },
  grace: {
    color: '#e0a860',
    svg: '<path d="M12 3 C 16 8 17 11 15.5 14.5 A 4 4 0 1 1 8.5 14.5 C 7.6 11.2 11 9.5 11 6 Z"/>',
  },
  valor: {
    color: '#bcc6cd',
    svg: '<g stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="12" y1="3" x2="12" y2="16"/><line x1="8" y1="14.5" x2="16" y2="14.5"/><line x1="12" y1="16" x2="12" y2="20"/></g><circle cx="12" cy="20.5" r="1.7"/>',
  },
  wonder: {
    color: '#a86ef0',
    svg: '<path d="M12 2 L13.6 10.4 L22 12 L13.6 13.6 L12 22 L10.4 13.6 L2 12 L10.4 10.4 Z"/>',
  },
};

/**
 * Subject + accent word for AI-GENERATED sigils (the experiment) — a linocut
 * ink stamp per domain, written to public/art/sigils/<domain>.png by
 * `delve art sigil`. An inked alternative to the crisp SVG above.
 */
export const SIGIL_SUBJECT: Record<Domain, { mark: string; accent: string }> = {
  blood: { mark: 'a downward-pointing triangle pierced by a single falling drop of blood', accent: 'crimson' },
  bone: { mark: 'a small skull set above two crossed bones', accent: 'bone white' },
  rot: { mark: 'a single coiled spiral grave-worm', accent: 'sickly green' },
  greed: { mark: 'a small stack of three thick blank coins', accent: 'gold' },
  dawn: { mark: 'a radiant rising sun with sharp rays', accent: 'pale gold-white' },
  grace: { mark: 'a single upright candle flame', accent: 'warm amber' },
  valor: { mark: 'a single upright sword, point up', accent: 'steel silver' },
  wonder: { mark: 'an eight-pointed star', accent: 'violet' },
};
