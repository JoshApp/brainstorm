import { writable } from './store';
import { getPlayerHp } from '../player/health';
import { getPlayerSnapshot } from './player-stats';
import { getGold, getLevel, getXpInLevel, getXpForNextLevel } from './run-state';
import { staminaFraction, reservedFraction, isStaminaRegenHeld, isStaminaExhausted } from '../combat/stamina';

// Reactive stores backing the live HUD readouts. Synced once per frame from
// the source-of-truth getters (frame-coherent: any direct mutation is caught
// next frame), and the stores only notify subscribers when a value actually
// changes. Widgets bind() to these instead of polling a getter + diffing a
// hand-kept cache.

export interface HpState {
  hp: number;
  max: number;
}
export const hpStore = writable<HpState>(
  { hp: 0, max: 0 },
  (a, b) => a.hp === b.hp && a.max === b.max,
);

export interface DepthState {
  depth: number;
  sanctuary: boolean;
}
export const depthStore = writable<DepthState>(
  { depth: 1, sanctuary: false },
  (a, b) => a.depth === b.depth && a.sanctuary === b.sanctuary,
);

export interface XpState {
  level: number;
  /** XP earned within the current level. */
  inLevel: number;
  /** XP needed to finish the current level (bar size). */
  next: number;
}
export const xpStore = writable<XpState>(
  { level: 1, inLevel: 0, next: 0 },
  (a, b) => a.level === b.level && a.inLevel === b.inLevel && a.next === b.next,
);

export const goldStore = writable<number>(0);

export interface StaminaState {
  /** 0..1 fill. */
  frac: number;
  /** Full and not mid-refill — the gauge fades out when true. */
  rested: boolean;
  /** Bottomed out ("gassed") — the bar flashes so a blocked dash/shot reads
   *  as "you're out", not an unresponsive tap. */
  exhausted: boolean;
  /** 0..1 — stamina RESERVED by an in-flight charged attack. Elden Ring bills
   *  the heavy on release, not while held; this previews the pending spend as a
   *  marked band at the leading edge of the fill so you can see where it'll
   *  land. 0 when not charging a melee heavy. */
  reserved: number;
}
export const staminaStore = writable<StaminaState>(
  { frac: 1, rested: true, exhausted: false, reserved: 0 },
  // Sub-pixel changes don't warrant a DOM write; ~0.4% steps keep the
  // bar smooth while idling at full produces no churn at all.
  (a, b) => Math.abs(a.frac - b.frac) < 0.004 && a.rested === b.rested
    && a.exhausted === b.exhausted && Math.abs(a.reserved - b.reserved) < 0.004,
);

/** One health bar. The fight shows one (the king) or several (its split
 *  princes — each tracked as its own bar so the split stays part of the
 *  boss encounter). */
export interface BossBar {
  hp: number;
  max: number;
}
export interface BossState {
  visible: boolean;
  name: string;
  bars: BossBar[];
  /** Fight tier — 'boss' (blood-red bar) vs 'miniboss' (amber bar). Drives the
   *  bar's colour so a named elite reads as a lesser threat than an act boss. */
  tier: 'boss' | 'miniboss';
}
function bossEq(a: BossState, b: BossState): boolean {
  if (a.visible !== b.visible || a.name !== b.name || a.tier !== b.tier || a.bars.length !== b.bars.length) return false;
  for (let i = 0; i < a.bars.length; i++) {
    if (a.bars[i].hp !== b.bars[i].hp || a.bars[i].max !== b.bars[i].max) return false;
  }
  return true;
}
export const bossStore = writable<BossState>(
  { visible: false, name: '', bars: [], tier: 'boss' },
  bossEq,
);

/** Push current HP into the store. Called once per frame after the player
 *  snapshot is recomputed (so max reflects this frame's equipment/buffs). */
export function syncHudStores(): void {
  hpStore.set({ hp: getPlayerHp(), max: getPlayerSnapshot().maxHp });
  xpStore.set({ level: getLevel(), inLevel: getXpInLevel(), next: getXpForNextLevel() });
  goldStore.set(getGold());
  const frac = staminaFraction();
  // The real locked-charge amount (stamina.reserveStamina has actually moved it
  // out of usable). The HUD draws it as a "ghost" segment past the usable fill,
  // so you watch your bar convert into a heavy as you hold.
  const reserved = reservedFraction();
  staminaStore.set({
    frac,
    rested: frac >= 0.999 && !isStaminaRegenHeld() && reserved === 0,
    exhausted: isStaminaExhausted(),
    reserved,
  });
}

/** Set the depth readout. Event-driven — called on level load, not polled. */
export function setDepthState(depth: number, sanctuary: boolean = false): void {
  depthStore.set({ depth, sanctuary });
}
