import * as THREE from 'three';
import { generateEntityId } from '../ecs/world';
import { registerInteractable, getInRangeInteractable } from './system';
import { emit } from '../broadcast/event-bus';
import { damagePlayer } from '../player/health';
import { getCount, removeItem } from '../player/inventory';
import { getGold, spendGold } from '../state/run-state';
import { showInWorldMessage } from '../ui/pickup-notification';
import { applyBrokenness } from './brokenness';
import type { Interactable } from './types';
import type { EntityId } from '../ecs/types';
import type { TransactionFamily, TransactionPrice, TransactionOutcome } from '../content/transactions';
import type { ItemSpec } from '../content/items';
import type { AffixInstance } from '../content/affixes';

// spawnEvent — the ONE factory the deal/shrine interactables are built on.
//
// The interactables MAP (2026-07) found the same boilerplate copy-pasted across
// every altar/fountain/basin/offering: an id, a one-shot `used` guard, the
// object literal, registerInteractable, the transaction:offered/accepted/
// resolved emit triple with a per-file family string, an ad-hoc cost deduction
// (each re-implemented damagePlayer / removeItem by hand — the price payload was
// telemetry only), and onDestroy cleanup. spawnEvent owns ALL of that so an
// event file is reduced to its two bespoke parts: build (the visuals) and onUse
// (the effect). New events author against this, not the boilerplate.
//
// Order of a use: canUse → affordability check → emit accepted → run the effect
// → PAY the cost centrally → emit resolved → finish. Effect-then-pay means a
// blood burst still anchors before a lethal HP price, and a pre-checked gold/key
// cost can't leave you charged for nothing.
//
// What STAYS bespoke (correctly not forced through here): objects with a
// multi-frame teardown animation (a chest lid), pure infrastructure (doors,
// stairs, floor pickups) — those aren't deals and gain nothing from the mold.

type PromptKind = NonNullable<Interactable['promptKind']>;

export interface EventCtx {
  id: EntityId;
  scene: THREE.Object3D;
  pos: THREE.Vector3;
  rotY: number;
  /** Tear the event down (fires onDestroy next tick). Called automatically after
   *  a successful onUse unless autoFinish is false; call it yourself for events
   *  that self-manage teardown. */
  finish: () => void;
  /** The live Interactable (populated right after build()). A build's tick can
   *  read it lazily — e.g. `getInRangeInteractable() === ctx.self` to gate an
   *  item preview's stats on "am I the highlighted one?". */
  self?: Interactable;
}

export interface EventDef {
  /** Id prefix + logical type (e.g. 'fountain', 'blood-altar'). */
  kind: string;
  scene: THREE.Object3D;
  pos: THREE.Vector3;
  rotY?: number;
  radius?: number;              // interact range, default 1.5
  promptLabel: string;
  promptKind?: PromptKind;
  /** Stated price → shows the cost chip AND is what the central applier deducts. */
  cost?: TransactionPrice;
  /** When set, emits transaction:offered (on approach) / accepted / resolved. */
  family?: TransactionFamily;
  labelOffsetY?: number;
  priority?: number;
  previewItem?: ItemSpec;
  previewAffixes?: readonly AffixInstance[];
  canUse?: () => boolean;
  outlineScale?: number;
  /** 0..1 decay applied to the built group (applyBrokenness). */
  brokenness?: number;
  /** Keep the built group on destroy (partial teardown handled in onDestroy). */
  keepBuiltOnDestroy?: boolean;
  /** Auto-finish after a successful onUse (default true). False for self-animating
   *  teardown. */
  autoFinish?: boolean;
  /** Build the bespoke visuals — already added + positioned in the scene. Return
   *  the ROOT group to remove on destroy, plus an optional per-frame tick. */
  build: (ctx: EventCtx) => { group: THREE.Group; tick?: (dt: number, playerPos: THREE.Vector3) => void };
  /** The effect after the cost clears. Returned outcome rides transaction:resolved. */
  onUse: (ctx: EventCtx) => TransactionOutcome | void;
  /** Extra cleanup on destroy (event-bus unsubs, registered lights, previews…). */
  onDestroy?: () => void;
}

function canAfford(cost?: TransactionPrice): boolean {
  if (!cost) return true;
  if (cost.gold && getGold() < cost.gold) return false;
  if (cost.itemId && getCount(cost.itemId) <= 0) return false;
  return true;   // hp is always "affordable" — it can kill you, that's the bet
}

function unaffordableMessage(cost: TransactionPrice): string {
  if (cost.itemId) return /key/i.test(cost.itemId) ? 'Locked. It wants a key.' : 'It wants something you lack.';
  if (cost.gold) return 'Not enough gold.';
  return 'You cannot pay.';
}

function payCost(cost: TransactionPrice | undefined): void {
  if (!cost) return;
  if (cost.hp) damagePlayer(cost.hp, null, 'physical', false, 'their own bargain');
  if (cost.gold) spendGold(cost.gold);
  if (cost.itemId) removeItem(cost.itemId);
  // danger: the cost IS the fight — nothing to deduct.
}

/** Build a deal/shrine interactable from a declarative spec. Returns the live
 *  Interactable (already registered) in case the caller needs a handle. */
export function spawnEvent(def: EventDef): Interactable {
  const id = generateEntityId(def.kind);
  const pos = def.pos.clone();
  const rotY = def.rotY ?? 0;

  const finish = () => { interactable.destroyed = true; interactable.promptLabel = ''; };
  const ctx: EventCtx = { id, scene: def.scene, pos, rotY, finish };

  const built = def.build(ctx);
  if (def.brokenness) applyBrokenness(built.group, def.brokenness);

  let used = false;
  let offered = false;
  const offerRange = (def.radius ?? 1.5) * 2.5;   // "seen the deal" range for the offered emit

  const interactable: Interactable = {
    id,
    position: pos,
    radius: def.radius ?? 1.5,
    promptLabel: def.promptLabel,
    promptKind: def.promptKind,
    cost: def.cost,
    labelOffsetY: def.labelOffsetY,
    priority: def.priority,
    previewItem: def.previewItem,
    previewAffixes: def.previewAffixes,
    canUse: def.canUse,
    outlineScale: def.outlineScale,
    keepBuiltOnDestroy: def.keepBuiltOnDestroy,
    built: { group: built.group, parts: new Map(), slots: new Map(), materials: new Map(), hitTargets: [] },
    destroyed: false,
    onUse() {
      if (used) return;
      if (def.canUse && !def.canUse()) return;
      if (!canAfford(def.cost)) { showInWorldMessage(unaffordableMessage(def.cost!)); return; }
      used = true;
      if (def.family) emit({ type: 'transaction:accepted', family: def.family, id, price: def.cost ?? {} });
      const outcome = def.onUse(ctx) || {};
      payCost(def.cost);
      if (def.family) emit({ type: 'transaction:resolved', family: def.family, id, outcome });
      interactable.promptLabel = '';   // spent — the verb no longer applies
      if (def.autoFinish !== false) finish();   // ...and destroy the object unless it self-manages
    },
    tick(dt: number, playerPos: THREE.Vector3) {
      // "Offered" once, when the player first comes near enough to read the deal.
      if (def.family && !offered && !used) {
        const dx = playerPos.x - pos.x, dz = playerPos.z - pos.z;
        if (dx * dx + dz * dz < offerRange * offerRange) {
          offered = true;
          emit({ type: 'transaction:offered', family: def.family, id });
        }
      }
      built.tick?.(dt, playerPos);
    },
    onDestroy() {
      // If the player SAW this deal (offered) and never took it (not used), then
      // its teardown — walking away, or descending past it — is a REFUSAL. The
      // deep records what you turn down, same as what you take.
      if (def.family && offered && !used) {
        emit({ type: 'transaction:declined', family: def.family, id, itemId: def.previewItem?.id });
      }
      def.onDestroy?.();
    },
  };
  ctx.self = interactable;   // let build()'s tick reference the live interactable
  registerInteractable(interactable);
  return interactable;
}

// getInRangeInteractable is re-exported so migrated events can ask "am I the
// highlighted one?" (for gated item-preview stats) without a second import.
export { getInRangeInteractable };
