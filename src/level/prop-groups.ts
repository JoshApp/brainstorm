import type { PropSpec } from './types';
import { FLOOR_CANDLE } from '../content/candle';
import { ALTAR_SKULL } from '../content/relics';
import { floorGlow } from '../content/light-props';

// Prop groups — named modular setpieces. A vault drops ONE entry
// like:
//
//   { kind: 'group', groupId: 'altar-ritual', x: 0, z: 0 }
//
// and the composer expands it into the group's child props (altar +
// flanking candles + corpse pile), translated into the vault-local
// coordinate space, then clearance-culled against the vault's walls
// so children that would clip into a wall quietly disappear.
//
// Authoring rules:
//   - Each child is a full PropSpec in GROUP-LOCAL coords (group
//     centre = (0, 0)).
//   - Set minClearance on children that should drop if they're too
//     close to a wall (typical: 0.4-0.6m for candles, larger for
//     altars).
//   - Keep groups SMALL — 2-5 children. Composability comes from
//     stacking multiple groups in a vault, not from monstrous
//     setpieces.

export interface GroupChild {
  /** Full PropSpec entry, with x/z relative to the group centre. */
  prop: PropSpec;
  /** Drop this child if it would land within this distance of any
   *  vault wall (in metres). 0 / undefined = always place. */
  minClearance?: number;
}

export interface PropGroupSpec {
  id: string;
  children: GroupChild[];
}

// Default corpse note — used by atmospheric groups so the author
// doesn't have to write a fresh line per spawn. The LLM in Phase 5
// will generate context-specific lines.
const CORPSE_NOTE = 'They were here before.\nSomething took them apart.';

// Floor glow shades for group-internal accents.
const GLOW_RITUAL = floorGlow(0xff3020);
const GLOW_BONE   = floorGlow(0x80a0a0);
const GLOW_CACHE  = floorGlow(0xffd060);

export const PROP_GROUPS: Record<string, PropGroupSpec> = {
  // Altar + flanking candles + a corpse who died at its foot.
  'altar-ritual': {
    id: 'altar-ritual',
    children: [
      { prop: { kind: 'altar', x: 0, z: 0 } },
      { prop: { kind: 'model', model: ALTAR_SKULL, x: 0, y: 0.82, z: 0, rotY: 0.25 } },
      { prop: { kind: 'model', model: FLOOR_CANDLE, x: -0.85, y: 0, z: 0.2 }, minClearance: 0.5 },
      { prop: { kind: 'model', model: FLOOR_CANDLE, x:  0.85, y: 0, z: 0.2 }, minClearance: 0.5 },
      { prop: { kind: 'corpse', x: 0, z: 1.4, rotY: 0.3, note: CORPSE_NOTE }, minClearance: 0.6 },
    ],
  },

  // Fountain + flanking candles + bone glow on the floor.
  'fountain-shrine': {
    id: 'fountain-shrine',
    children: [
      { prop: { kind: 'fountain', x: 0, z: 0 } },
      { prop: { kind: 'model', model: FLOOR_CANDLE, x: -1.1, y: 0, z: -0.6 }, minClearance: 0.5 },
      { prop: { kind: 'model', model: FLOOR_CANDLE, x:  1.1, y: 0, z: -0.6 }, minClearance: 0.5 },
      { prop: { kind: 'model', model: GLOW_BONE, x: 0, y: 0, z: 1.2 }, minClearance: 0.4 },
    ],
  },

  // Four candles in a square around an altar with a skull. Centre-
  // piece for ritual rooms — visually loaded but cheap (4 candles +
  // 1 altar + 1 skull + 1 glow).
  'ritual-circle': {
    id: 'ritual-circle',
    children: [
      { prop: { kind: 'altar', x: 0, z: 0 } },
      { prop: { kind: 'model', model: ALTAR_SKULL, x: 0, y: 0.82, z: 0, rotY: -0.4 } },
      { prop: { kind: 'model', model: FLOOR_CANDLE, x: -1.1, y: 0, z: -1.1 }, minClearance: 0.5 },
      { prop: { kind: 'model', model: FLOOR_CANDLE, x:  1.1, y: 0, z: -1.1 }, minClearance: 0.5 },
      { prop: { kind: 'model', model: FLOOR_CANDLE, x: -1.1, y: 0, z:  1.1 }, minClearance: 0.5 },
      { prop: { kind: 'model', model: FLOOR_CANDLE, x:  1.1, y: 0, z:  1.1 }, minClearance: 0.5 },
      { prop: { kind: 'model', model: GLOW_RITUAL, x: 0, y: 0, z: 0 } },
    ],
  },

  // Single ritual candle + a corpse + a bone-glow patch. The "single
  // forlorn corpse" beat — sparse, used in encounter rooms.
  'bone-shrine': {
    id: 'bone-shrine',
    children: [
      { prop: { kind: 'corpse', x: 0, z: 0, rotY: -0.5, note: CORPSE_NOTE } },
      { prop: { kind: 'model', model: FLOOR_CANDLE, x: -0.7, y: 0, z: -0.4 }, minClearance: 0.4 },
      { prop: { kind: 'model', model: GLOW_BONE, x: 0, y: 0, z: 0 } },
    ],
  },

  // Chest with two flanking candles + a corpse defender — the "the
  // last guy died protecting this loot" arrangement.
  'chest-cache': {
    id: 'chest-cache',
    children: [
      { prop: { kind: 'chest', x: 0, z: 0 } },
      { prop: { kind: 'model', model: FLOOR_CANDLE, x: -0.7, y: 0, z: -0.4 }, minClearance: 0.5 },
      { prop: { kind: 'model', model: FLOOR_CANDLE, x:  0.7, y: 0, z: -0.4 }, minClearance: 0.5 },
      { prop: { kind: 'corpse', x: 0, z: 1.3, rotY: 0.8, note: CORPSE_NOTE }, minClearance: 0.6 },
      { prop: { kind: 'model', model: GLOW_CACHE, x: 0, y: 0, z: 0 } },
    ],
  },

  // Pillar pair with a candle between them — a colonnade fragment.
  'pillar-pair': {
    id: 'pillar-pair',
    children: [
      { prop: { kind: 'pillar', x: -1.1, z: 0 } },
      { prop: { kind: 'pillar', x:  1.1, z: 0 } },
      { prop: { kind: 'model', model: FLOOR_CANDLE, x: 0, y: 0, z: 0 }, minClearance: 0.4 },
    ],
  },
};
