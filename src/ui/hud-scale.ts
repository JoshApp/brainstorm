// HUD SCALE ON A PC — the corner and bottom-centre HUD pieces read slightly
// small on a desktop monitor (Josh, 2026-11-24: "most of the hud elements are a
// bit too small there"). One rule scales them together with CSS `zoom`, which
// scales each piece AND its margin from the screen edge, so the layout keeps
// its proportions; the bottom-centre pieces stay centred (left: 50% +
// translateX(-50%) survive zoom, measured in Chrome).
//
// Only pieces anchored to the screen edges are listed. Anything positioned by
// a projected screen point (the interact prompt, the item tag) must NOT be
// zoomed: zoom would scale its translate() and pull it off its object.
// Phones keep their sizes: the thumb layout is tuned in px (hud-layout.ts).

import { isDesktopLike } from '../controls/platform';

/** How much larger the HUD reads on a PC. */
export const PC_HUD_ZOOM = 1.25;

const SCALED = [
  'depth-counter', 'buff-bar', 'health-hearts', 'stamina-line', 'stamina-bar',
  'consumable-bar', 'gold-hud', 'gold-tick', 'inventory-button', 'rite-button', 'weapon-swap-chip',
];

let applied = false;
export function applyPcHudScale(): void {
  if (applied || typeof document === 'undefined' || !isDesktopLike()) return;
  applied = true;
  const st = document.createElement('style');
  st.id = 'pc-hud-scale';
  st.textContent = `${SCALED.map((id) => `#${id}`).join(', ')} { zoom: ${PC_HUD_ZOOM}; }`;
  document.head.appendChild(st);
}
