import { get } from '../ecs/world';
import { BUFFS } from '../content/buffs';
import { FONT_UI } from './hud';

// ── WHAT IS ON YOU RIGHT NOW ─────────────────────────────────────────────────
//
// Josh: *"buff/debuff HUD: stacking is wrong, needs a denser diegetic read."*
//
// Two problems, and the first one is not cosmetic.
//
// STACKS WERE NEVER DRAWN. `ecs/buffs.ts` stacks poison and bleed up to a cap
// and scales the per-tick damage by the stack count — so a five-stack bleed does
// five times the damage of a one-stack bleed, and the HUD rendered them
// identically. The one number that changes how fast you are dying was the one
// number not on screen.
//
// AND IT WAS ENORMOUS. Each buff was a 110px-minimum pill carrying its full name
// in letterspaced caps plus a numeric countdown. Four statuses ran past 460px —
// more than half a phone's landscape width, spent restating things that do not
// change. A status is a STATE YOU ARE IN; the HUD's job is to let you clock it
// in the corner of your eye mid-fight, not to be read.
//
// ── THE SHAPE ────────────────────────────────────────────────────────────────
//
// A chip per status, 30px, and everything on it is something that CHANGES:
//
//   colour     — which status. The same colour its motes are (BuffSpec.vfx),
//                so the thing dripping off you and the thing on your HUD agree.
//   the drain  — how long is left, as the chip emptying from the top down. No
//                number: you do not need "7s", you need "nearly gone".
//   the count  — how many stacks, and ONLY when there is more than one. A "1"
//                on every chip is noise that trains you to stop reading them.
//
// The NAME is the one thing that never changes, so it is not on the chip. It
// appears once, above the row, when a status lands or refreshes — and fades.
// The dungeon tells you what it did to you, once, and then expects you to know.

interface BuffChip {
  root: HTMLDivElement;
  /** Drains downward as the buff expires. */
  drain: HTMLDivElement;
  /** Stack count. Hidden entirely at one stack. */
  count: HTMLDivElement;
  initialDuration: number;
  lastRemaining: number;
  lastStacks: number;
  /** Last width written, so a steady state costs no DOM writes. */
  lastPct: number;
}

let container: HTMLDivElement | null = null;
let nameEl: HTMLDivElement | null = null;
let nameUntil = 0;
const chips = new Map<string, BuffChip>();

const SIZE = 30;
/** How long the name lingers after a status lands or refreshes, ms. */
const NAME_HOLD_MS = 1600;

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

export function createBuffBar() {
  if (container) return;
  const wrap = document.createElement('div');
  wrap.id = 'buff-bar'; wrap.classList.add('game-hud');
  Object.assign(wrap.style, {
    position: 'fixed',
    left: '50%',
    bottom: 'calc(56px + env(safe-area-inset-bottom, 0px))',  // above the HP pips
    transform: 'translateX(-50%)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '4px',
    zIndex: '10',
    pointerEvents: 'none',
  } as Partial<CSSStyleDeclaration>);

  // The name of whatever last landed on you. One element for all statuses, not
  // one per chip — it is an announcement, not a label.
  nameEl = document.createElement('div');
  Object.assign(nameEl.style, {
    fontFamily: FONT_UI,
    fontSize: '10px',
    fontWeight: '700',
    letterSpacing: '0.24em',
    textShadow: '0 0 6px rgba(0,0,0,0.95)',
    opacity: '0',
    transition: 'opacity 0.35s ease-out',
    whiteSpace: 'nowrap',
  } as Partial<CSSStyleDeclaration>);

  container = document.createElement('div');
  Object.assign(container.style, {
    display: 'flex',
    gap: '5px',
  } as Partial<CSSStyleDeclaration>);

  wrap.append(nameEl, container);
  document.body.appendChild(wrap);
}

/** Announce a status by name — on first application and on every refresh. */
function announce(label: string, color: number): void {
  if (!nameEl) return;
  nameEl.textContent = label;
  nameEl.style.color = hex(color);
  nameEl.style.opacity = '1';
  nameUntil = performance.now() + NAME_HOLD_MS;
}

export function updateBuffBar() {
  if (!container) return;
  const player = get('player');
  if (!player) return;

  if (nameEl && nameUntil > 0 && performance.now() > nameUntil) {
    nameEl.style.opacity = '0';
    nameUntil = 0;
  }

  const seen = new Set<string>();

  for (const active of player.buffs) {
    const spec = BUFFS[active.specId];
    if (!spec) continue;
    seen.add(active.specId);

    // The chip takes the buff's VFX colour when it has one, so the motes
    // dripping off you and the chip on your HUD are the same status. Falling
    // back to `color` keeps every existing buff looking as it did.
    const color = spec.vfx?.color ?? spec.color ?? 0xffffff;
    const label = spec.displayName ?? active.specId;

    let chip = chips.get(active.specId);
    if (!chip) {
      chip = createChip(color, spec.harmful === true);
      container.appendChild(chip.root);
      chip.initialDuration = active.remaining;
      chips.set(active.specId, chip);
      announce(label, color);
    } else if (active.remaining > chip.lastRemaining) {
      // Refreshed — re-reference the drain and say its name again. A status
      // landing on you a second time is news.
      chip.initialDuration = active.remaining;
      announce(label, color);
      flashRefresh(chip, color);
    }

    // THE DRAIN. Empties downward from the top, so a chip that is nearly gone
    // is nearly empty — readable at a glance without reading a number.
    const frac = chip.initialDuration > 0
      ? Math.max(0, Math.min(1, active.remaining / chip.initialDuration))
      : 0;
    const pct = Math.round(frac * 100);
    if (pct !== chip.lastPct) {
      chip.drain.style.height = `${pct}%`;
      chip.lastPct = pct;
    }

    // THE COUNT — the number this HUD existed without. Hidden at one stack:
    // a "1" on every chip is noise, and noise is what teaches you to stop
    // looking. It appears the moment a status starts compounding, which is
    // exactly when you need to know.
    if (active.stacks !== chip.lastStacks) {
      chip.lastStacks = active.stacks;
      const many = active.stacks > 1;
      chip.count.textContent = many ? String(active.stacks) : '';
      chip.count.style.display = many ? 'flex' : 'none';
      // A compounding status gets a hotter rim, so the chip reads as WORSE
      // before you have read the numeral off it.
      chip.root.style.boxShadow = many
        ? `0 0 ${6 + Math.min(active.stacks, 5) * 2}px ${hex(color)}aa`
        : `0 0 6px ${hex(color)}44`;
    }

    chip.lastRemaining = active.remaining;
  }

  for (const [id, chip] of chips) {
    if (!seen.has(id)) {
      chip.root.remove();
      chips.delete(id);
    }
  }
}

function flashRefresh(chip: BuffChip, color: number) {
  chip.root.style.transition = 'transform 0.12s ease-out';
  chip.root.style.transform = 'scale(1.14)';
  setTimeout(() => { chip.root.style.transform = 'scale(1)'; }, 120);
  void color;
}

function createChip(color: number, harmful: boolean): BuffChip {
  const c = hex(color);
  const root = document.createElement('div');
  Object.assign(root.style, {
    position: 'relative',
    width: `${SIZE}px`,
    height: `${SIZE}px`,
    borderRadius: '3px',
    border: `1px solid ${c}77`,
    // ONE BIT OF "IS THIS GOOD OR BAD", carried by an edge rather than by hue.
    // Burn and Berserk are both hot orange and both 30px; on a phone in a dark
    // room they read identically, and one of them is killing you. A boon lights
    // its TOP edge and an affliction its BOTTOM — rising versus sinking, legible
    // before you have identified which status it actually is.
    [harmful ? 'borderBottom' : 'borderTop']: `3px solid ${c}`,
    background: 'rgba(10, 7, 5, 0.85)',
    boxShadow: `0 0 6px ${c}44`,
    overflow: 'hidden',
    flexShrink: '0',
  } as Partial<CSSStyleDeclaration>);

  // The drain sits BEHIND the numeral and shrinks from the top, so the chip
  // empties like something running out rather than like a progress bar filling.
  const drain = document.createElement('div');
  Object.assign(drain.style, {
    position: 'absolute',
    left: '0', bottom: '0', width: '100%', height: '100%',
    // Strong enough that a ONE-stack status still reads as a lit chip in a dark
    // room — the first pass was 55/22 over a near-black plate and an unnumbered
    // burn was indistinguishable from an empty square.
    background: `linear-gradient(180deg, ${c}cc 0%, ${c}66 100%)`,
    borderTop: `1px solid ${c}`,
    transition: 'height 0.12s linear',
  } as Partial<CSSStyleDeclaration>);

  const count = document.createElement('div');
  Object.assign(count.style, {
    position: 'absolute',
    inset: '0',
    display: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: FONT_UI,
    fontSize: '14px',
    fontWeight: '800',
    // Dark numeral on the lit chip, not a coloured one on a coloured field —
    // it has to stay legible as the drain empties out from under it.
    color: 'rgba(12, 8, 5, 0.95)',
    textShadow: `0 0 4px ${c}, 0 1px 0 rgba(255,255,255,0.25)`,
    letterSpacing: '0',
  } as Partial<CSSStyleDeclaration>);

  root.append(drain, count);
  return {
    root, drain, count,
    initialDuration: 1, lastRemaining: 1, lastStacks: -1, lastPct: -1,
  };
}
