import * as THREE from 'three';
import { generateEntityId } from '../ecs/world';
import { buildModel } from '../ecs/build-model';
import { registerInteractable } from './system';
import { emit } from '../broadcast/event-bus';
import { whisper, dismissWhisper } from '../ui/whisper';
import { showNote } from '../ui/note-card';
import { makeRevealMaterial, isLampRevealed } from '../scene/lamp-reveal';
import { createPickup } from './pickup';
import { RARITY_COLORS, type ItemSpec } from '../content/items';
import type { FallenDelver } from '../content/corpses';
import { makeCorpseModel } from '../content/corpse-model';

// A fallen delver — someone who came down before you and failed here. Walking
// up reveals their epitaph (in-world, whispered, NO pause); if they died holding
// something, a lamp-reactive glint at the hand marks it and SEARCH takes it.
//
// Geometry is a parametric ModelSpec (content/corpse-model.ts) — hooded head,
// limbs, draped cloak, blood pool, dropped pack, fleshy/skeletal decay — so the
// bodies read as people, not capsules. Benchable: delve bench model-corpse-*.

const READ_DIST = 2.2;        // ambient epitaph whispers inside this (+ lamp gaze)
const LOOK_AWAY_GRACE = 1.4;  // s of not-looking before the ambient line fades

/** Compose the DEEP-read note (Tier 2) — name, the epitaph, and the longer
 *  `account` if one exists (the Phase-5 LLM seam). Parchment uses pre-wrap, so
 *  newlines lay it out. */
function deepNote(f: FallenDelver): string {
  const lines = [f.name, '', `“${f.epitaph}”`];
  if (f.account) lines.push('', f.account);
  return lines.join('\n');
}

// Where the loot glint sits — the model exposes a `loot_glint` slot at the
// hand worth searching, so the cue tracks the pose without a position table.
const GLINT_FALLBACK: [number, number, number] = [0.3, 0.12, 0.1];

export function spawnCorpse(
  parent: THREE.Object3D,
  pos: THREE.Vector3,
  rotY: number,
  fallen: FallenDelver,
  loot: ItemSpec | null,
) {
  const built = buildModel(makeCorpseModel(fallen.pose, fallen.decay ?? 'fleshy', !!loot));
  built.group.position.copy(pos);
  built.group.rotation.y = rotY;
  parent.add(built.group);

  // If they died holding something: a lamp-reactive glint at the hand, tinted by
  // the loot's rarity. It blooms only when your lamp falls across the body — the
  // signal that this one is worth searching. Removed once looted.
  let glint: THREE.Mesh | null = null;
  if (loot) {
    const glintMat = makeRevealMaterial({
      texture: 'fire-wisp',
      color: RARITY_COLORS[loot.rarity ?? 'mundane'],
      size: [0.22, 0.22],
      intensity: 0.95,
    });
    glint = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), glintMat);
    const glintSlot = built.slots.get('loot_glint');
    if (glintSlot) glint.position.copy(glintSlot.position);
    else glint.position.set(...GLINT_FALLBACK);
    glint.rotation.x = -Math.PI / 2.6;
    glint.renderOrder = 2;
    built.group.add(glint);
  }

  let epitaphSpoken = false;
  let looted = false;
  let shown = false;          // ambient epitaph line currently up
  let awayTimer = 0;          // s spent not-looking while it's up (grace)
  // One speaker token for THIS body — its epitaph + reaction sequence behind
  // each other (same source) instead of the reaction preempting the epitaph,
  // while a different body / rune you look at still overrides this one.
  const speaker = Symbol('corpse');

  // Log the discovery ONCE (lore + event log — the Phase 4/5 trace seam),
  // whether it first surfaced ambiently or on a deliberate read.
  function logEpitaphOnce() {
    if (epitaphSpoken) return;
    epitaphSpoken = true;
    emit({ type: 'note:read', noteBody: `${fallen.name}: ${fallen.epitaph}` });
  }

  const interactable = {
    id: generateEntityId('corpse'),
    position: pos.clone(),
    radius: 1.4,
    promptLabel: loot ? 'SEARCH' : 'READ',
    // TIER 1 — AMBIENT: the short epitaph whispers as your lamp finds the body,
    // no press, no pause (cheap/cached for the LLM layer). Fades fast on a
    // sustained look-away; re-shows on a re-look. Same model as wall-runes.
    tick(dt: number, playerPos: THREE.Vector3) {
      const d = Math.hypot(playerPos.x - pos.x, playerPos.z - pos.z);
      const lookingAt = d < READ_DIST && isLampRevealed(pos);
      if (lookingAt && !shown) {
        shown = true; awayTimer = 0;
        whisper(fallen.epitaph, speaker);
        logEpitaphOnce();
      } else if (shown && !lookingAt) {
        awayTimer += dt;
        if (awayTimer >= LOOK_AWAY_GRACE) { shown = false; dismissWhisper(speaker); }
      } else if (shown) {
        awayTimer = 0;
      }
    },
    onUse() {
      // TIER 2 — DEEP READ: stop and read the full account on the parchment
      // (pauses). The deliberate, opt-in moment — the home for the rich
      // Phase-5 LLM-authored `account`.
      showNote(deepNote(fallen));
      logEpitaphOnce();

      if (loot && !looted) {
        looted = true;
        // Drop what they carried OUT IN FRONT of the body (the corpse faces +X
        // local; offset along its facing) so the pickup lands clear on the floor
        // instead of buried inside the robe. Through the normal pickup path
        // (same as a chest), then pull the glint — nothing left to find.
        const worldPos = new THREE.Vector3();
        built.group.getWorldPosition(worldPos);
        const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(built.group.quaternion);
        worldPos.addScaledVector(fwd, 0.55);   // out past the hands/lap
        worldPos.y += 0.14;
        createPickup(parent, worldPos, loot);
        if (glint) {
          built.group.remove(glint);
          glint.geometry.dispose();
          (glint.material as THREE.Material).dispose();
          glint = null;
        }
        interactable.promptLabel = 'READ';   // still here to re-read, nothing to take
        // The thing that watches has a word for the ones who carried gear they
        // couldn't keep — whispered as you loot. NOTE: this is the dungeon's WIT,
        // a different temperature than the in-world epitaph/account; when the
        // Phase-5 voice-in-the-deep gets its own surface, move reactions onto it.
        if (fallen.reaction) whisper(fallen.reaction, speaker);
      }
    },
    built,
  };
  registerInteractable(interactable);
}
