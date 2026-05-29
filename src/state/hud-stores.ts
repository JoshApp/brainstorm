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
