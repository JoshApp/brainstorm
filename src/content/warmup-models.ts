import {
  RUBBLE_CHUNK, BONE_PILE, SAND_DRIFT, CORNER_MOUND, WALL_PILE, CORNER_MOUND_LARGE,
  CORNER_MOUND_SMALL, WALL_BUTTRESS, FALLEN_PILLAR_SEGMENT, IRON_BARS, RUINED_COLUMN,
  BROKEN_PLANKS, ASH_MOUND, STONE_SHARDS, FLOOR_CRACK, WALL_SCORCH, WALL_GOUGE, LURKER,
} from './clutter';
import { VASE_TALL, VASE_FLASK, VASE_BROKEN, VASE_SQUAT } from './vase';
import { CHEST, CHEST_IRON, CHEST_BOSS } from './chest';
import { OSSUARY_NICHE, OSSUARY_NICHE_SMALL } from './ossuary';

// Static props/clutter the warmup must compile so their material pipelines are ready
// BEFORE the prop first appears. Deeper floors introduce types the first floor lacks
// (a boss chest, a fallen pillar, a sand drift), so without this they'd compile mid-
// reveal — the first-use hitch. The warm pass builds one of each and renders it through
// the real PSX pipeline (correct target format) alongside the roster + effects.
//
// FIRST-CLASS SEAM: this is the one list to extend. Add a new prop/clutter ModelSpec
// here and it auto-warms. (Enemies/items warm from their own registries; effects self-
// register via registerWarmup; floor shell/decor warm from the loaded floor itself.)
export const WARM_MODELS = [
  // clutter / debris
  RUBBLE_CHUNK, BONE_PILE, SAND_DRIFT, CORNER_MOUND, WALL_PILE, CORNER_MOUND_LARGE,
  CORNER_MOUND_SMALL, WALL_BUTTRESS, FALLEN_PILLAR_SEGMENT, IRON_BARS, RUINED_COLUMN,
  BROKEN_PLANKS, ASH_MOUND, STONE_SHARDS, FLOOR_CRACK, WALL_SCORCH, WALL_GOUGE, LURKER,
  // destructibles
  VASE_TALL, VASE_FLASK, VASE_BROKEN, VASE_SQUAT,
  // chests
  CHEST, CHEST_IRON, CHEST_BOSS,
  // pale family (PAINTED chroma props — one pipeline for the whole family)
  OSSUARY_NICHE, OSSUARY_NICHE_SMALL,
];
