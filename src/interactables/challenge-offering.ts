import * as THREE from 'three';
import { generateEntityId } from '../ecs/world';
import { registerInteractable } from './system';
import type { StyleMaterials } from '../style/materials';
import { activateEncounter, onEncounterActivated, onEncounterComplete } from '../encounters/registry';
import { emit } from '../broadcast/event-bus';
import { arenaEncounterId } from '../level/arena-waves';
import { createPickup } from './pickup';
import { buildModel } from '../ecs/build-model';
import { rollLoot } from '../content/loot';
import { rollDropItem } from '../content/drop-tables';
import { ITEMS, type ItemSpec } from '../content/items';
import { gameRng } from '../engine/rng';
import { showInWorldMessage } from '../ui/pickup-notification';
import { playImpact, playRitualBell } from '../audio/sfx';
import { kickShake } from '../combat/screen-shake';
import { registerLight, unregisterLight } from '../scene/light-pool';
import { setRoomMood } from '../level/room-mood';
import { disposeBuiltTree } from '../style/material-registry';

// Challenge offering — the VOLUNTARY arena, framed as a RITUAL ALTAR.
// A dark stone altar with two unlit candles sits in the centre. Approach
// it, accept the trial, and it ACTIVATES the room's wave encounter: the
// candles ignite blood-red, the carved sigils glow, the gate slams (a
// reactor on the encounter — see door.ts), and the waves come. Survive
// them and the altar settles + drops the hoard. The reward is the whole
// point — you choose to start the ritual.
//
// Pure reactor wiring on the Encounter layer: onUse = TRIGGER (activate),
// loot + altar settle = REACTOR (on complete). The offering knows nothing
// about waves or the gate.

const SEAM_DARK   = 0x2a0a08;  // before ritual: a dim banked ember
const SEAM_ACTIVE = 0xff2410;  // during ritual: hot blood-red
const SEAM_WON    = 0xffc060;  // after ritual: warm amber, the trial held
const CANDLE_DARK   = 0x3a2820;  // before: an old waxen stub, cold
const CANDLE_ACTIVE = 0xff4818;  // during: ritual flame red-orange
const CANDLE_WON    = 0xffc070;  // after: a normal warm candle
const PRIZE_FLOAT_Y = 0.72;      // reward hover height — just above the slab (sigil ≈0.49), not head-high

export function spawnChallengeOffering(
  scene: THREE.Object3D,
  pos: THREE.Vector3,
  roomId: string,
  depth: number,
  materials: StyleMaterials,
): void {
  const encId = arenaEncounterId(roomId);

  const group = new THREE.Group();
  group.position.copy(pos);
  scene.add(group);

  // RITUAL ALTAR — a low dark slab on a wider plinth, scored across the top
  // with sigil grooves. Two candle stubs at the corners. A circle of fainter
  // glyphs ringed into the floor around it. Inert until the player chooses
  // to start the trial.
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.18, 0.74), materials.wall);
  plinth.position.y = 0.09;
  plinth.castShadow = true;
  group.add(plinth);

  const slab = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.30, 0.58), materials.wall);
  slab.position.y = 0.33;
  slab.castShadow = true;
  group.add(slab);

  // Carved sigil glow on top of the slab. The colour flips on ritual start.
  const sigilMat = new THREE.MeshBasicMaterial({
    color: SEAM_DARK, transparent: true, opacity: 0.40, fog: false,
  });
  const sigil = new THREE.Mesh(new THREE.PlaneGeometry(0.68, 0.46), sigilMat);
  sigil.rotation.x = -Math.PI / 2;
  sigil.position.y = 0.49;
  group.add(sigil);

  // Two candles on the slab corners. The waxMat goes from cold/banked → hot
  // red → warm white as the ritual progresses; the wick is a tiny additive
  // sphere that grows on activation (the candles IGNITE) and is hidden in the
  // inert state.
  function buildCandle(localX: number, localZ: number): { wax: THREE.Mesh; flame: THREE.Mesh; flameMat: THREE.MeshBasicMaterial; waxMat: THREE.MeshStandardMaterial } {
    const waxMat = new THREE.MeshStandardMaterial({
      color: 0xc8a060, roughness: 0.92, metalness: 0,
      emissive: CANDLE_DARK, emissiveIntensity: 0.5,
    });
    const wax = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.045, 0.18, 8), waxMat);
    wax.position.set(localX, 0.55, localZ);
    wax.castShadow = true;
    group.add(wax);

    const flameMat = new THREE.MeshBasicMaterial({
      color: CANDLE_ACTIVE, transparent: true, opacity: 0, fog: false,
    });
    const flame = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), flameMat);
    flame.position.set(localX, 0.66, localZ);
    flame.scale.setScalar(0);
    group.add(flame);
    return { wax, flame, flameMat, waxMat };
  }
  const candleL = buildCandle(-0.30, -0.20);
  const candleR = buildCandle( 0.30, -0.20);
  const candles = [candleL, candleR];

  // Ritual circle on the floor — a wide ring of faint glow ringed around the
  // altar. Same hue as the sigil so the whole altar reads as one mood.
  const circleMat = new THREE.MeshBasicMaterial({
    color: SEAM_DARK, transparent: true, opacity: 0.16, fog: false,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const circle = new THREE.Mesh(new THREE.RingGeometry(0.95, 1.18, 32), circleMat);
  circle.rotation.x = -Math.PI / 2;
  circle.position.y = 0.04;
  circle.renderOrder = 1;
  group.add(circle);

  // Light source — DIM and cold-tinted at rest (a banked ember), SURGES to
  // intense blood-red when the ritual starts, settles to warm amber on win.
  const lightId = generateEntityId('challenge-light');
  const lightTint = { value: SEAM_DARK };
  let lightIntensity = 1.2;
  registerLight({
    id: lightId, category: 'pickup',
    // pos is ground-aware (builder passes groundYAt); +0.6 above it, not
    // world 0.6 — else the ember floats over a sunken arena's floor.
    position: new THREE.Vector3(pos.x, pos.y + 0.6, pos.z),
    color: SEAM_DARK,
    intensity: 1.2, distance: 3.4, decay: 1.6,
    getIntensity: () => lightIntensity,
    getColor: (out) => { out.setHex(lightTint.value); },
  });

  const id = generateEntityId('challenge-offering');
  let accepted = false;
  let claimed = false;
  let phase = 0;
  // Finish-flare timer. -1 = idle; set to 0 on the trial's completion to bloom
  // the altar light + sigils for FLARE_DUR_S, easing into the warm 'won' hold.
  let flareT = -1;
  const FLARE_DUR_S = 0.8;

  // Apply a ritual STATE: dark / active / won. Sets sigil + circle + candle
  // wax tints and the light colour to match. Smooth visual transitions handled
  // by the tick (which blends).
  function applyRitualState(state: 'dark' | 'active' | 'won') {
    if (state === 'dark') {
      sigilMat.color.setHex(SEAM_DARK);
      circleMat.color.setHex(SEAM_DARK);
      lightTint.value = SEAM_DARK;
      for (const c of candles) {
        c.waxMat.emissive.setHex(CANDLE_DARK);
        c.flameMat.color.setHex(CANDLE_ACTIVE);
      }
    } else if (state === 'active') {
      sigilMat.color.setHex(SEAM_ACTIVE);
      circleMat.color.setHex(SEAM_ACTIVE);
      lightTint.value = SEAM_ACTIVE;
      for (const c of candles) {
        c.waxMat.emissive.setHex(CANDLE_ACTIVE);
        c.flameMat.color.setHex(CANDLE_ACTIVE);
      }
    } else {
      sigilMat.color.setHex(SEAM_WON);
      circleMat.color.setHex(SEAM_WON);
      lightTint.value = SEAM_WON;
      for (const c of candles) {
        c.waxMat.emissive.setHex(CANDLE_WON);
        c.flameMat.color.setHex(CANDLE_WON);
      }
    }
  }
  applyRitualState('dark');

  // ── SHOW-AND-TELL: pre-roll the hoard at SPAWN and float the prize
  // above the altar — a TRIAL is a LEGIBLE deal (you see what you
  // fight for; the price is the fight). Same rolls the completion
  // reactor used to make; now they're made up front and granted
  // verbatim when the trial is won.
  // A trial is PAID for with the fight, so its hoard has a rarity FLOOR — it
  // can never resolve to a healpot or bone-and-rust the way a generous bias
  // alone would. The floor rises out of the early floors: uncommon on 1-2,
  // rare from floor 3 on. Bias still sets the ceiling (a chance at fabled).
  const drops: ItemSpec[] = [];
  {
    // Main reward from the 'challenge' pool (gear, depth-scaled rarity floor);
    // a bonus second item stays a general roll.
    const a = rollDropItem('challenge', depth, gameRng) ?? ITEMS['flask-draught'];
    if (a) drops.push(a);
    const b = rollLoot({ depth, bias: 3, minRarity: 'uncommon' }, gameRng);
    if (b) drops.push(b);
  }
  const prize = drops[0] ?? null;
  let prizeGroup: THREE.Group | null = null;
  if (prize?.dropModel) {
    const built = buildModel(prize.dropModel);
    prizeGroup = built.group;
    // Float just above the (low) slab — sigil sits at ~0.49, so PRIZE_FLOAT_Y
    // keeps the reward hovering over the stone, not up at head height. (Was 1.0,
    // which floated it in the air well above this short altar.)
    prizeGroup.position.set(pos.x, pos.y + PRIZE_FLOAT_Y, pos.z);
    scene.add(prizeGroup);
  }
  let prizePhase = 0;

  const interactable: import('./types').Interactable = {
    id,
    position: pos.clone(),
    radius: 1.6,
    labelOffsetY: 1.0,
    promptLabel: 'begin the ritual',
    promptKind: 'trial',   // blood-red — a blood trial
    built: { group, parts: new Map(), slots: new Map(), materials: new Map(), hitTargets: [] },
    onUse() {
      if (accepted) return;
      accepted = true;
      interactable.promptLabel = '';
      // TRIGGER: activate the room's wave encounter → the gate seals (reactor)
      // and the waves begin. Now you have to earn it. The reactor on the same
      // event lights the candles (see below) so the ignition lines up with the
      // gate slam.
      // Unified transaction stream: the TRIAL family — the price is
      // the fight itself (content/transactions.ts).
      emit({ type: 'transaction:accepted', family: 'trial', id: encId, price: { danger: true } });
      activateEncounter(encId);
      showInWorldMessage('The candles take. The waves are called.');
      playRitualBell({ x: pos.x, y: pos.y + 0.6, z: pos.z });
      kickShake(0.10, 0.22);
    },
    tick(dt: number) {
      if (prizeGroup) {
        prizePhase += dt;
        prizeGroup.rotation.y = prizePhase * 0.6;
        prizeGroup.position.y = pos.y + PRIZE_FLOAT_Y + Math.sin(prizePhase * 1.4 * Math.PI * 2) * 0.03;
      }
      phase += dt;
      // Sigil + circle breathe — slow + dim while inert, faster + brighter
      // mid-trial, hot + steady once won.
      const rate = claimed ? 1.8 : accepted ? 3.4 : 0.9;
      const lo = claimed ? 0.55 : accepted ? 0.40 : 0.18;
      const hi = claimed ? 0.25 : accepted ? 0.45 : 0.22;
      const breath = 0.5 + 0.5 * Math.sin(phase * rate);
      sigilMat.opacity = lo + hi * breath;
      circleMat.opacity = (lo * 0.55) + (hi * 0.4) * breath;
      // Light intensity follows the ritual state, with a similar breath layer.
      const baseI = claimed ? 2.0 : accepted ? 3.4 : 1.2;
      lightIntensity = baseI * (0.85 + 0.30 * breath);
      // Candle flames flicker (after they've been lit). The flame mesh is
      // size 0 in the inert state so this is a no-op then.
      for (const c of candles) {
        const flicker = 0.92 + 0.18 * Math.sin(phase * 11 + c.flame.position.x * 7);
        if (accepted) c.flame.scale.setScalar(1 + 0.08 * (Math.random() - 0.5));
        c.flameMat.opacity = (accepted ? 0.92 : 0) * flicker;
      }
      // FINISH FLARE — a transient bloom on top of the 'won' hold the instant
      // the trial completes: the altar light surges and the sigils flash white-
      // hot, then ease out. Fires off the same encounter:complete as the room-
      // torch flare (arena-light-arc), so the altar and the whole room punch
      // bright together — one triumph, then both settle.
      if (flareT >= 0) {
        flareT += dt;
        const f = Math.max(0, 1 - flareT / FLARE_DUR_S);
        const env = f * f;   // ease-out bloom
        lightIntensity += 6.0 * env;
        sigilMat.opacity = Math.min(1, sigilMat.opacity + 0.6 * env);
        circleMat.opacity = Math.min(1, circleMat.opacity + 0.45 * env);
        if (flareT >= FLARE_DUR_S) flareT = -1;
      }
    },
    destroyed: false,
    onDestroy() {
      unregisterLight(lightId);
      scene.remove(group);
      disposeBuiltTree(group);
      unsubscribe();
    },
  };
  registerInteractable(interactable);

  // REACTOR 1: the ritual STARTS — ignite the candles. The activation also
  // seals the gate via its own reactor on door.ts, so the visuals + the
  // gameplay seal happen on the same beat.
  const unsubActivated = onEncounterActivated(encId, () => {
    applyRitualState('active');
    for (const c of candles) {
      c.flame.scale.setScalar(1);
      c.flameMat.opacity = 0.92;
    }
    // Tint the WHOLE arena room blood-red. Per-room mood override eases in
    // over ~1.5s — first the candles take, then the room's torches drift
    // toward the ritual hue. The room's own torches keep their flicker; the
    // mood blender mutates their colour each frame, not their behaviour.
    setRoomMood(roomId, SEAM_ACTIVE, 1.5);
  });

  // REACTOR 2: the trial is WON → settle the altar to a warm hold + yield the
  // hoard. A generous bias (boss-chest tier) so the gamble pays out; always at
  // least a heal so committing is never a total loss.
  const unsubComplete = onEncounterComplete(encId, () => {
    if (claimed) return;
    claimed = true;
    applyRitualState('won');
    // Drop the room mood back to its baked palette — the dungeon's normal
    // warmth returns as the dark releases.
    setRoomMood(roomId, null, 2.0);
    // The finish beat — a bloom of the altar (flareT) under a resolving bell
    // that bookends the start toll, a thud, and a kick. The room torches flare
    // on this same event (arena-light-arc), so the whole arena punches bright.
    flareT = 0;
    playRitualBell(interactable.position);
    playImpact(interactable.position);
    kickShake(0.12, 0.28);
    showInWorldMessage('The dark was fed. The altar holds.');
    // The hoard was pre-rolled + DISPLAYED at spawn — the floating
    // prize comes down off its pedestal and lands as pickups.
    if (prizeGroup) {
      scene.remove(prizeGroup);
      disposeBuiltTree(prizeGroup);
      prizeGroup = null;
    }
    emit({
      type: 'transaction:resolved', family: 'trial', id: encId,
      outcome: { itemIds: drops.map((d) => d.id) },
    });
    let i = 0;
    for (const item of drops) {
      if (!item) continue;
      const a = (i / Math.max(1, drops.length)) * Math.PI * 2;
      const dropPos = new THREE.Vector3(pos.x + Math.cos(a) * 0.5, 0.6, pos.z + Math.sin(a) * 0.5);
      createPickup(scene, dropPos, item);
      i++;
    }
  });

  const unsubscribe = () => { unsubActivated(); unsubComplete(); };
}
