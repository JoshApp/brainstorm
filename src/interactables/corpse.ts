import * as THREE from 'three';
import { generateEntityId } from '../ecs/world';
import { buildModel } from '../ecs/build-model';
import { mergeRigidViewmodel } from '../player/viewmodel-merge';
import { registerInteractable } from './system';
import { emit } from '../broadcast/event-bus';
import { whisper, dismissWhisper } from '../ui/whisper';
import { showNote } from '../ui/note-card';
import { makeRevealMaterial, isLampRevealed } from '../scene/lamp-reveal';
import { markAsSignal } from '../scene/signal-layer';
import { registerLight } from '../scene/light-pool';
import { getTexture } from '../style/procedural-textures';
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
  // The pose is baked into the spec — a corpse never re-articulates. Collapse
  // its ~40+ bone meshes (each hand alone is 16 finger segments — the
  // `handL_f`/`handR_f` swarm in the 2026-07-04 phone recordings) into a few
  // merged meshes per material. Slots survive (the loot glint mounts on
  // `loot_glint` below); the textured blood-pool decal stays loose.
  mergeRigidViewmodel(built.group, null, 'corpse-merged');
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
    // SIGNAL — the same argument as the wall rune. A glint is how a fallen delver is found
    // at all, and it is gated by the lamp already; the veil should not get a second vote.
    markAsSignal(glint);
    const glintSlot = built.slots.get('loot_glint');
    if (glintSlot) glint.position.copy(glintSlot.position);
    else glint.position.set(...GLINT_FALLBACK);
    glint.rotation.x = -Math.PI / 2.6;
    // NO explicit renderOrder — markAsSignal above sets SIGNAL_ORDER, which already sorts
    // it over the corpse AND puts it after the veil. Setting 2 here overwrote that and put
    // the glint back UNDER the veil, which is the one place it needs to be seen from.
    built.group.add(glint);
  }

  // SOUL-GLOW (#70) — a fallen delver is a RARE, notable find now, so it earns a
  // faint COLD light: a low, slow-pulsing blue that reads "something is here" from
  // across the dark (lighting doctrine) AND lifts the body's brown silhouette off
  // the stone. Plus a small soul-mote drifting above it. Cleared with the level.
  const SOUL_COLOR = 0x7aa0d8;
  registerLight({
    id: generateEntityId('corpse-soul'), category: 'pickup', priority: 'low',
    position: new THREE.Vector3(pos.x, pos.y + 0.5, pos.z),
    color: SOUL_COLOR, intensity: 0.85, distance: 3.2, decay: 1.7,
    getIntensity: () => { const t = performance.now() / 1000; return 0.85 * (0.75 + 0.25 * Math.sin(t * 1.6)); },
  });
  {
    const moteMat = new THREE.SpriteMaterial({
      map: getTexture('fire-wisp'), color: SOUL_COLOR, transparent: true,
      opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, fog: true,
    });
    const mote = new THREE.Sprite(moteMat);
    mote.scale.set(0.3, 0.3, 0.3);
    mote.position.set(pos.x, pos.y + 0.75, pos.z);
    mote.onBeforeRender = () => {
      const t = performance.now() / 1000;
      mote.position.y = pos.y + 0.72 + Math.sin(t * 0.9) * 0.08;
      moteMat.opacity = 0.35 + 0.2 * (0.5 + 0.5 * Math.sin(t * 1.6));
    };
    parent.add(mote);
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
          // No dispose mid-play (WebGPU): a frame in flight may still reference
          // the buffers, and disposing the last reveal material would release
          // its pipeline (the next floor's corpses recompile it). GC reclaims
          // the mesh once it leaves the scene.
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
