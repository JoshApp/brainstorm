import * as THREE from 'three';
import { RARITY_COLORS, type ItemSpec } from '../content/items';
import { isAnyScreenOpen } from './screen-manager';

// Floating item-preview labels — used by SELECT few interactables
// where the player needs to know an item's identity BEFORE committing
// to take it (the blood altar's HP cost, the starter altars' weapon
// choice). NOT used for ground pickups — those keep the "find out
// what it is by picking it up" loop, and the rarity halo already
// telegraphs tier.
//
// Each preview is registered per-altar with an id; the altar updates
// its world anchor + visibility per tick. A shared tick driver in
// main.ts projects every active preview to screen space.

const tmpVec = new THREE.Vector3();

interface PreviewEntry {
  id: string;
  worldX: number;
  worldY: number;
  worldZ: number;
  visible: boolean;
  el: HTMLDivElement;
  /** Stats element (if the item HAS stats to show). null when the
   *  item is stat-less. */
  statsEl: HTMLDivElement | null;
  /** True for altars where stats are hidden by default and only
   *  revealed when the player is highlighting the altar (in interact
   *  range + facing it). Starter altars set this false because the
   *  whole room IS a picker and stats need to be visible side-by-side
   *  for comparison. */
  hideStatsUntilInspect: boolean;
  /** Last inspected state — used to skip redundant style writes. */
  inspected: boolean;
}

export interface ItemPreviewOptions {
  /** If true, the stats line is hidden by default and only shown when
   *  setItemPreviewInspected(id, true) is called. Used by the blood
   *  altar so the player has to LEAN IN (be the in-range interactable)
   *  to see what bargain they're considering — name + flavor still
   *  identify the offering, stats are the contract. */
  hideStatsUntilInspect?: boolean;
}

const entries = new Map<string, PreviewEntry>();

/** Register a preview for a given item at the given altar id. The id
 *  is owner-supplied (e.g. the interactable id) so update and
 *  unregister calls can find the entry. */
export function registerItemPreview(id: string, item: ItemSpec, opts: ItemPreviewOptions = {}): void {
  if (entries.has(id)) return;

  const el = document.createElement('div');
  Object.assign(el.style, {
    position: 'fixed',
    transform: 'translate(-50%, -100%)',
    pointerEvents: 'none',
    zIndex: '12',
    opacity: '0',
    transition: 'opacity 0.18s ease',
    fontFamily: '"Iowan Old Style", "Palatino", "Times New Roman", serif',
    color: 'rgba(220, 180, 140, 0.95)',
    padding: '6px 11px',
    background: 'rgba(20, 12, 8, 0.78)',
    border: '1px solid rgba(180, 130, 90, 0.4)',
    borderRadius: '4px',
    textAlign: 'center',
    // Width is content-driven up to a viewport-relative cap — narrower
    // on phones, generous on desktop. Critical for cross-platform
    // robustness: the label width is a function of VIEWPORT size,
    // not of where the label happens to sit on screen, so it can
    // never reflow differently near one edge vs the other.
    width: 'max-content',
    maxWidth: 'clamp(160px, 32vw, 240px)',
    boxSizing: 'border-box',
    lineHeight: '1.3',
  } as Partial<CSSStyleDeclaration>);

  // Name — rarity-coloured. Forced single-line via nowrap so it never
  // silently wraps near a viewport edge (which used to read as "the
  // label is resizing"). Sizes are clamp(min, vw, max) so a phone
  // gets a small readable label and a desktop gets a slightly larger
  // one without either platform feeling broken.
  const name = document.createElement('div');
  const rarity = item.rarity ?? 'mundane';
  const rarityHex = RARITY_COLORS[rarity].toString(16).padStart(6, '0');
  name.textContent = item.name;
  Object.assign(name.style, {
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: 'clamp(11px, 2.0vw, 13px)',
    fontWeight: '600',
    letterSpacing: '0.16em',
    color: `#${rarityHex}`,
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
  } as Partial<CSSStyleDeclaration>);
  el.appendChild(name);

  // Flavor — italic, dimmed. The only line allowed to wrap (bounded
  // by the max-width above), so longer flavour can break into 2 short
  // lines on mobile.
  if (item.flavor) {
    const flavorEl = document.createElement('div');
    flavorEl.textContent = item.flavor;
    Object.assign(flavorEl.style, {
      fontStyle: 'italic',
      fontSize: 'clamp(11px, 1.8vw, 13px)',
      color: 'rgba(220, 180, 140, 0.70)',
      marginTop: '3px',
    } as Partial<CSSStyleDeclaration>);
    el.appendChild(flavorEl);
  }

  // Stat summary — single line via nowrap. Hidden by default if the
  // caller asked for hide-until-inspect (blood altar); the starter
  // altars leave the flag off so stats are always visible for
  // side-by-side comparison.
  const stats = formatStats(item);
  let statsEl: HTMLDivElement | null = null;
  if (stats) {
    statsEl = document.createElement('div');
    statsEl.textContent = stats;
    Object.assign(statsEl.style, {
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: 'clamp(9px, 1.5vw, 11px)',
      fontWeight: '600',
      letterSpacing: '0.10em',
      color: 'rgba(255, 220, 180, 0.85)',
      marginTop: '5px',
      whiteSpace: 'nowrap',
      display: opts.hideStatsUntilInspect ? 'none' : 'block',
    } as Partial<CSSStyleDeclaration>);
    el.appendChild(statsEl);
  }

  document.body.appendChild(el);
  entries.set(id, {
    id, worldX: 0, worldY: 0, worldZ: 0, visible: false, el,
    statsEl,
    hideStatsUntilInspect: !!opts.hideStatsUntilInspect,
    inspected: false,
  });
}

/** Toggle the stats-line visibility for previews registered with
 *  hideStatsUntilInspect. No-op for previews that always show stats
 *  (the starter altars). Called from the blood altar's tick: true
 *  when this altar is the highlighted in-range interactable, false
 *  otherwise. */
export function setItemPreviewInspected(id: string, inspected: boolean): void {
  const e = entries.get(id);
  if (!e || !e.hideStatsUntilInspect || !e.statsEl) return;
  if (e.inspected === inspected) return;
  e.inspected = inspected;
  e.statsEl.style.display = inspected ? 'block' : 'none';
}

/** Update the world anchor + visibility for a registered preview. */
export function setItemPreviewAnchor(id: string, x: number, y: number, z: number, visible: boolean): void {
  const e = entries.get(id);
  if (!e) return;
  e.worldX = x;
  e.worldY = y;
  e.worldZ = z;
  e.visible = visible;
}

/** Tear down a preview — call from the altar's onDestroy. */
export function unregisterItemPreview(id: string): void {
  const e = entries.get(id);
  if (!e) return;
  e.el.remove();
  entries.delete(id);
}

/** Per-frame projection of every visible preview onto screen space.
 *  Driven from main.ts. Forces all previews hidden while a screen
 *  (inventory, settings, etc.) is open so they don't poke through. */
export function tickItemPreviews(camera: THREE.Camera, canvas: HTMLCanvasElement): void {
  const rect = canvas.getBoundingClientRect();
  const screensOpen = isAnyScreenOpen();
  for (const e of entries.values()) {
    if (!e.visible || screensOpen) {
      if (e.el.style.opacity !== '0') e.el.style.opacity = '0';
      continue;
    }
    // No distance-based resizing and no horizontal clamping — the
    // label stays at its anchor's projected screen position at a
    // FIXED size and clips naturally against the viewport edges via
    // CSS when the anchor approaches one. Resizing was making the
    // labels balloon on close approach and the clamp made them
    // visibly snap toward the centre instead of sliding cleanly off
    // with the camera. Just project + position.
    tmpVec.set(e.worldX, e.worldY, e.worldZ);
    tmpVec.project(camera);
    if (tmpVec.z > 1) {
      if (e.el.style.opacity !== '0') e.el.style.opacity = '0';
      continue;
    }
    const sx = (tmpVec.x * 0.5 + 0.5) * rect.width + rect.left;
    const sy = (-tmpVec.y * 0.5 + 0.5) * rect.height + rect.top;
    e.el.style.left = `${sx}px`;
    e.el.style.top = `${sy}px`;
    if (e.el.style.opacity !== '1') e.el.style.opacity = '1';
  }
}

function formatStats(item: ItemSpec): string | null {
  const parts: string[] = [];
  if (item.weapon) {
    const w = item.weapon;
    parts.push(`${w.damage} DMG`);
    if (w.critChance && w.critChance > 0) {
      const c = Math.round(w.critChance * 100);
      const m = w.critMultiplier ?? 2;
      parts.push(`${c}% CRIT ×${m}`);
    }
  }
  if (item.modifiers) {
    for (const mod of item.modifiers) {
      const sign = mod.amount >= 0 ? '+' : '';
      switch (mod.kind) {
        case 'weapon-damage':   parts.push(`${sign}${mod.amount} DMG`); break;
        case 'max-hp':          parts.push(`${sign}${mod.amount} MAX HP`); break;
        case 'physical-armor':  parts.push(`${sign}${mod.amount} ARMOUR`); break;
        case 'magic-armor':     parts.push(`${sign}${mod.amount} MAGIC ARMOUR`); break;
        case 'damage-multiplier': {
          const pct = Math.round((mod.amount - 1) * 100);
          const psign = pct >= 0 ? '+' : '';
          parts.push(`${psign}${pct}% DMG`);
          break;
        }
      }
    }
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}
