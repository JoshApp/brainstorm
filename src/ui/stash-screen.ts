// Stash screen — opens loot boxes earned from achievements. Tap a box,
// it spins through item names with a slowing reel, lands on a rolled
// item from the tier's pool, reveals the item card with rarity flare.
//
// Why "Stash" not "Loot box": fits the in-world tone better. The DCC-
// tribute broadcast layer ("ACHIEVEMENT UNLOCKED") IS allowed to be
// game-y, but the stash itself sits in the title-screen frame which
// reads more in-world.

import { hexCss } from '../style/color-utils';
import { openScreen, closeScreen } from './screen-manager';
import {
  getStash, consumeStashEntry, recordItemFound,
  type StashEntry,
} from '../state/meta-state';
import { ITEMS, RARITY_COLORS, type ItemSpec, type Rarity } from '../content/items';

const SCREEN_ID = 'stash';

let root: HTMLDivElement | null = null;

export function showStash() {
  if (root) return;

  root = document.createElement('div');
  root.id = 'stash-screen';
  Object.assign(root.style, {
    position: 'fixed',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: 'min(560px, 92vw)',
    maxHeight: '92vh',
    overflowY: 'auto',
    padding: '24px 26px',
    background: 'linear-gradient(180deg, rgba(22, 16, 10, 0.97), rgba(10, 6, 4, 0.99))',
    border: '1px solid rgba(170, 130, 80, 0.4)',
    borderRadius: '3px',
    boxShadow: '0 10px 36px rgba(0,0,0,0.75)',
    color: 'rgba(220, 180, 140, 0.92)',
    fontFamily: '"Iowan Old Style", "Palatino", serif',
    opacity: '0',
    transition: 'opacity 220ms ease',
    pointerEvents: 'auto',
  } as Partial<CSSStyleDeclaration>);

  rebuild();
  document.body.appendChild(root);
  openScreen({
    id: SCREEN_ID,
    root,
    // 'title' layer so opening from the start screen renders ABOVE the
    // title — title is also 'title' layer; later-opened screens within
    // a layer stack higher. With 'modal' (z=200) it sat behind the
    // title pill (z=9000), looking like a click that did nothing.
    policy: { pausesWorld: true, needsBackdrop: true, layer: 'title' },
    onDismissRequest: dismiss,
  });
  requestAnimationFrame(() => { if (root) root.style.opacity = '1'; });
}

function dismiss() {
  if (!root) return;
  const r = root;
  root = null;
  r.style.opacity = '0';
  setTimeout(() => r.remove(), 240);
  closeScreen(SCREEN_ID);
}

function rebuild() {
  if (!root) return;
  root.replaceChildren();

  // Header
  const header = document.createElement('div');
  header.textContent = 'The Stash';
  Object.assign(header.style, {
    fontSize: '20px',
    letterSpacing: '0.18em',
    textTransform: 'uppercase',
    color: 'rgba(230, 180, 110, 0.95)',
    textAlign: 'center',
    marginBottom: '4px',
  });
  root.appendChild(header);

  const sub = document.createElement('div');
  sub.textContent = 'what the dungeon owes you.';
  Object.assign(sub.style, {
    fontSize: '12px',
    fontStyle: 'italic',
    color: 'rgba(180, 140, 100, 0.6)',
    textAlign: 'center',
    marginBottom: '18px',
  });
  root.appendChild(sub);

  const stash = getStash();
  if (stash.length === 0) {
    const empty = document.createElement('div');
    empty.textContent = 'nothing waits.';
    Object.assign(empty.style, {
      fontStyle: 'italic',
      color: 'rgba(160, 130, 100, 0.55)',
      textAlign: 'center',
      padding: '20px 0',
    });
    root.appendChild(empty);
  } else {
    const list = document.createElement('div');
    Object.assign(list.style, {
      display: 'grid',
      gap: '8px',
      gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
    });
    for (const entry of stash) {
      list.appendChild(makeBox(entry));
    }
    root.appendChild(list);
  }

  // Close hint
  const hint = document.createElement('div');
  hint.textContent = 'tap outside to close';
  Object.assign(hint.style, {
    marginTop: '20px',
    textAlign: 'center',
    fontSize: '10px',
    letterSpacing: '0.22em',
    textTransform: 'uppercase',
    color: 'rgba(160, 120, 80, 0.45)',
    fontFamily: 'system-ui, sans-serif',
  });
  root.appendChild(hint);
}

function makeBox(entry: StashEntry): HTMLButtonElement {
  const tint = RARITY_COLORS[entry.tier];
  const tintRgb = hexCss(tint);
  const btn = document.createElement('button');
  Object.assign(btn.style, {
    display: 'flex', flexDirection: 'column', gap: '4px',
    padding: '14px 12px',
    background: `linear-gradient(180deg, rgba(40, 28, 18, 0.85), rgba(20, 14, 10, 0.85))`,
    border: `1px solid ${tintRgb}`,
    borderRadius: '3px',
    color: 'rgba(220, 200, 170, 0.95)',
    cursor: 'pointer',
    boxShadow: `0 0 18px ${tintRgb}33`,
    fontFamily: '"Iowan Old Style", "Palatino", serif',
    textAlign: 'left',
    transition: 'transform 0.08s ease',
  });
  // tier label
  const t = document.createElement('div');
  t.textContent = entry.tier.toUpperCase();
  Object.assign(t.style, {
    fontSize: '10px', letterSpacing: '0.24em',
    color: tintRgb,
    fontFamily: 'system-ui, sans-serif',
  });
  btn.appendChild(t);
  // source name
  const s = document.createElement('div');
  s.textContent = entry.source;
  Object.assign(s.style, {
    fontSize: '14px', fontWeight: '500',
    color: 'rgba(230, 200, 170, 0.95)',
  });
  btn.appendChild(s);
  // hint
  const h = document.createElement('div');
  h.textContent = 'tap to open';
  Object.assign(h.style, {
    fontSize: '10px',
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: 'rgba(180, 150, 120, 0.55)',
    fontFamily: 'system-ui, sans-serif',
    marginTop: '4px',
  });
  btn.appendChild(h);

  btn.addEventListener('pointerdown', () => { btn.style.transform = 'scale(0.97)'; });
  btn.addEventListener('pointerup',   () => { btn.style.transform = 'scale(1)'; });
  btn.addEventListener('pointerleave',() => { btn.style.transform = 'scale(1)'; });
  btn.addEventListener('click', () => openBox(entry));
  return btn;
}

// ── Opening animation ──────────────────────────────────────────────
// Tap a box → reel UI spins through item names from the pool, slows,
// lands on the rolled one. Item granted to codex.

function openBox(entry: StashEntry) {
  const consumed = consumeStashEntry(entry.id);
  if (!consumed) return;
  const item = rollItemFromTier(consumed.tier);
  // Add to codex regardless of whether the player has it already.
  recordItemFound(item.id);
  showReveal(consumed, item);
}

function rollItemFromTier(tier: Rarity): ItemSpec {
  const pool = Object.values(ITEMS).filter(it => (it.rarity ?? 'mundane') === tier);
  if (pool.length === 0) {
    // Fallback: anything mundane. Should never trigger since 'mundane'
    // has multiple items, but keeps the code total.
    return Object.values(ITEMS).find(it => (it.rarity ?? 'mundane') === 'mundane') ?? Object.values(ITEMS)[0];
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

function showReveal(entry: StashEntry, item: ItemSpec) {
  if (!root) return;
  const overlay = document.createElement('div');
  Object.assign(overlay.style, {
    position: 'fixed',
    inset: '0',
    background: 'rgba(0, 0, 0, 0.65)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: '250',
    opacity: '0',
    transition: 'opacity 200ms ease',
  });

  const tintRgb = hexCss(RARITY_COLORS[entry.tier]);
  const card = document.createElement('div');
  Object.assign(card.style, {
    width: 'min(360px, 80vw)',
    padding: '24px 22px',
    background: 'linear-gradient(180deg, rgba(28, 20, 14, 0.97), rgba(12, 8, 6, 0.99))',
    border: `2px solid ${tintRgb}`,
    borderRadius: '3px',
    boxShadow: `0 0 40px ${tintRgb}66, 0 8px 28px rgba(0,0,0,0.7)`,
    color: 'rgba(230, 200, 170, 0.95)',
    fontFamily: '"Iowan Old Style", "Palatino", serif',
    textAlign: 'center',
    transform: 'scale(0.85)',
    transition: 'transform 280ms cubic-bezier(0.2, 0.7, 0.2, 1.4)',
  });

  // Reel: vertical scroll of item names slowing to land on the final.
  const reel = document.createElement('div');
  Object.assign(reel.style, {
    height: '30px',
    overflow: 'hidden',
    position: 'relative',
    marginBottom: '12px',
    color: tintRgb,
    fontSize: '15px',
    letterSpacing: '0.12em',
    fontWeight: '500',
  });
  const inner = document.createElement('div');
  Object.assign(inner.style, {
    display: 'flex',
    flexDirection: 'column',
    transition: 'transform 1.6s cubic-bezier(0.15, 0.7, 0.25, 1.0)',
  });
  // Push several decoys + the real item at the end. Each row 30px.
  const decoys: string[] = [];
  for (let i = 0; i < 14; i++) {
    decoys.push(randomItemNameForFlavor());
  }
  decoys.push(item.name);
  for (const name of decoys) {
    const row = document.createElement('div');
    row.textContent = name;
    Object.assign(row.style, { height: '30px', lineHeight: '30px' });
    inner.appendChild(row);
  }
  reel.appendChild(inner);
  card.appendChild(reel);

  // Tier ribbon
  const tier = document.createElement('div');
  tier.textContent = entry.tier.toUpperCase();
  Object.assign(tier.style, {
    fontSize: '11px',
    letterSpacing: '0.3em',
    color: tintRgb,
    fontFamily: 'system-ui, sans-serif',
    marginBottom: '6px',
  });
  card.appendChild(tier);

  // Item name
  const name = document.createElement('div');
  name.textContent = item.name;
  Object.assign(name.style, {
    fontSize: '18px',
    fontWeight: '600',
    color: tintRgb,
    marginBottom: '4px',
    opacity: '0',
    transition: 'opacity 400ms ease',
  });
  card.appendChild(name);

  // Item flavor
  const flav = document.createElement('div');
  flav.textContent = item.flavor ?? '';
  Object.assign(flav.style, {
    fontSize: '13px',
    fontStyle: 'italic',
    color: 'rgba(200, 170, 140, 0.75)',
    lineHeight: '1.4',
    marginBottom: '14px',
    opacity: '0',
    transition: 'opacity 400ms ease 100ms',
  });
  card.appendChild(flav);

  // Dismiss hint
  const tap = document.createElement('div');
  tap.textContent = 'tap to continue';
  Object.assign(tap.style, {
    fontSize: '10px',
    letterSpacing: '0.22em',
    textTransform: 'uppercase',
    color: 'rgba(180, 150, 120, 0.5)',
    fontFamily: 'system-ui, sans-serif',
    opacity: '0',
    transition: 'opacity 400ms ease 600ms',
  });
  card.appendChild(tap);

  overlay.appendChild(card);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => {
    overlay.style.opacity = '1';
    card.style.transform = 'scale(1)';
    // Run the reel — translate up so the LAST row aligns with the visible window.
    const finalRowIndex = decoys.length - 1;
    inner.style.transform = `translateY(${-finalRowIndex * 30}px)`;
  });
  setTimeout(() => {
    name.style.opacity = '1';
    flav.style.opacity = '1';
    tap.style.opacity = '1';
  }, 1700);

  // Tap to dismiss + refresh stash list behind.
  const close = () => {
    overlay.style.opacity = '0';
    setTimeout(() => {
      overlay.remove();
      rebuild();   // updated stash count
    }, 220);
  };
  overlay.addEventListener('click', close);
}

// Decoy names that scroll past in the reel. Mix existing items + flavor
// strings the player won't recognize so the wheel "could land on anything."
function randomItemNameForFlavor(): string {
  const all = Object.values(ITEMS).map(it => it.name);
  return all[Math.floor(Math.random() * all.length)];
}
