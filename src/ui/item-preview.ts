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
  // Cached child refs — we restyle font sizes per-frame to keep the
  // label legible across viewing distance, so we need direct access
  // instead of re-querying every tick.
  nameEl: HTMLDivElement;
  flavorEl: HTMLDivElement | null;
  statsEl: HTMLDivElement | null;
}

// Base font sizes (px) at REF_DIST. Per-frame distance scaling
// multiplies these.
const NAME_BASE_PX = 12;
const FLAVOR_BASE_PX = 13;
const STATS_BASE_PX = 10;
// Camera-to-anchor distance at which labels render at base size.
// Closer than this → labels grow; further → they shrink (clamped).
const REF_DIST = 3.0;
const MIN_SCALE = 0.85;
const MAX_SCALE = 1.6;

const entries = new Map<string, PreviewEntry>();

/** Register a preview for a given item at the given altar id. The id
 *  is owner-supplied (e.g. the interactable id) so update and
 *  unregister calls can find the entry. */
export function registerItemPreview(id: string, item: ItemSpec): void {
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
    padding: '7px 13px',
    background: 'rgba(20, 12, 8, 0.78)',
    border: '1px solid rgba(180, 130, 90, 0.4)',
    borderRadius: '4px',
    textAlign: 'center',
    // Cap width but stay inside the viewport on narrow phones — 80vw
    // leaves room for the screen edges so the label never wraps awkwardly
    // because it's pinned half-off-screen.
    maxWidth: 'min(240px, 80vw)',
    lineHeight: '1.3',
  } as Partial<CSSStyleDeclaration>);

  // Name — rarity-coloured, slight letter spacing.
  const name = document.createElement('div');
  const rarity = item.rarity ?? 'mundane';
  const rarityHex = RARITY_COLORS[rarity].toString(16).padStart(6, '0');
  name.textContent = item.name;
  Object.assign(name.style, {
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: `${NAME_BASE_PX}px`,
    fontWeight: '600',
    letterSpacing: '0.18em',
    color: `#${rarityHex}`,
    textTransform: 'uppercase',
  } as Partial<CSSStyleDeclaration>);
  el.appendChild(name);

  // Flavor — italic, dimmed.
  let flavorEl: HTMLDivElement | null = null;
  if (item.flavor) {
    flavorEl = document.createElement('div');
    flavorEl.textContent = item.flavor;
    Object.assign(flavorEl.style, {
      fontStyle: 'italic',
      fontSize: `${FLAVOR_BASE_PX}px`,
      color: 'rgba(220, 180, 140, 0.70)',
      marginTop: '4px',
    } as Partial<CSSStyleDeclaration>);
    el.appendChild(flavorEl);
  }

  // Stat summary — compact, monospace-ish.
  const stats = formatStats(item);
  let statsEl: HTMLDivElement | null = null;
  if (stats) {
    statsEl = document.createElement('div');
    statsEl.textContent = stats;
    Object.assign(statsEl.style, {
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: `${STATS_BASE_PX}px`,
      fontWeight: '600',
      letterSpacing: '0.10em',
      color: 'rgba(255, 220, 180, 0.85)',
      marginTop: '6px',
    } as Partial<CSSStyleDeclaration>);
    el.appendChild(statsEl);
  }

  document.body.appendChild(el);
  entries.set(id, {
    id, worldX: 0, worldY: 0, worldZ: 0, visible: false, el,
    nameEl: name, flavorEl, statsEl,
  });
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
  const margin = 8;
  for (const e of entries.values()) {
    if (!e.visible || screensOpen) {
      if (e.el.style.opacity !== '0') e.el.style.opacity = '0';
      continue;
    }
    // Camera-to-anchor distance drives the font-size scale: closer
    // makes the label feel like part of the world (especially on
    // desktop where the viewport is wide and a fixed 12px name reads
    // as tiny). Clamped both sides so it never balloons or vanishes.
    const dx = e.worldX - camera.position.x;
    const dy = e.worldY - camera.position.y;
    const dz = e.worldZ - camera.position.z;
    const dist = Math.hypot(dx, dy, dz);
    const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, REF_DIST / Math.max(dist, 0.5)));
    setFontScale(e, scale);

    tmpVec.set(e.worldX, e.worldY, e.worldZ);
    tmpVec.project(camera);
    if (tmpVec.z > 1) {
      if (e.el.style.opacity !== '0') e.el.style.opacity = '0';
      continue;
    }
    let sx = (tmpVec.x * 0.5 + 0.5) * rect.width + rect.left;
    const sy = (-tmpVec.y * 0.5 + 0.5) * rect.height + rect.top;
    // Clamp horizontally so the label can't slide off-screen on
    // mobile when the anchor sits near the viewport edge. We use the
    // measured width of the label, halved (CSS centres it via
    // translate(-50%)), so it always stays fully visible.
    const halfW = e.el.offsetWidth / 2;
    if (halfW > 0) {
      const minX = halfW + margin;
      const maxX = window.innerWidth - halfW - margin;
      if (maxX >= minX) sx = Math.max(minX, Math.min(maxX, sx));
    }
    e.el.style.left = `${sx}px`;
    e.el.style.top = `${sy}px`;
    if (e.el.style.opacity !== '1') e.el.style.opacity = '1';
  }
}

function setFontScale(e: PreviewEntry, scale: number): void {
  // Skip restyle if scale hasn't meaningfully changed — keeps the
  // DOM out of layout thrash for static viewing.
  const prev = parseFloat(e.el.dataset.fontScale ?? '0');
  if (Math.abs(prev - scale) < 0.02) return;
  e.el.dataset.fontScale = scale.toFixed(3);
  e.nameEl.style.fontSize = `${NAME_BASE_PX * scale}px`;
  if (e.flavorEl) e.flavorEl.style.fontSize = `${FLAVOR_BASE_PX * scale}px`;
  if (e.statsEl) e.statsEl.style.fontSize = `${STATS_BASE_PX * scale}px`;
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
