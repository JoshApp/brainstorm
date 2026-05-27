import type { LevelSpec } from './types';
import { ITEMS } from '../content/items';

// Safe room — the small chamber between dungeon floors where the
// player catches their breath. No enemies. No traps. Just a calm beat.
//
// V1 fixtures:
//   - Stash chest in the corner: tap to open the meta-progression
//     stash (loot boxes earned from previous runs).
//   - Fountain off to the side: same DRINK gamble as in the regular
//     dungeon — gives the player a moment of choice.
//   - Two candles flanking the descent stairs: soft warm light, no
//     enemies → low light count is fine, the room feels safe.
//   - Stairs at the far end leading to the next REAL depth.
//
// Future fixtures (placeholders to wire later):
//   - Smith pedestal (upgrade a weapon)
//   - Vendor stall (buy a one-off consumable / scroll)
//   - Mystery NPC slot (LLM-driven encounter)
//
// The room shape itself stays the same between visits — players learn
// the layout. Variations come from the NPCs / contents, not geometry.

/**
 * Build the safe room that follows floor `prevDepth`. The generated
 * level's stairs target `depth-${prevDepth + 1}`. Loader's `generate`
 * callback resolves the 'safe-N' id by calling this.
 */
export function generateSafeRoom(prevDepth: number): LevelSpec {
  const nextDepth = prevDepth + 1;
  const id = `safe-${prevDepth}`;
  const nextId = `depth-${nextDepth}`;

  return {
    id,
    // Depth used for difficulty scaling — N/A here (no enemies) but
    // pass through the higher value so any modifiers that DO check
    // depth get the right number for the next floor.
    depth: nextDepth,
    displayName: 'A still place between the dark',
    // Warm dark — slightly warmer than the dungeon floors. Reads as a
    // refuge without flipping to a cosy lit room.
    fogColor: 0x140a06,
    startPos: { x: 0, z: -2.4, yaw: 0 },
    rooms: [
      {
        id: 'safe-chamber',
        rect: { x: 0, z: 0, w: 8, d: 9 },
        height: 3.0,
      },
    ],
    corridors: [],

    props: [
      // Stash chest — left side, raised on a small pedestal feel via
      // its model. Opens the META-progression stash (loot boxes).
      {
        kind: 'stash-chest',
        x: -2.6, z: 0.0,
        rotY: Math.PI / 2,   // face the centre
      },
      // Fountain — right side, mirroring the stash. Same gamble logic
      // as the dungeon fountains; one-shot per visit.
      {
        kind: 'fountain',
        x: 2.6, z: 0.0,
        rotY: -Math.PI / 2,
      },
      // Floor candles flanking the descent stairs at the back.
      { kind: 'model', model: FLOOR_CANDLE, x: -1.2, y: 0, z: 3.4 },
      { kind: 'model', model: FLOOR_CANDLE, x:  1.2, y: 0, z: 3.4 },
      // Soft warm centre glow — sets the tone immediately on arrival.
      { kind: 'model', model: SAFE_FLOOR_GLOW, x: 0, y: 0, z: 0.5 },
    ],

    torches: [
      // Two torches at the back, gentle warm. No torches in the middle —
      // keeps the centre dim so the candles + stash glow read.
      { x: -3.85, z: 3.4, height: 2.0, wall: 'W', colorTint: 0xffb070, intensityMul: 0.85 },
      { x:  3.85, z: 3.4, height: 2.0, wall: 'E', colorTint: 0xffb070, intensityMul: 0.85 },
    ],

    spawns: [],  // no enemies — this is the SAFE room
    doors: [],

    stairs: [
      {
        id: `stairs-${id}-down`,
        // Far end, descending into the back wall.
        x: 0, z: 3.4,
        rotY: 0,
        targetLevel: nextId,
      },
    ],
  };
}

// Lazy-load model imports — keep this module's top-level light so it
// doesn't fight bundler tree-shaking when other code doesn't need it.
import { FLOOR_CANDLE } from '../content/candle';
import { floorGlow } from '../content/light-props';
const SAFE_FLOOR_GLOW = floorGlow(0xffb070);
// `ITEMS` is imported for future smith/vendor wiring; suppress
// unused-import noise until those land.
void ITEMS;
