// THE LIVING ACQUISITION BEAT — taking a thing is an EVENT, not a silent blip
// into a bag. Two gestures fire when the player acquires an item:
//
//   1. FLY-TO-SATCHEL — the item pops into view centre-screen, then arcs up and
//      into the satchel button (the old-school "it flew into you" beat), which
//      pulses as it lands. Every real pickup gets this (keys excepted — they're
//      pure currency with their own HUD tick).
//   2. DOMAIN FLOOD — when the item is a DOMAIN RELIC (a permanent affliction),
//      the screen briefly floods with the domain's colour and the voice in the
//      deep remarks that your affliction with that domain has deepened. Rarer,
//      heavier — reserved for the relics that mark you.
//
// One central listener on `item:picked-up` drives both, deduped against the
// double-emit (pickup.onUse + inventory.addItem both fire the event for one
// floor pickup). Everything here is presentation — it never touches inventory
// or combat state.

import { on } from '../broadcast/event-bus';
import { ITEMS, type ItemSpec } from '../content/items';
import { getItemThumbnail, itemImageUrl } from './item-thumbnail';
import { itemFraming } from './item-framing';
import { getReliquary } from '../player/reliquary';
import { flashDomainGlow } from './vignette';
import { RARITY_COLORS } from '../content/items';
import { hexCss } from '../style/color-utils';
import { projectToScreen, flyToHud } from './fly-to-hud';

let lastId = '';
let lastAt = -1;

// A pale-brass key glyph — the currency-not-gold read the key HUD uses.
const KEY_GLYPH = `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="rgba(222,198,140,0.98)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="4.2"/><path d="M11 11l7 7"/><path d="M15.5 15.5l2-2"/><path d="M18 18l2-2"/></svg>`;

export function initAcquisitionBeat(): void {
  on((e) => {
    if (e.type !== 'item:picked-up') return;
    const now = performance.now();
    // Dedupe the double-emit: one floor pickup fires the event twice (the
    // interactable AND inventory.addItem). Collapse repeats of the same id
    // inside a short window into one beat.
    if (e.itemId === lastId && now - lastAt < 350) { lastAt = now; return; }
    lastId = e.itemId; lastAt = now;

    const item = ITEMS[e.itemId];
    if (!item) return;

    // Launch the chip from the object's REAL on-screen spot (projected from its
    // world position) so the flight is continuous with where it sat — falling
    // back to lower-centre only if the projection isn't available (headless /
    // behind camera).
    const from = (e.worldPos && projectToScreen(e.worldPos))
      ?? { x: window.innerWidth * 0.5, y: window.innerHeight * 0.48 };

    // Keys fly into the KEY counter (their own currency slot); everything else
    // flies into the satchel. Same gesture, different destination.
    if (item.kind === 'key') {
      try { flyKeyToHud(from); } catch { /* presentation must never throw */ }
      return;
    }

    try { flyItemToSatchel(item, from); } catch { /* presentation must never throw */ }

    // (The relic's provenance is READ as an inscription — owned by
    // pickup-notification, which routes a relic's flavor through the reading
    // channel instead of the terse toast.)

    // Domain relics are the afflictions — flood + the DEEP's remark on the NEXT
    // frame (a separate voice from the reading), once the relic has landed in the
    // reliquary and the count is current.
    if (item.kind === 'relic' && (item.domain || item.rarity === 'cursed')) {
      requestAnimationFrame(() => {
        try { playDomainDeepening(item); } catch { /* never break on a beat */ }
      });
    }
  });
}

/** DEV: fire the full beat for an item on demand (bench/scenario verification). */
export function debugPlayAcquisitionBeat(item: ItemSpec): void {
  if (!import.meta.env.DEV) return;
  const from = { x: window.innerWidth * 0.5, y: window.innerHeight * 0.48 };
  try { flyItemToSatchel(item, from); } catch { /* ignore */ }
  if (item.kind === 'relic' && (item.domain || item.rarity === 'cursed')) {
    try { playDomainDeepening(item); } catch { /* ignore */ }
  }
}

// ── Fly-to-satchel ─────────────────────────────────────────────────────────
// The item "presents itself" at its floor spot, holds a beat, then arcs into the
// satchel and shrinks away — the classic pickup read, but starting from where
// the object actually was. Uses the item's real thumbnail (2.5D relic art when
// baked, procedural rig otherwise).
function flyItemToSatchel(item: ItemSpec, from: { x: number; y: number }): void {
  const btn = document.getElementById('inventory-button');
  const thumb = itemImageUrl(item) ?? getItemThumbnail(item);
  if (!thumb) return;   // headless / thumbnail rig unavailable

  const accent = itemFraming(item)?.color ?? hexCss(RARITY_COLORS[item.rarity ?? 'mundane']);

  const chip = document.createElement('div');
  Object.assign(chip.style, {
    borderRadius: '8px',
    background: 'rgba(18, 12, 8, 0.82)',
    border: `1.5px solid ${accent}`,
    boxShadow: `0 0 22px ${accent}, 0 6px 18px rgba(0,0,0,0.6)`,
    display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  } as Partial<CSSStyleDeclaration>);
  const img = document.createElement('img');
  img.src = thumb;
  Object.assign(img.style, {
    width: '100%', height: '100%', objectFit: 'contain', imageRendering: 'pixelated',
  } as Partial<CSSStyleDeclaration>);
  chip.appendChild(img);

  flyToHud({ from, targetEl: btn, node: chip, size: 76, accent, present: true });
}

// ── Fly-to-key-counter ───────────────────────────────────────────────────────
// A key is pure currency — it flies straight into the key slot (no present-hold),
// the same continuous flight as gold, just a different destination + glyph.
function flyKeyToHud(from: { x: number; y: number }): void {
  const target = document.getElementById('keys-indicator');
  const glyph = document.createElement('div');
  glyph.innerHTML = KEY_GLYPH;
  glyph.style.filter = 'drop-shadow(0 0 5px rgba(222,198,140,0.75))';
  flyToHud({ from, targetEl: target, node: glyph, size: 34, accent: 'rgba(222,198,140,0.9)' });
}

// ── Domain deepening ────────────────────────────────────────────────────────
// Count how many relics of this affliction the player now carries, so the flood
// and the words ESCALATE — the first is a foothold, the fifth is a takeover.
function afflictionCount(item: ItemSpec): number {
  const cursed = item.rarity === 'cursed';
  let n = 0;
  for (const r of getReliquary()) {
    if (cursed) { if (r.spec.rarity === 'cursed') n++; }
    else if (r.spec.domain === item.domain) n++;
  }
  return Math.max(1, n);
}

function playDomainDeepening(item: ItemSpec): void {
  const f = itemFraming(item);
  if (!f) return;
  const count = afflictionCount(item);
  // Strength climbs with the count but saturates — a floor, then escalation.
  const strength = Math.min(1, 0.55 + (count - 1) * 0.15);
  // ONLY the diegetic screen flood — the domain's colour washes in as the relic
  // marks you. NO top-right pop: that channel (the voice in the deep) is reserved
  // for achievements + genuinely new beats, not routine mid-run pickups. The
  // relic's own provenance still reads through the centred inscription channel
  // (pickup-notification), which is the in-world register a pickup should use.
  flashDomainGlow(f.color, strength);
}
