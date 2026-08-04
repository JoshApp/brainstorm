import * as THREE from 'three';
import { buildModel } from '../ecs/build-model';
import { CONFIG } from '../config';
import { buildRelicBillboard } from '../effects/relic-billboard';
import { hasRelicArt } from '../content/relic-art-assets';
import { generateEntityId } from '../ecs/world';
import { registerInteractable, getInRangeInteractable } from './system';
import { canAfford, payCost, unaffordableMessage } from './event-factory';
import { showInWorldMessage } from '../ui/pickup-notification';
import { registerItemPreview, setItemPreviewAnchor, setItemPreviewInspected, unregisterItemPreview } from '../ui/item-preview';
import { playEquipClick, playDenied } from '../audio/sfx';
import { emit } from '../broadcast/event-bus';
import { disposeBuiltTree } from '../style/material-registry';
import { addRelic } from '../player/reliquary';
import { addItem } from '../player/inventory';
import { groundEquip } from '../player/ground-equip';
import { dropGearPickup } from './pickup';
import type { ItemSpec } from '../content/items';
import type { AffixInstance } from '../content/affixes';
import type { StyleMaterials } from '../style/materials';
import type { TransactionPrice, TransactionFamily } from '../content/transactions';
import type { Interactable } from './types';

// THE OFFERING SYSTEM — "here are N things, take one."
//
// The room IS the picker. Instead of opening a menu, we stand the choices up in
// the world on plinths (or on the ground, or in a niche) and let the player walk
// between them, raise the lamp, read each card, and commit. Taking one closes the
// others: their offering vanishes and the empty stone stays behind as a monument
// to what you refused. Commitment-by-absence.
//
// This is a SYSTEM, not a room: anything that offers a choice of goods routes
// through it — the starter weapons, a floor's guaranteed trove, a merchant's
// wares, a boss's spoils. Authoring one is DATA:
//
//   spawnOfferingGroup({
//     scene, materials, style: 'pedestal',
//     cost: { itemId: KEY_ID },              // tag a price onto the whole group
//     offerings: [ { item: a, pos: p1 }, { item: b, pos: p2 }, { item: c, pos: p3 } ],
//   });
//
// Costs ride the SAME central applier every other priced thing uses
// (event-factory canAfford/payCost), so the price chip on the prompt, the
// affordability refusal, and the deduction are all consistent by construction.
// A per-offering `cost` overrides the group's, so a group can mix free and
// priced goods on adjacent stones.
//
// The group PERSISTS until the floor is left — walk away, find something that
// changes your mind, come back. It is not consumed by leaving the room.

const SPIN = 0.5;              // rad/s — the offering turns on its stone
const BOB_AMPLITUDE = 0.025;   // m
const BOB_FREQUENCY = 0.8;     // Hz — slow, dreamy hover

/** PLACEMENT CONSTRAINT — minimum metres between offerings in one group.
 *  Each offering floats a name card above it, and below this spacing the cards
 *  overlap into unreadable mush at normal viewing distance (measured on a phone
 *  at ~3m). Whoever places a trove room must honour this, or the "survey your
 *  options at a glance" premise breaks.
 *
 *  The number itself lives in config.ts, because the pass that has to OBEY it
 *  (level/centrepieces.ts) runs headless and must not drag this UI-heavy module
 *  into a node import. Re-exported here so the constraint is documented where
 *  the system it constrains lives. */
export const MIN_OFFERING_SPACING = CONFIG.CENTREPIECE.OFFERING_MIN_SPACING;

/** How an offering is presented. Adding one is a data edit here, not new code
 *  at every call site. */
export type OfferingStyle = 'pedestal' | 'ground';

interface StyleDef {
  /** Build the static furniture the offering rests on (stays after the take).
   *  Returns the group plus how high above `pos` the offering floats. */
  base: (materials: StyleMaterials) => { group: THREE.Group; restY: number };
  /** Prompt height — kept LOW so it clears the offering + its floating card. */
  labelOffsetY: number;
  /** Height of the floating item card above `pos`. */
  previewY: number;
}

const STYLES: Record<OfferingStyle, StyleDef> = {
  // A waist-high stone block — the ceremonial presentation. The offering hovers
  // above it, lit and turning: unmistakably ON DISPLAY, unmistakably a choice.
  pedestal: {
    base: (materials) => {
      const group = new THREE.Group();
      const baseH = 0.62, baseW = 0.70, baseD = 0.55;
      const block = new THREE.Mesh(new THREE.BoxGeometry(baseW, baseH, baseD), materials.wall);
      block.position.y = baseH / 2;
      block.castShadow = true; block.receiveShadow = true;
      group.add(block);
      const capH = 0.06;
      const cap = new THREE.Mesh(new THREE.BoxGeometry(baseW + 0.06, capH, baseD + 0.06), materials.wall);
      cap.position.y = baseH + capH / 2;
      cap.castShadow = true; cap.receiveShadow = true;
      group.add(cap);
      return { group, restY: baseH + capH + 0.30 };
    },
    labelOffsetY: 0.55,
    previewY: 1.7,
  },
  // A flat slab set into the floor — the offering rests low, almost dropped
  // there. Reads as older, humbler, less staged than a plinth: spoils left
  // behind rather than goods presented.
  ground: {
    base: (materials) => {
      const group = new THREE.Group();
      const slab = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.46, 0.10, 12), materials.dressed);
      slab.position.y = 0.05;
      slab.receiveShadow = true;
      group.add(slab);
      return { group, restY: 0.34 };
    },
    labelOffsetY: 0.30,
    previewY: 1.25,
  },
};

// ── Group bookkeeping ────────────────────────────────────────────────
// Offerings that belong to one choice must close together, but they aren't
// always spawned together: a trove stands its three stones up in one call, while
// the starter chamber's altars arrive as three INDEPENDENT props from the vault
// map. So membership is by `groupId`, not by call — spawn them however the
// placement wants, and any member taking closes its siblings.
const groups = new Map<string, Set<() => void>>();
/** How many of each group's allowance has been spent. */
const picksTaken = new Map<string, number>();

/** Drop all group bookkeeping (level teardown). Members self-deregister on
 *  destroy, so this is belt-and-braces against a stale floor's ids. */
export function resetOfferingGroups(): void {
  groups.clear();
  picksTaken.clear();
}

/** One thing on offer, and where it stands. */
export interface Offering {
  item: ItemSpec;
  affixes?: AffixInstance[];
  /** Where this offering's furniture sits (floor level). */
  pos: THREE.Vector3;
  rotY?: number;
  /** Price for THIS one — overrides the group price, so a group can mix free
   *  and costly goods side by side. */
  cost?: TransactionPrice;
}

/** Everything about an offering except WHICH thing and WHERE — shared by every
 *  member of a choice. */
export interface OfferingOpts {
  /** Id prefix — shows in debug overlays ('trove', 'starter', 'spoils'…). */
  kind?: string;
  scene: THREE.Object3D;
  materials: StyleMaterials;
  style?: OfferingStyle;
  /** Members sharing this id close together. spawnOfferingGroup assigns one
   *  automatically; pass your own when the offerings are placed separately
   *  (e.g. one per vault-map prop). */
  groupId?: string;
  /** Price applied when the offering doesn't state its own. */
  cost?: TransactionPrice;
  /** Emits transaction:accepted/resolved under this family when set. */
  family?: TransactionFamily;
  promptLabel?: string;
  /** How many of the group may be taken before the rest close. Default 1. */
  picks?: number;
  /** Default TRUE: each offering shows only its name + flavour until you LEAN IN
   *  (become the highlighted one), then its stats appear. With three or more
   *  cards up at once, full cards overlap into mush — and "identify at a glance,
   *  lean in for the contract" is the better read anyway: the lamp reveals detail.
   *  Set false for a small group meant to be compared stat-for-stat side by side
   *  (the starter weapons). */
  leanInForStats?: boolean;
  /** Override what taking does. Default routes the item the same way a floor
   *  pickup would (relics collect, gear equips, consumables bag). */
  onTake?: (item: ItemSpec, affixes: AffixInstance[], pos: THREE.Vector3) => void;
  /** Fired AFTER a take resolves, whatever route the item took. A side effect,
   *  not a replacement for acquisition (that's `onTake`) — used by the
   *  CONTESTED room modifier to spring the room's seal on the act of reaching. */
  onTaken?: (item: ItemSpec) => void;
  /** Per-offering cleanup (e.g. the caller removing a collision AABB). */
  onDestroy?: () => void;
}

export interface OfferingGroupSpec extends OfferingOpts {
  offerings: Offering[];
}

/** Default acquisition: exactly what taking the same item off the floor does, so
 *  an offering never behaves differently from a pickup of the same thing. */
function defaultTake(item: ItemSpec, affixes: AffixInstance[], scene: THREE.Object3D, pos: THREE.Vector3): void {
  if (item.kind === 'consumable' || item.kind === 'key') { addItem(item.id); return; }
  if (item.kind === 'relic') { addRelic(item, affixes); return; }
  groundEquip({
    item, affixes,
    onEquipped: () => {},
    // A swap at an offering sheds the old piece onto the stone beside it.
    dropDisplaced: (dItem, dAff) => dropGearPickup(scene, pos, dItem, dAff),
  });
}

/** Build the visual for one offering — a relic shows its painted 2.5D face, a
 *  weapon its viewmodel. Same rule a floor drop uses. */
function buildOfferingVisual(item: ItemSpec): { group: THREE.Group; billboard: boolean } {
  const billboard = item.kind === 'relic' && hasRelicArt(item.id);
  const built = billboard ? buildRelicBillboard(item) : buildModel(item.viewmodel ?? item.dropModel);
  return { group: built.group, billboard };
}

let autoGroupSeq = 0;

/**
 * Stand a set of offerings up in the world as one mutually-exclusive choice.
 * Taking one (or `picks` of them) closes the rest.
 */
export function spawnOfferingGroup(spec: OfferingGroupSpec): void {
  const groupId = spec.groupId ?? `offer-group-${autoGroupSeq++}`;
  for (const offering of spec.offerings) {
    spawnOffering(offering, { ...spec, groupId });
  }
}

/**
 * Stand ONE offering up. Give several the same `groupId` and they become a
 * single mutually-exclusive choice even though they were placed independently.
 */
export function spawnOffering(offering: Offering, opts: OfferingOpts): void {
  const spec = opts;
  const style = STYLES[spec.style ?? 'pedestal'];
  const kind = spec.kind ?? 'offering';
  const picksAllowed = spec.picks ?? 1;
  const groupId = spec.groupId ?? `offer-solo-${autoGroupSeq++}`;

  let siblings = groups.get(groupId);
  if (!siblings) { siblings = new Set(); groups.set(groupId, siblings); }

  {
    const pos = offering.pos.clone();
    const rotY = offering.rotY ?? 0;
    const cost = offering.cost ?? spec.cost;

    // ── The furniture. Its OWN scene root, so tearing down the offering never
    // takes the stone with it — the empty plinth is the point.
    const { group: baseGroup, restY } = style.base(spec.materials);
    baseGroup.position.copy(pos);
    baseGroup.rotation.y = rotY;
    spec.scene.add(baseGroup);

    // ── The offering itself. Separate root so a tap-target raycast resolves to
    // the GOODS rather than the stone under them.
    const { group: itemGroup, billboard } = buildOfferingVisual(offering.item);
    itemGroup.position.set(pos.x, pos.y + restY, pos.z);
    if (!billboard) itemGroup.rotation.set(0.20, rotY, 0.30);
    spec.scene.add(itemGroup);

    const id = generateEntityId(kind);
    // The room is the picker, so every option must be identifiable from where
    // the player stands — but full cards stacked side by side overlap. Name +
    // flavour always; stats when you lean in (see leanInForStats).
    const leanIn = spec.leanInForStats ?? true;
    registerItemPreview(id, offering.item, { hideStatsUntilInspect: leanIn });

    let phase = 0;
    let closed = false;

    const interactable: Interactable = {
      id,
      position: pos.clone(),
      radius: 1.5,
      labelOffsetY: style.labelOffsetY,
      promptLabel: spec.promptLabel ?? 'TAKE',
      cost,
      previewItem: offering.item,
      previewAffixes: offering.affixes,
      built: { group: itemGroup, parts: new Map(), slots: new Map(), materials: new Map(), hitTargets: [] },
      keepBuiltOnDestroy: true,
      destroyed: false,
      onUse() {
        if (closed) return;
        if (!canAfford(cost)) {
          showInWorldMessage(unaffordableMessage(cost!));
          playDenied();
          return;
        }
        if (spec.family) {
          emit({ type: 'transaction:accepted', family: spec.family, id, price: cost ?? {} });
        }
        payCost(cost);
        const affixes = [...(offering.affixes ?? [])];
        if (spec.onTake) spec.onTake(offering.item, affixes, pos);
        else defaultTake(offering.item, affixes, spec.scene, pos);
        spec.onTaken?.(offering.item);
        playEquipClick();
        emit({ type: 'item:picked-up', itemId: offering.item.id, worldPos: { x: pos.x, y: pos.y + restY, z: pos.z } });
        if (spec.family) {
          emit({ type: 'transaction:resolved', family: spec.family, id, outcome: { itemIds: [offering.item.id] } });
        }
        // Close this one always. Once the group's allowance is spent, every
        // remaining offering withdraws too — each stone left standing bare.
        close();
        const taken = (picksTaken.get(groupId) ?? 0) + 1;
        picksTaken.set(groupId, taken);
        if (taken >= picksAllowed) {
          for (const closeSibling of [...(groups.get(groupId) ?? [])]) closeSibling();
        }
      },
      tick(dt: number) {
        if (closed) return;
        phase += dt;
        // A billboard owns its own facing (it turns to the camera); everything
        // else rotates on its stone.
        if (!billboard) itemGroup.rotation.y = rotY + phase * SPIN;
        itemGroup.position.y = pos.y + restY + Math.sin(phase * BOB_FREQUENCY * Math.PI * 2) * BOB_AMPLITUDE;
        setItemPreviewAnchor(id, pos.x, pos.y + style.previewY, pos.z, true);
        // Reveal this one's stats while it's the offering you're actually
        // considering (in range + facing it) — the lean-in.
        if (leanIn) setItemPreviewInspected(id, getInRangeInteractable() === interactable);
      },
      onDestroy() {
        spec.scene.remove(itemGroup);
        disposeBuiltTree(itemGroup);
        unregisterItemPreview(id);
        // Leave the group. Level teardown destroys every live interactable, so
        // this is what keeps a FIXED group id (like the starter altars') from
        // carrying stale closers into the next floor — no cross-module reset
        // wiring required, and the bookkeeping can't outlive its members.
        siblings!.delete(close);
        if (siblings!.size === 0) { groups.delete(groupId); picksTaken.delete(groupId); }
        spec.onDestroy?.();
      },
    };

    /** Withdraw this offering: the goods go, the stone stays. */
    const close = () => {
      if (closed) return;
      closed = true;
      siblings!.delete(close);          // leave the group so it can't be re-closed
      interactable.destroyed = true;
      interactable.promptLabel = '';
    };
    siblings.add(close);

    registerInteractable(interactable);
  }
}
