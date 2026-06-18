// ── DELVE game faces — the 3-role type system ────────────────────────────────
//
// Grounded in DELVE's own materials, not just "copy Souls":
//   • EB Garamond  — the READING VOICE (lore, item text, menu body). The Souls /
//     FromSoft register: warm, literary, archaic. The workhorse.
//   • Cinzel       — MONUMENTAL display. Inscriptional caps for the title screen
//     and carved-stone moments ("carved from the deep").
//   • Grenze Gotisch — the GRIMOIRE blackletter (the cursed-book menu pages).
//
// Self-hosted + imported through Vite (?url) so the filenames are content-hashed
// — a swapped face can never be served stale from cache (see art/texture-urls.ts).
// Faces degrade to a system serif if injection is somehow skipped, so it's safe.
import ebg400 from '../assets/fonts/eb-garamond-400.woff2?url';
import ebg500 from '../assets/fonts/eb-garamond-500.woff2?url';
import ebg400i from '../assets/fonts/eb-garamond-400i.woff2?url';
import cinzel600 from '../assets/fonts/cinzel-600.woff2?url';
import grenze600 from '../assets/fonts/grenze-gotisch-600.woff2?url';
import grenze700 from '../assets/fonts/grenze-gotisch-700.woff2?url';

// Single-quoted family names: these get interpolated into double-quoted HTML
// style="" attributes in places, and double quotes there close the attribute early.
export const FONT_SERIF = "'EB Garamond', 'Iowan Old Style', 'Palatino', 'Times New Roman', serif";
export const FONT_TITLE = "'Cinzel', 'Trajan Pro', 'Iowan Old Style', serif";
export const FONT_BLACK = "'Grenze Gotisch', 'Iowan Old Style', serif";

let injected = false;
/** Register the @font-face rules once. Idempotent; no-op without a document. */
export function injectGameFonts(): void {
  if (injected || typeof document === 'undefined') return;
  injected = true;
  const ff = (fam: string, url: string, w = '400', style = 'normal') =>
    `@font-face{font-family:'${fam}';font-weight:${w};font-style:${style};font-display:swap;src:url('${url}') format('woff2')}`;
  const st = document.createElement('style'); st.id = 'game-fonts';
  st.textContent = [
    ff('EB Garamond', ebg400, '400'), ff('EB Garamond', ebg500, '500'), ff('EB Garamond', ebg400i, '400', 'italic'),
    ff('Cinzel', cinzel600, '600'),
    ff('Grenze Gotisch', grenze600, '600'), ff('Grenze Gotisch', grenze700, '700'),
  ].join('');
  document.head.appendChild(st);
}
