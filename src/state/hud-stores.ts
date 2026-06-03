import { writable } from './store';
import { getPlayerHp } from '../player/health';
import { getPlayerSnapshot } from './player-stats';
import { getGold, getLevel, getXpInLevel, getXpForNextLevel } from './run-state';

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
}
function bossEq(a: BossState, b: BossState): boolean {
  if (a.visible !== b.visible || a.name !== b.name || a.bars.length !== b.bars.length) return false;
  for (let i = 0; i < a.bars.length; i++) {
    if (a.bars[i].hp !== b.bars[i].hp || a.bars[i].max !== b.bars[i].max) return false;
  }
  return true;
}
export const bossStore = writable<BossState>(
  { visible: false, name: '', bars: [] },
  bossEq,
);

/** Push current HP into the store. Called once per frame after the player
 *  snapshot is recomputed (so max reflects this frame's equipment/buffs). */
export function syncHudStores(): void {
  hpStore.set({ hp: getPlayerHp(), max: getPlayerSnapshot().maxHp });
  xpStore.set({ level: getLevel(), inLevel: getXpInLevel(), next: getXpForNextLevel() });
  goldStore.set(getGold());
}

/** Set the depth readout. Event-driven — called on level load, not polled. */
export function setDepthState(depth: number, sanctuary: boolean = false): void {
  depthStore.set({ depth, sanctuary });
}
