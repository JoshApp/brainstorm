import * as THREE from 'three';
import { generateEntityId } from '../ecs/world';
import { registerInteractable } from './system';
import { makeRevealMaterial, isLampRevealed } from '../scene/lamp-reveal';
import { markAsSignal } from '../scene/signal-layer';
import { whisper, dismissWhisper } from '../ui/whisper';
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
const READ_DIST = 2.4;        // whisper fires inside this XZ distance (+ lamp gaze)
const RUNE_INTENSITY = 1.15;  // dialed back from a neon 1.5 — a carved glow, not a sign
const PULSE_AMP = 0.14;       // ± fraction of intensity the arcane breathe swings (subtler)
const PULSE_RATE = 1.6;       // rad/s of the breathe
const RUNE_VARIANTS = 8;      // procedural rune-alphabet variants (procedural-textures.ts)
const LOOK_AWAY_GRACE = 1.4;  // s of NOT looking before the line fades — a glance
                              //   away doesn't snap it; a deliberate turn does

export function spawnWallRune(
  parent: THREE.Object3D,
  pos: THREE.Vector3,     // a point ON the wall surface (already nudged inward)
  yaw: number,            // face into the room (same convention as wall torches)
  mark: WallMark,
): void {
  // Randomize the glyph string per rune so a wall of them doesn't repeat: pick
  // one of the carved rune-alphabet variants by position (deterministic per
  // spot). A mark can still force a specific glyph (e.g. the 'rune-sigil' ward).
  const variant = Math.abs(Math.round(pos.x * 13.7 + pos.z * 28.3)) % RUNE_VARIANTS;
  const mat = makeRevealMaterial({
    texture: mark.glyph ?? `rune-row-${variant}`,
    color: mark.tint ?? RUNE_TINT.bone,
    size: [RUNE_W, RUNE_H],
    intensity: RUNE_INTENSITY,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(RUNE_W, RUNE_H), mat);
  // SIGNAL. A glyph is the dungeon telling you where to look, so a veiled doorway must not
  // swallow it. This changes nothing at range: the reveal material's own alpha is driven by
  // lamp proximity and cone, so a rune two rooms away is still dark — it only stops the
  // veil eating one you are close enough to read. See scene/signal-layer.ts.
  markAsSignal(mesh);
  mesh.position.copy(pos);
  mesh.rotation.y = yaw;
  // NO explicit renderOrder — markAsSignal above sets SIGNAL_ORDER, which already draws it
  // after the walls AND after the veil. Setting 2 here put it back under the veil, which is
  // the one place a glyph most needs to be readable from.
  parent.add(mesh);

  // The rune BREATHES — a slow, faint arcane pulse on its glow so it reads as
  // live scrawl, not a static decal. Modulates the reveal-intensity uniform the
  // material exposed; the pulse is subtle (the lamp gaze still does the heavy
  // reveal). Phase-offset per rune so a wall of them doesn't throb in unison.
  const pulseUniform = (mat.userData.uRevealIntensity as { value: number } | undefined);
  const pulsePhase = (pos.x * 1.7 + pos.z * 2.3) % (Math.PI * 2);
  let age = 0;

  let showing = false;        // OUR line is currently up
  let discovered = false;     // the note:read discovery has been logged (once ever)
  let awayTimer = 0;          // s spent NOT looking while a line is up (grace)
  const token = Symbol('rune');   // owner tag so look-away only dismisses OUR line

  registerInteractable({
    id: generateEntityId('wall-rune'),
    position: pos.clone(),
    radius: READ_DIST,
    // Not a USE target — runes are read by approaching, not by pressing a
    // button. Empty label keeps it out of the prompt + USE selection.
    promptLabel: '',
    onUse() {},
    tick(dt, playerPos) {
      // Arcane breathe — modulate the glow so the rune feels live.
      if (pulseUniform) {
        age += dt;
        pulseUniform.value = RUNE_INTENSITY * (1 + PULSE_AMP * Math.sin(age * PULSE_RATE + pulsePhase));
      }
      const d = Math.hypot(playerPos.x - pos.x, playerPos.z - pos.z);
      // "Looking at it" = close enough AND the lamp gaze cone is on it. Reading
      // is the reward for scanning the wall, not just walking near.
      const lookingAt = d < READ_DIST && isLampRevealed(pos);
      if (lookingAt && !showing) {
        showing = true;
        awayTimer = 0;
        whisper(mark.text, token);
        // Count the discovery ONCE (+1 LORE, event log — the Phase 4/5
        // epitaph/trace seam), even though the line can re-show on a re-look.
        if (!discovered) { discovered = true; emit({ type: 'note:read', noteBody: mark.text }); }
      } else if (showing) {
        if (lookingAt) {
          awayTimer = 0;       // still looking — hold the line
        } else {
          // Look away — but GRACE it: a glance away (or the gaze cone wobbling at
          // the edge) shouldn't snap the line. Only after a sustained turn-away
          // does it fade. Re-shows if you look back. Owner-gated dismiss never
          // kills another rune's line.
          awayTimer += dt;
          if (awayTimer >= LOOK_AWAY_GRACE) {
            showing = false;
            dismissWhisper(token);
          }
        }
      }
    },
  });
}
