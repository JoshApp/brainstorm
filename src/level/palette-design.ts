// ─────────────────────────────────────────────────────────────────────
// Level Palette & Pass system — DRAFT v0
// ─────────────────────────────────────────────────────────────────────
//
// This file is a STAKE IN THE GROUND. Types only, no runtime, nothing
// imports it yet. The goal is to argue about the shape on one page
// before refactoring the composer.
//
// The model:
//   1. Authors write SHAPE + INTENT, not exhaustive layouts.
//   2. The composer runs a chain of PASSES (carve → light → decor →
//      encounter → event) that each read intent from a resolved
//      PALETTE and emit their own slice of the final LevelSpec.
//   3. PALETTES cascade: act default → floor override → boss layer →
//      vault override. Last wins per field. Hand-placed overrides on
//      the vault (props / torches / voids) are written LAST and never
//      get overwritten by a pass.
//   4. Per-vault PROTECT rects let an author tell every pass "don't
//      place anything in this rect" — keeps the composer from
//      clogging meaningful empty space.
//
// Open questions noted inline with QQQ.

import type { TorchSpec, PropSpec } from './types';

// ── Palette ──────────────────────────────────────────────────────────
// A bag of intent values. Every field is OPTIONAL — the cascade fills
// the holes from layers below. A vault declaring `light: { density:
// 'sparse' }` inherits everything else from the floor/act above it.

export interface Palette {
  // TONAL — colour, material, mood. Cascades through every pass.
  tone?: {
    /** Default per-torch light tint when nothing more specific
     *  overrides. Per-torch overrides still win. */
    lightTint?: number;
    /** Per-torch intensity multiplier (0..2). */
    lightIntensity?: number;
    /** Scene fog colour. */
    fogColor?: number;
    /** Wall stone variant — drives material + bracing geometry. */
    wallVariant?: 'stone' | 'braced' | 'cathedral' | 'bone' | 'verdant';
    /** Ceiling shape for procgen room shells. */
    ceilingStyle?: 'flat' | 'barrel' | 'pitched' | 'collapsed';
    /** Ambient particle drift through rooms. */
    particle?: 'none' | 'dust' | 'ash' | 'spores' | 'droplets';
    /** Ambient audio bed id. */
    ambienceId?: string;
  };

  // CARVE — floor cutouts. Runs FIRST so downstream passes see the
  // post-carve walkable region.
  carve?: {
    style?: 'solid' | 'fissured' | 'pit-cluster' | 'chasm' | 'eroded';
    density?: 'light' | 'standard' | 'dense';
  };

  // LIGHTING — torch density + placement rule. Tint pulled from
  // tone.lightTint unless overridden here.
  light?: {
    density?: 'dark' | 'sparse' | 'medium' | 'dense';
    /** Override the per-torch tint for the procedural pass only —
     *  lets a boss-floor palette force red torches without touching
     *  the act-wide tone. */
    tintOverride?: number;
  };

  // DECOR — what fills the room.
  decor?: {
    style?: 'sparse' | 'pillared' | 'ruined' | 'bone' | 'verdant' | 'arena';
    density?: 'light' | 'standard' | 'dense';
  };

  // ENCOUNTER — multiplier on X-slot fill rate. Spawn ROLES still
  // come from the vault's encounter archetype / depth roll table.
  encounter?: {
    density?: 'sparse' | 'standard' | 'dense';
  };

  // EVENT — multiplier on $/? slot fill rate.
  events?: {
    density?: 'sparse' | 'standard' | 'dense';
  };
}

/** A palette with every field guaranteed filled by the cascade. The
 *  resolver throws if a required field is still undefined after the
 *  act layer. */
export type ResolvedPalette = Required<Palette>;

// QQQ: should we add an explicit "lock" syntax? e.g. a layer can say
// "this field is final, no later layer may override" — useful when an
// act REALLY wants every room to feel dark even if a vault tries to
// brighten itself. Maybe a `lockedKeys: string[]` per layer.

// ── Vault changes ────────────────────────────────────────────────────
// Author-facing additions to the existing Vault interface. Existing
// fields (id, map, tags, minDepth, weight, encounter, etc.) all stay.

export interface VaultPaletteFields {
  /** Vault-local intent. Wins over act/floor/boss layers per field. */
  palette?: Palette;
  /** Negative-space rects (vault-local). Every pass refuses to place
   *  anything inside these. Author uses to protect a ritual circle,
   *  a boss spawn point, a corridor through-line, etc. */
  protect?: Array<{ x: number; z: number; w: number; d: number }>;
  // Existing escape-hatch fields keep their meaning — always written
  // LAST in the compose pipeline so they overlay every procedural
  // result:
  //   props?: PropSpec[]
  //   torches?: TorchSpec[]
  //   voids?: Array<{ x, z, w, d }>
}

// ── Act changes ──────────────────────────────────────────────────────
// Additions to the existing Act interface (acts.ts). Existing fields
// (bossDepth, bossId, name, etc.) all stay.

export interface ActPaletteFields {
  /** Act-wide defaults. The baseline mood every floor in the act
   *  inherits unless overridden. */
  palette: Palette;
  /** Per-floor (depth) overrides. Use for "depth-2 is darker" or
   *  "depth-6 has the spore wave." Keyed by absolute depth. */
  floorOverrides?: Record<number, Palette>;
  /** Boss-floor palette layer — applied automatically on the act's
   *  bossDepth, sitting ABOVE the floor override but BELOW the
   *  vault override. The king's hall stays gold even when the act
   *  itself runs red. */
  bossPalette?: Palette;
}

// ── Resolver ─────────────────────────────────────────────────────────
// Merges the cascade in priority order, last layer wins per field.
// Deep merge: nested objects (tone, light, decor) merge field-by-field
// rather than replacing wholesale.

export interface CascadeInput {
  act: Palette;
  floor?: Palette;        // act.floorOverrides[depth]
  boss?: Palette;         // act.bossPalette if depth === act.bossDepth
  vault?: Palette;        // vault.palette
}

/** Pure — same input always produces the same ResolvedPalette. The
 *  per-vault rng for pass internals is NOT in here; it's threaded
 *  separately through PassContext below. */
export declare function resolvePalette(cascade: CascadeInput): ResolvedPalette;

// ── Pass interface ───────────────────────────────────────────────────
// Every pass takes the same context shape + emits its own output type.
// The composer runs them in a fixed sequence and merges outputs into
// the LevelSpec.

export interface PassContext {
  /** The vault being composed (for its map, id, palette, protect). */
  vaultId: string;
  /** Vault-local walkable cells. Post-CARVE, so light/decor/encounter
   *  passes never place anything in a void. */
  walkable: ReadonlyArray<{ col: number; row: number }>;
  /** Vault-local forbidden rects (the union of vault.protect + any
   *  rects earlier passes have claimed exclusive — e.g. a ritual-
   *  circle decor might forbid encounters around it). */
  forbidden: ReadonlyArray<{ x: number; z: number; w: number; d: number }>;
  /** Resolved palette for this vault (cascade already applied). */
  palette: ResolvedPalette;
  /** Deterministic per-vault-per-run RNG. Mixed seed:
   *  hash(runSeed, actId, depth, vaultIndex). */
  rng: () => number;
  /** Vault dimensions for cell→world math. */
  gridW: number;
  gridH: number;
}

/** Every pass writes into one or more LevelSpec slots. The slot type
 *  is the pass's payload — the composer collects them in order. */
export interface PassOutput {
  voids?: Array<{ x: number; z: number; w: number; d: number }>;
  torches?: TorchSpec[];
  props?: PropSpec[];
  spawns?: Array<{ enemyId: string; x: number; z: number }>;
  /** Rects the pass claims — future passes treat them as forbidden.
   *  e.g. the carve pass marks every void rect so decor won't drop
   *  pillars on a pit edge. */
  claimed?: Array<{ x: number; z: number; w: number; d: number }>;
}

export interface Pass {
  /** Stable id used for tracing / disabling individual passes in
   *  scenarios (e.g. snap a vault with --no-decor). */
  id: 'carve' | 'lighting' | 'decor' | 'encounter' | 'event';
  run(ctx: PassContext): PassOutput;
}

// ── Pipeline order ──────────────────────────────────────────────────
// Fixed order — each pass sees the cumulative state from the ones
// before it. Reordering would change behaviour (decor needs to see
// the carved voids, encounter needs to see decor footprints, etc.).

export const PASS_ORDER: Array<Pass['id']> = [
  'carve',     // first — defines the walkable region
  'lighting',  // touches wall edges only, no conflict with walkable
  'decor',     // reads voids + lighting placements as forbidden
  'encounter', // reads voids + decor footprints as forbidden
  'event',     // reads everything; events are rare
];

// QQQ: should `lighting` run AFTER decor instead? Argument for: a
// dense-pillared room might want torches MOUNTED ON the pillars, not
// just on outer walls. Argument against: complicates the pass
// dependency. Leaving as outer-walls-only for v1.

// ── Where vault.props / vault.torches / vault.voids fit ──────────────
//
// Composer pseudo-code:
//
//   for each placed vault in the floor:
//     palette = resolvePalette({ act, floor, boss, vault })
//     ctx = makePassContext(vault, palette, runRng)
//     for pass in PASS_ORDER:
//       out = pass.run(ctx)
//       collect(out)
//       extend ctx.forbidden with out.claimed
//
//     // Hand-authored escape hatches — last write wins per slot,
//     // so explicit author placements ALWAYS land in the final
//     // LevelSpec untouched.
//     extend voids   with vault.voids
//     extend torches with vault.torches
//     extend props   with vault.props
//     extend spawns  with vault.props.filter(p => p.kind === 'spawn')

// ── Pseudo-example: an Act II floor that's blood-red and pillared ───
//
//   const ACT_II: Act = {
//     ...existing,
//     palette: {
//       tone: { lightTint: TORCH_BLOOD, fogColor: 0x180808, wallVariant: 'stone' },
//       carve: { style: 'fissured', density: 'light' },
//       light: { density: 'sparse' },
//       decor: { style: 'pillared', density: 'standard' },
//       encounter: { density: 'standard' },
//       events: { density: 'standard' },
//     },
//     floorOverrides: {
//       5: { light: { density: 'dark' } },   // depth-5 is the dark floor
//     },
//     bossPalette: {
//       tone: { lightTint: TORCH_GOLD },     // king's hall stays gold
//       decor: { style: 'arena' },           // no pillars in the boss room
//       carve: { style: 'solid' },           // no pits at the king's feet
//     },
//   };
//
//   // A vault re-used across all three acts looks blood-red here,
//   // golden in the boss room, and (per its act palette) something
//   // entirely different in Act I — all from one ASCII shape.
