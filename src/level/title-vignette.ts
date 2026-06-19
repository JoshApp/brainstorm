// THE TITLE VIGNETTE — a bonfire breathing in the dark, behind the main menu.
//
// A small posed scene main.ts mounts at the title (via startRun) so the render
// loop runs and the fire is ALIVE — its flame sprites + light flicker on their own
// clock even while the title's `pausesWorld` freezes everything else. The fire sits
// front-RIGHT of the spawn so the menu reads against the dark on the LEFT.
// DESCEND/CONTINUE rebuild a real floor over it. Keep it MINIMAL — this renders
// before the player's even committed, and lighting is the GPU wall.
import type { LevelSpec } from './types';
import { BONFIRE } from '../content/bonfire';

export const TITLE_VIGNETTE: LevelSpec = {
  id: 'title-vignette',
  depth: 1,
  startPos: { x: 0, z: 0, yaw: 0 }, // looking down −Z; the fire is ahead-right
  rooms: [{ id: 'tv', rect: { x: 0.6, z: -2, w: 9, d: 9 }, height: 4 }],
  corridors: [],
  // closer (zoomed in) + nudged left of the old x:1.3 so the fire reads nearer
  // centre while the menu still holds the left.
  props: [{ kind: 'model', model: BONFIRE, x: 0.8, y: 0, z: -2.1, rotY: 0.4 }],
  torches: [],
  spawns: [],
  doors: [],
  stairs: [],
};
