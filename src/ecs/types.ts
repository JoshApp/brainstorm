// ECS-lite: entity registry + effect/trigger/buff data model.
//
// Not a full ECS — we don't iterate-by-component every frame. This is an
// organizing principle: state that needs to be queried/mutated by effects
// (HP, buffs, equipped items, passives) lives in Entity records. The
// presentation classes (Enemy, Sword, Torch) hold the meshes and animation
// state separately and refer to their entity by ID.
//
// The win: any effect operating on an entity (deal damage, apply buff, heal,
// modify stat) goes through the same code path whether it was triggered by
// the player swinging, an item proc'ing, or a buff ticking.

export type EntityId = string;

export type EntityKind = 'player' | 'enemy' | 'prop';

export interface StatPool {
  /** Maximum / starting value. */
  base: number;
  /** Current value, clamped to [0, base]. */
  current: number;
}

export interface ActiveBuff {
  /** ID of the BuffSpec in content/buffs.ts. */
  specId: string;
  /** Seconds until this buff expires. */
  remaining: number;
  /** Accumulator for periodic-tick effects (compared against spec.tickInterval). */
  tickAccumulator: number;
  /** Number of stacks (1 unless the spec allows stacking). */
  stacks: number;
}

/**
 * An entity is whatever game-logic state an in-world thing has. Mesh + animation
 * live elsewhere on the presentation side; this is the data model effects act on.
 */
export interface Entity {
  id: EntityId;
  kind: EntityKind;
  /** Health pool — undefined for entities that can't be damaged (props). */
  hp?: StatPool;
  /** Active buffs ticking on this entity. */
  buffs: ActiveBuff[];
  /** Passives attached to this entity (intrinsic + granted by equipped items). */
  passives: PassiveSpec[];
}

// ============================================================================
// Content specs (data-driven, JSON-friendly — these are what items, enemies,
// and abilities are made of)
// ============================================================================

/** When the trigger should consider firing its effects. */
export type TriggerEvent =
  | 'hit'          // entity landed a hit on a target (source = self, target = victim)
  | 'killed'       // entity killed a target (source = self)
  | 'damaged'      // entity took damage (source = self)
  | 'died'         // entity's HP reached 0
  | 'interval';    // every tick — used inside buffs

export interface TriggerSpec {
  on: TriggerEvent;
  /** 0..1 probability per trigger event. Default 1 (always fires). */
  chance?: number;
  /** Effects to apply if the trigger fires. */
  effects: EffectSpec[];
}

/** Where the effect's target comes from when it fires. */
export type EffectTarget =
  | 'self'         // the entity that owns the trigger
  | 'victim'       // the entity that was hit/killed
  | 'attacker';    // the entity that hit us

export interface EffectSpec {
  type:
    | 'damage'
    | 'heal'
    | 'apply-buff';
  /** Override the implicit target (default depends on trigger). */
  target?: EffectTarget;
  /** For damage/heal — amount (positive). */
  amount?: number;
  /** For apply-buff — which BuffSpec to apply. */
  buffId?: string;
  /** For apply-buff — duration in seconds. */
  duration?: number;
}

export interface BuffSpec {
  id: string;
  /** Human-readable label shown in the buff bar (e.g. 'REGEN', 'BURN'). */
  displayName?: string;
  /** Hex color for the buff bar indicator (and future effect tints). */
  color?: number;
  /** Optional: how often (seconds) to fire tickEffect while active. */
  tickInterval?: number;
  /** Effect that fires on each tick (applied to the buff's owner). */
  tickEffect?: EffectSpec;
}

export interface PassiveSpec {
  id: string;
  trigger: TriggerSpec;
}
