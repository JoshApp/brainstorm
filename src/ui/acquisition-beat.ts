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
import { getItemThumbnail } from './item-thumbnail';
import { itemFraming } from './item-framing';
import { getReliquary } from '../player/reliquary';
import { flashDomainGlow } from './vignette';
import { broadcastPop } from './broadcast-pop';
import { RARITY_COLORS } from '../content/items';
import { hexCss } from '../style/color-utils';

let lastId = '';
let lastAt = -1;

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
    if (item.kind === 'key') return;   // keys have their own HUD counter beat

    try { flyItemToSatchel(item); } catch { /* presentation must never throw */ }

    // Domain relics are the afflictions — flood + narrate on the NEXT frame, so
    // the relic has already landed in the reliquary and the count is current.
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
  try { flyItemToSatchel(item); } catch { /* ignore */ }
  if (item.kind === 'relic' && (item.domain || item.rarity === 'cursed')) {
    try { playDomainDeepening(item); } catch { /* ignore */ }
  }
}

// ── Fly-to-satchel ─────────────────────────────────────────────────────────
function flyItemToSatchel(item: ItemSpec): void {
  const btn = document.getElementById('inventory-button');
  const thumb = getItemThumbnail(item);
  if (!thumb) return;   // headless / thumbnail rig unavailable

  const vw = window.innerWidth, vh = window.innerHeight;
  // Start: a touch above screen centre (where the item "presents itself").
  const start = { x: vw * 0.5, y: vh * 0.44 };
  // End: the satchel button, or the top-right corner if it isn't mounted yet.
  const r = btn?.getBoundingClientRect();
  const end = r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : { x: vw - 40, y: 40 };
  const dx = end.x - start.x, dy = end.y - start.y;

  const accent = itemFraming(item)?.color ?? hexCss(RARITY_COLORS[item.rarity ?? 'mundane']);

  const chip = document.createElement('div');
  chip.classList.add('game-hud');
  Object.assign(chip.style, {
    position: 'fixed', left: `${start.x}px`, top: `${start.y}px`,
    width: '76px', height: '76px', marginLeft: '-38px', marginTop: '-38px',
    borderRadius: '8px', zIndex: '60', pointerEvents: 'none',
    background: 'rgba(18, 12, 8, 0.82)',
    border: `1.5px solid ${accent}`,
    boxShadow: `0 0 22px ${accent}, 0 6px 18px rgba(0,0,0,0.6)`,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    willChange: 'transform, opacity',
  } as Partial<CSSStyleDeclaration>);
  const img = document.createElement('img');
  img.src = thumb;
  Object.assign(img.style, {
    width: '100%', height: '100%', objectFit: 'contain', imageRendering: 'pixelated',
  } as Partial<CSSStyleDeclaration>);
  chip.appendChild(img);
  document.body.appendChild(chip);

  // Pop into view, hold, then arc up-and-into the satchel, shrinking away.
  const anim = chip.animate(
    [
      { transform: 'translate(0px,0px) scale(0.35)', opacity: 0, offset: 0 },
      { transform: 'translate(0px,0px) scale(1.18)', opacity: 1, offset: 0.14 },
      { transform: 'translate(0px,0px) scale(1.0)',  opacity: 1, offset: 0.24 },
      { transform: 'translate(0px,0px) scale(1.0)',  opacity: 1, offset: 0.42 },   // hold
      { transform: `translate(${dx * 0.5}px,${dy * 0.5 - 46}px) scale(0.72)`, opacity: 0.95, offset: 0.72 }, // arc lift
      { transform: `translate(${dx}px,${dy}px) scale(0.26)`, opacity: 0.12, offset: 1 },
    ],
    { duration: 1000, easing: 'cubic-bezier(0.4, 0.0, 0.2, 1)', fill: 'forwards' },
  );
  anim.onfinish = () => {
    chip.remove();
    pulseSatchel(btn, accent);
  };
}

/** The satchel button drinks the item in — a quick scale pop + a coloured breath. */
function pulseSatchel(btn: HTMLElement | null, accent: string): void {
  if (!btn) return;
  const prevFilter = btn.style.filter;
  btn.animate(
    [
      { transform: 'scale(1)', filter: prevFilter || 'none' },
      { transform: 'scale(1.22)', filter: `drop-shadow(0 0 10px ${accent})` },
      { transform: 'scale(1)', filter: prevFilter || 'none' },
    ],
    { duration: 320, easing: 'ease-out' },
  );
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
  flashDomainGlow(f.color, strength);

  const { title, header } = deepeningLine(f.label, count);
  broadcastPop(title, f.label.toUpperCase(), header);
}

// The voice in the deep — cruel, amused, present-tense. `domain` is the label
// ("Blood", "Rot", "Cursed"). Escalates: root → hold → saturation.
function deepeningLine(domain: string, count: number): { title: string; header: string } {
  const d = domain.toLowerCase();
  if (count <= 1) {
    return {
      title: `The ${d} takes root in you. It will ask for more.`,
      header: 'an affliction begins',
    };
  }
  if (count <= 3) {
    return {
      title: `Your ${d} deepens. The deep can smell it on you now.`,
      header: 'the affliction deepens',
    };
  }
  return {
    title: `You are more ${d} than delver. It is delighted.`,
    header: 'the affliction takes hold',
  };
}
