import type { StatModifier } from '../combat/modifiers';

// STAT ICONS — a tiny, shared glyph vocabulary for item stats, so a modifier
// line reads at a glance (a heart for life, a blade for damage, a shield for
// armour) instead of as a wall of bullets. Kept as a pure data map (kind →
// {svg, color, category}) with no DOM, so every item surface — the details
// column today, the unified item card later — draws from ONE legend and they
// all agree. Icons are single 24-viewBox paths using `currentColor` so the
// caller tints them by the category colour.

export type StatCategory = 'life' | 'damage' | 'armor' | 'speed' | 'crit' | 'leech' | 'hazard' | 'generic';

export interface StatIcon {
  /** Inner markup of a 0 0 24 24 SVG (paths only) — fill/stroke use currentColor. */
  path: string;
  /** Category tint (CSS colour). */
  color: string;
  category: StatCategory;
}

// Category tints — grimdark-muted, but each distinct at a glance.
const COL = {
  life:   'rgba(224, 92, 92, 0.95)',    // blood red
  damage: 'rgba(240, 176, 104, 0.95)',  // amber steel
  armor:  'rgba(150, 176, 200, 0.95)',  // cold steel-blue
  speed:  'rgba(150, 216, 180, 0.95)',  // quick green
  crit:   'rgba(236, 208, 128, 0.95)',  // spark gold
  leech:  'rgba(200, 120, 176, 0.95)',  // draining violet
  hazard: 'rgba(196, 140, 200, 0.95)',  // ill light
  generic:'rgba(200, 178, 140, 0.85)',  // parchment
} as const;

// ── glyph paths (single-path, filled) ──────────────────────────────────────
// Centred with margin on all sides (x 3..21, y 4.2..20) so it can't clip against
// the viewBox edge — the previous path touched x≈0.9 / y=21 and read cut off.
const HEART  = '<path d="M12 20C5 15.5 3 11.5 3 8.5 3 6 5 4.2 7.2 4.2 9.2 4.2 11 5.6 12 7.3 13 5.6 14.8 4.2 16.8 4.2 19 4.2 21 6 21 8.5 21 11.5 19 15.5 12 20Z"/>';
// a downward dagger — hilt at top, blade to the point
const BLADE  = '<path d="M12 2l2.2 4.5V14l-2.2 3-2.2-3V6.5L12 2z"/><rect x="8.4" y="14" width="7.2" height="1.8" rx="0.6"/>';
const SHIELD = '<path d="M12 2l7 2.6v5.7c0 4.5-3 7.9-7 9.7-4-1.8-7-5.2-7-9.7V4.6L12 2z"/>';
// a lightning bolt for speed
const BOLT   = '<path d="M13 2L4 13h6l-1 9 9-11h-6l1-9z"/>';
// a four-point spark for crit
const SPARK  = '<path d="M12 2l1.8 7.4L21 12l-7.2 2.6L12 22l-1.8-7.4L3 12l7.2-2.6L12 2z"/>';
// a teardrop for lifesteal / bleed
const DROP   = '<path d="M12 2s6 7 6 11a6 6 0 1 1-12 0c0-4 6-11 6-11z"/>';
// a broken/cracked chevron for incoming-damage / hazard
const CRACK  = '<path d="M13 2L6 12h4l-2 10 9-12h-5l1-8z" opacity="0.9"/>';
const DOT    = '<circle cx="12" cy="12" r="4"/>';

/** The icon for a stat modifier — category tint + glyph. Everything routes here
 *  so the legend stays in one place. */
export function statModifierIcon(kind: StatModifier['kind']): StatIcon {
  switch (kind) {
    case 'max-hp':               return { path: HEART,  color: COL.life,   category: 'life' };
    case 'weapon-damage':
    case 'damage-multiplier':
    case 'finisher-damage-mult': return { path: BLADE,  color: COL.damage, category: 'damage' };
    case 'physical-armor':
    case 'magic-armor':          return { path: SHIELD, color: COL.armor,  category: 'armor' };
    case 'incoming-damage-mult': return { path: CRACK,  color: COL.hazard, category: 'hazard' };
    case 'move-speed-mult':
    case 'action-speed-mult':    return { path: BOLT,   color: COL.speed,  category: 'speed' };
    case 'crit-chance':
    case 'crit-mult':            return { path: SPARK,  color: COL.crit,   category: 'crit' };
    case 'lifesteal-pct':
    case 'bleed-chain':
    case 'bleed-feed':           return { path: DROP,   color: COL.leech,  category: 'leech' };
    default:                     return { path: DOT,    color: COL.generic,category: 'generic' };
  }
}

/** Build a 12px inline <svg> element for a stat icon, tinted to its category. */
export function statIconEl(icon: StatIcon, px = 12): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(px));
  svg.setAttribute('height', String(px));
  svg.style.flexShrink = '0';
  svg.style.display = 'block';   // drop the inline baseline so the glyph can't clip
  svg.style.color = icon.color;
  svg.style.fill = 'currentColor';
  svg.style.overflow = 'visible';
  svg.innerHTML = icon.path;
  return svg;
}
