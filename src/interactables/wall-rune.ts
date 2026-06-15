import * as THREE from 'three';
import { generateEntityId } from '../ecs/world';
import { registerInteractable } from './system';
import { makeRevealMaterial, isLampRevealed } from '../scene/lamp-reveal';
import { whisper } from '../ui/whisper';
import { emit } from '../broadcast/event-bus';
import type { WallMark } from '../content/wall-marks';
import { RUNE_TINT } from '../content/wall-marks';

// A wall-rune: a glyph scratched into the stone that is near-invisible until the
// player's lamp falls across it (it blooms via the additive lamp-reveal
// material), and whose message whispers up — in-world, no pause — when you come
// close enough to read it. The lamp is the instrument of discovery; the rune is
// a trace someone left. NOT a USE target (empty promptLabel) — purely a thing
// you find by looking.

const RUNE_W = 0.95;
const RUNE_H = 0.62;
const READ_DIST = 2.4;        // whisper fires inside this XZ distance
const REARM_DIST = 3.4;       // ...and re-arms once you've stepped back past this

export function spawnWallRune(
  parent: THREE.Object3D,
  pos: THREE.Vector3,     // a point ON the wall surface (already nudged inward)
  yaw: number,            // face into the room (same convention as wall torches)
  mark: WallMark,
): void {
  const mat = makeRevealMaterial({
    texture: mark.glyph ?? 'rune-scrawl',
    color: mark.tint ?? RUNE_TINT.bone,
    size: [RUNE_W, RUNE_H],
    intensity: 1.15,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(RUNE_W, RUNE_H), mat);
  mesh.position.copy(pos);
  mesh.rotation.y = yaw;
  mesh.renderOrder = 2;       // draw after walls so the additive glow reads
  parent.add(mesh);

  let whispered = false;

  registerInteractable({
    id: generateEntityId('wall-rune'),
    position: pos.clone(),
    radius: READ_DIST,
    // Not a USE target — runes are read by approaching, not by pressing a
    // button. Empty label keeps it out of the prompt + USE selection.
    promptLabel: '',
    onUse() {},
    tick(_dt, playerPos) {
      const d = Math.hypot(playerPos.x - pos.x, playerPos.z - pos.z);
      // The message surfaces only when you've actually LOOKED at the rune (lamp
      // gaze cone fell across it), not merely walked near — reading is the
      // reward for scanning the wall.
      if (!whispered && d < READ_DIST && isLampRevealed(pos)) {
        whispered = true;
        whisper(mark.text);
        // Count as a discovery: +1 LORE, dedup, and into the event log (the
        // Phase 4/5 epitaph/trace seam) — same path corpse notes use.
        emit({ type: 'note:read', noteBody: mark.text });
      } else if (whispered && d > REARM_DIST) {
        whispered = false;     // walked away — let it speak again next time
      }
    },
  });
}
