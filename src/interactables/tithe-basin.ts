import * as THREE from 'three';
import { generateEntityId, get } from '../ecs/world';
import { registerInteractable } from './system';
import { registerLight } from '../scene/light-pool';
import { createSheet, menuButton } from '../ui/menu-shell';
import { getGold, spendGold } from '../state/run-state';
import { damagePlayer, getPlayerHp } from '../player/health';
import { getEquipped, setSlot } from '../player/equipment';
import { applyMutationWithFeedback } from '../player/apply-mutation';
import { TAINTED_MUTATIONS } from '../content/tainted-mutations';
import { applyBuff } from '../ecs/buffs';
import { rollLoot } from '../content/loot';
import { ITEMS, type ItemSpec } from '../content/items';
import { createPickup } from './pickup';
import { gameRng } from '../engine/rng';
import { showNote } from '../ui/note-card';
import { playRitualBell } from '../audio/sfx';
import { spawnBloodBurst } from '../effects/blood-burst';
import { emit } from '../broadcast/event-bus';
import { TRANSACTION_TINTS } from '../content/transactions';
import type { StyleMaterials } from '../style/materials';

// ── THE TITHE BASIN — the UNKNOWN family's altar ─────────────────────
//
// A dry stone basin under pale light. You place something of yours in
// it — blood, gold, or the weapon out of your own hand — and the
// dungeon decides what you were worth. The outcome is hidden until
// you've already paid: that's the family contract (transactions.ts),
// and the inverse of the blood altar (where the goods are visible and
// the price is the surprise of how much it hurts).
//
// The three tithes price three different things, and their outcome
// tables respect what was risked:
//
//   BLOOD — cheap, honest. The dungeon respects blood: usually a
//           boon-buff or a brand, sometimes nothing.
//   GOLD  — the coward's currency. Scorn-heavy; the basin has no use
//           for coin and the broadcast layer knows it. Occasionally
//           it pays anyway, to keep you guessing.
//   YOUR WEAPON — the hardcore bet. Place your equipped weapon in the
//           basin: it is GONE, fists-against-the-dark, unless the
//           dungeon answers. Usually it answers with a better blade;
//           sometimes a cursed one; sometimes with silence.
//
// One use. The basin keeps what it takes.

const GOLD_TITHE_BASE = 25;       // scaled up with depth
const BLOOD_TITHE_HP = 2;

type TitheKind = 'blood' | 'gold' | 'weapon';

interface Outcome {
  weight: number;
  apply(ctx: Ctx): import('../content/transactions').TransactionOutcome;
}

interface Ctx {
  scene: THREE.Object3D;
  pos: THREE.Vector3;
  depth: number;
}

function dropBeside(ctx: Ctx, item: ItemSpec): void {
  const a = gameRng() * Math.PI * 2;
  createPickup(ctx.scene, new THREE.Vector3(ctx.pos.x + Math.cos(a) * 0.55, 0.6, ctx.pos.z + Math.sin(a) * 0.55), item);
}

function scorn(note: string): Outcome['apply'] {
  return () => {
    showNote(note);
    return { scorned: true };
  };
}

function grantLoot(bias: number, note: string): Outcome['apply'] {
  return (ctx) => {
    const item = rollLoot({ depth: ctx.depth, bias }, gameRng) ?? ITEMS['healing-potion'];
    if (item) dropBeside(ctx, item);
    showNote(note);
    return { itemIds: item ? [item.id] : [] };
  };
}

function grantBoon(buffId: string, duration: number, note: string): Outcome['apply'] {
  return () => {
    const player = get('player');
    if (player) applyBuff(player, buffId, duration);
    showNote(note);
    return {};
  };
}

function grantBrand(): Outcome['apply'] {
  return () => {
    const m = TAINTED_MUTATIONS[Math.floor(gameRng() * TAINTED_MUTATIONS.length)];
    applyMutationWithFeedback(m.id);
    return { mutationId: m.id };
  };
}

/** Roll a weapon at least one rarity step up from the loot curve's
 *  mood — the basin honors a real sacrifice more often than not. */
function grantWeapon(bias: number, note: string): Outcome['apply'] {
  return (ctx) => {
    for (let i = 0; i < 12; i++) {
      const item = rollLoot({ depth: ctx.depth, bias }, gameRng);
      if (item && item.kind === 'weapon') {
        dropBeside(ctx, item);
        showNote(note);
        return { itemIds: [item.id] };
      }
    }
    // The pool refused to produce a weapon — the basin at least
    // returns a cursed-band consolation rather than pure silence.
    return grantLoot(3, note)(ctx);
  };
}

const TABLES: Record<TitheKind, Outcome[]> = {
  blood: [
    { weight: 4, apply: grantBoon('berserk', 30, 'The basin drinks. Your arms remember a stronger man.') },
    { weight: 3, apply: grantBrand() },
    { weight: 2, apply: grantLoot(2, 'Something surfaces that was not there before.') },
    { weight: 2, apply: scorn('The basin drinks. Nothing answers.') },
  ],
  gold: [
    { weight: 5, apply: scorn('The coins lie where they fell. The basin wants none of it.') },
    { weight: 2, apply: grantLoot(2, 'The coins are gone. Something else remains.') },
    { weight: 1, apply: grantLoot(4, 'The basin, for once, pays its debts.') },
  ],
  weapon: [
    { weight: 5, apply: grantWeapon(4, 'The basin keeps the blade. It returns another.') },
    { weight: 2, apply: grantWeapon(6, 'The dark weighs the gift, and is moved.') },
    { weight: 2, apply: scorn('The basin keeps the blade. That is all.') },
  ],
};

function rollOutcome(kind: TitheKind): Outcome {
  const table = TABLES[kind];
  const total = table.reduce((t, o) => t + o.weight, 0);
  let r = gameRng() * total;
  for (const o of table) {
    r -= o.weight;
    if (r <= 0) return o;
  }
  return table[table.length - 1];
}

export function spawnTitheBasin(
  scene: THREE.Object3D,
  pos: THREE.Vector3,
  depth: number,
  materials: StyleMaterials,
): void {
  const id = generateEntityId('tithe');
  const tint = TRANSACTION_TINTS.unknown;
  const ctx: Ctx = { scene, pos: pos.clone(), depth };
  let used = false;
  let offerSeen = false;

  // ── Geometry: a squat stone basin, dry, pale-lit. ──
  const group = new THREE.Group();
  group.position.copy(pos);
  const stone = materials.wall;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.42, 0.52, 10), stone);
  base.position.y = 0.26;
  base.castShadow = true; base.receiveShadow = true;
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.40, 0.22, 12), stone);
  bowl.position.y = 0.62;
  bowl.castShadow = true; bowl.receiveShadow = true;
  // The hollow — a dark disc; the pale glow rims it.
  const hollow = new THREE.Mesh(
    new THREE.CylinderGeometry(0.42, 0.42, 0.02, 12),
    new THREE.MeshStandardMaterial({ color: 0x06070a, roughness: 1 }),
  );
  hollow.position.y = 0.74;
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(0.44, 0.018, 8, 24),
    new THREE.MeshStandardMaterial({
      color: 0x10141c, roughness: 0.8,
      emissive: tint.accent, emissiveIntensity: 0.7,
    }),
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.74;
  group.add(base, bowl, hollow, rim);
  scene.add(group);

  // Pale light — UNKNOWN-family signal (uncommon light = something is here).
  // Pale light with a slow BREATH (not a flame flicker — the basin is
  // patient): ±8% over ~4s, so the room feels faintly alive.
  const breathSeed = gameRng() * Math.PI * 2;
  registerLight({
    id: `${id}-glow`, category: 'pickup',
    position: new THREE.Vector3(pos.x, pos.y + 1.3, pos.z),
    color: tint.light, intensity: 1.6, distance: 5.5, decay: 1.8,
    getIntensity: () => 1.6 * (1 + 0.08 * Math.sin(performance.now() / 1000 * 1.6 + breathSeed)),
  });

  function resolveTithe(kind: TitheKind, price: import('../content/transactions').TransactionPrice): void {
    used = true;
    emit({ type: 'transaction:accepted', family: 'unknown', id, price });
    playRitualBell();
    const outcome = rollOutcome(kind).apply(ctx);
    emit({ type: 'transaction:resolved', family: 'unknown', id, outcome });
    // The basin is spent — the pale rim dies.
    (rim.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.1;
    interactable.promptLabel = '';
  }

  function openTitheSheet(): void {
    const sheet = createSheet({ id: `tithe-${id}`, title: 'THE BASIN WAITS' });
    const note = document.createElement('div');
    Object.assign(note.style, {
      color: '#8a93a3', fontSize: '12px', fontStyle: 'italic',
      padding: '4px 2px 12px', lineHeight: '1.5',
    } as Partial<CSSStyleDeclaration>);
    note.textContent = 'Place something of yours in the hollow. What returns is not your decision.';
    sheet.body.appendChild(note);

    const goldPrice = Math.round((GOLD_TITHE_BASE * (1 + (depth - 1) * 0.10)) / 5) * 5;
    const weapon = getEquipped('weapon');

    const row = (label: string, sub: string, enabled: boolean, act: () => void) => {
      const btn = menuButton(label, () => { sheet.close(); act(); });
      btn.disabled = !enabled;
      if (!enabled) btn.style.opacity = '0.35';
      const subEl = document.createElement('div');
      Object.assign(subEl.style, { color: '#6b727c', fontSize: '11px', margin: '2px 0 10px 2px' } as Partial<CSSStyleDeclaration>);
      subEl.textContent = sub;
      sheet.body.append(btn, subEl);
    };

    row(`BLOOD · ${BLOOD_TITHE_HP} HP`, 'The dungeon respects blood.', getPlayerHp() > BLOOD_TITHE_HP, () => {
      spawnBloodBurst(scene, pos.x, pos.y + 0.9, pos.z);
      damagePlayer(BLOOD_TITHE_HP, null, 'physical', false, 'the hungry basin');
      resolveTithe('blood', { hp: BLOOD_TITHE_HP });
    });
    row(`GOLD · ${goldPrice}`, 'The basin has no use for coin. Probably.', getGold() >= goldPrice, () => {
      spendGold(goldPrice);
      resolveTithe('gold', { gold: goldPrice });
    });
    row(
      weapon ? `YOUR WEAPON · ${weapon.name}` : 'YOUR WEAPON',
      weapon ? 'It will be gone. Something may answer.' : 'Your hands are already empty.',
      !!weapon,
      () => {
        if (!weapon) return;
        setSlot('weapon', null);
        resolveTithe('weapon', { itemId: weapon.id });
      },
    );
    sheet.open();
  }

  const interactable: import('./types').Interactable = {
    id,
    position: pos.clone(),
    radius: 1.5,
    labelOffsetY: 1.1,
    promptLabel: 'TITHE',
    promptKind: 'unknown',   // pale — a gamble, the outcome hidden
    built: { group, parts: new Map(), slots: new Map(), materials: new Map(), hitTargets: [] },
    keepBuiltOnDestroy: true,
    onUse() {
      if (used) return;
      openTitheSheet();
    },
    tick(_dt: number, playerPos: THREE.Vector3) {
      if (used || offerSeen) return;
      const dx = playerPos.x - pos.x;
      const dz = playerPos.z - pos.z;
      if (dx * dx + dz * dz < 16) {
        offerSeen = true;
        emit({ type: 'transaction:offered', family: 'unknown', id });
      }
    },
    destroyed: false,
  };
  registerInteractable(interactable);
}
