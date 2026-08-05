import * as THREE from 'three';
import { groundYAt } from '../level/elevation';
import type { OpeningSpec, DoorSpec } from '../level/types';
import type { WalkableRegion } from '../level/walkable';
import type { StyleMaterials } from '../style/materials';
import { spawnDoor } from './door';
import { spawnBossMist } from './boss-mist';
import { spawnCobweb, type Destructible } from '../level/destructibles';
import { buildModel } from '../ecs/build-model';
import { chooseFrameModel, installFrameFittings } from '../level/frame';
import { openingEndpoints } from '../level/opening';

// One place that installs ANY fitting into a wall opening. Every opening —
// corridor archway, hinged door, portcullis, boss fog-gate, cobweb — arrives
// here as the same OpeningSpec (world centre + wall-line rotY + gap width) and
// is dispatched to its behaviour. Placement, the stone frame, and the
// movement seal are shared; only the panel/curtain visual + the open-condition
// differ. This is what lets a new room type reuse the battle-tested doorway
// code instead of re-deriving coordinates and breaking on its own.

export interface FittingContext {
  materials: StyleMaterials;
  /** roomId → alive-enemy count, for portcullis unlock checks. */
  enemyRoomMembership: () => Map<string, number>;
  /** Fallback opening height (the containing room's height). */
  roomHeight: number;
  /** Collect a destructible (cobweb) so the level can tick/dispose it. */
  addDestructible: (d: Destructible) => void;
  /** roomId → walkable rect. Arena-trap gates test "player committed inside
   *  the room" against this instead of a door-plane cross. */
  roomRectById: (id: string) => { x: number; z: number; w: number; d: number } | null;
}

const FOG_GATE_HEIGHT = 2.6;   // = doorframe clear opening; the frame's lintel
                               // fill closes the gap up to the room ceiling

export function spawnFitting(
  scene: THREE.Object3D,
  opening: OpeningSpec,
  walkable: WalkableRegion,
  ctx: FittingContext,
): { teardown?: () => void } {
  switch (opening.kind) {
    case 'door-hinged':
    case 'gate-cleared':
    case 'gate-arena':
      // Doors own their seal (wall segment) + state machine internally; the
      // stone frame is already emitted as a prop by the tilemap parser.
      return spawnDoor(scene, openingToDoorSpec(opening), walkable, ctx.materials,
        ctx.enemyRoomMembership, opening.height ?? ctx.roomHeight, ctx.roomRectById);

    case 'cobweb': {
      // Destructible curtain. Seal is now a wall segment (was a hand-tuned
      // circle obstacle) spanning the full gap; slashing the web removes it.
      // Openable: a cobweb curtain is cut through, not walked around. An audit
      // asking about LAYOUT must not treat it as stone (see WallSegment).
      const seg = { ...openingSeg(opening), openable: true };
      walkable.addWall(seg);
      const web = spawnCobweb(scene, opening.x, opening.z, opening.rotY, opening.widthM,
        () => walkable.removeWall(seg));
      ctx.addDestructible(web);
      return {};
    }

    case 'fog-gate': {
      // The boss threshold gets its OWN stone frame here (the parser never
      // framed it — that's the "empty space above" the player saw). The frame
      // fills to the room ceiling; the mist curtain stays door-height. Then
      // the soulslike lifecycle, sealing with the same wall segment doors use.
      buildFrame(scene, opening, ctx.roomHeight);
      const mistH = opening.height ?? FOG_GATE_HEIGHT;
      return spawnBossMist(scene, walkable, {
        x: opening.x, z: opening.z, rotY: opening.rotY, widthM: opening.widthM, height: mistH,
      }, opening.color ?? 0xffd060);
    }

    case 'archway':
      buildFrame(scene, opening, ctx.roomHeight);
      return {};
  }
}

/** Stone doorframe (jambs + lintel fill to the ceiling) centred on the opening.
 *  The lintel fill is what closes the gap above a short curtain. */
function buildFrame(scene: THREE.Object3D, opening: OpeningSpec, ceilingHeight: number): void {
  // Fog-gate / archway openings own their seal and want no columns in the gap,
  // so force the slim doorframe. Routed through the SHARED chooser + fittings
  // installer (level/frame.ts) so these dress identically to corridor + tilemap
  // frames — the nav eye + crown glow now ride the fitting path too.
  const { model } = chooseFrameModel({ width: opening.widthM, ceilingHeight, openHeight: opening.height, slimOnly: true });
  const built = buildModel(model);
  built.group.position.set(opening.x, groundYAt(opening.x, opening.z), opening.z);
  built.group.rotation.y = opening.rotY;
  scene.add(built.group);
  installFrameFittings(built, scene, opening.x, opening.z);
}

/** Endpoints of the opening's gap as a wall-segment shape. */
function openingSeg(o: OpeningSpec): { ax: number; az: number; bx: number; bz: number } {
  if (o.ax !== undefined && o.az !== undefined && o.bx !== undefined && o.bz !== undefined) {
    return { ax: o.ax, az: o.az, bx: o.bx, bz: o.bz };
  }
  return openingEndpoints(o);
}

/** Convert a unified opening into the door builder's legacy spec. */
function openingToDoorSpec(o: OpeningSpec): DoorSpec {
  const seg = openingSeg(o);
  return {
    id: o.id,
    ax: seg.ax, az: seg.az, bx: seg.bx, bz: seg.bz,
    height: o.height,
    hinge: o.hinge,
    swingDir: o.swingDir,
    unlock: o.unlock,
  };
}
