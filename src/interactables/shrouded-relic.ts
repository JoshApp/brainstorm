import * as THREE from 'three';
import { buildModel } from '../ecs/build-model';
import { generateEntityId } from '../ecs/world';
import { registerInteractable } from './system';
import { tryAutoEquip } from '../player/equipment';
import { addItem, removeItem } from '../player/inventory';
import { rollItemInstance, instanceDisplayName } from '../player/item-instance';
import { showInWorldMessage } from '../ui/pickup-notification';
import { playEquipClick } from '../audio/sfx';
import { emit } from '../broadcast/event-bus';
import { registerLight, unregisterLight } from '../scene/light-pool';
import { rollCursedItem } from '../content/loot';
import { RARITY_COLORS } from '../content/items';
import { gameRng } from '../engine/rng';
import type { ModelSpec } from '../ecs/model-types';

// Shrouded relic — a findable risk/reward GAMBLE. A cloth-wrapped thing
// that floats just off the floor, washed in cursed-violet light so the
// player reads "this is cursed" from across the room (lighting-as-signal:
// violet = a gamble). But you do NOT see WHAT it is. Taking it commits
// you — only on the take does the dungeon reveal which curse you bought.
//
// The horror+dopamine fusion in one pickup: the glow promises power, the
// shroud hides the price. The actual item is a random cursed piece rolled
// at spawn (stats hidden until taken == rolled-and-concealed, which the
// player can't distinguish from rolled-on-grab).

const VIOLET = RARITY_COLORS.cursed;

// Veiled relic model — a dark wrapped bundle bound in cord, with a single
// violet glint bleeding through the wrappings (the cursed thing inside).
const SHROUDED_RELIC_MODEL: ModelSpec = {
  id: 'shrouded-relic',
  materials: {
    cloth: { color: 0x1a151f, roughness: 1.0, metalness: 0.0, flatShading: 'auto' },
    cord:  { color: 0x0c0a10, roughness: 1.0, metalness: 0.0 },
    glint: { color: 0x2a1230, emissive: VIOLET, emissiveIntensity: 1.4, roughness: 0.4, fog: false },
  },
  parts: [
    // Wrapped body — an ovoid bundle.
    { name: 'body', kind: 'sphere', pos: [0, 0, 0], radius: 0.12, segments: [12, 10], scale: [0.85, 1.25, 0.85], mat: 'cloth', jitter: 0.012 },
    // Binding cords — two thin bands cinching the cloth.
    { kind: 'cylinder', pos: [0,  0.03, 0], radius: 0.125, height: 0.02, segments: 12, mat: 'cord' },
    { kind: 'cylinder', pos: [0, -0.05, 0], radius: 0.115, height: 0.02, segments: 12, mat: 'cord' },
    // The glint — a small violet core peeking through a parting in the
    // wrappings near the top. The one thing the shroud can't fully hide.
    { kind: 'sphere', pos: [0, 0.085, 0.085], radius: 0.028, segments: [8, 8], mat: 'glint' },
  ],
};

const ROTATE_SPEED = 0.4;
const BOB_AMPLITUDE = 0.035;
const BOB_FREQUENCY = 1.2;
const REST_Y = 0.55;       // floats at chest height — a thing held up by nothing

/**
 * Spawn a shrouded relic at `pos`. Rolls a random cursed item eligible at
 * `depth` (hidden until taken). On use: grants + reveals it. `onDestroy`
 * is the owner cleanup (e.g. removing a collision entry), matching the
 * starter/blood altar convention.
 */
export function spawnShroudedRelic(
  scene: THREE.Object3D,
  pos: THREE.Vector3,
  depth: number,
  onDestroy?: () => void,
): void {
  // Roll the concealed prize now; the player can't tell spawn-roll from
  // grab-roll, and pre-rolling keeps the grant deterministic.
  const cursed = rollCursedItem(depth, gameRng);
  if (!cursed) return;   // no cursed item eligible — don't spawn an empty gamble

  const built = buildModel(SHROUDED_RELIC_MODEL);
  const group = built.group;
  group.position.copy(pos);
  group.position.y += REST_Y;
  scene.add(group);

  const id = generateEntityId('shrouded-relic');

  // Cursed-violet glow — the across-the-room signal. Borrowed from the
  // shared light pool (no shader recompile).
  const lightId = `shrouded-light-${id}`;
  const lightPos = new THREE.Vector3(pos.x, pos.y + REST_Y, pos.z);
  registerLight({
    id: lightId,
    category: 'pickup',
    position: lightPos,
    color: VIOLET,
    intensity: 3.0,
    distance: 3.2,
    decay: 1.5,
  });

  let phase = 0;
  let taken = false;

  const interactable: import('./types').Interactable = {
    id,
    position: pos.clone(),
    radius: 1.4,
    labelOffsetY: 0.9,
    promptLabel: 'TAKE',
    outlineScale: 1.3,
    built: { group, parts: new Map(), slots: new Map(), materials: new Map(), hitTargets: [] },
    onUse() {
      if (taken) return;
      taken = true;
      // Reveal + grant. The toast shows the real name — the moment the
      // shroud comes off and you learn what you bought.
      const inst = rollItemInstance(cursed);
      const displayName = instanceDisplayName(inst);
      addItem(cursed.id, displayName);
      if (tryAutoEquip(cursed, inst.affixes)) removeItem(cursed.id);
      showInWorldMessage('The shroud falls away.');
      playEquipClick();
      emit({ type: 'item:picked-up', itemId: cursed.id });
      interactable.promptLabel = '';
      interactable.destroyed = true;
    },
    tick(dt: number) {
      if (taken) return;
      phase += dt;
      group.rotation.y = phase * ROTATE_SPEED;
      const y = pos.y + REST_Y + Math.sin(phase * BOB_FREQUENCY * Math.PI * 2) * BOB_AMPLITUDE;
      group.position.y = y;
      lightPos.set(pos.x, y, pos.z);
    },
    destroyed: false,
    onDestroy() {
      unregisterLight(lightId);
      scene.remove(group);
      group.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) m.dispose();
        mesh.geometry.dispose();
      });
      onDestroy?.();
    },
  };
  registerInteractable(interactable);
}
