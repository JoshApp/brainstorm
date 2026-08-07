import type { LevelSpec, PropSpec } from './types';
import { planPortals } from './portals';
import { chooseFrameModel } from './frame';
import { archwayColumnOffset, archwayPassableHalfBand } from '../content/archway';
import { doorframeCollision, doorframePassableHalfBand } from '../content/doorframe';
import { WALL_T } from './poly-room-shell';

// ── FRAMES FOR POLYGON DOORWAYS ──────────────────────────────────────────────
//
// Josh, walking a polygon floor: *"the doorframe building… and the eye
// navigation system is gone."*
//
// Both, and it is one gap. The archway EYE (scene/archway-eye.ts — the dungeon's
// own eye set in the keystone, which opens toward unexplored ground and tracks
// you across the room) is mounted on the FRAME model. Frames were emitted by
// `emitArchwaysForCorridors`, which lives in the clutter pass and only ever runs
// on the vault path. Measured: 930 archways and 436 doorframes across 120 vault
// floors, and ZERO across 120 polygon floors. No frame, no eye, no threshold
// draft.
//
// It could not simply be called, either. That emitter finds openings from RECT
// edges and can only place a frame on one of four axis-aligned sides — and a
// polygon's wall is a polygon edge, frequently chamfered. A frame mounted square
// to the world in a wall that runs at 45° is worse than no frame.
//
// So this is the portal-driven version. It reuses every decision the original
// makes — `chooseFrameModel`, the collision geometry, the nav-gate band, the
// stair-mouth soft-lock guarantee — and takes only the POSITION and ROTATION
// from the portal, which is the part the rect path got wrong.
//
// ── ONE FRAME PER SIDE, ON PURPOSE ───────────────────────────────────────────
//
// A portal is per (room, corridor), so a corridor joining two rooms produces
// two: one in each room's wall. That is correct and it is why there is no
// dedupe here — unlike the rect emitter, which saw every opening twice (once
// from each side of a shared edge) and had to key them by position to drop the
// duplicate. Each of these is a different hole in a different wall.

/** Below this a hole is build noise, not a way through — matches the rect
 *  emitter's own floor so the two paths agree about what counts as a doorway. */
const MIN_WIDTH = 0.7;

/**
 * Hang a frame in every polygon doorway on this floor.
 *
 * Mutates `spec.props` and `spec.navGates`, like the emitter it replaces.
 * A no-op on floors with no polygon rooms, so it is safe to call unconditionally.
 */
export function emitFramesForPortals(spec: LevelSpec): void {
  const corridors = (spec.corridors ?? []).map((c) => ({ id: c.id, rect: c.rect }));
  if (!corridors.length) return;

  for (const room of spec.rooms ?? []) {
    if (!room.poly || room.poly.length < 3) continue;

    // A stair room's mouth must stay column-free. The stairwell footprint
    // already eats most of a small exit room, so a column at the doorway can
    // pinch the only path to the stair below player width — you can SEE the
    // stairs and cannot reach them. Same guarantee the rect emitter makes.
    const stairMouth = (spec.stairs ?? []).some((st) =>
      Math.abs(st.x - room.rect.x) <= room.rect.w / 2
      && Math.abs(st.z - room.rect.z) <= room.rect.d / 2);

    for (const p of planPortals(room.id, room.poly, corridors)) {
      if (p.width < MIN_WIDTH) continue;
      const corridor = (spec.corridors ?? []).find((c) => c.id === p.corridorId);
      if (!corridor) continue;

      // The frame sits IN the wall, not on its inner face — the portal's
      // midpoint is on the room's outline, so push out half a wall thickness to
      // centre it in the masonry. This is the reveal you walk through.
      const x = p.mid[0] + p.normal[0] * (WALL_T / 2);
      const z = p.mid[1] + p.normal[1] * (WALL_T / 2);

      // The tympanum sizes to the taller of the two spaces so it never falls
      // short of a ceiling; `openHeight` caps the lintel to the corridor's own
      // interior so no slit of void shows above it in a low tunnel.
      const ceiling = Math.max(room.height, corridor.height);
      const { kind, model } = chooseFrameModel({
        width: p.width,
        ceilingHeight: ceiling,
        openHeight: corridor.height,
        // The frame is set INTO this wall, so its depths are solved from it —
        // a 1.10m reveal in 0.25m of stone is what put half of every doorway
        // out in the corridor. See content/frame-depth.ts.
        wallDepth: WALL_T,
        slimOnly: stairMouth,
      });

      const base = {
        kind: 'model' as const, model,
        x, y: 0, z, rotY: p.rotY,
        proximityGlow: true,
      };

      if (kind === 'doorframe') {
        spec.props.push({
          ...base,
          _dbg: 'doorframe-portal',
          collision: stairMouth ? undefined : doorframeCollision(p.width),
        } as PropSpec);
        (spec.navGates ??= []).push({
          x, z, rotY: p.rotY,
          halfBand: stairMouth ? p.width / 2 : doorframePassableHalfBand(p.width),
        });
      } else {
        // Column blockers at the visible column centres, r 0.18 to match their
        // half-width plus a hair. Same numbers as the rect emitter — every
        // centimetre here narrows the gap a player has to walk through, and the
        // soft-lock guarantee is computed against exactly these.
        const colOffset = archwayColumnOffset(p.width);
        spec.props.push({
          ...base,
          _dbg: 'archway-portal',
          collision: [
            { kind: 'circle', r: 0.18, ox: -colOffset, oz: 0 },
            { kind: 'circle', r: 0.18, ox: colOffset, oz: 0 },
          ],
        } as PropSpec);
        (spec.navGates ??= []).push({
          x, z, rotY: p.rotY, halfBand: archwayPassableHalfBand(p.width),
        });
      }
    }
  }
}
