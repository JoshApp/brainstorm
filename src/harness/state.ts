// Harness module state. Lives here so observation/action/index can read
// + write the shared counters without circular imports.
//
// Booted lazily — most fields stay null/zero until bootHarness() runs.

import * as THREE from 'three';
import type { LiveLevel } from '../level/builder';
import type { InputState } from '../controls/input';
import type { WeaponViewmodel } from '../player/viewmodel';
import type { DelveRenderer } from '../scene/create-renderer';

export interface HarnessContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: DelveRenderer;
  canvas: HTMLCanvasElement;
  input: InputState;
  /** Returns the active level — main.ts holds a mutable `currentLevel`,
   *  so we read via a getter to follow stair-driven swaps. */
  getLevel: () => LiveLevel | null;
  /** Player's weapon viewmodel — exposes isSwinging so the harness's
   *  attack action can wait for the full swing to play out before
   *  re-pausing. */
  weapon: WeaponViewmodel;
}

let ctx: HarnessContext | null = null;
let booted = false;
let turn = 0;
let tickClockSeconds = 0;

export function getContext(): HarnessContext {
  if (!ctx) throw new Error('[harness] not booted yet');
  return ctx;
}

export function tryGetContext(): HarnessContext | null {
  return ctx;
}

export function setContext(c: HarnessContext): void {
  ctx = c;
  booted = true;
}

export function isBooted(): boolean {
  return booted;
}

export function getTurn(): number {
  return turn;
}

export function incrementTurn(): void {
  turn++;
}

export function getTickClock(): number {
  return tickClockSeconds;
}

/** Called from main.ts each frame with the unpaused dt slice so the
 *  harness can report tickClock in seconds of actual game-time. */
export function advanceTickClock(dt: number): void {
  tickClockSeconds += dt;
}
