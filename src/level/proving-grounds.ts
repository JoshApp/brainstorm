// Proving Grounds — a parameterized test-floor factory. Instead of hand-
// authoring a chamber per thing-to-test, it GENERATES a real, playable floor
// around a chosen subject: a mob/boss to fight, or an event to poke. The
// subject lists come straight from the registries (ENEMIES, the event table
// below, ITEMS for the loadout in the UI), so new content is test-launchable
// the moment it exists — zero per-test authoring.
//
// All ids are prefixed `proving-` so run-state-listeners skips persistence:
// practising with a hammer against the boiling king can't poison the real save
// or inflate meta records.

import type { LevelSpec, PropSpec, EnemySpawnSpec } from './types';
import { ENEMIES } from '../content/enemies';

const HEIGHT = 3.4;

/** A sealed, lit rectangular room with the player at the south end facing the
 *  subject at the north. The level builder closes the shell from the rect. */
function provingRoom(
  id: string,
  displayName: string,
  w: number,
  d: number,
  fill: { props?: PropSpec[]; spawns?: EnemySpawnSpec[] },
  opts: { torchTint?: number; fogColor?: number; stairTo?: string } = {},
): LevelSpec {
  const roomId = `${id}-room`;
  const tint = opts.torchTint ?? 0xffaa55;
  return {
    id,
    depth: 0,
    displayName,
    fogColor: opts.fogColor ?? 0x14100a,
    startPos: { x: 0, z: d / 2 - 1.5, yaw: 0 },
    rooms: [{ id: roomId, rect: { x: 0, z: 0, w, d }, height: HEIGHT }],
    corridors: [],
    props: fill.props ?? [],
    torches: [
      { x: -(w / 2 + 0.05), z: -(d / 2) + 1.0, height: 2.2, wall: 'W', colorTint: tint, intensityMul: 0.9 },
      { x: (w / 2 + 0.05), z: -(d / 2) + 1.0, height: 2.2, wall: 'E', colorTint: tint, intensityMul: 0.9 },
      { x: -(w / 2 + 0.05), z: (d / 2) - 1.0, height: 2.2, wall: 'W', colorTint: tint, intensityMul: 0.7 },
      { x: (w / 2 + 0.05), z: (d / 2) - 1.0, height: 2.2, wall: 'E', colorTint: tint, intensityMul: 0.7 },
    ],
    spawns: (fill.spawns ?? []).map((s) => ({ ...s, roomId: s.roomId ?? roomId })),
    doors: [],
    stairs: opts.stairTo
      ? [{ x: 0, z: -(d / 2) + 0.9, rotY: Math.PI, targetLevel: opts.stairTo }]
      : [],
  };
}

// ── Fight: any mob or boss, dropped into an arena ────────────────────
export function buildFightLevel(enemyId: string): LevelSpec | null {
  const spec = ENEMIES[enemyId];
  if (!spec) return null;
  const boss = !!spec.isBoss;
  // Bosses get a bigger arena; both scale a little with the model.
  const size = boss ? 18 : 11;
  return provingRoom(
    `proving-fight-${enemyId}`,
    spec.bossName ?? spec.name ?? enemyId,
    size, size,
    {
      // Active (not dormant): no fog-gate ceremony in a test arena — you walk
      // up and fight. (Dormant bosses only wake on a mist cross, which we omit.)
      spawns: [{ enemyId, x: 0, z: -(size / 2) + 3, dormant: false }],
    },
    {
      torchTint: boss ? 0xff6030 : 0xffaa55,
      fogColor: boss ? 0x180806 : 0x14100a,
      stairTo: 'proving-depth-1',
    },
  );
}

// ── Events: a room built around one interactable to test ─────────────
export interface ProvingEvent {
  id: string;
  label: string;
  prop: PropSpec;
}

// Declaratively-placeable events. (Shrouded relics need a runtime spawn, so
// they're a fast-follow, not in this list yet.)
export const PROVING_EVENTS: ProvingEvent[] = [
  { id: 'chest-iron', label: 'Chest (iron)', prop: { kind: 'chest', x: 0, z: -2.5, tier: 'iron' } },
  { id: 'chest-boss', label: 'Chest (boss)', prop: { kind: 'chest', x: 0, z: -2.5, tier: 'boss' } },
  { id: 'chest-mimic', label: 'Mimic chest', prop: { kind: 'chest', x: 0, z: -2.5, tier: 'iron', mimic: true } },
  { id: 'fountain-gamble', label: 'Fountain (gamble)', prop: { kind: 'fountain', x: 0, z: -2.5, variant: 'gamble' } },
  { id: 'fountain-rest', label: 'Fountain (rest)', prop: { kind: 'fountain', x: 0, z: -2.5, variant: 'rest' } },
  { id: 'fountain-tainted', label: 'Fountain (tainted)', prop: { kind: 'fountain', x: 0, z: -2.5, variant: 'tainted' } },
  { id: 'spike-trap', label: 'Spike trap', prop: { kind: 'spike-trap', x: 0, z: -2.5 } },
  { id: 'merchant', label: 'Wandering merchant', prop: { kind: 'merchant', x: 0, z: -2.5 } },
  { id: 'corpse-note', label: 'Corpse + note', prop: { kind: 'corpse', x: 0, z: -2.5, note: 'a proving-grounds corpse. it tested nothing and died anyway.' } },
];

export function buildEventLevel(eventId: string): LevelSpec | null {
  const ev = PROVING_EVENTS.find((e) => e.id === eventId);
  if (!ev) return null;
  return provingRoom(
    `proving-event-${eventId}`,
    ev.label,
    9, 9,
    { props: [ev.prop] },
    { stairTo: 'proving-depth-1' },
  );
}
