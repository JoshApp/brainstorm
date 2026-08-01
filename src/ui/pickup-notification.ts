import { on } from '../broadcast/event-bus';
import { ITEMS, RARITY_COLORS } from '../content/items';
import { DOMAINS } from '../content/domains';
import { SETS } from '../content/sets';
import { getReliquary } from '../player/reliquary';
import { showInscription } from './inscription';

// Brief upper-center label that fades in and out when an item is picked up.
// Stays warm/dim (in-world register, not broadcast register) so it doesn't
// compete with achievement toasts in the upper-right.
//
// RELICS get an ACQUISITION MOMENT: the premise is that a relic belonged to a
// delver who became something down here, and taking it takes on a piece of
// them. So a relic pickup reveals its PROVENANCE (the flavor line) beneath the
// name, tinted by its domain, and HOLDS longer the heavier the relic — a quiet,
// grave "this was someone's," never a celebratory pop (the place doesn't cheer).
// Not a modal: the same non-blocking upper-centre toast, so it never interrupts
// a fight. Common relics get a short beat; rare/cursed get the held reveal.

const SHOW_MS = 2200;
const FADE_MS = 280;
// Rarity → how long the reveal holds. The heavy finds linger; a common one is a
// quick satisfying beat. (ms)
const HOLD_BY_RARITY: Record<string, number> = {
  mundane: 2400, uncommon: 2800, rare: 3800, cursed: 4400, fabled: 4600,
};

function hex(n: number): string { return '#' + n.toString(16).padStart(6, '0'); }

let label: HTMLDivElement | null = null;
let titleEl: HTMLDivElement | null = null;
let subEl: HTMLDivElement | null = null;
let hideTimer: number | undefined;

export function createPickupNotification() {
  if (label) return;

  label = document.createElement('div');
  label.id = 'pickup-notification'; label.classList.add('game-hud');
  Object.assign(label.style, {
    position: 'fixed',
    left: '50%',
    top: 'calc(48px + env(safe-area-inset-top, 0px))',
    transform: 'translateX(-50%) translateY(-6px)',
    padding: '10px 18px',
    color: 'rgba(255, 220, 180, 0.95)',
    background: 'rgba(20, 12, 8, 0.7)',
    border: '1px solid rgba(255, 180, 110, 0.45)',
    borderRadius: '3px',
    fontFamily: 'Georgia, "Times New Roman", serif',  // in-world voice = serif
    fontStyle: 'italic',
    fontSize: '15px',
    textShadow: '0 0 6px rgba(0,0,0,0.9)',
    letterSpacing: '0.04em',
    opacity: '0',
    pointerEvents: 'none',
    zIndex: '11',
    transition: `opacity ${FADE_MS}ms ease-out, transform ${FADE_MS}ms ease-out`,
    maxWidth: 'min(420px, 80vw)',
    textAlign: 'center',
  } as Partial<CSSStyleDeclaration>);

  // Title (the item name) + an optional provenance subtitle (relics only).
  titleEl = document.createElement('div');
  subEl = document.createElement('div');
  Object.assign(subEl.style, {
    marginTop: '5px',
    fontSize: '12.5px',
    opacity: '0.82',
    fontStyle: 'italic',
    letterSpacing: '0.02em',
    lineHeight: '1.35',
  } as Partial<CSSStyleDeclaration>);
  label.appendChild(titleEl);
  label.appendChild(subEl);
  document.body.appendChild(label);

  on((event) => {
    if (event.type !== 'item:picked-up') return;
    const item = ITEMS[event.itemId];
    // Use the affix-decorated displayName if the caller provided one
    // (rolled-affix pickup); fall back to the base item name otherwise.
    const name = event.displayName ?? item?.name ?? event.itemId;
    // A relic with provenance earns the acquisition reveal: its flavor line,
    // domain-tinted, held by rarity. Everything else is the plain name toast.
    if (item?.kind === 'relic' && item.flavor) {
      const accent = item.domain ? DOMAINS[item.domain].register.color : RARITY_COLORS[item.rarity ?? 'mundane'];
      let provenance = item.flavor;
      // PROVENANCE-SET recognition — a second DISTINCT piece of the same dead
      // delver's belongings gets named as such. (This event fires before the
      // relic lands in the reliquary, so "held" is what you carried before.)
      if (item.setId) {
        const set = SETS[item.setId];
        if (set?.owner) {
          const held = new Set(
            getReliquary().filter((r) => r.spec.setId === item.setId).map((r) => r.spec.id));
          if (!held.has(item.id) && held.size >= 1) {
            provenance = `${item.flavor} Another of ${set.owner.split(',')[0]}’s things.`;
          }
        }
      }
      // A relic is READ, not toasted — its provenance rises through the reading
      // channel (inscription.ts), the place speaking. Distinct from the deep's
      // pop and from the terse name-toast below.
      showInscription(provenance);
    } else {
      show(name);
    }
  });
}

/** The relic acquisition moment — name + provenance, domain-tinted, held by
 *  weight. Reuses the pickup toast so it never blocks a fight. */
function showReveal(title: string, provenance: string, accentHex: number, holdMs: number) {
  if (!label || !titleEl || !subEl) return;
  const accent = hex(accentHex);
  titleEl.textContent = title;
  titleEl.style.fontStyle = 'normal';
  titleEl.style.letterSpacing = '0.06em';
  subEl.textContent = provenance;
  subEl.style.display = '';
  subEl.style.color = accent;
  label.style.borderColor = accent;
  label.style.boxShadow = `0 0 18px ${accent}44`;
  reveal(holdMs);
}

/** Show a brief in-world message in the same warm serif register as pickups
 *  (e.g. "You can carry no more.", "Already whole."). Terse + indifferent —
 *  this is in-world voice, NOT the broadcast layer. */
export function showInWorldMessage(text: string) {
  show(text);
}

function show(text: string) {
  if (!label || !titleEl || !subEl) return;
  // Plain toast — name only, no provenance, warm default border.
  titleEl.textContent = text;
  titleEl.style.fontStyle = 'italic';
  titleEl.style.letterSpacing = '0.04em';
  subEl.textContent = '';
  subEl.style.display = 'none';
  label.style.borderColor = 'rgba(255, 180, 110, 0.45)';
  label.style.boxShadow = 'none';
  reveal(SHOW_MS);
}

/** Fade the label in and schedule its fade-out after `holdMs`. */
function reveal(holdMs: number) {
  if (!label) return;
  label.style.opacity = '1';
  label.style.transform = 'translateX(-50%) translateY(0)';
  if (hideTimer !== undefined) clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    if (!label) return;
    label.style.opacity = '0';
    label.style.transform = 'translateX(-50%) translateY(-6px)';
  }, holdMs);
}
